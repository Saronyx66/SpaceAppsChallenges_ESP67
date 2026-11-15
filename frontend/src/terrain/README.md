# Whole Phlegra Montes experiment

Open `/terrain-test` after starting `npm run dev`. The dashboard at `/` now embeds this same renderer through `DashboardTerrain.tsx`; both pages share `useWholeTerrain.ts`, `TerrainScene.tsx`, the worker and material. The renderer is lazy-loaded. The dashboard retains its sidebar, theme, layout and route panel implementation.

This viewer renders the entire `Phlegra_DTM_full.tif`: **6193 × 14476 pixels**, **6.216736 × 14.531481 km**, **1.0038326485352 m/pixel**. It preserves the native Mars CRS, geographic proportions and 1× vertical scale. Elevations range from −3312.663330078125 to −3051.7724609375 m. There are 65,566,202 valid source samples. The GeoTIFF contains all valid terrain from the original IMG; only a thin NoData border was removed before this experiment.

## One mesh, one data bundle

There are no terrain chunks, streamed tiles, LOD pyramids or LithoSphere dependencies. A worker downloads and decompresses **one 112.5 MiB gzip bundle**, builds **one indexed BufferGeometry**, and transfers its buffers to the viewer. It does not fetch additional data on zoom or pan.

The whole-region mesh can be rebuilt at source sample strides 4, 8 (default), or 16, giving spacings approximately 4.015, 8.031 and 16.061 m. The finest mesh has 5,607,380 vertices. Every valid selected elevation retains its original float32 bit pattern. Last row/column samples are always included, so coverage is never shortened. The mesh is centered in projected metres and relative elevation only to maintain numerical precision. There is no vertical exaggeration.

**This is not a full native-resolution geometric mesh.** A native grid would have 89.6 million vertices and require multiple gigabytes of CPU/GPU buffers. With the user's single-mesh constraint, geometric sampling is the explicit performance tradeoff. Native-resolution surface normals preserve visual shading detail on zoom, but cannot restore silhouette/parallax detail omitted by the mesh. Rendering all metre-scale geometry efficiently requires a different strategy such as chunking, which this version does not use.

## Native numerical shading and NoData

The bundle contains a 4-pixel sampled float32 grid, a 2-bit-per-native-cell triangle validity mask, and packed numerical normals calculated from immediate valid native elevation neighbours. Normal X/Z components are quantized to 8 bits each, with Y reconstructed in the shader. Bilinear normal interpolation provides smooth shading. Elevation/slope mineral colors and the previous rough material and lights are retained. These numerical data textures are not photographic imagery.

The fragment shader checks the exact native triangle mask at every LOD: it never paints over NoData holes, and preserves the same irregular valid-triangle footprint as the original crop renderer. It uses uint addressing to avoid precision loss with 89 million cell indices. A valid isolated sample cannot form a triangle and is not rendered. Invalid mesh support vertices receive nearest-valid sampled heights solely to keep interpolation finite; they do not change any valid sampled elevation. Masked support is invisible. Coarse geometry next to boundaries remains an approximation of the native surface.

## Reproduce and verify

Generated full-terrain assets are ignored by Git. Do not add the source GeoTIFF, generated large data bundle, or LithoSphere checkout to GitHub. The old 1024-square export is retained for reproducibility but is not loaded by this viewer.

From `frontend/`:

```powershell
py -m pip install -r scripts/requirements-terrain.txt
py scripts/export_full_terrain.py 'C:/path/to/Phlegra_DTM_full.tif'
py scripts/verify_full_terrain.py 'C:/path/to/Phlegra_DTM_full.tif'
npm run typecheck
npm run build
npm run dev
```

The verifier compares every selected valid float32 sample bit-for-bit and every native triangle mask bit, plus full dimensions, CRS, affine transform, resolution and payload sizes. The metadata includes a SHA-256 fingerprint of the source.

## Hardware and hosting

This intentionally loads the entire dataset in one pass. It needs a capable GPU, WebGL2, texture dimensions of at least 8192, and several hundred MB of free CPU/GPU memory. The detailed 4 m mesh adds substantial memory and render cost; 16 m reduces geometry, though native shading/mask memory stays fixed. It is not optimized for mobile GPUs. Worker construction avoids blocking the UI during CPU geometry creation; the initial GPU upload can still pause rendering.

The gzip payload is about 112.5 MiB and expands to roughly 214 MiB. The worker handles both Vite's `Content-Encoding: gzip` response (automatically decoded by fetch) and binary gzip assets served without that header. Configure SPA fallback for `/terrain-test` without rewriting data URLs to HTML. This full dataset is included in local Vite production output but remains ignored in Git. The build warns about the lazy renderer's approximately 250 kB gzip JavaScript chunk; the dashboard does not load it.

References: [Three.js DataTexture](https://threejs.org/docs/pages/DataTexture.html), [Three.js BufferGeometry](https://threejs.org/docs/pages/BufferGeometry.html).
