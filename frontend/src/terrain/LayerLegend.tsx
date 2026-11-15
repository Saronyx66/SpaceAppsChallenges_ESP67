import { terrainLayer, type TerrainLayerId } from "./layers";
import type { WholeMetadata } from "./whole";

export function LayerLegend({ layer, meta }: { layer: TerrainLayerId; meta: WholeMetadata }) {
  const definition = terrainLayer(layer);
  const endpoints =
    layer === "thermal"
      ? ["Colder", "Hotter"]
      : layer === "dust"
        ? ["Less dust", "More dust"]
        : [`${meta.min.toFixed(1)} m`, `${meta.max.toFixed(1)} m`];
  return (
    <aside className="layer-legend" aria-label={`${definition.name} legend`} aria-live="polite">
      <strong>{definition.name}</strong>
      <div
        className="layer-color-ramp"
        aria-hidden="true"
        style={{ background: `linear-gradient(90deg, ${definition.palette.join(", ")})` }}
      />
      <div className="layer-legend-scale">
        <span>{endpoints[0]}</span>
        <span>{endpoints[1]}</span>
      </div>
    </aside>
  );
}
