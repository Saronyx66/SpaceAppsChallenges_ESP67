"""Local HTTP adapter for the existing routing algorithm; no plotting on requests."""
import json
import logging
import math
import os
import tempfile
from functools import lru_cache
from pathlib import Path
from threading import Lock

import numpy as np
import rasterio
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict, Field, FiniteFloat
from rasterio.windows import Window
from dotenv import load_dotenv

# API configuration is portable and independent of local edits to main.py.
# Load it before importing the algorithm; only the __main__ guard is required
# in the shared algorithm file. Never persist a machine-specific path in Git.
BACKEND_DIR = Path(__file__).resolve().parent
load_dotenv(BACKEND_DIR / ".env", override=False)
_data_dir = os.environ.get("MARS_DATA_DIR", "").strip()
if not _data_dir:
    raise RuntimeError("Set MARS_DATA_DIR in backend/.env or the environment to your external Phlegra dataset folder.")
_dataset_dir = Path(_data_dir).expanduser()
if not _dataset_dir.is_absolute():
    _dataset_dir = BACKEND_DIR / _dataset_dir

from . import main as routing

routing.DTM = _dataset_dir.resolve() / "DTEEC_060707_2160_060773_2160_A01.IMG"
routing.THEMIS_PNG = BACKEND_DIR / "themis_day_colored.png"
routing.DUST_PNG = BACKEND_DIR / "dust_dci_dtm_extent_smooth.png"

app = FastAPI(title="Martian Navigator local routing")
_route_lock = Lock()
_log = logging.getLogger(__name__)
FACTOR = 4
# Frontend GeoTIFF is the original IMG minus only its NoData border.
SOURCE_WIDTH, SOURCE_HEIGHT = 6196, 14478
FRONT_WIDTH, FRONT_HEIGHT = 6193, 14476
CROP_COL, CROP_ROW = 2, 1


class Coordinate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    x: FiniteFloat = Field(ge=0, le=100, strict=True)
    y: FiniteFloat = Field(ge=0, le=100, strict=True)


class RouteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    start: Coordinate
    goal: Coordinate


def _check_source(src):
    if (src.width, src.height) != (SOURCE_WIDTH, SOURCE_HEIGHT):
        raise HTTPException(503, "Configured DTM does not match the frontend Phlegra terrain.")
    expected = (1.0038326485352, 0, -3075.7432351118528, 0, -1.0038326485352, 2107125.035887268)
    if not src.crs or any(abs(a-b) > 1e-6 for a,b in zip(tuple(src.transform)[:6], expected)):
        raise HTTPException(503, "Configured DTM georeferencing does not match the frontend.")


def _valid_native(src, col, row):
    c, r = math.floor(col), math.floor(row)
    if c < 0 or r < 0 or c + 1 >= src.width or r + 1 >= src.height:
        return False
    data = src.read(1, window=Window(c,r,2,2), masked=True)
    valid = ~np.ma.getmaskarray(data) & np.isfinite(data.data)
    if col-c+row-r <= 1:
        return bool(valid[0,0] and valid[1,0] and valid[0,1])
    return bool(valid[0,1] and valid[1,0] and valid[1,1])


def point_to_cell(point: Coordinate, src):
    """Invert the same Rasterio pixel-center mapping used in savedRoute.ts."""
    _check_source(src)
    source_col = point.x / 100 * (FRONT_WIDTH - 1) + CROP_COL
    source_row = point.y / 100 * (FRONT_HEIGHT - 1) + CROP_ROW
    if not _valid_native(src,source_col,source_row):
        raise HTTPException(422, "Selected coordinates are outside the valid terrain footprint.")
    cols, rows = src.width // FACTOR, src.height // FACTOR
    col = math.floor((source_col + .5) * cols / src.width)
    row = math.floor((source_row + .5) * rows / src.height)
    # Snapping must not place a marker into a native NoData gap.
    center_col = (col+.5)*src.width/cols-.5
    center_row = (row+.5)*src.height/rows-.5
    if not (0 <= col < cols and 0 <= row < rows) or not _valid_native(src,center_col,center_row):
        raise HTTPException(422, "Selected location has no valid nearby routing-grid cell.")
    return row,col


@lru_cache(maxsize=1)
def _load_routing_data(signature):
    # Reuse every existing calculation. Cache until source/PNG files change.
    z,res = routing.load_dtm(routing.DTM, factor=FACTOR)
    slope = routing.slope_deg(z,res)
    dust = routing.decode_dust(routing.DUST_PNG,z)
    warm = routing.decode_themis(routing.THEMIS_PNG,z)
    return z,res,routing.cost_map(slope,dust,warm),slope,dust,warm


@app.get("/api/health")
def health():
    return {"service":"martian-navigator-routing", "ready":True, "data_cached":bool(_load_routing_data.cache_info().currsize)}


@app.post("/api/route")
def calculate_route(request: RouteRequest):
    if not _route_lock.acquire(blocking=False):
        raise HTTPException(409,"Another route is being calculated. Please wait and try again.")
    try:
        with rasterio.open(routing.DTM) as src:
            start = point_to_cell(request.start,src)
            goal = point_to_cell(request.goal,src)
        if start == goal:
            raise HTTPException(422,"Starting point and destination must be in different routing-grid cells (about 4 m apart).")
        paths = (routing.DTM,routing.THEMIS_PNG,routing.DUST_PNG)
        signature = tuple((str(p),p.stat().st_mtime_ns,p.stat().st_size) for p in paths)
        z,res,cost,slope,dust,warm = _load_routing_data(signature)
        for name,point in (("Starting point",start),("Destination",goal)):
            if not np.isfinite(cost[point]):
                raise HTTPException(422,f"{name} is not traversable under the current routing constraints.")
        path = routing.astar(cost,start,goal)
        if not path:
            raise HTTPException(404,"No safe route was found between the selected points.")
        waypoints = routing.simplify(path,cost)
        commands = routing.to_commands(waypoints,res)
        # Existing exporter writes to a temporary file, never the tracked sample.
        with tempfile.TemporaryDirectory(prefix="martian-route-") as directory:
            output = Path(directory)/"route.json"
            routing.export_threejs(waypoints,commands,z,res,slope,dust,warm,path=output)
            result = json.loads(output.read_text())
        result["request"] = {"start":request.start.model_dump(),"goal":request.goal.model_dump(),
                             "start_cell":list(start),"goal_cell":list(goal)}
        return result
    except HTTPException:
        raise
    except (FileNotFoundError,rasterio.errors.RasterioIOError) as error:
        _log.exception("Local routing inputs could not be opened")
        raise HTTPException(503,"Routing data is unavailable. Check the backend dataset configuration.") from error
    except Exception as error:
        _log.exception("Route calculation failed")
        raise HTTPException(500,"Python could not calculate this route.") from error
    finally:
        _route_lock.release()
