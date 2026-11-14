import { terrainLayer, type TerrainLayerId } from "./layers";
import type { WholeMetadata } from "./whole";

export function LayerLegend({ layer, meta }: { layer: TerrainLayerId; meta: WholeMetadata }) {
  const definition = terrainLayer(layer);
  const preview = !definition.scientificDataAvailable;
  return (
    <aside className="layer-legend" aria-label={`${definition.name} legend`} aria-live="polite">
      <strong>
        {definition.name}
        {preview ? " · palette preview" : ""}
      </strong>
      {preview && <span className="layer-legend-status">Scientific layer unavailable</span>}
      <div
        className="layer-color-ramp"
        aria-hidden="true"
        style={{ background: `linear-gradient(90deg, ${definition.palette.join(", ")})` }}
      />
      <div className="layer-legend-scale">
        <span>{preview ? "Palette start" : `${meta.min.toFixed(1)} m`}</span>
        <span>{preview ? "Palette end" : `${meta.max.toFixed(1)} m`}</span>
      </div>
      <p>
        {preview
          ? "Colors follow elevation for preview only. No thermal or dust measurements."
          : "DTM elevation tint · slope shaded"}
      </p>
    </aside>
  );
}
