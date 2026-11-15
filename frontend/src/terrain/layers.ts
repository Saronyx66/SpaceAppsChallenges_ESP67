export type TerrainLayerId = "altitude" | "thermal" | "dust";

// Reference images inform only these color choices; they are never sampled,
// projected onto the terrain, or interpreted as scientific rasters.
export const TERRAIN_LAYERS = [
  {
    id: "altitude",
    name: "Altitude Map",
    mode: 0,
    detail: "Martian terrain elevation",
    scientificDataAvailable: true,
    palette: ["#776353", "#8c7761", "#a18a6e", "#b49b7b"],
  },
  {
    id: "thermal",
    name: "Thermal Emission",
    mode: 1,
    detail: "Scientific data unavailable",
    scientificDataAvailable: false,
    palette: ["#280b53", "#ab2d88", "#f87536", "#fff1a0"],
  },
  {
    id: "dust",
    name: "Surface Dust Cover Index",
    mode: 2,
    detail: "Scientific data unavailable",
    scientificDataAvailable: false,
    // Preserve the source's green -> yellow order. The official TES DCI key
    // puts green at higher DCI (less dust) than yellow (lower DCI/more dust).
    // The local RGB PNG does NOT retain calibrated numerical DCI samples.
    // https://mars.asu.edu/data/tes_ruffdust/large/tes_ruffdust_label.png
    palette: ["#30e65a", "#9dfc50", "#d9ff51", "#fff878"],
  },
] as const;

export function terrainLayer(id: TerrainLayerId) {
  return TERRAIN_LAYERS.find((layer) => layer.id === id)!;
}

/** Future scientific-layer input contract, not a data generator or loader.
 * Prepare real rasters in the DTM's Mars CRS, affine grid and pixel-center
 * convention before using them. Preserve each raster's own validity mask.
 * Values/ranges/units must come from the source product, never from its JPEG
 * palette or from DTM elevation. No scientific raster is connected today.
 */
export type DtmAlignedScientificRaster = {
  layer: Exclude<TerrainLayerId, "altitude">;
  sourceProduct: string;
  crsWkt: string;
  transform: readonly [number, number, number, number, number, number];
  width: number;
  height: number;
  values: Float32Array;
  valid: Uint8Array;
  units: string;
  displayRange: readonly [number, number];
};
