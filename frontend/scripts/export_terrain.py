"""Extract native-resolution Mars elevations; never reproject or fill NoData."""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import rasterio
from rasterio.windows import Window
from rasterio.warp import transform as project

parser = argparse.ArgumentParser()
parser.add_argument("source", type=Path)
parser.add_argument("--output", type=Path, default=Path("public/terrain/phlegra"))
args = parser.parse_args()
size = 1024
with rasterio.open(args.source) as src:
    if src.width < size or src.height < size or not src.crs:
        raise ValueError("Source must have a CRS and at least 1024 x 1024 pixels")
    best = None
    # Deterministic overlapping native-resolution search. Prefer nearly complete
    # windows, then robust relief; avoid selecting a single extreme outlier.
    for row in range(0, src.height - size + 1, 512):
        for col in range(0, src.width - size + 1, 512):
            window = Window(col, row, size, size)
            data = src.read(1, window=window, masked=True)
            valid = ~np.ma.getmaskarray(data) & np.isfinite(data.data)
            fraction = float(valid.mean())
            if fraction < 0.99:
                continue
            values = data.data[valid].astype(np.float64) * src.scales[0] + src.offsets[0]
            relief = float(np.percentile(values, 98) - np.percentile(values, 2))
            if best is None or relief > best[0]:
                best = (relief, window)
    if best is None:
        raise ValueError("No window with at least 99% valid elevations found")
    relief, window = best
    data = src.read(1, window=window, masked=True)
    valid = ~np.ma.getmaskarray(data) & np.isfinite(data.data)
    elevations = (data.data.astype(np.float64) * src.scales[0] + src.offsets[0]).astype('<f4')
    # Original NoData sentinel remains in the elevation file; explicit mask is
    # authoritative. Browser excludes all triangles touching invalid samples.
    elevations[~valid] = src.nodata if src.nodata is not None else np.nan
    affine = src.window_transform(window)
    corners = [affine * p for p in [(0, 0), (size, 0), (size, size), (0, size)]]
    lon, lat = project(src.crs, src.crs.geodetic_crs, *zip(*corners))
    args.output.mkdir(parents=True, exist_ok=True)
    elevations.tofile(args.output / 'elevation.f32')
    valid.astype('uint8').tofile(args.output / 'valid.u8')
    metadata = {
        'width': size, 'height': size, 'source': args.source.name,
        'productId': src.tags().get('PRODUCT_ID'),
        'sourceSha256': hashlib.file_digest(args.source.open('rb'), 'sha256').hexdigest(),
        'sourceSize': [src.width, src.height],
        'window': {'col': int(window.col_off), 'row': int(window.row_off)},
        'crsWkt': src.crs.to_wkt(), 'transform': list(affine)[:6],
        'sourceTransform': list(src.transform)[:6],
        'resolution': list(src.res), 'horizontalUnits': 'metres',
        'elevationUnits': 'metres (HiRISE DTM; band unit tag absent)',
        'noData': src.nodata, 'scale': src.scales[0], 'offset': src.offsets[0],
        'projectedCorners': corners, 'geographicCorners': list(zip(lon, lat)),
        'geographicBounds': [min(lon), min(lat), max(lon), max(lat)],
        'validCount': int(valid.sum()), 'min': float(elevations[valid].min()),
        'max': float(elevations[valid].max()), 'robustRelief': relief,
        'encoding': 'little-endian float32 elevations; uint8 mask (1 valid, 0 invalid); row-major',
        'pixelInterpretation': 'Area; mesh vertices at pixel centers',
    }
    (args.output / 'metadata.json').write_text(json.dumps(metadata, indent=2))
    print(json.dumps(metadata, indent=2))
