import type { MapCoordinates, TerrainSurface } from "./surface";

export type RouteSummary = {
  riskIndex: number | null;
  distanceM: number | null;
  estimatedTime: string | null;
};
export type SavedRoute = { points: { col: number; row: number }[]; summary?: RouteSummary | null };
export type DisplayedRoute = {
  positions: Float32Array;
  segments: number;
  clippedSamples: number;
  base: MapCoordinates;
  destination: MapCoordinates;
  summary: RouteSummary | null;
};

export function parseRouteSummary(value: unknown): RouteSummary | null {
  if (!value || typeof value !== "object") return null;
  const summary = value as Record<string, unknown>;
  const number = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
  const risk = number(summary.risk_index);
  const hours = number(summary.est_time_h);
  const time =
    typeof summary.est_time_hms === "string" && /^\d+h [0-5]\dm$/.test(summary.est_time_hms)
      ? summary.est_time_hms
      : null;
  return {
    riskIndex: risk !== null && risk >= 1 && risk <= 10 ? risk : null,
    distanceM: number(summary.total_distance_m),
    estimatedTime:
      time ??
      (hours !== null ? `${hours.toLocaleString("en-US", { maximumFractionDigits: 2 })} h` : null),
  };
}

export function formatRouteDistance(metres: number | null | undefined) {
  if (metres == null) return "Unavailable";
  return metres < 1000
    ? `${metres.toLocaleString("en-US", { maximumFractionDigits: 1 })} m`
    : `${(metres / 1000).toLocaleString("en-US", { maximumFractionDigits: 2 })} km`;
}

// The current Python export omits georeferencing. This explicit legacy adapter
// applies ONLY to its factor-4 original Phlegra IMG, not arbitrary raster grids.
// Rasterio out_shape scales each axis by source-size/output-size; rows are not
// exactly 4x because 14478 is not divisible by 4. Samples are pixel centers.
const SOURCE = { width: 6196, height: 14478, cropCol: 2, cropRow: 1, resolution: 1.0038326485352 };

export function parseSavedRoute(value: unknown): SavedRoute {
  if (!value || typeof value !== "object") throw Error("The saved route is not a JSON object.");
  const data = value as {
    grid?: { rows?: unknown; cols?: unknown; res_m?: unknown };
    points?: unknown;
    summary?: unknown;
  };
  const rows = data.grid?.rows,
    cols = data.grid?.cols,
    res = data.grid?.res_m;
  if (
    rows !== Math.floor(SOURCE.height / 4) ||
    cols !== Math.floor(SOURCE.width / 4) ||
    typeof res !== "number" ||
    Math.abs(res - SOURCE.resolution * 4) > 1e-6
  )
    throw Error("The saved route grid does not match the current Phlegra Python export.");
  if (!Array.isArray(data.points) || data.points.length < 2 || data.points.length > 200_000)
    throw Error("The saved route must contain between 2 and 200,000 points.");
  const points = data.points.map((raw: unknown) => {
    const p = raw as { row?: unknown; col?: unknown } | null;
    if (
      !p ||
      typeof p.row !== "number" ||
      typeof p.col !== "number" ||
      !Number.isFinite(p.row) ||
      !Number.isFinite(p.col) ||
      p.row < 0 ||
      p.col < 0 ||
      p.row > rows - 1 ||
      p.col > cols - 1
    )
      throw Error("The saved route contains invalid row/column coordinates.");
    return {
      col: ((p.col + 0.5) * SOURCE.width) / cols - 0.5 - SOURCE.cropCol,
      row: ((p.row + 0.5) * SOURCE.height) / rows - 0.5 - SOURCE.cropRow,
    };
  });
  return { points, summary: parseRouteSummary(data.summary) };
}

export function drapeSavedRoute(route: SavedRoute, surface: TerrainSurface): DisplayedRoute {
  const m = surface.meta;
  if (
    m.width !== 6193 ||
    m.height !== 14476 ||
    Math.abs(m.resolution[0] - SOURCE.resolution) > 1e-8 ||
    Math.abs(m.transform[2] - -3073.735569814782) > 1e-5 ||
    Math.abs(m.transform[5] - 2107124.0320546194) > 1e-5
  )
    throw Error("This route is for a different DTM; its georeferencing must be supplied first.");
  const coordinates = (p: { col: number; row: number }): MapCoordinates => ({
    x: String((p.col / (m.width - 1)) * 100),
    y: String((p.row / (m.height - 1)) * 100),
  });
  const base = coordinates(route.points[0]),
    destination = coordinates(route.points[route.points.length - 1]);
  if (!surface.point(base) || !surface.point(destination))
    throw Error("A saved route endpoint is outside valid terrain.");
  const positions: number[] = [];
  let previous: ReturnType<TerrainSurface["point"]> = null,
    clippedSamples = 0,
    samples = 0;
  for (let i = 1; i < route.points.length; i++) {
    const a = route.points[i - 1],
      b = route.points[i];
    // Drape densely enough to follow mesh triangles and check the native mask;
    // a missing sample breaks the line instead of bridging a NoData gap.
    const count = Math.max(
      1,
      Math.ceil(Math.max(Math.abs(b.col - a.col), Math.abs(b.row - a.row)) * 2),
    );
    if ((samples += count) > 500_000) throw Error("The saved route is too long to display safely.");
    for (let j = i === 1 ? 0 : 1; j <= count; j++) {
      const t = j / count;
      const point = surface.point(
        coordinates({ col: a.col + (b.col - a.col) * t, row: a.row + (b.row - a.row) * t }),
      );
      if (!point) {
        previous = null;
        clippedSamples++;
        continue;
      }
      if (previous && previous.distanceToSquared(point) > 1e-10)
        positions.push(previous.x, previous.y + 2, previous.z, point.x, point.y + 2, point.z);
      previous = point;
    }
  }
  if (!positions.length) throw Error("The saved route has no segments on valid terrain.");
  return {
    positions: new Float32Array(positions),
    segments: positions.length / 6,
    clippedSamples,
    base,
    destination,
    summary: route.summary ?? null,
  };
}
