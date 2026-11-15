import { Component, useEffect, useRef, type ReactNode, type RefObject } from "react";
import { useThree } from "@react-three/fiber";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Vector3 } from "three";
import type { WholeMetadata } from "./whole";


const STRIP_TILT = (6.4 * Math.PI) / 180;
export type TerrainCamera = { zoom: (factor: number) => void };
export class TerrainBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state: { error: string | null } = { error: null };
  static getDerivedStateFromError(e: Error) {
    return { error: e.message };
  }
  render() {
    return this.state.error ? (
      <p role="alert">3D viewer unavailable: {this.state.error}</p>
    ) : (
      this.props.children
    );
  }
}
export function TerrainLights() {
  return (
    <>
      <color attach="background" args={["#151719"]} />
      <hemisphereLight args={["#e3d6c5", "#3e3530", 1.1]} />
      <directionalLight position={[-700, 650, -350]} intensity={3.2} />
      <directionalLight position={[600, 300, 400]} intensity={0.4} color="#c3ced5" />
    </>
  );
}
export function TerrainControls({
  reset = 0,
  meta,
  cameraRef,
  onZoom,
  view = "3d",
}: {
  view?: "3d" | "2d";
  reset?: number;
  meta: WholeMetadata;
  cameraRef?: RefObject<TerrainCamera | null>;
  onZoom?: (zoom: number) => void;
}) {
  const { camera, gl, invalidate, size } = useThree();
  const controls = useRef<OrbitControls | null>(null),
    fitDistance = useRef(1),
    onZoomRef = useRef(onZoom);
  onZoomRef.current = onZoom;
  useEffect(() => {
    if (gl.capabilities.maxTextureSize < 8192)
      throw Error("The terrain viewer needs 8192-pixel texture support.");
    const orbit = new OrbitControls(camera, gl.domElement);
    controls.current = orbit;
    orbit.minDistance = 30;
    orbit.maxDistance = 100000;
    orbit.maxPolarAngle = Math.PI / 2 - 0.025;
    orbit.screenSpacePanning = true;
    const change = () => {
      onZoomRef.current?.(fitDistance.current / orbit.getDistance());
      gl.domElement.dataset.camera = [...camera.position.toArray(), ...orbit.target.toArray()]
        .map((n) => n.toFixed(3))
        .join(",");
      invalidate();
    };
    orbit.addEventListener("change", change);
    if (cameraRef)
      cameraRef.current = {
        zoom: (factor) => {
          const offset = camera.position.clone().sub(orbit.target);
          const distance = Math.max(
            orbit.minDistance,
            Math.min(orbit.maxDistance, offset.length() * factor),
          );
          camera.position.copy(orbit.target).add(offset.setLength(distance));
          orbit.update();
          change();
        },
      };
    return () => {
      orbit.removeEventListener("change", change);
      orbit.dispose();
      controls.current = null;
      if (cameraRef) cameraRef.current = null;
    };
  }, [camera, gl, invalidate, cameraRef]);
  useEffect(() => {
    const orbit = controls.current;
    if (!orbit) return;
    const width = meta.width * meta.resolution[0],
      height = meta.height * meta.resolution[1];
    const aspect = size.width / Math.max(1, size.height),
      direction =
        view === "2d"
          ? 
            new Vector3(
              0.001 * Math.cos(STRIP_TILT),
              1,
              -0.001 * Math.sin(STRIP_TILT),
            ).normalize()
          : new Vector3(0.85, 0.72, 0.26).normalize();
    orbit.enableRotate = view === "3d";
    const right = new Vector3().crossVectors(new Vector3(0, 1, 0), direction).normalize();
    const up = new Vector3().crossVectors(direction, right).normalize(),
      tanV = Math.tan((21 * Math.PI) / 180);
    let distance = 0;
    for (const x of [-width / 2, width / 2])
      for (const y of [-(meta.max - meta.min) / 2, (meta.max - meta.min) / 2])
        for (const z of [-height / 2, height / 2]) {
          const corner = new Vector3(x, y, z);
          distance = Math.max(
            distance,
            corner.dot(direction) + Math.abs(corner.dot(right)) / (tanV * aspect),
            corner.dot(direction) + Math.abs(corner.dot(up)) / tanV,
          );
        }
    fitDistance.current = distance * (view === "2d" ? 1.03 : 1.13);
    camera.position.copy(direction.multiplyScalar(fitDistance.current));
    orbit.target.set(0, 0, 0);
    orbit.update();
    invalidate();
  }, [camera, invalidate, reset, size.width, size.height, meta, view]);
  return null;
}
