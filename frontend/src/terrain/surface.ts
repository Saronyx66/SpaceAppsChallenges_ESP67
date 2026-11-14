import { Ray, Vector3 } from "three";
import type { WholeMetadata } from "./whole";

/** X/Y are 0–100% of the full pixel-center extent: east / south from NW.
 * The exact native triangle mask is shared with the material, not its bounds.
 * Heights are barycentric samples of the currently rendered mesh (not invented
 * native elevations). All world axes use metres, with north = -Z and up = +Y.
 */
export type MapCoordinates = { x: string; y: string };
export class TerrainSurface {
  readonly cols: number;
  readonly rows: number;
  constructor(
    readonly meta: WholeMetadata,
    readonly grid: Float32Array,
    readonly mask: Uint8Array,
    readonly step: number,
  ) {
    this.cols = Math.ceil((meta.width - 1) / step) + 1;
    this.rows = Math.ceil((meta.height - 1) / step) + 1;
  }
  validPixel(col: number, row: number) {
    const m = this.meta;
    if (
      !Number.isFinite(col) ||
      !Number.isFinite(row) ||
      col < 0 ||
      row < 0 ||
      col > m.width - 1 ||
      row > m.height - 1
    )
      return false;
    // Same native cell/triangle convention as wholeMaterial, including edges.
    const x = Math.min(m.width - 1 - 1e-5, col),
      y = Math.min(m.height - 1 - 1e-5, row);
    const cx = Math.floor(x),
      cy = Math.floor(y),
      index = cy * (m.width - 1) + cx;
    const flags = (this.mask[Math.floor(index / 4)] >> (2 * (index % 4))) & 3;
    return !!(flags & (x - cx + y - cy <= 1 ? 1 : 2));
  }
  vertex(c: number, r: number) {
    const m = this.meta,
      col = Math.min(m.width - 1, c * this.step),
      row = Math.min(m.height - 1, r * this.step);
    const gc = Math.min(m.gridWidth - 1, (c * this.step) / m.baseStep);
    const gr = Math.min(m.gridHeight - 1, (r * this.step) / m.baseStep);
    return new Vector3(
      (col - (m.width - 1) / 2) * m.resolution[0],
      this.grid[gr * m.gridWidth + gc] - (m.min + m.max) / 2,
      (row - (m.height - 1) / 2) * m.resolution[1],
    );
  }
  point(value: MapCoordinates) {
    if (!value.x.trim() || !value.y.trim()) return null;
    const x = Number(value.x),
      y = Number(value.y);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > 100 || y > 100)
      return null;
    const m = this.meta,
      col = (x / 100) * (m.width - 1),
      row = (y / 100) * (m.height - 1);
    if (!this.validPixel(col, row)) return null;
    const c = Math.min(this.cols - 2, Math.floor(col / this.step)),
      r = Math.min(this.rows - 2, Math.floor(row / this.step));
    const a = this.vertex(c, r),
      b = this.vertex(c + 1, r),
      d = this.vertex(c + 1, r + 1),
      e = this.vertex(c, r + 1);
    const fx = (col - c * this.step) / (Math.min(m.width - 1, (c + 1) * this.step) - c * this.step);
    const fy =
      (row - r * this.step) / (Math.min(m.height - 1, (r + 1) * this.step) - r * this.step);
    const height =
      fx + fy <= 1
        ? a.y * (1 - fx - fy) + b.y * fx + e.y * fy
        : b.y * (1 - fy) + e.y * (1 - fx) + d.y * (fx + fy - 1);
    return new Vector3(
      (col - (m.width - 1) / 2) * m.resolution[0],
      height,
      (row - (m.height - 1) / 2) * m.resolution[1],
    );
  }
  coordinates(point: Vector3): MapCoordinates {
    const m = this.meta;
    // Enough digits to retain the clicked native mask cell near its boundary.
    return {
      x: ((point.x / m.resolution[0] / (m.width - 1) + 0.5) * 100).toFixed(8),
      y: ((point.z / m.resolution[1] / (m.height - 1) + 0.5) * 100).toFixed(8),
    };
  }
  /** Walk only ray-crossed grid cells, not millions of mesh triangles. */
  intersect(ray: Ray) {
    const m = this.meta,
      halfX = ((m.width - 1) * m.resolution[0]) / 2,
      halfZ = ((m.height - 1) * m.resolution[1]) / 2;
    let start = 0,
      end = Infinity;
    for (const [axis, low, high] of [
      ["x", -halfX, halfX],
      ["y", -(m.max - m.min) / 2 - 1, (m.max - m.min) / 2 + 1],
      ["z", -halfZ, halfZ],
    ] as const) {
      const origin = ray.origin[axis],
        direction = ray.direction[axis];
      if (Math.abs(direction) < 1e-10) {
        if (origin < low || origin > high) return null;
        continue;
      }
      const a = (low - origin) / direction,
        b = (high - origin) / direction;
      start = Math.max(start, Math.min(a, b));
      end = Math.min(end, Math.max(a, b));
    }
    if (end < start) return null;
    const point = ray.at(start + 1e-7, new Vector3()),
      hit = new Vector3();
    let c = Math.min(
      this.cols - 2,
      Math.max(0, Math.floor((point.x / m.resolution[0] + (m.width - 1) / 2) / this.step)),
    );
    let r = Math.min(
      this.rows - 2,
      Math.max(0, Math.floor((point.z / m.resolution[1] + (m.height - 1) / 2) / this.step)),
    );
    // Exact 2D DDA traversal also visits very thin corner-crossed cells.
    for (
      let i = 0;
      i < this.cols + this.rows && c >= 0 && r >= 0 && c < this.cols - 1 && r < this.rows - 1;
      i++
    ) {
      const a = this.vertex(c, r),
        b = this.vertex(c + 1, r),
        e = this.vertex(c, r + 1),
        d = this.vertex(c + 1, r + 1);
      for (const tri of [
        [a, e, b],
        [b, e, d],
      ]) {
        if (ray.intersectTriangle(tri[0], tri[1], tri[2], true, hit)) {
          const col = hit.x / m.resolution[0] + (m.width - 1) / 2,
            row = hit.z / m.resolution[1] + (m.height - 1) / 2;
          if (this.validPixel(col, row)) return hit.clone();
        }
      }
      const nextX =
        Math.abs(ray.direction.x) < 1e-10
          ? Infinity
          : ((ray.direction.x > 0 ? b.x : a.x) - ray.origin.x) / ray.direction.x;
      const nextZ =
        Math.abs(ray.direction.z) < 1e-10
          ? Infinity
          : ((ray.direction.z > 0 ? e.z : a.z) - ray.origin.z) / ray.direction.z;
      if (Math.min(nextX, nextZ) > end || !Number.isFinite(Math.min(nextX, nextZ))) break;
      if (nextX <= nextZ) c += Math.sign(ray.direction.x);
      if (nextZ <= nextX) r += Math.sign(ray.direction.z);
    }
    return null;
  }
}
