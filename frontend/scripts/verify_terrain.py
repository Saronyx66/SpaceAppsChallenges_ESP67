"""Verify the browser export against the original GeoTIFF, without resampling."""
import argparse
import json
from pathlib import Path

import numpy as np
import rasterio
from rasterio.windows import Window

parser = argparse.ArgumentParser()
parser.add_argument('source', type=Path)
parser.add_argument('--export', type=Path, default=Path('public/terrain/phlegra'))
args = parser.parse_args()
meta = json.loads((args.export / 'metadata.json').read_text())
shape = (meta['height'], meta['width'])
heights = np.fromfile(args.export / 'elevation.f32', dtype='<f4').reshape(shape)
mask = np.fromfile(args.export / 'valid.u8', dtype='uint8').reshape(shape).astype(bool)
with rasterio.open(args.source) as src:
    window = Window(meta['window']['col'], meta['window']['row'], meta['width'], meta['height'])
    original = src.read(1, window=window, masked=True)
    expected_mask = ~np.ma.getmaskarray(original) & np.isfinite(original.data)
    expected = (original.data.astype(np.float64) * src.scales[0] + src.offsets[0]).astype('<f4')
    np.testing.assert_array_equal(mask, expected_mask)
    np.testing.assert_array_equal(heights[mask], expected[mask])
    np.testing.assert_array_equal(meta['transform'], list(src.window_transform(window))[:6])
    assert rasterio.crs.CRS.from_wkt(meta['crsWkt']) == src.crs
    assert meta['resolution'] == list(src.res)
    assert meta['noData'] == src.nodata
    assert meta['validCount'] == int(mask.sum())
    if (~mask).any():
        np.testing.assert_array_equal(heights[~mask], original.data[~mask])
print('PASS: every valid elevation, validity mask, NoData, affine transform, CRS, resolution and valid count match the GeoTIFF.')
