import { useEffect, useMemo, useRef, type RefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  ACESFilmicToneMapping,
  BufferGeometry,
  Float32BufferAttribute,
  Raycaster,
  Vector2,
} from "three";
import { useWholeTerrain } from "./useWholeTerrain";
import {
  TerrainBoundary,
  TerrainControls,
  TerrainLights,
  STRIP_TILT,
  type TerrainCamera,
} from "./TerrainScene";
import type { MapCoordinates, TerrainSurface } from "./surface";
import type { TerrainLayerId } from "./layers";
import type { wholeMaterial, WholeMetadata } from "./whole";
import { LayerLegend, MapScaleBar } from "./LayerLegend";
import { drapeSavedRoute, type SavedRoute, type DisplayedRoute } from "./savedRoute";
import { RouteOverlay } from "./RouteOverlay";

type Props = {
  route: SavedRoute | null;
  onRouteDisplayed: (route: DisplayedRoute) => void;
  onRouteError: (message: string) => void;
  layer: TerrainLayerId;
  view: "3d" | "2d";
  base: MapCoordinates;
  destination: MapCoordinates;
  selecting: boolean;
  cameraRef: RefObject<TerrainCamera | null>;
  onSelect: (value: MapCoordinates | null) => void;
  onZoom: (zoom: number, metersPerPixel: number) => void;
  metersPerPixel: number;
  onValidation: (valid: { base: boolean; destination: boolean; ready: boolean }) => void;
};
function SurfaceColoring({
  surface,
  layer,
}: {
  surface: ReturnType<typeof wholeMaterial>;
  layer: TerrainLayerId;
}) {
  const { invalidate } = useThree();
  useEffect(() => {
    surface.setLayer(layer);
    invalidate();
  }, [surface, layer, invalidate]);
  return null;
}
function MarkerProjection({
  locations,
  base,
  destination,
  elements,
}: {
  locations: TerrainSurface;
  base: MapCoordinates;
  destination: MapCoordinates;
  elements: RefObject<(HTMLDivElement | null)[]>;
}) {
  const { camera, size, invalidate } = useThree();
  const points = useMemo(
    () => [locations.point(base), locations.point(destination)],
    [locations, base, destination],
  );
  useEffect(() => invalidate(), [invalidate, points]);
  useFrame(() => {
    // Demand rendering runs frame callbacks before the renderer updates camera
    // matrices; project against the current OrbitControls pose immediately.
    camera.updateMatrixWorld();
    points.forEach((point, i) => {
      const element = elements.current[i];
      if (!element) return;
      if (!point) {
        element.hidden = true;
        return;
      }
      const projected = point.clone().project(camera);
      element.hidden =
        projected.z < -1 ||
        projected.z > 1 ||
        Math.abs(projected.x) > 1 ||
        Math.abs(projected.y) > 1;
      element.style.left = `${((projected.x + 1) / 2) * size.width}px`;
      element.style.top = `${((1 - projected.y) / 2) * size.height}px`;
      element.dataset.surface = point.toArray().join(",");
    });
  });
  return null;
}
function DestinationPicker({
  locations,
  selecting,
  onSelect,
}: {
  locations: TerrainSurface;
  selecting: boolean;
  onSelect: Props["onSelect"];
}) {
  const { gl, camera } = useThree();
  useEffect(() => {
    if (!selecting) return;
    const canvas = gl.domElement,
      raycaster = new Raycaster();
    let start: { x: number; y: number; id: number } | null = null;
    const down = (e: PointerEvent) => {
      if (e.button === 0 && e.isPrimary) start = { x: e.clientX, y: e.clientY, id: e.pointerId };
    };
    const cancel = () => {
      start = null;
    };
    const up = (e: PointerEvent) => {
      const initial = start;
      start = null;
      if (
        !initial ||
        e.button !== 0 ||
        e.pointerId !== initial.id ||
        Math.hypot(e.clientX - initial.x, e.clientY - initial.y) > 4
      )
        return;
      const rect = canvas.getBoundingClientRect();
      raycaster.setFromCamera(
        new Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          1 - ((e.clientY - rect.top) / rect.height) * 2,
        ),
        camera,
      );
      const point = locations.intersect(raycaster.ray);
      onSelect(point ? locations.coordinates(point) : null);
    };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", cancel);
    return () => {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", cancel);
    };
  }, [gl, camera, selecting, onSelect, locations]);
  return null;
}

function TerrainGrid({ meta }: { meta: WholeMetadata }) {
  const geometry = useMemo(() => {
    const width = (meta.width - 1) * meta.resolution[0];
    const height = (meta.height - 1) * meta.resolution[1];
    const halfWidth = width / 2;
    const halfHeight = height / 2;
    const columns = Math.max(1, Math.round(width / 1000));
    const rows = Math.max(1, Math.round(height / (width / columns)));
    const positions: number[] = [];

    for (let column = 0; column <= columns; column++) {
      const x = -halfWidth + (width * column) / columns;
      positions.push(x, 0, -halfHeight, x, 0, halfHeight);
    }
    for (let row = 0; row <= rows; row++) {
      const z = -halfHeight + (height * row) / rows;
      positions.push(-halfWidth, 0, z, halfWidth, 0, z);
    }

    const result = new BufferGeometry();
    result.setAttribute("position", new Float32BufferAttribute(positions, 3));
    return result;
  }, [meta]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <lineSegments geometry={geometry} renderOrder={10} rotation={[0, STRIP_TILT, 0]}>
      <lineBasicMaterial
        color="#f5d6a0"
        depthTest={false}
        depthWrite={false}
        opacity={0.72}
        toneMapped={false}
        transparent
      />
    </lineSegments>
  );
}

export default function DashboardTerrain(props: Props) {
  const { terrain, error, status } = useWholeTerrain();
  const renderedRoute = useMemo(() => {
    if (!props.route || !terrain) return null;
    try {
      return { data: drapeSavedRoute(props.route, terrain.locations) };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "The saved route could not be displayed.",
      };
    }
  }, [props.route, terrain]);
  useEffect(() => {
    if (renderedRoute?.data) props.onRouteDisplayed(renderedRoute.data);
    else if (renderedRoute?.error) props.onRouteError(renderedRoute.error);
  }, [renderedRoute, props.onRouteDisplayed, props.onRouteError]);
  const markers = useRef<(HTMLDivElement | null)[]>([]);
  useEffect(() => {
    props.onValidation({
      base: !!terrain?.locations.point(props.base),
      destination: !!terrain?.locations.point(props.destination),
      ready: !!terrain && !error,
    });
  }, [terrain, error, props.base, props.destination, props.onValidation]);
  return (
    <div
      className="dashboard-terrain"
      data-terrain-ready={!!terrain && !error}
      data-geometry-id={terrain?.geometry.uuid}
      data-material-id={terrain?.surface.material.uuid}
      data-layer={props.layer}
      data-route-segments={renderedRoute?.data?.segments ?? 0}
    >
      {error ? (
        <p className="dashboard-terrain-status" role="alert">
          Could not load terrain: {error}
        </p>
      ) : !terrain ? (
        <p className="dashboard-terrain-status" role="status">
          {status}
        </p>
      ) : (
        <TerrainBoundary>
          <Canvas
            frameloop="demand"
            dpr={[1, 1.5]}
            camera={{ fov: 42, near: 1, far: 200000 }}
            gl={{
              alpha: true,
              antialias: true,
              toneMapping: ACESFilmicToneMapping,
              toneMappingExposure: 1.15,
            }}
            fallback={<p role="alert">WebGL2 is required for this terrain.</p>}
          >
            <TerrainLights />
            <SurfaceColoring surface={terrain.surface} layer={props.layer} />
            <mesh geometry={terrain.geometry} material={terrain.surface.material} dispose={null} />
            {props.view === "2d" && <TerrainGrid meta={terrain.meta} />}
            {renderedRoute?.data && <RouteOverlay positions={renderedRoute.data.positions} />}
            <TerrainControls
              meta={terrain.meta}
              view={props.view}
              cameraRef={props.cameraRef}
              onZoom={props.onZoom}
            />
            <DestinationPicker
              locations={terrain.locations}
              selecting={props.selecting}
              onSelect={props.onSelect}
            />
            <MarkerProjection
              locations={terrain.locations}
              base={props.base}
              destination={props.destination}
              elements={markers}
            />
          </Canvas>
        </TerrainBoundary>
      )}
      {terrain && !error && (
        <div className={`map-data-overlays ${props.view === "2d" ? "has-map-scale" : ""}`}>
          {props.view === "2d" && props.metersPerPixel > 0 && (
            <MapScaleBar metersPerPixel={props.metersPerPixel} />
          )}
          <LayerLegend layer={props.layer} meta={terrain.meta} />
        </div>
      )}
      {(["base", "destination"] as const).map((kind, index) => (
        <div
          hidden={!terrain}
          key={kind}
          ref={(element) => {
            markers.current[index] = element;
          }}
          className={`map-marker map-marker--${kind}`}
          aria-label={`${kind === "base" ? "Base" : "Destination"} terrain marker`}
        >
          <span className="marker-label">{kind.toUpperCase()}</span>
          <span className="marker-pin">
            {kind === "base" ? (
              <svg aria-hidden="true" viewBox="0 0 18 18">
                <path d="M3 14.5h12M5 14.5V8l4-3.5L13 8v6.5M7.2 14.5v-4h3.6v4" />
              </svg>
            ) : (
              <span className="marker-dot" />
            )}
          </span>
        </div>
      ))}
    </div>
  );
}
