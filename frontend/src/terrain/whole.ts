import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  MeshStandardMaterial,
  NearestFilter,
  RedFormat,
  RGBAFormat,
  UnsignedByteType,
} from "three";
import { terrainLayer, type TerrainLayerId } from "./layers";

export type WholeMetadata = {
  width: number;
  height: number;
  gridWidth: number;
  gridHeight: number;
  baseStep: number;
  min: number;
  max: number;
  validCount: number;
  resolution: [number, number];
  transform: number[];
  geographicBounds: number[];
  crsWkt: string;
  productId: string;
  gridBytes: number;
  maskBytes: number;
  normalBytes: number;
  maskSize: [number, number];
  normalSize: [number, number];
};
export type MeshData = {
  positions: Float32Array;
  normals: Float32Array;
  uv: Float32Array;
  indices: Uint32Array;
  vertices: number;
  triangles: number;
  step: number;
};
export function wholeGeometry(data: MeshData) {
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(data.positions, 3));
  g.setAttribute("normal", new BufferAttribute(data.normals, 3));
  g.setAttribute("uv", new BufferAttribute(data.uv, 2));
  g.setIndex(new BufferAttribute(data.indices, 1));
  g.computeBoundingSphere();
  return g;
}

export function wholeMaterial(meta: WholeMetadata, buffer: ArrayBuffer, offset: number) {
  const mask = new DataTexture(
    new Uint8Array(buffer, offset + meta.gridBytes, meta.maskBytes),
    ...meta.maskSize,
    RedFormat,
    UnsignedByteType,
  );
  const normal = new DataTexture(
    new Uint8Array(buffer, offset + meta.gridBytes + meta.maskBytes, meta.normalBytes),
    ...meta.normalSize,
    RGBAFormat,
    UnsignedByteType,
  );
  for (const t of [mask, normal]) {
    t.minFilter = t.magFilter = NearestFilter;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    t.flipY = false;
  }
  const material = new MeshStandardMaterial({ roughness: 0.97, metalness: 0 });
  // One mutable uniform; changing palettes never rebuilds geometry, material,
  // shader programs, textures, data, or camera controls.
  const layerMode = { value: 0 };
  material.userData.activeLayer = "altitude";
  material.onBeforeCompile = (shader) => {
    shader.uniforms.layerMode = layerMode;
    shader.uniforms.thermalPalette = {
      value: terrainLayer("thermal").palette.map((hex) => new Color(hex)),
    };
    shader.uniforms.dustPalette = {
      value: terrainLayer("dust").palette.map((hex) => new Color(hex)),
    };
    shader.uniforms.nativeMask = { value: mask };
    shader.uniforms.nativeNormals = { value: normal };
    shader.uniforms.maskSize = { value: meta.maskSize };
    shader.uniforms.normalSize = { value: meta.normalSize };
    shader.uniforms.rasterSize = { value: [meta.width, meta.height] };
    shader.uniforms.lowColor = { value: new Color("#776353") };
    shader.uniforms.highColor = { value: new Color("#b49b7b") };
    shader.uniforms.rockColor = { value: new Color("#5c5148") };
    shader.vertexShader =
      "varying vec2 terrainUV; varying float terrainElevation;\n" + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      "#include <begin_vertex>\nterrainUV = uv; terrainElevation = position.y;",
    );
    shader.fragmentShader =
      `
      uniform sampler2D nativeMask, nativeNormals;
      uniform vec2 maskSize, normalSize, rasterSize;
      uniform vec3 lowColor, highColor, rockColor;
      uniform float layerMode;
      uniform vec3 thermalPalette[4], dustPalette[4];
      varying vec2 terrainUV;
      varying float terrainElevation;
      vec3 paletteColor(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
        float p = clamp(t, 0., 1.) * 3.;
        if (p < 1.) return mix(a, b, p);
        if (p < 2.) return mix(b, c, p - 1.);
        return mix(c, d, p - 2.);
      }
      vec3 sourceNormal(vec2 pixel) {
        pixel = clamp(pixel, vec2(0.), rasterSize - 1.);
        uint i = uint(pixel.y) * uint(rasterSize.x) + uint(pixel.x);
        uint texel = i / 2u;
        vec4 value = texture2D(nativeNormals, (vec2(float(texel % uint(normalSize.x)),float(texel / uint(normalSize.x)))+.5)/normalSize);
        vec2 xz = (i % 2u == 0u ? value.rg : value.ba) * 2. - 1.;
        return normalize(vec3(xz.x, sqrt(max(.0001,1.-dot(xz,xz))),xz.y));
      }
    ` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <color_fragment>",
      `
      #include <color_fragment>
      vec2 pixel = clamp(terrainUV * (rasterSize-1.),vec2(0.),rasterSize-1.0001);
      vec2 cell = floor(pixel);
      uint cellIndex = uint(cell.y) * uint(rasterSize.x-1.) + uint(cell.x);
      uint packedIndex = cellIndex / 4u;
      float packedMask = floor(texture2D(nativeMask,(vec2(float(packedIndex % uint(maskSize.x)),float(packedIndex / uint(maskSize.x)))+.5)/maskSize).r * 255.+.5);
      float flags = mod(floor(packedMask / pow(4.,float(cellIndex % 4u))),4.);
      vec2 fraction = fract(pixel);
      float triangleBit = fraction.x+fraction.y <= 1. ? 1. : 2.;
      if (mod(floor(flags/triangleBit),2.) < 1.) discard;
      vec3 nx0 = mix(sourceNormal(cell),sourceNormal(cell+vec2(1.,0.)),fraction.x);
      vec3 nx1 = mix(sourceNormal(cell+vec2(0.,1.)),sourceNormal(cell+vec2(1.,1.)),fraction.x);
      vec3 nativeN = normalize(mix(nx0,nx1,fraction.y));
      float elevation = clamp((terrainElevation+${((meta.max - meta.min) / 2).toFixed(8)})/${(meta.max - meta.min).toFixed(8)},0.,1.);
      float slope = acos(clamp(nativeN.y,0.,1.))/1.570796327;
      diffuseColor.rgb = mix(mix(lowColor,highColor,elevation),rockColor,min(.75,slope*1.4));
      // Explicit visual previews use the EXISTING elevation tint coordinate.
      // This is not a temperature, thermal-emission or dust-index measurement.
      if (layerMode > .5 && layerMode < 1.5)
        diffuseColor.rgb = paletteColor(elevation,thermalPalette[0],thermalPalette[1],thermalPalette[2],thermalPalette[3]);
      else if (layerMode > 1.5)
        diffuseColor.rgb = paletteColor(elevation,dustPalette[0],dustPalette[1],dustPalette[2],dustPalette[3]);
    `,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <normal_fragment_maps>",
      "#include <normal_fragment_maps>\nnormal = normalize(mat3(viewMatrix) * nativeN);",
    );
  };
  material.customProgramCacheKey = () => "whole-native-mask-normals-palettes-v2";
  return {
    material,
    setLayer: (id: TerrainLayerId) => {
      layerMode.value = terrainLayer(id).mode;
      material.userData.activeLayer = id;
    },
    dispose: () => {
      material.dispose();
      mask.dispose();
      normal.dispose();
    },
  };
}
