import { useEffect, useRef, useState } from "react";
import { wholeGeometry, wholeMaterial, type MeshData, type WholeMetadata } from "./whole";
import { TerrainSurface } from "./surface";

export function useWholeTerrain() {
  const [terrain, setTerrain] = useState<null | {
    meta: WholeMetadata;
    geometry: ReturnType<typeof wholeGeometry>;
    surface: ReturnType<typeof wholeMaterial>;
    locations: TerrainSurface;
    step: number;
    vertices: number;
    triangles: number;
  }>(null);
  const [status, setStatus] = useState("Loading the full Phlegra Montes DTM…");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const workerRef = useRef<Worker | null>(null);
  useEffect(() => {
    const worker = new Worker(new URL("./whole.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;
    let current: typeof terrain = null;
    let grid: Float32Array, mask: Uint8Array;
    worker.onmessage = ({
      data,
    }: MessageEvent<
      MeshData & {
        meta?: WholeMetadata;
        buffer?: ArrayBuffer;
        offset?: number;
        status?: string;
        error?: string;
      }
    >) => {
      if (data.error) {
        setError(data.error);
        setBusy(false);
        return;
      }
      if (data.status) {
        setStatus(data.status);
        return;
      }
      const meta = data.meta ?? current!.meta;
      if (data.meta) {
        const view = new DataView(data.buffer!, data.offset!, meta.gridBytes);
        grid = new Float32Array(meta.gridBytes / 4);
        for (let i = 0; i < grid.length; i++) grid[i] = view.getFloat32(i * 4, true);
        mask = new Uint8Array(data.buffer!, data.offset! + meta.gridBytes, meta.maskBytes);
      }
      const surface = data.meta
        ? wholeMaterial(meta, data.buffer!, data.offset!)
        : current!.surface;
      const geometry = wholeGeometry(data),
        previous = current;
      current = {
        meta,
        surface,
        geometry,
        locations: new TerrainSurface(meta, grid, mask, data.step),
        step: data.step,
        vertices: data.vertices,
        triangles: data.triangles,
      };
      setTerrain(current);
      setBusy(false);
      if (previous) requestAnimationFrame(() => previous.geometry.dispose());
    };
    worker.onerror = (e) => {
      setError(e.message);
      setBusy(false);
    };
    worker.postMessage({
      url: `${import.meta.env.BASE_URL}terrain/phlegra-full/whole.bin.gz`,
      step: 8,
    });
    return () => {
      worker.terminate();
      workerRef.current = null;
      current?.geometry.dispose();
      current?.surface.dispose();
    };
  }, []);
  const setStep = (step: number) => {
    setBusy(true);
    workerRef.current?.postMessage({ step });
  };
  return { terrain, status, error, busy, setStep };
}
