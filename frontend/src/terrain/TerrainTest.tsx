import { useEffect, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { ACESFilmicToneMapping } from "three";
import { useWholeTerrain } from "./useWholeTerrain";
import {
  TerrainBoundary as Boundary,
  TerrainControls as Controls,
  TerrainLights,
} from "./TerrainScene";
import "./terrain.css";

export default function TerrainTest() {
  const { terrain, status, error, busy, setStep } = useWholeTerrain();
  const [reset, setReset] = useState(0);
  const [wireframe, setWireframe] = useState(false);
  useEffect(() => {
    if (terrain) {
      terrain.surface.material.wireframe = wireframe;
      terrain.surface.material.needsUpdate = true;
    }
  }, [terrain, wireframe]);
  const m = terrain?.meta;
  return (
    <main className="terrain-test">
      <header className="terrain-heading">
        <div>
          <p>RENDERER EXPERIMENT / FULL DTM</p>
          <h1>Phlegra Montes</h1>
          <span>Entire region · one mesh · native numerical surface shading</span>
        </div>
        <a href="/">← Martian Navigator</a>
      </header>
      <section className="terrain-viewport" aria-label="Interactive 3D Mars elevation terrain">
        {error ? (
          <p className="terrain-status" role="alert">
            Could not load terrain: {error}
          </p>
        ) : !terrain ? (
          <p className="terrain-status" role="status">
            {status}
          </p>
        ) : (
          <Boundary>
            <Canvas
              frameloop="demand"
              dpr={[1, 1.5]}
              camera={{ fov: 42, near: 1, far: 200000 }}
              gl={{
                antialias: true,
                toneMapping: ACESFilmicToneMapping,
                toneMappingExposure: 1.15,
              }}
              fallback={<p role="alert">WebGL2 is required.</p>}
            >
              <TerrainLights />
              <mesh
                geometry={terrain.geometry}
                material={terrain.surface.material}
                dispose={null}
              />
              <Controls reset={reset} meta={terrain.meta} />
            </Canvas>
          </Boundary>
        )}
        <div className="terrain-tools">
          <button onClick={() => setReset((n) => n + 1)}>Reset view</button>
          <button aria-pressed={wireframe} onClick={() => setWireframe((v) => !v)}>
            Wireframe {wireframe ? "on" : "off"}
          </button>
          <label>
            Mesh spacing{" "}
            <select
              aria-label="Mesh spacing"
              disabled={!terrain || busy}
              value={terrain?.step ?? 8}
              onChange={(event) => {
                setStep(Number(event.target.value));
              }}
            >
              <option value={16}>16 m · lighter</option>
              <option value={8}>8 m · balanced</option>
              <option value={4}>4 m · detailed</option>
            </select>
          </label>
          {busy && terrain && <span>Rebuilding single mesh…</span>}
        </div>
        <div className="terrain-compass">−Z NORTH · +X EAST · +Y UP</div>
        <p className="terrain-help">Drag to orbit · Right drag to pan · Scroll / pinch to zoom</p>
      </section>
      <footer className="terrain-debug" aria-label="Terrain diagnostics">
        <div>
          <small>FULL GEOGRAPHIC COVERAGE · MARS</small>
          <strong>
            {m ? `${m.geographicBounds[1].toFixed(5)}–${m.geographicBounds[3].toFixed(5)}° N` : "…"}
          </strong>
          <span>
            {m ? `${m.geographicBounds[0].toFixed(5)}–${m.geographicBounds[2].toFixed(5)}° E` : "…"}
          </span>
        </div>
        <div>
          <small>SOURCE GRID / NATIVE RESOLUTION</small>
          <strong>{m ? `${m.width.toLocaleString()} × ${m.height.toLocaleString()}` : "…"}</strong>
          <span>
            {m
              ? `${m.resolution[0].toFixed(6)} m/pixel · ${((m.width * m.resolution[0]) / 1000).toFixed(3)} × ${((m.height * m.resolution[1]) / 1000).toFixed(3)} km`
              : "…"}
          </span>
        </div>
        <div>
          <small>SINGLE MESH / CURRENT SPACING</small>
          <strong>{terrain?.vertices.toLocaleString() ?? "…"} vertices</strong>
          <span>
            {terrain?.triangles.toLocaleString() ?? "…"} triangles ·{" "}
            {terrain ? (terrain.step * terrain.meta.resolution[0]).toFixed(3) : "…"} m mesh spacing
          </span>
        </div>
        <div>
          <small>ELEVATION / TRUE SCALE</small>
          <strong>{m ? `${m.min.toFixed(1)} to ${m.max.toFixed(1)} m` : "…"}</strong>
          <span>1× vertical scale · native mask & shading</span>
        </div>
        <details>
          <summary>Source, precision & rendering limits</summary>
          <p>
            {m?.productId}. Complete GeoTIFF extent. {m?.validCount.toLocaleString()} valid native
            samples; {m ? ((1 - m.validCount / (m.width * m.height)) * 100).toFixed(2) : "…"}%
            NoData. The source is 1.0038 m/pixel; this single mesh uses every {terrain?.step}th
            sample. Valid selected elevations are unchanged. Native-resolution numerical normals
            retain surface shading; the exact native triangle mask retains gaps and edges. Shading
            detail is not native geometric detail. No photographic textures, chunks, streaming, LOD
            pyramid, or elevation exaggeration.
          </p>
          <p>
            The 4 m mesh has about 5.6 million vertices and needs substantial GPU memory. A native 1
            m mesh would require several gigabytes, so it is not offered. This viewer loads one
            large compressed bundle and needs WebGL2, 8192-pixel texture support and a capable GPU.
          </p>
          <pre>{m?.crsWkt}</pre>
          <p>Source affine: {m?.transform.join(", ")}</p>
        </details>
      </footer>
    </main>
  );
}
