import { useEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";

export function RouteOverlay({ positions }: { positions: Float32Array }) {
  const { size, invalidate } = useThree();
  const objects = useMemo(() => {
    const geometry = new LineSegmentsGeometry().setPositions(positions);
    const outline = new LineMaterial({
      color: "#18241b",
      linewidth: 7,
      depthTest: true,
      depthWrite: false,
      toneMapped: false,
    });
    const core = new LineMaterial({
      color: "#efffe5",
      linewidth: 3,
      depthTest: true,
      depthWrite: false,
      toneMapped: false,
    });
    const lines = [new LineSegments2(geometry, outline), new LineSegments2(geometry, core)];
    lines.forEach((line, i) => {
      line.renderOrder = 20 + i;
      line.raycast = () => {};
    });
    return { geometry, outline, core, lines };
  }, [positions]);
  useEffect(() => {
    objects.outline.resolution.set(size.width, size.height);
    objects.core.resolution.set(size.width, size.height);
    invalidate();
  }, [objects, size.width, size.height, invalidate]);
  useEffect(
    () => () => {
      objects.geometry.dispose();
      objects.outline.dispose();
      objects.core.dispose();
    },
    [objects],
  );
  return (
    <group name="saved-python-route">
      {objects.lines.map((line) => (
        <primitive key={line.uuid} object={line} dispose={null} />
      ))}
    </group>
  );
}
