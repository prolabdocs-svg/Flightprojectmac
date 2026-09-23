import * as THREE from 'three';

/**
 * Shared world-surface texturing (Art Bible §6.7, §12.4, §31): one generated, tileable RGBA
 * detail texture sampled in WORLD space at several scales, injected into ordinary
 * MeshStandardMaterials. The authored vertex/uniform colour stays the palette authority; the
 * detail only modulates it, so every region keeps its own look.
 *
 *   A  macro   (0.6 / 2.3 km)  dry/lush + value breakup that still reads from altitude
 *   G  meso    (41 / 170 m)    grass clumps, worn/bare soil patches
 *   R  fine    (5.3 m)         grain + derivative bump for the 5 m view, faded with distance
 *   B  strata  (biplanar)      layered rock on slopes (terrain only)
 *
 * Every channel is normalised to mean 0.5, so mip-averaged detail is energy-neutral at range.
 */

const SIZE = 512;

/** Deterministic lattice hash -> [0, 1). */
function hash(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Tileable fBm value noise over a size x size tile: octave o has (base << o) lattice cells that
 * wrap at the tile edge, so the result repeats seamlessly. Lattices are hashed once per octave.
 */
function fbmField(size: number, base: number, octaves: number, seed: number, ridged = false): Float32Array {
  const out = new Float32Array(size * size);
  const smooth = new Float32Array(size), cell = new Int32Array(size);
  let amp = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    const f = base << o;
    const lattice = new Float32Array(f * f);
    for (let j = 0; j < f; j++) for (let i = 0; i < f; i++) lattice[j * f + i] = hash(i, j, seed + o * 17);
    for (let k = 0; k < size; k++) {
      const x = (k / size) * f, x0 = Math.floor(x), fx = x - x0;
      cell[k] = x0;
      smooth[k] = fx * fx * (3 - 2 * fx);
    }
    for (let y = 0; y < size; y++) {
      const ay = cell[y], by = (ay + 1) % f, v = smooth[y];
      for (let x = 0; x < size; x++) {
        const ax = cell[x], bx = (ax + 1) % f, u = smooth[x];
        const a = lattice[ay * f + ax], b = lattice[ay * f + bx], c = lattice[by * f + ax], d = lattice[by * f + bx];
        let n = a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
        if (ridged) n = 1 - Math.abs(n * 2 - 1);
        out[y * size + x] += n * amp;
      }
    }
    norm += amp; amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

/** Rescale a channel to mean 0.5 with a fixed spread, so shader weights mean the same thing everywhere. */
function normalise(values: Float32Array, spread: number): Float32Array {
  let mean = 0;
  for (const v of values) mean += v;
  mean /= values.length;
  let variance = 0;
  for (const v of values) variance += (v - mean) ** 2;
  const std = Math.sqrt(variance / values.length) || 1;
  for (let i = 0; i < values.length; i++) values[i] = Math.min(1, Math.max(0, 0.5 + ((values[i] - mean) / std) * spread));
  return values;
}

/** Builds the four detail channels (exported for the tileability/neutrality test). */
export function buildSurfaceDetailData(size = SIZE): Uint8Array {
  const n = size * size;
  // Fine: clumpy grain plus a little ridged crack structure.
  const fine = fbmField(size, 48, 3, 11);
  const cracks = fbmField(size, 24, 2, 19, true);
  for (let i = 0; i < n; i++) fine[i] = fine[i] * 0.75 + cracks[i] * 0.25;
  // Meso: soft clumps and patches.
  const meso = fbmField(size, 6, 5, 23);
  // Strata: horizontal layers (integer frequencies keep them periodic) warped by noise, plus fractures.
  const warp = fbmField(size, 4, 3, 31), fractures = fbmField(size, 12, 4, 37, true);
  const strata = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = Math.floor(i / size) / size, w = warp[i] - 0.5;
    const layers = Math.sin((t * 14 + w * 1.6) * Math.PI * 2) * 0.5 + Math.sin((t * 37 + w * 2.3) * Math.PI * 2) * 0.25;
    strata[i] = layers * 0.55 + fractures[i] * 0.45;
  }
  // Macro: broad low-frequency fields.
  const macro = fbmField(size, 3, 5, 43);
  normalise(fine, 0.2); normalise(meso, 0.2); normalise(strata, 0.22); normalise(macro, 0.24);
  const data = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    data[i * 4] = Math.round(fine[i] * 255);
    data[i * 4 + 1] = Math.round(meso[i] * 255);
    data[i * 4 + 2] = Math.round(strata[i] * 255);
    data[i * 4 + 3] = Math.round(macro[i] * 255);
  }
  return data;
}

let detailTexture: THREE.DataTexture | null = null;

/** The one shared detail texture (≈1 MB of VRAM + mips), generated on first use. */
export function getSurfaceDetailTexture(): THREE.DataTexture {
  if (detailTexture) return detailTexture;
  const tex = new THREE.DataTexture(buildSurfaceDetailData(), SIZE, SIZE, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  // Flight views graze the ground: anisotropy is what keeps detail from smearing at shallow angles.
  tex.anisotropy = 8;
  tex.colorSpace = THREE.NoColorSpace; // data, not albedo
  tex.needsUpdate = true;
  detailTexture = tex;
  return tex;
}

export interface SurfaceDetailOptions {
  /** Strength of the dry/lush + value macro breakup (0 disables). */
  macro?: number;
  /** Strength of meso clumps (0 disables). */
  meso?: number;
  /** Strength of the fine grain (0 disables). */
  fine?: number;
  /** Bump strength of the fine grain at close range (0 disables). */
  bump?: number;
  /** Bare-soil patches on flat ground driven by the meso channel (0 disables). */
  soil?: number;
  /** Layered rock on slopes (terrain meshes only). */
  rock?: boolean;
  /** Fine-grain world scale in metres per texture tile. */
  fineScaleM?: number;
}

const DEFAULTS: Required<SurfaceDetailOptions> = { macro: 1, meso: 1, fine: 1, bump: 1, soil: 0.35, rock: false, fineScaleM: 5.3 };

const VERT_PARS = /* glsl */ `
varying vec3 vSurfWorld;
varying vec3 vSurfNormal;
`;
const VERT_MAIN = /* glsl */ `
vec4 surfWorld = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
  surfWorld = instanceMatrix * surfWorld;
#endif
surfWorld = modelMatrix * surfWorld;
vSurfWorld = surfWorld.xyz;
vSurfNormal = normalize(mat3(modelMatrix) * objectNormal);
`;

const FRAG_PARS = /* glsl */ `
uniform sampler2D surfDetail;
uniform vec4 surfStrength;   // macro, meso, fine, bump
uniform vec2 surfParams;     // soil, fine scale (m)
varying vec3 vSurfWorld;
varying vec3 vSurfNormal;
float surfFineH;
float surfFade;
vec2 surfRot(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
`;

const FRAG_COLOR = /* glsl */ `
{
  vec2 p = vSurfWorld.xz;
  float dist = length(vViewPosition);
  // Macro: two rotated scales so no tile period is visible even from 3 km up.
  float mA = texture2D(surfDetail, p * (1.0 / 2300.0)).a;
  float mB = texture2D(surfDetail, surfRot(p, 0.73) * (1.0 / 610.0) + 0.37).a;
  float macroV = mA * 0.6 + mB * 0.4;
  vec3 lush = diffuseColor.rgb * vec3(0.86, 0.96, 0.86);
  vec3 dry = diffuseColor.rgb * vec3(1.13, 1.06, 0.86);
  diffuseColor.rgb = mix(diffuseColor.rgb, mix(lush, dry, smoothstep(0.25, 0.75, mA)), surfStrength.x);
  diffuseColor.rgb *= mix(1.0, 0.86 + 0.28 * mB, surfStrength.x);
  // Meso clumps; fades only at long range so the plains never go back to one flat plate.
  float g1 = texture2D(surfDetail, surfRot(p, -0.41) * (1.0 / 170.0) + 0.61).g;
  float g2 = texture2D(surfDetail, p * (1.0 / 41.0)).g;
  float mesoV = g1 * 0.55 + g2 * 0.45;
  float mesoFade = 1.0 - smoothstep(2500.0, 7000.0, dist);
  diffuseColor.rgb *= mix(1.0, 0.8 + 0.4 * mesoV, surfStrength.y * mesoFade);
  // Bare / worn soil where the meso field peaks (flat ground only when rock is on).
  float soilMask = smoothstep(0.66, 0.8, g1 * 0.6 + g2 * 0.4) * surfParams.x;
  vec3 soil = diffuseColor.rgb * vec3(1.18, 0.98, 0.74);
  // Fine grain: shimmer-free because it fades out before it goes sub-pixel.
  surfFade = 1.0 - smoothstep(35.0, 320.0, dist);
  surfFineH = texture2D(surfDetail, surfRot(p, 1.9) * (1.0 / surfParams.y)).r;
  diffuseColor.rgb *= mix(1.0, 0.78 + 0.44 * surfFineH, surfStrength.z * surfFade);
#ifdef SURF_ROCK
  vec3 n = normalize(vSurfNormal);
  float slope = 1.0 - n.y;
  float rockW = smoothstep(0.09, 0.3, slope + (g2 - 0.5) * 0.12);
  soilMask *= 1.0 - rockW;
  diffuseColor.rgb = mix(diffuseColor.rgb, soil, soilMask);
  // Biplanar strata: projections along X and Z, weighted by the horizontal normal.
  vec2 w = abs(n.xz); w = w * w; w /= max(w.x + w.y, 1e-4);
  float sx = texture2D(surfDetail, vec2(p.y, vSurfWorld.y * 2.6) * (1.0 / 46.0)).b;
  float sz = texture2D(surfDetail, vec2(p.x, vSurfWorld.y * 2.6) * (1.0 / 46.0)).b;
  float strataV = sx * w.x + sz * w.y;
  vec3 rock = diffuseColor.rgb * (0.66 + 0.68 * strataV) * vec3(1.02, 1.0, 0.97);
  diffuseColor.rgb = mix(diffuseColor.rgb, rock, rockW);
  surfFineH = mix(surfFineH, strataV, rockW);
#else
  diffuseColor.rgb = mix(diffuseColor.rgb, soil, soilMask);
#endif
}
`;

/** Derivative bump (same maths as three's perturbNormalArb) from the fine height, faded with distance. */
const FRAG_NORMAL = /* glsl */ `
{
  float bumpK = surfStrength.w * surfFade;
  if (bumpK > 0.001) {
    vec2 dH = vec2(dFdx(surfFineH), dFdy(surfFineH)) * bumpK;
    vec3 sp = -vViewPosition;
    vec3 sx = normalize(dFdx(sp)), sy = normalize(dFdy(sp));
    vec3 r1 = cross(sy, normal), r2 = cross(normal, sx);
    float det = dot(sx, r1) * faceDirection;
    normal = normalize(abs(det) * normal - sign(det) * (dH.x * r1 + dH.y * r2));
  }
}
`;

/**
 * Adds world-space surface detail to a MeshStandardMaterial in place (vertex colours, `color`
 * and any `map` keep working underneath). Returns the material for chaining.
 */
export function applySurfaceDetail<T extends THREE.MeshStandardMaterial>(material: T, options: SurfaceDetailOptions = {}): T {
  const o = { ...DEFAULTS, ...options };
  const uniforms = {
    surfDetail: { value: getSurfaceDetailTexture() },
    surfStrength: { value: new THREE.Vector4(o.macro, o.meso, o.fine, o.bump) },
    surfParams: { value: new THREE.Vector2(o.soil, o.fineScaleM) },
  };
  material.defines = { ...material.defines, SURF_DETAIL: '' };
  if (o.rock) material.defines.SURF_ROCK = '';
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${VERT_MAIN}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAG_COLOR}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${FRAG_NORMAL}`);
  };
  // Same injected source for every user; the defines above already split rock/non-rock programs.
  material.customProgramCacheKey = () => 'surface-detail-v1';
  material.userData.surfaceDetail = uniforms;
  return material;
}
