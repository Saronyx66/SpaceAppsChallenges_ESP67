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

function niceDistance(distance: number) {
  const magnitude = 10 ** Math.floor(Math.log10(distance));
  const scaled = distance / magnitude;
  const factor = scaled >= 5 ? 5 : scaled >= 2 ? 2 : 1;
  return factor * magnitude;
}

function formatDistance(meters: number) {
  if (meters >= 1000) return `${Number((meters / 1000).toPrecision(2))} km`;
  if (meters >= 1) return `${Math.round(meters)} m`;
  return `${Math.round(meters * 100)} cm`;
}

export function MapScaleBar({ metersPerPixel }: { metersPerPixel: number }) {
  if (!Number.isFinite(metersPerPixel) || metersPerPixel <= 0) return null;
  const meters = niceDistance(metersPerPixel * 110);
  const width = Math.min(110, meters / metersPerPixel);
  const label = formatDistance(meters);

  return (
    <aside className="map-scale-bar" aria-label={`Map scale: ${label}`}>
      <strong>{label}</strong>
      <span className="map-scale-bar-line" aria-hidden="true" style={{ width }} />
      <small>1 grid cell ≈ 1 km</small>
    </aside>
  );
}
