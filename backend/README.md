# Local backend data

Keep the raw HiRISE IMG outside the Git repository. Copy `.env.example` to `.env` and set `MARS_DATA_DIR` to the directory containing `DTEEC_060707_2160_060773_2160_A01.IMG`. The API loads `backend/.env` explicitly with python-dotenv. Existing process environment variables take precedence. Absolute paths are recommended; relative values are resolved against the backend directory. Each teammate supplies their own local path; no personal dataset paths are committed.

`themis_day_colored.png` and `dust_dci_dtm_extent_smooth.png` remain versioned beside `main.py`. The API resolves their paths from `Path(__file__).resolve().parent`, independently of the working directory. No imagery or raw terrain is downloaded automatically.

Install dependencies in a virtual environment from `backend/`:

```powershell
py -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements.txt
```

Running `main.py` directly executes the existing CLI routing pipeline using its existing path defaults and START/GOAL constants. Importing it does not run routing. The API sets paths in its own Python process without modifying the algorithm file; local CLI path customizations remain local. The routing functions and calculations are unchanged by this configuration setup. Large IMG/TIF/TIFF files, local `.env` files, Python environments and caches are ignored; these rules do not ignore PNG inputs.

## Connect the frontend's Start and Destination

From the repository root, run the local service in one terminal:

```powershell
py -m uvicorn backend.api:app --host 127.0.0.1 --port 8000
```

Start the frontend in another terminal with `cd frontend` then `npm run dev`. Its Vite proxy forwards `/api` to the local Python process; Vite preview uses the same proxy. Static hosting needs an equivalent reverse proxy to the Python service.

`POST /api/route` accepts the same normalized DTM coordinates as the sidebar:

```json
{"start":{"x":32.2916666667,"y":55.2787948464},"goal":{"x":32.2916666667,"y":55.4170}}
```

X increases east and Y south from the northwest pixel center, each from 0 to 100. The adapter accounts for the original IMG's 2-column/1-row border and Rasterio's separate X/Y resampling scales, then chooses the nearest factor-4 routing-grid cell. It checks both requested positions and snapped cell centers against native NoData, and checks snapped endpoints against the existing cost map. The frontend synchronizes its markers to the returned cell centers. Endpoints in the same cell, invalid coordinates, non-traversable endpoints and no-route results return explicit errors.

The service calls the existing `astar`, `simplify`, command conversion and JSON exporter with the request's start/goal, without changing their calculations or mutating the module's `START`/`GOAL` constants. Those constants remain defaults for manually running `main.py`. HTTP requests do not open plot windows or overwrite the tracked `route_threejs.json`; the existing JSON exporter uses a temporary file and the response is returned directly to React.

The first request prepares the current routing data (several seconds locally), then caches it until the source IMG or PNG files change. Only one calculation runs at a time; another request receives a busy response rather than starting another expensive search. Canceling a browser request or changing inputs prevents stale display in React, but does not interrupt an A* calculation already running in Python. Restart the service after changing algorithm code or parameters. `/api/health` identifies the service and reports whether data is cached.

Run fast adapter tests with `py -m unittest backend.test_api -v`. They use the actual local DTM for coordinate/NoData checks and do not prepare cost maps or run A*. The local service requires FastAPI and Uvicorn, included in `requirements.txt`.
