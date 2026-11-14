import { BufferAttribute, BufferGeometry, Color } from 'three'

export type TerrainMetadata = {
  width: number; height: number; min: number; max: number; validCount: number
  resolution: [number, number]; transform: [number, number, number, number, number, number]
  geographicBounds: [number, number, number, number]; crsWkt: string
  window: { col: number; row: number }; productId: string
}

export function buildTerrain(meta: TerrainMetadata, heights: Float32Array, mask: Uint8Array) {
  const { width: w, height: h, transform: t } = meta
  const count = w * h
  if (heights.length !== count || mask.length !== count) throw Error('Terrain grid size mismatch')
  const centerX = t[0] * w / 2 + t[1] * h / 2 + t[2]
  const centerY = t[3] * w / 2 + t[4] * h / 2 + t[5]
  const elevationOrigin = (meta.min + meta.max) / 2
  const positions = new Float32Array(count * 3)
  const indices = new Uint32Array((w - 1) * (h - 1) * 6)
  let n = 0
  const used = new Uint8Array(count)
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const i = row * w + col
      if (mask[i] && !Number.isFinite(heights[i])) throw Error('Non-finite valid elevation')
      positions[i * 3] = t[0] * (col + .5) + t[1] * (row + .5) + t[2] - centerX
      positions[i * 3 + 1] = mask[i] ? heights[i] - elevationOrigin : 0
      positions[i * 3 + 2] = -(t[3] * (col + .5) + t[4] * (row + .5) + t[5] - centerY)
      if (row === h - 1 || col === w - 1) continue
      const a = i, b = i + 1, c = i + w, d = c + 1
      // Counterclockwise viewed from above; never bridge a NoData sample.
      for (const tri of [[a, c, b], [b, c, d]]) {
        if (tri.every(v => mask[v])) {
          for (const v of tri) { indices[n++] = v; used[v] = 1 }
        }
      }
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setIndex(new BufferAttribute(indices.subarray(0, n), 1))
  geometry.computeVertexNormals()
  const normals = geometry.getAttribute('normal')
  const colors = new Float32Array(count * 3)
  const low = new Color('#776353'), high = new Color('#b49b7b'), rock = new Color('#5c5148')
  const color = new Color()
  for (let i = 0; i < count; i++) {
    const elevation = mask[i] ? (heights[i] - meta.min) / Math.max(1, meta.max - meta.min) : 0
    const slope = Math.acos(Math.min(1, Math.max(0, normals.getY(i)))) / (Math.PI / 2)
    color.copy(low).lerp(high, elevation).lerp(rock, Math.min(.75, slope * 1.4))
    color.toArray(colors, i * 3)
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3))
  geometry.computeBoundingSphere()
  return { geometry, vertices: used.reduce((sum, value) => sum + value, 0), triangles: n / 3 }
}
