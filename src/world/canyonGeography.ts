import { createNoise2D } from 'simplex-noise';
import { createSeededRandom } from '../core/seededRandom';

/**
 * Authored geography for Red Canyon (terrain type `canyon`), same contract as
 * `fieldGeography.ts`: one pure deterministic elevation function that `terrainQuery.ts` wires
 * in, so the visual mesh, ground contact and the Rapier heightfield all sample the same numbers.
 *
 * Shape (REGION_ART_BIBLE.canyon silhouette: "layered red mesas cut by a dry wash, sheer canyon
 * walls, no visible grid"):
 *   - a high mesa tableland at ~CANYON_RIM_M with layered strata (quantised benches),
 *   - a deep dry wash (no water) meandering NNW-SSE with SHEER walls, not a rolling valley,
 *   - short side canyons biting into the rim off the main wash,
 *   - isolated butte caps standing above the rim,
 *   - the map edge falls away into haze rather than a hard cut.
 * Deliberately NOT The Field's rolling-hill formula: the wall term is a hard smoothstep, and
 * the strata quantiser is what makes the mesas read as sedimentary layers from 1500 m.
 */

const SEED = 'project-flight-red-canyon-v1';
const noise = (channel: string) => {
  const rng = createSeededRandom(SEED, channel);
  return createNoise2D(() => rng.next());
};
const macroN = noise('macro');
const mesaN = noise('mesa');
const sideN = noise('side');
const microN = noise('micro');

/** Mesa rim datum (m) and the dry wash floor (m) — the ~95 m drop is the region's signature. */
export const CANYON_RIM_M = 120;
export const CANYON_FLOOR_M = 18;
/** Nothing is ever below this; Red Canyon has no sea and no standing water. */
export const CANYON_MIN_M = 0;
/** Half-width (m) of the wash floor; walls rise over CANYON_WALL_M beyond it. */
export const CANYON_HALF_W = 130;
export const CANYON_WALL_M = 95;
export const EDGE_START_M = 6600;
export const EDGE_END_M = 7900;

/** Meandering dry wash control points [x, z]. Kept > 600 m from `red_canyon_mesa` (60, 320)
 * so the airfield sits on solid mesa, not on a rim edge. */
export const CANYON_WASH_POINTS: ReadonlyArray<readonly [number, number]> = [
  [400, 3600], [100, 2400], [-250, 1500], [-600, 700], [-850, -200],
  [-1000, -1200], [-1400, -2600], [-1900, -4000],
];

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

function fbm(n: (x: number, y: number) => number, x: number, z: number, scaleM: number, octaves: number): number {
  let amp = 1, freq = 1 / scaleM, sum = 0, ampSum = 0;
  for (let i = 0; i < octaves; i++) {
    sum += n(x * freq, z * freq) * amp;
    ampSum += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / ampSum;
}

/** Perpendicular distance (m) from (x,z) to the dry wash centreline. */
export function distanceToWash(x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i < CANYON_WASH_POINTS.length - 1; i++) {
    const [ax, az] = CANYON_WASH_POINTS[i], [bx, bz] = CANYON_WASH_POINTS[i + 1];
    const dx = bx - ax, dz = bz - az;
    const t = clamp01(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz));
    best = Math.min(best, Math.hypot(x - (ax + dx * t), z - (az + dz * t)));
  }
  return best;
}

/** Sedimentary strata: pull 45% of the height onto 24 m benches so mesas read as layered rock
 * instead of smooth noise. This is the single most region-defining term here. */
function strata(h: number): number {
  const stepped = Math.floor(h / 24) * 24 + 12;
  return h * 0.55 + stepped * 0.45;
}

/** Side canyons: narrow noise-carved notches biting into the rim, scaled by how close the
 * point already is to the main wash (they feed it, they don't appear in open tableland). */
function sideCanyonCut(x: number, z: number, washDist: number): number {
  const feeder = 1 - smoothstep(600, 2600, washDist);
  if (feeder <= 0) return 0;
  const n = Math.abs(sideN(x / 900, z / 900));
  return feeder * smoothstep(0.16, 0.0, n) * 62;
}

/** Red Canyon's natural (ungraded) elevation at a world point. */
export function canyonElevation(x: number, z: number): number {
  const washDist = distanceToWash(x, z);
  // Tableland: broad regional tilt + mesa caps standing proud of the rim.
  const macro = fbm(macroN, x, z, 2600, 3) * 38;
  const mesaMask = smoothstep(0.18, 0.46, mesaN(x / 1700, z / 1700));
  const rim = CANYON_RIM_M + macro + mesaMask * 86;
  let h = strata(rim);

  // Main wash: sheer walls. The wall term is a hard smoothstep over CANYON_WALL_M, so the
  // profile is a box canyon, not a valley.
  const wall = smoothstep(CANYON_HALF_W, CANYON_HALF_W + CANYON_WALL_M, washDist);
  // The wash floor descends gently to the south so the drainage is believable.
  const floor = CANYON_FLOOR_M + smoothstep(-4000, 3600, z) * 26 + fbm(microN, x, z, 220, 2) * 3;
  h = floor + (h - floor) * wall;

  h -= sideCanyonCut(x, z, washDist) * wall;

  // Micro roughness: enough to break up the strata bands, never enough to soften the walls.
  h += fbm(microN, x, z, 460, 3) * 6 * wall;

  // Map edge hazes down instead of ending on a cliff face.
  const edge = smoothstep(EDGE_START_M, EDGE_END_M, Math.max(Math.abs(x), Math.abs(z)));
  h -= edge * 70;

  return Math.max(CANYON_MIN_M, h);
}

/** True where the ground is canyon floor rather than mesa top — used by the composition to
 * decide what belongs where (scrub + cottonwood below, camp + scrub above). */
export const isWashFloor = (x: number, z: number): boolean => distanceToWash(x, z) < CANYON_HALF_W + 30;
