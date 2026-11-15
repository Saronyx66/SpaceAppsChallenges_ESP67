import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { test } from "node:test";
import { Ray, Vector3 } from "three";
import { TerrainSurface } from "./surface.ts";
import type { WholeMetadata } from "./whole";
import {
  parseSavedRoute,
  drapeSavedRoute,
  parseRouteSummary,
  formatRouteDistance,
} from "./savedRoute.ts";

// Tests use the real local numerical bundle, never synthetic terrain.
const bundle = gunzipSync(
  readFileSync(new URL("../../public/terrain/phlegra-full/whole.bin.gz", import.meta.url)),
);
const length = bundle.readUInt32LE(4),
  offset = 8 + length;
const meta: WholeMetadata = JSON.parse(bundle.toString("utf8", 8, offset));
const grid = new Float32Array(meta.gridBytes / 4);
for (let i = 0; i < grid.length; i++) grid[i] = bundle.readFloatLE(offset + i * 4);
const mask = new Uint8Array(
  bundle.buffer,
  bundle.byteOffset + offset + meta.gridBytes,
  meta.maskBytes,
);
const surface = new TerrainSurface(meta, grid, mask, 8);
const pythonRoute = JSON.parse(
  readFileSync(new URL("../../../backend/route_threejs.json", import.meta.url), "utf8"),
);

test("rejects empty, nonnumeric, out-of-range and native NoData coordinates", () => {
  for (const p of [
    { x: "", y: "50" },
    { x: "NaN", y: "50" },
    { x: "Infinity", y: "50" },
    { x: "-1", y: "50" },
    { x: "101", y: "50" },
    { x: "0", y: "0" },
  ])
    assert.equal(surface.point(p), null);
});
test("existing base and destination are inside the real footprint", () => {
  assert.ok(surface.point({ x: "24.6", y: "68.2" }));
  assert.ok(surface.point({ x: "67.5", y: "34.8" }));
});
test("coordinate center uses projected metres and matches the rendered triangle", () => {
  const p = surface.point({ x: "50", y: "50" })!;
  assert.ok(p);
  assert.equal(p.x, 0);
  assert.equal(p.z, 0);
  const ray = new Ray(new Vector3(0, 1000, 0), new Vector3(0, -1, 0));
  assert.ok(surface.intersect(ray)!.distanceTo(p) < 1e-6);
});
test("selected mesh vertices retain their source float32 heights", () => {
  const col = 2560,
    row = 6400;
  const p = surface.point({
    x: String((col / (meta.width - 1)) * 100),
    y: String((row / (meta.height - 1)) * 100),
  })!;
  assert.ok(p);
  assert.ok(
    Math.abs(p.y + (meta.min + meta.max) / 2 - grid[(row / 4) * meta.gridWidth + col / 4]) < 1e-9,
  );
});
test("oblique ray picking and coordinate round trips agree with surface sampling", () => {
  let count = 0;
  for (let x = 10; x < 95; x += 10)
    for (let y = 10; y < 95; y += 10) {
      const p = surface.point({ x: String(x), y: String(y) });
      if (!p) continue;
      const origin = p.clone().add(new Vector3(250, 2000, -333));
      const hit = surface.intersect(new Ray(origin, p.clone().sub(origin).normalize()));
      assert.ok(hit && hit.distanceTo(p) < 1e-5);
      const roundtrip = surface.point(surface.coordinates(hit));
      assert.ok(roundtrip && roundtrip.distanceTo(hit) < 1e-4);
      count++;
    }
  assert.ok(count > 40);
});
test("a ray over native NoData does not hit the invisible support mesh", () => {
  const p = surface.vertex(0, 0);
  assert.equal(
    surface.intersect(new Ray(new Vector3(p.x, 1000, p.z), new Vector3(0, -1, 0))),
    null,
  );
});

test("Python route mapping accounts for resampling cell centers and IMG-to-TIFF border offsets", () => {
  const route = parseSavedRoute(pythonRoute);
  const first = pythonRoute.points[0];
  assert.equal(route.points[0].col, ((first.col + 0.5) * 6196) / pythonRoute.grid.cols - 2.5);
  assert.equal(route.points[0].row, ((first.row + 0.5) * 14478) / pythonRoute.grid.rows - 1.5);
  assert.ok(Math.abs(route.points[0].col - first.u * (meta.width - 1)) > 0.1);
});

test("saved route drapes on the real terrain, keeps endpoints and contains no invalid values", () => {
  const result = drapeSavedRoute(parseSavedRoute(pythonRoute), surface);
  assert.ok(result.segments > pythonRoute.points.length);
  assert.equal(result.clippedSamples, 0);
  assert.ok(result.positions.every(Number.isFinite));
  const start = surface.point(result.base)!,
    end = surface.point(result.destination)!;
  assert.ok(start && end);
  const first = result.positions.slice(0, 3),
    last = result.positions.slice(-3);
  for (const [actual, expected] of [
    [first, start],
    [last, end],
  ] as const) {
    assert.ok(Math.abs(actual[0] - expected.x) < 0.001);
    assert.ok(Math.abs(actual[1] - expected.y - 2) < 0.001);
    assert.ok(Math.abs(actual[2] - expected.z) < 0.001);
  }
  for (let i = 0; i < result.positions.length; i += 3) {
    const col = result.positions[i] / meta.resolution[0] + (meta.width - 1) / 2;
    const row = result.positions[i + 2] / meta.resolution[1] + (meta.height - 1) / 2;
    assert.ok(surface.validPixel(col, row));
  }
});

test("saved route rejects malformed payloads, unrecognized grids and invalid endpoints", () => {
  for (const value of [
    null,
    {},
    { ...pythonRoute, points: [] },
    { ...pythonRoute, grid: { ...pythonRoute.grid, rows: 100 } },
    { ...pythonRoute, points: [{ row: -1, col: 500 }, pythonRoute.points[1]] },
  ])
    assert.throws(() => parseSavedRoute(value));
  assert.throws(
    () =>
      drapeSavedRoute(
        {
          points: [
            { col: 0, row: 0 },
            { col: 3000, row: 7000 },
          ],
        },
        surface,
      ),
    /endpoint/,
  );
});

test("backend route summary is preserved through parsing and terrain draping", () => {
  const summary = {
    risk_index: 3.6,
    total_distance_m: 20.1,
    est_time_h: 0.01,
    est_time_hms: "0h 00m",
  };
  const expected = { riskIndex: 3.6, distanceM: 20.1, estimatedTime: "0h 00m" };
  const parsed = parseSavedRoute({ ...pythonRoute, summary });
  assert.deepEqual(parsed.summary, expected);
  assert.deepEqual(drapeSavedRoute(parsed, surface).summary, expected);
});

test("missing or invalid summary metrics remain unavailable rather than fabricated", () => {
  assert.equal(parseRouteSummary(undefined), null);
  assert.deepEqual(
    parseRouteSummary({
      risk_index: Infinity,
      total_distance_m: -5,
      est_time_h: NaN,
      est_time_hms: "unknown",
    }),
    { riskIndex: null, distanceM: null, estimatedTime: null },
  );
  assert.deepEqual(parseRouteSummary({ risk_index: 11, est_time_h: 0.25 }), {
    riskIndex: null,
    distanceM: null,
    estimatedTime: "0.25 h",
  });
});

test("route distance formatting converts units without changing the backend value", () => {
  assert.equal(formatRouteDistance(null), "Unavailable");
  assert.equal(formatRouteDistance(20.1), "20.1 m");
  assert.equal(formatRouteDistance(1234.5), "1.23 km");
});
