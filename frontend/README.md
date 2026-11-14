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
The frontend retains the terrain image, Google Fonts typography (Plus Jakarta Sans and IBM Plex Mono), coordinate controls, layers, zoom/pan, markers, and draggable/resizable route information panel. Fonts require network access; CSS fallback fonts remain available.

## Future backend integration

This is currently a visual prototype. Coordinates are normalized map positions (0–100), not planetary latitude/longitude. Route curves are illustrative and metrics remain pending; the Climate Map is a placeholder, not a scientific data layer.

LithoSphere and Python/FastAPI are not bundled. A future service should define coordinate projection, route requests/results, terrain tile endpoints, and climate metadata before replacing the local preview state in src/App.tsx. Keep datasets and backend secrets on the server; use a VITE_API_BASE_URL environment variable when an API is introduced. VITE_ variables are public browser configuration. Configure CORS on FastAPI or a Vite development proxy when connecting it.

No external datasets or backend checkout are required to run this frontend.

