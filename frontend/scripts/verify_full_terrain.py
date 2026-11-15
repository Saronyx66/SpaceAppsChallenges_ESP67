"""Check every selected valid sample and every native triangle mask bit."""
import argparse
import gzip
import json
import struct
from pathlib import Path
import numpy as np
import rasterio
from rasterio.windows import Window

p=argparse.ArgumentParser()
p.add_argument('source',type=Path)
p.add_argument('--bundle',type=Path,default=Path('public/terrain/phlegra-full/whole.bin.gz'))
args=p.parse_args()
with gzip.open(args.bundle,'rb') as f, rasterio.open(args.source) as src:
    assert f.read(4)==b'PHL1'
    length=struct.unpack('<I',f.read(4))[0]
    m=json.loads(f.read(length))
    grid=np.frombuffer(f.read(m['gridBytes']),dtype='<f4').reshape(m['gridHeight'],m['gridWidth'])
    packed=np.frombuffer(f.read(m['maskBytes']),dtype='uint8')
    assert (m['width'],m['height'])==(src.width,src.height)
    assert m['transform']==list(src.transform)[:6]
    assert rasterio.crs.CRS.from_wkt(m['crsWkt'])==src.crs
    assert m['resolution']==list(src.res)
    xs=np.unique(np.append(np.arange(0,src.width,4),src.width-1))
    ys=np.unique(np.append(np.arange(0,src.height,4),src.height-1))
    compared=0
    for r,y in enumerate(ys):
        z=src.read(1,window=Window(0,int(y),src.width,1))[0,xs]
        valid=src.read_masks(1,window=Window(0,int(y),src.width,1))[0,xs]>0
        np.testing.assert_array_equal(grid[r,valid].view('uint32'),z[valid].view('uint32'))
        compared+=int(valid.sum())
    for row in range(0,src.height-1,256):
        n=min(256,src.height-1-row)
        valid=src.read_masks(1,window=Window(0,row,src.width,n+1))>0
        flags=((valid[:-1,:-1]&valid[1:,:-1]&valid[:-1,1:]).astype('uint8')
              | ((valid[:-1,1:]&valid[1:,:-1]&valid[1:,1:]).astype('uint8')<<1)).ravel()
        i=np.arange(row*(src.width-1),(row+n)*(src.width-1),dtype='int64')
        decoded=(packed[i//4]>>(2*(i%4)))&3
        np.testing.assert_array_equal(decoded,flags)
    # Validate normal payload size without holding another full copy in memory.
    normal_bytes=0
    while block:=f.read(1024*1024): normal_bytes+=len(block)
    assert normal_bytes==m['normalBytes']
    print(f'PASS: {compared:,} selected valid elevations bit-identical; every native triangle mask bit matches; entire extent, CRS, affine, resolution and payload sizes match.')
