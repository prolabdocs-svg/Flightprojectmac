import { createNoise2D } from 'simplex-noise';
import { createSeededRandom } from '../core/seededRandom';

/**
 * Authored geography for The Field (terrain type `meadow`), z = north, and EAST IS -X (world/compass.ts):
 *   - a northern mountain chain (crest ~z 4100) cut by a pass near x 1500 that opens south
 *     into a broad valley toward the home plain,
 *   - a flat home plain around the strips at (0,0) / (0,620),
 *   - rolling hills all round, taller eastern hills,
 *   - a river valley from the north-western mountains through the lake basin, round the
 *     south of the plain and out to the sea,
 *   - the map edge sinks below SEA_LEVEL_M so the world ends as a coast, not a cut.
 * Pure deterministic elevation: `terrainQuery.ts` wires it in, so the visual mesh, ground
 * contact and the Rapier heightfield all sample the same numbers. Features are placed by
 * masks/curves; noise only roughens them.
 */

const SEED = 'project-flight-field-v2';
const noise = (channel: string) => {
  const rng = createSeededRandom(SEED, channel);
  return createNoise2D(() => rng.next());
};
const macroN = noise('macro');
const mountainN = noise('mountain');
const hillN = noise('hill');
const localN = noise('local');
const microN = noise('micro');
const warpXN = noise('warpX');
const warpZN = noise('warpZ');

export const HOME_DATUM_M = 6;
export const SEA_LEVEL_M = -24;
/** Lake: bed dips `floorDepthM` below the surface at the centre, edge meets the surface.
 * `radiusM` is the nominal radius; the real shoreline is `lakeShoreRadius(angle)` (a lobed,
 * bayed outline) and never exceeds `maxRadiusM`. */
export const FIELD_LAKE = { x: 2500, z: 1900, radiusM: 720, maxRadiusM: 1080, floorDepthM: 34, waterLevelM: -12 } as const;
/** Wooded island off the north shore (crest ~10 m above the water, shore radius ~115 m). */
export const FIELD_LAKE_ISLAND = { x: 2330, z: 2230, radiusM: 115 } as const;

const angDiff = (a: number, b: number): number => Math.atan2(Math.sin(a - b), Math.cos(a - b));
/** Shoreline radius at polar angle `a` = atan2(dz, dx) from the lake centre. Low harmonics give
 * an organic outline; two authored features make it a place: a long north-east arm where the
 * river comes in, and a blunt peninsula on the west shore. The lake road and dock follow the
 * outline through `lakeShore` (fieldComposition.ts). */
export function lakeShoreRadius(a: number): number {
  const R = FIELD_LAKE.radiusM;
  let k = 1 + 0.1 * Math.sin(2 * a + 0.9) + 0.07 * Math.sin(3 * a + 2.3) + 0.04 * Math.sin(5 * a + 0.2) + 0.025 * Math.sin(8 * a + 1.7);
  k += 0.42 * Math.exp(-((angDiff(a, 0.86) / 0.2) ** 2)); // river arm (inflow, north-west of world = +x,+z)
  k += 0.16 * Math.exp(-((angDiff(a, 2.35) / 0.3) ** 2)); // reed bay, north-east
  k -= 0.2 * Math.exp(-((angDiff(a, -0.35) / 0.16) ** 2)); // west peninsula
  return Math.min(FIELD_LAKE.maxRadiusM, R * k);
}
/** Signed distance-ish to the lake shore (negative inside the water outline). */
export function lakeEdgeDistance(x: number, z: number): number {
  const dx = x - FIELD_LAKE.x, dz = z - FIELD_LAKE.z;
  return Math.hypot(dx, dz) - lakeShoreRadius(Math.atan2(dz, dx));
}
/** Half-extent of the terrain mesh; the edge sinks into the sea from EDGE_START_M outward. */
export const EDGE_START_M = 6600;
export const EDGE_END_M = 7900;

export const PASS_X = -1500;
export const RIDGE_PEAK_M = 680;
/** Crest line of the northern chain. */
export const ridgeZ = (x: number): number => 4100 + 380 * Math.sin(-x / 2400 + 0.6) + 180 * Math.sin(-x / 900 + 2);

/** River control points [x, z, valleyFloorM]: floor descends from the mountains, is the lake
 * surface at the lake, and meets the sea. Passes ≥1.5 km from both airstrips. */
const RIVER_CONTROL = [
  [4600, 4300, 60], [3700, 3300, 32], [2500, 1900, -12], [2050, 700, -14], [1900, -800, -15],
  [1000, -2300, -16], [-700, -3100, -18], [-2600, -3300, -20], [-4800, -4300, -22], [-6900, -5300, -24],
] as const;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

function fbm(n: (x: number, y: number) => number, x: number, z: number, scaleM: number, octaves: number, persistence = 0.5): number {
  let amp = 1, freq = 1 / scaleM, sum = 0, ampSum = 0;
  for (let i = 0; i < octaves; i++) {
    sum += n(x * freq, z * freq) * amp;
    ampSum += amp;
    amp *= persistence;
    freq *= 2;
  }
  return sum / ampSum;
}

function ridgedFbm(x: number, z: number, scaleM: number, octaves: number): number {
  let amp = 1, freq = 1 / scaleM, sum = 0, ampSum = 0;
  for (let i = 0; i < octaves; i++) {
    const n = mountainN(x * freq, z * freq);
    // Rounded crease (sqrt(n²+e), not |n|): crests stay ridge-like but resolvable on the 62 m grid.
    sum += Math.pow(Math.max(0, (1 - Math.sqrt(n * n + 0.25)) / 0.500), 1.4) * amp;
    ampSum += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / ampSum;
}

/** Catmull-Rom subdivision of RIVER_CONTROL so the centreline (and its valley) curves. */
const SUBDIV = 6;
export const FIELD_RIVER_POINTS: ReadonlyArray<readonly [number, number, number]> = (() => {
  const c = RIVER_CONTROL;
  const out: Array<[number, number, number]> = [];
  for (let i = 0; i < c.length - 1; i++) {
    const p0 = c[Math.max(0, i - 1)], p1 = c[i], p2 = c[i + 1], p3 = c[Math.min(c.length - 1, i + 2)];
    for (let k = 0; k < SUBDIV; k++) {
      const t = k / SUBDIV, t2 = t * t, t3 = t2 * t;
      const cr = (a: number, b: number, cc: number, d: number) =>
        0.5 * (2 * b + (-a + cc) * t + (2 * a - 5 * b + 4 * cc - d) * t2 + (-a + 3 * b - 3 * cc + d) * t3);
      out.push([cr(p0[0], p1[0], p2[0], p3[0]), cr(p0[1], p1[1], p2[1], p3[1]), lerp(p1[2], p2[2], t)]);
    }
  }
  out.push([...c[c.length - 1]]);
  return out;
})();

/** Nearest point on the river centreline: distance and the valley-floor height there. */
function riverNearest(x: number, z: number): { dist: number; floorM: number } {
  let best = Infinity, floorM = 0;
  const pts = FIELD_RIVER_POINTS;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az, af] = pts[i], [bx, bz, bf] = pts[i + 1];
    const abx = bx - ax, abz = bz - az;
    const t = clamp01(((x - ax) * abx + (z - az) * abz) / (abx * abx + abz * abz));
    const d = Math.hypot(x - (ax + abx * t), z - (az + abz * t));
    if (d < best) { best = d; floorM = lerp(af, bf, t); }
  }
  return { dist: best, floorM };
}

export const distanceToRiver = (x: number, z: number): number => riverNearest(x, z).dist;

/** Half-width of the river's open water (the rendered ribbon is 32-44 m wide). */
export const RIVER_WATER_HALF_M = 19;

/** Channel bed depth below the valley floor, and how far the water sits above the bed. */
export const RIVER_CARVE_M = 6;
export const RIVER_WATER_ABOVE_BED_M = 0.6;
const RIVER_CHANNEL_HALF_M = 150;

/** Ribbon water surface for a centreline vertex: valley floor - carve + a shallow depth. */
export const riverWaterLevel = (floorM: number): number => floorM - RIVER_CARVE_M + RIVER_WATER_ABOVE_BED_M;

export const homePlainMask = (x: number, z: number): number =>
  1 - smoothstep(0.4, 1, Math.hypot(x / 2500, (z - 300) / 2100));
const eastHillsMask = (x: number, z: number): number =>
  smoothstep(1500, 3800, -x) * (1 - smoothstep(3500, 6500, Math.abs(z + 300)));
/** 0..1 corridor: the pass and the broad valley that carries it south towards the plain. */
function passCorridor(x: number, z: number): number {
  const cx = PASS_X - 380 * Math.sin(z / 1100);
  const across = Math.exp(-(((x - cx) / 760) ** 2));
  return across * smoothstep(900, 2100, z) * (1 - smoothstep(5300, 6300, z));
}

function rawElevation(x: number, z: number): number {
  const px = x + warpXN(x / 4200, z / 4200) * 360;
  const pz = z + warpZN(x / 4200, z / 4200) * 360;
  const plain = homePlainMask(x, z);
  const roll = fbm(hillN, px, pz, 1500, 3, 0.45);

  // Rolling countryside, taller in the east; the northern back-country stays high.
  let h = 14 + (1 - plain) * (38 + 55 * roll);
  h += eastHillsMask(x, z) * (95 + 150 * Math.max(0, fbm(macroN, px, pz, 2600, 2)));
  h += smoothstep(5200, 6600, z) * 55;
  h = lerp(h, 6 + 3 * roll, plain);

  // Northern chain, cut by the pass; the corridor also flattens the hills feeding the pass.
  const d = z - ridgeZ(x);
  const core = Math.exp(-((d / 1350) ** 2));
  const crest = 0.68 + 0.32 * ridgedFbm(px, pz, 2600, 3);
  const passG = Math.exp(-(((x - PASS_X) / 620) ** 2));
  h += RIDGE_PEAK_M * core * crest * (1 - 0.92 * passG) + 110 * Math.exp(-((d / 2800) ** 2));
  const corridor = passCorridor(x, z);
  h = lerp(h, Math.min(h, 34 + 40 * smoothstep(3000, 4700, z) + 6 * roll), corridor);

  h += fbm(localN, px, pz, 320, 2, 0.3) * 7 * (1 - plain * 0.85) + fbm(microN, x, z, 80, 1) * 0.5;
  return h;
}

// The river is ≥2 km from home, so it never touches the datum sample.
const DATUM_OFFSET_M = HOME_DATUM_M - rawElevation(0, 0);

/** Natural (ungraded) elevation of The Field at world x/z. The lake bed equals the water level
 * exactly at the footprint edge, dips to `floorDepthM` below at the centre, and blends back
 * into the surrounding terrain outside the footprint. */
export function fieldElevation(x: number, z: number): number {
  let h = rawElevation(x, z) + DATUM_OFFSET_M;
  // River valley in WORLD metres (RIVER_CONTROL floors are world heights: lake surface, sea level).
  // Applying it before the datum offset used to sink the lower valley ~8 m below the sea.
  const river = riverNearest(x, z);
  h = lerp(h, river.floorM, 1 - smoothstep(180, 1000, river.dist));
  h -= RIVER_CARVE_M * (1 - smoothstep(0, RIVER_CHANNEL_HALF_M, river.dist));
  // The map edge sinks into the sea (a coast, never a cut).
  h = lerp(h, SEA_LEVEL_M - 20, smoothstep(EDGE_START_M, EDGE_END_M, Math.max(Math.abs(x), Math.abs(z))));
  const d = Math.hypot(x - FIELD_LAKE.x, z - FIELD_LAKE.z);
  // Beyond 3x the widest shore every blend below is saturated, so the outline doesn't matter there.
  if (d >= 3 * FIELD_LAKE.maxRadiusM) return h;
  const r = lakeShoreRadius(Math.atan2(z - FIELD_LAKE.z, x - FIELD_LAKE.x));
  if (d < r) {
    const k = d / r;
    const bed = FIELD_LAKE.waterLevelM - FIELD_LAKE.floorDepthM * (1 - k * k) * (0.55 + 0.45 * Math.min(1, r / FIELD_LAKE.radiusM));
    const di = Math.hypot(x - FIELD_LAKE_ISLAND.x, z - FIELD_LAKE_ISLAND.z);
    return Math.max(bed, FIELD_LAKE.waterLevelM - 40 + 48 * Math.exp(-((di / 150) ** 2)) + fbm(localN, x, z, 60, 1) * 1.2);
  }
  // Basin walls: never below the lake surface at the rim, eased into the surroundings.
  const wall = lerp(h, Math.max(h, FIELD_LAKE.waterLevelM + 3), 1 - smoothstep(r * 1.5, r * 3, d));
  return lerp(FIELD_LAKE.waterLevelM, wall, smoothstep(r, r * 1.9, d));
}
