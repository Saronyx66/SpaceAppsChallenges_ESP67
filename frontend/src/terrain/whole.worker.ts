/// <reference lib="webworker" />
import type { WholeMetadata } from './whole'

let grid: Float32Array
let meta: WholeMetadata

function build(step: number) {
  const stride = step / meta.baseStep
  const gx: number[] = [], gy: number[] = []
  for (let x = 0; x < meta.gridWidth - 1; x += stride) gx.push(x)
  gx.push(meta.gridWidth - 1)
  for (let y = 0; y < meta.gridHeight - 1; y += stride) gy.push(y)
  gy.push(meta.gridHeight - 1)
  const w = gx.length, h = gy.length, count = w * h
  const positions = new Float32Array(count * 3)
  const normals = new Float32Array(count * 3)
  const uv = new Float32Array(count * 2)
  const indices = new Uint32Array((w - 1) * (h - 1) * 6)
  const mid = (meta.min + meta.max) / 2
  let n = 0
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
    const i = r * w + c
    const col = Math.min(meta.width - 1, gx[c] * meta.baseStep)
    const row = Math.min(meta.height - 1, gy[r] * meta.baseStep)
    positions[i * 3] = (col - (meta.width - 1) / 2) * meta.resolution[0]
    positions[i * 3 + 1] = grid[gy[r] * meta.gridWidth + gx[c]] - mid
    positions[i * 3 + 2] = (row - (meta.height - 1) / 2) * meta.resolution[1]
    normals[i * 3 + 1] = 1 // Fragment normals come from native elevation derivatives.
    uv[i * 2] = col / (meta.width - 1)
    uv[i * 2 + 1] = row / (meta.height - 1)
    if (r < h - 1 && c < w - 1) {
      indices[n++] = i; indices[n++] = i + w; indices[n++] = i + 1
      indices[n++] = i + 1; indices[n++] = i + w; indices[n++] = i + w + 1
    }
  }
  return { positions, normals, uv, indices, vertices: count, triangles: n / 3, step }
}

self.onmessage = async ({ data }: MessageEvent<{ url?: string; step: number }>) => {
  try {
    if (data.url) {
      self.postMessage({ status: 'Loading the entire DTM bundle…' })
      const response = await fetch(data.url)
      if (!response.ok || !response.body) throw Error(`Terrain bundle: HTTP ${response.status}. Run the full-terrain exporter first.`)
      // Vite marks .gz assets with Content-Encoding, so fetch already decodes
      // them. Static hosts may serve the gzip bytes without that header.
      const buffer = response.headers.get('content-encoding')?.includes('gzip')
        ? await response.arrayBuffer()
        : await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
      const view = new DataView(buffer)
      if (new TextDecoder().decode(new Uint8Array(buffer, 0, 4)) !== 'PHL1') throw Error('Invalid terrain bundle')
      const length = view.getUint32(4, true)
      meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 8, length)))
      const offset = 8 + length
      if (buffer.byteLength !== offset + meta.gridBytes + meta.maskBytes + meta.normalBytes) throw Error('Truncated terrain bundle')
      grid = new Float32Array(meta.gridBytes / 4)
      for (let i = 0; i < grid.length; i++) grid[i] = view.getFloat32(offset + i * 4, true)
      self.postMessage({ status: 'Constructing one whole-region mesh…' })
      const mesh = build(data.step)
      self.postMessage({ meta, buffer, offset, ...mesh }, { transfer: [buffer, mesh.positions.buffer, mesh.normals.buffer, mesh.uv.buffer, mesh.indices.buffer] })
    } else {
      const mesh = build(data.step)
      self.postMessage(mesh, { transfer: [mesh.positions.buffer, mesh.normals.buffer, mesh.uv.buffer, mesh.indices.buffer] })
    }
  } catch (error) { self.postMessage({ error: String(error) }) }
}
