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

Inputs and terrain clicks use this same coordinate system. The base is fixed at X 49.34593023%, Y 45.99253794%, the center of the lowest-mean-risk 5×5 traversable routing-grid area; its read-only fields display three decimal places while calculations retain full precision. Only the destination can be edited or selected on the map. Destination coordinates must be finite, within 0–100, and inside the native valid-triangle mask. Invalid edits show an inline error and hide the corresponding marker until corrected; they never clamp or silently move a marker to other terrain. Marker height is interpolated on the currently rendered 8-pixel mesh. It is not an additional native elevation measurement.

Drag to rotate, right-drag to pan, and scroll/pinch, use +/−, or the vertical zoom slider to zoom. The scale slider stays synchronized with camera zoom in both 2D and 3D. The 2D top view aligns a square grid to the DTM bounds, with cells approximately 1 km across, and displays a dynamic metric scale bar beside the map legend. Both follow map zoom and pan. Select on map enables destination picking; drags do not place destinations, and background/NoData clicks leave the destination unchanged. Map controls are scoped to the canvas, so sidebar scrolling does not move the camera.

Run `npm run test:terrain` with the local bundle present to verify coordinate validation, native-mask rejection, source sample heights, surface interpolation and ray picking against real terrain data.

## Calculate a route with Python

Calculate Route sends the current Start and Destination coordinates to `POST /api/route`, then draws the JSON response on the terrain. A centered loading overlay with animated ellipsis remains visible while the request is pending; the backend does not report a measurable completion percentage. The inputs and map destination picker share the same normalized coordinate system. Python snaps endpoints to its approximately 4 m grid; Base and Destination synchronize to those returned centers. Editing coordinates or selecting a new destination clears the old route and cancels display of any stale response. After the route is successfully displayed, the draggable/resizable/collapsible Route Information popup shows the backend risk index, Mars terrain distance and estimated time. New requests, failed requests and coordinate edits clear the previous analysis.

From the repository root run `py -m uvicorn backend.api:app --host 127.0.0.1 --port 8000`. In another terminal start the frontend with `cd frontend` then `npm run dev`. Both Vite development and preview proxy `/api` to that Python process. Static hosting needs an equivalent reverse proxy. No backend files or `.env` are exposed by the frontend server. The previous saved-file middleware has been replaced; `backend/route_threejs.json` remains a CLI-generated sample/test fixture and is not overwritten by API requests.

The current JSON has a 1549-column × 3619-row, factor-4 grid from the original 6196 × 14478 IMG and omits georeferencing. `savedRoute.ts` explicitly adapts that legacy Phlegra format: original pixel center = `(output index + 0.5) * original size / output size - 0.5`, then subtract the GeoTIFF's 2-column/1-row border offset. The two axes use their actual resampling ratios, not an assumed identical factor. Existing JSON `x/z/u/v/elev` fields are not used for placement. A different grid/DTM is rejected rather than guessed; future exports should carry the original source identity, CRS and affine transform.

The route is densely sampled against the existing terrain surface and native validity mask, split at NoData gaps, and drawn 2 metres above the rendered mesh to avoid surface flicker. This lift is visual only. The terrain geometry, elevation dataset, camera behavior, and Python algorithms are unchanged. Route tests cover the real JSON's mapping, endpoint alignment, draping, validity and malformed payload rejection.

## Future backend integration

The local Python routing API and its analysis summary popup are connected. Calibrated thermal emission data and numerical surface dust cover values are not integrated into the map layers. Thermal Emission and Surface Dust Cover Index explicitly report their scientific data as unavailable. Selecting them recolors the existing DTM elevation using reference-inspired palettes; this is not a thermal or dust measurement. Scientific data availability is shown in the layer menu. The supplied JPEGs inspire palette colors only and are not loaded, georeferenced or used as measurements. Altitude Map retains the original elevation/slope visualization.

The three Map Layers options form one keyboard-accessible radio group. Layer changes update a material uniform and request a render; they do not recreate the terrain geometry, reload data, replace the material, or reset camera/marker state. Compact legends show actual DTM min/max elevations for Altitude. Thermal Emission uses Colder/Hotter as a qualitative color key, keeps its original title, and shows no Kelvin/Celsius values because calibrated temperatures are unavailable. Preview colors do not have scientific units and still follow DTM elevation, not thermal/dust measurements.

DCI is mean emissivity at 1350–1400 cm⁻¹: lower DCI indicates more dust, and higher DCI less dust. The [official TES DCI scale](https://mars.asu.edu/data/tes_ruffdust/large/tes_ruffdust_label.png) places yellow toward more dust than green. The existing green-to-yellow ramp is not reversed: its left endpoint is Less dust and right endpoint More dust. The local dust PNG is RGB with no calibration metadata; no numerical DCI is inferred from pixel colors, the backend's hue proxy, or the published global range. Legends show only the layer title, color bar and qualitative endpoints; explanatory paragraphs and palette-preview labels are omitted from the visible UI. Scientific interpretation: [Ruff and Christensen / ASU TES DCI](https://tes.asu.edu/~ruff/DCI/dci.html).

`src/terrain/layers.ts` keeps palettes and scientific availability separate and defines `DtmAlignedScientificRaster` for future real products. Before connecting a real raster, align its CRS, affine transform, pixel dimensions and pixel-center convention with the DTM, preserve its own NoData mask, and supply source product identity, units and display range. No scientific raster loader or geographic reprojection is implemented by this preview change.

The Route Information panel retains its existing styles and drag/resize/collapse behavior. It opens only for a successfully displayed route and reads `summary.risk_index`, `summary.total_distance_m` and `summary.est_time_hms` from that same response. Risk uses the backend's 1–10 scale; distance is formatted in metres or kilometres; estimated time uses the backend's returned text (or numeric hours if text is absent). Missing, nonfinite or invalid metrics show Unavailable rather than fabricated results. These are estimates from the existing backend model, not additional frontend risk classifications or calibrated measurements. The panel stays inside the map when resizing the window.

LithoSphere and raw terrain files are not bundled in the repository. FastAPI runs as a separate local Python process; the frontend makes route requests through the Vite proxy.
