# Martian Navigator frontend

Standalone React + TypeScript application for the NASA Space Apps project.

## Local development

Use Node 22.12+ (22.x) or Node 24+ and npm.

    cd frontend
    npm ci
    npm run dev

Open the local URL printed by Vite (usually http://localhost:5173).

    npm run typecheck
    npm run build
    npm run preview

The production output is generated in dist/. Serve it with a static web server.
The dashboard at `/` uses the real Phlegra Montes Three.js terrain. `/terrain-test` remains available for renderer experiments. Both share the worker, numerical bundle, material, lighting and camera controls. Google Fonts typography (Plus Jakarta Sans and IBM Plex Mono) requires network access; fallback fonts remain available.

The local terrain bundle must exist at `public/terrain/phlegra-full/whole.bin.gz`. It is ignored by Git. See [terrain setup and rendering limits](src/terrain/README.md) to generate it from the original GeoTIFF. No terrain data is modified by dashboard interactions.

## Coordinates and interactions

X and Y are normalized percentages (0–100), not latitude/longitude or metres. The northwest pixel center is (0, 0); X increases eastward and Y southward across the entire GeoTIFF pixel-center extent. Thus `column = X / 100 * (6193 - 1)` and `row = Y / 100 * (14476 - 1)`. The source Mars affine transform supplies the projected location of that pixel. Rendered world coordinates are centered projected metres, east = +X, south = +Z and elevation = +Y.

Inputs and terrain clicks use this same coordinate system. Coordinates must be finite, within 0–100, and inside the native valid-triangle mask. Invalid edits show an inline error and hide the corresponding marker until corrected; they never clamp or silently move a marker to other terrain. Marker height is interpolated on the currently rendered 8-pixel mesh. It is not an additional native elevation measurement.

Drag to rotate, right-drag to pan, and scroll/pinch or use +/− to zoom. Select on map enables destination picking; drags do not place destinations, and background/NoData clicks leave the destination unchanged. Map controls are scoped to the canvas, so sidebar scrolling does not move the camera.

Run `npm run test:terrain` with the local bundle present to verify coordinate validation, native-mask rejection, source sample heights, surface interpolation and ray picking against real terrain data.

## Future backend integration

No backend, routing algorithm, risk calculation, thermal emission data or surface dust cover data is connected. Calculate Route displays "Route calculation is not connected yet." No route or fabricated metrics are drawn. Thermal Emission and Surface Dust Cover Index explicitly report their scientific data as unavailable. Selecting them displays an optional palette preview driven by existing DTM elevation, with a persistent notice that it is not a thermal or dust measurement. The supplied JPEGs inspire palette colors only and are not loaded, georeferenced or used as measurements. Altitude Map retains the original elevation/slope visualization.

The three Map Layers options form one keyboard-accessible radio group. Layer changes update a material uniform and request a render; they do not recreate the terrain geometry, reload data, replace the material, or reset camera/marker state. Compact legends show actual DTM min/max elevations for Altitude and nonnumeric palette endpoints for previews. Preview colors do not have scientific units.

`src/terrain/layers.ts` keeps palettes and scientific availability separate and defines `DtmAlignedScientificRaster` for future real products. Before connecting a real raster, align its CRS, affine transform, pixel dimensions and pixel-center convention with the DTM, preserve its own NoData mask, and supply source product identity, units and display range. No scientific raster loader or geographic reprojection is implemented by this preview change.

The Route Information panel's styles, dragging, resizing and collapsing implementation are retained in `src/App.tsx`. The panel is gated off until actual route results exist. No current UI action opens it.

LithoSphere and Python/FastAPI are not bundled. The frontend makes no backend API requests.
