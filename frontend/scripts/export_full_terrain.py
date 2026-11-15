"""One full-extent numerical terrain bundle. No chunks or pyramids."""
import argparse
import gzip
import hashlib
import json
import struct
from pathlib import Path
import numpy as np
import rasterio
from rasterio.warp import transform as project
from scipy.ndimage import distance_transform_edt

p = argparse.ArgumentParser()
p.add_argument('source', type=Path)
p.add_argument('--output', type=Path, default=Path('public/terrain/phlegra-full'))
args = p.parse_args()
args.output.mkdir(parents=True, exist_ok=True)
with rasterio.open(args.source) as src:
    z = src.read(1)
    valid = (src.read_masks(1) > 0) & np.isfinite(z)
    if src.scales != (1.0,) or src.offsets != (0.0,) or src.transform.b or src.transform.d:
        raise ValueError('Expected unscaled north-up Phlegra DTM')
    h, w = z.shape
    lo, hi = float(z[valid].min()), float(z[valid].max())
    xs = np.unique(np.append(np.arange(0,w,4),w-1))
    ys = np.unique(np.append(np.arange(0,h,4),h-1))
    grid = z[np.ix_(ys,xs)].copy()
    gm = valid[np.ix_(ys,xs)]
    grid[~gm] = grid[tuple(distance_transform_edt(~gm, return_distances=False, return_indices=True))][~gm]
    grid = grid.astype('<f4')
    print(f'Whole-region grid: {w} x {h}; finest mesh {len(xs)} x {len(ys)}', flush=True)
    flags = ((valid[:-1,:-1] & valid[1:,:-1] & valid[:-1,1:]).astype('uint8')
             | ((valid[:-1,1:] & valid[1:,:-1] & valid[1:,1:]).astype('uint8') << 1)).ravel()
    flags = np.pad(flags,(0,(-flags.size)%4)).reshape(-1,4)
    packed = (flags[:,0] | flags[:,1]<<2 | flags[:,2]<<4 | flags[:,3]<<6)
    mw = 4096
    mh = int(np.ceil(packed.size/mw))
    packed = np.pad(packed,(0,mw*mh-packed.size))
    # Native numeric normals: two unsigned bytes per source pixel.
    nw = 8192
    nh = int(np.ceil(w*h*2/(nw*4)))
    normal = np.zeros(nw*nh*4,dtype='uint8')
    for row in range(0,h,256):
        end=min(h,row+256)
        center=z[row:end].copy();cm=valid[row:end]
        center[~cm]=0
        left=np.concatenate([center[:,:1],center[:,:-1]],axis=1)
        right=np.concatenate([center[:,1:],center[:,-1:]],axis=1)
        lm=np.concatenate([cm[:,:1],cm[:,:-1]],axis=1)
        rm=np.concatenate([cm[:,1:],cm[:,-1:]],axis=1)
        top=z[np.maximum(0,np.arange(row,end)-1)]
        bottom=z[np.minimum(h-1,np.arange(row,end)+1)]
        tm=valid[np.maximum(0,np.arange(row,end)-1)]
        bm=valid[np.minimum(h-1,np.arange(row,end)+1)]
        dx=(np.where(rm,right,center)-np.where(lm,left,center))/((lm.astype('float32')+rm).clip(1)*src.res[0])
        dz=(np.where(bm,bottom,center)-np.where(tm,top,center))/((tm.astype('float32')+bm).clip(1)*src.res[1])
        dx[~cm]=0;dz[~cm]=0
        length=np.sqrt(1+dx*dx+dz*dz)
        enc=np.stack([np.round((-dx/length*.5+.5)*255),np.round((-dz/length*.5+.5)*255)],axis=-1).astype('uint8')
        normal[row*w*2:end*w*2]=enc.ravel()
    corners=[src.transform*v for v in [(0,0),(w,0),(w,h),(0,h)]]
    lon,lat=project(src.crs,src.crs.geodetic_crs,*zip(*corners))
    meta={'width':w,'height':h,'gridWidth':len(xs),'gridHeight':len(ys),'baseStep':4,
          'resolution':list(src.res),'transform':list(src.transform)[:6],'crsWkt':src.crs.to_wkt(),
          'geographicBounds':[min(lon),min(lat),max(lon),max(lat)],'projectedCorners':corners,
          'min':lo,'max':hi,'validCount':int(valid.sum()),'noData':src.nodata,
          'source':args.source.name,'sourceSha256':hashlib.sha256(args.source.read_bytes()).hexdigest(),
          'productId':src.tags().get('PRODUCT_ID'),'maskSize':[mw,mh],'normalSize':[nw,nh],
          'gridBytes':grid.nbytes,'maskBytes':packed.nbytes,'normalBytes':normal.nbytes,
          'encoding':'PHL1, LE uint32 JSON length, JSON, float32 grid, uint8 packed triangle mask, uint8 native normals; gzip',
          'note':'One global mesh; native mask/normals; mesh steps 4/8/16. Valid grid samples exact; invisible invalid support uses nearest valid.'}
    header=json.dumps(meta).encode()
    with gzip.open(args.output/'whole.bin.gz','wb',compresslevel=6) as out:
        out.write(b'PHL1');out.write(struct.pack('<I',len(header)));out.write(header)
        out.write(grid.tobytes());out.write(packed.tobytes());out.write(normal.tobytes())
    (args.output/'metadata.json').write_text(json.dumps(meta,indent=2))
    print(f'Exported one bundle: {(args.output/"whole.bin.gz").stat().st_size/1024**2:.1f} MiB',flush=True)
