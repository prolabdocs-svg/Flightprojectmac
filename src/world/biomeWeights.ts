import type { GroundSurfaceId } from './surfaces';

/** World spec §36-38/4390-4400: a point's biome is a *blend*, not a single winner. Weights
 * sum to ~1, at most 4 nonzero entries, no hard thresholds (§36 explicitly forbids
 * `if (height > 1000) forest` style cliffs) — every factor below fades in/out smoothly. */
export interface BiomeWeights {
  [biomeId: string]: number;
}

export interface BiomeInputs {
  /** The region's single baseline/anchor biome id (from TERRAIN_SURFACE_AND_BIOME) — the
   * dominant biome this point blends around. */
  regionBiomeId: string;
  elevationM: number;
  slopeDeg: number;
  /** Compass bearing (degrees, 0-360) the slope faces downhill toward. North-facing (~0) is
   * cooler/moister, south-facing (~180) is hotter/drier — spec §36 aspect factor. */
  aspectDeg: number;
  /** 0 (dry) .. 1 (saturated) proxy for moisture, e.g. derived from distance to nearest
   * water body by the caller. */
  moisture01: number;
  /** Ground surface at this point (spec §36 "soil" factor). */
  surfaceId: GroundSurfaceId;
  /** 0 (untouched) .. 1 (heavily disturbed) proxy for human land use / disturbance, e.g.
   * derived from proximity to a graded runway by the caller. */
  disturbance01: number;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** Cubic smoothstep — continuous, zero-derivative at both ends, no cliffs (spec §36). */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Each base biome's transition targets under wet / dry / steep / disturbed pressure. Reuses
 * the 8 existing biome ids as targets where a natural neighbor already exists in the catalog
 * (e.g. steep terrain trending toward `rocky_mountain`), and adds two new secondary ids —
 * `riparian_corridor` (wet-side transition) and `agricultural_mosaic` (disturbed-but-not-yet-
 * urban transition) — where nothing in the existing 8 fits. */
const ADJACENCY: Record<string, { wet?: string; dry?: string; steep?: string; disturbed?: string }> = {
  temperate_grassland: { wet: 'riparian_corridor', dry: 'xeric_plain', steep: 'rocky_mountain', disturbed: 'agricultural_mosaic' },
  rocky_mountain: { wet: 'temperate_woodland', dry: 'badlands', disturbed: 'urban_periurban' },
  badlands: { wet: 'temperate_grassland', dry: 'xeric_plain', steep: 'rocky_mountain', disturbed: 'urban_periurban' },
  temperate_woodland: { wet: 'riparian_corridor', dry: 'temperate_grassland', steep: 'rocky_mountain', disturbed: 'agricultural_mosaic' },
  coastal_dune: { wet: 'riparian_corridor', dry: 'xeric_plain', steep: 'rocky_mountain', disturbed: 'urban_periurban' },
  urban_periurban: { wet: 'agricultural_mosaic', dry: 'xeric_plain', steep: 'rocky_mountain' },
  xeric_plain: { wet: 'temperate_grassland', dry: 'badlands', steep: 'highland_scrub', disturbed: 'urban_periurban' },
  highland_scrub: { wet: 'temperate_woodland', dry: 'xeric_plain', steep: 'rocky_mountain', disturbed: 'urban_periurban' },
};

/** Fixed color per biome id for renderer vertex-color blending (spec §241/§250). */
export const BIOME_COLORS: Record<string, string> = {
  temperate_grassland: '#7a8f4a',
  rocky_mountain: '#8c8478',
  badlands: '#a8623f',
  temperate_woodland: '#3f6b3a',
  coastal_dune: '#d9c48a',
  urban_periurban: '#8a8a8a',
  xeric_plain: '#c2a568',
  highland_scrub: '#7d8a63',
  riparian_corridor: '#3a7d5c',
  agricultural_mosaic: '#b7a339',
};

/**
 * Full causal biome-blend formula (world spec §36-37): elevation, moisture, slope, aspect,
 * soil (surface) and disturbance (human land use) each push a continuous amount of weight
 * from the region's anchor biome toward a neighbor biome. Deterministic, no RNG.
 */
export function computeBiomeWeights(inputs: BiomeInputs): BiomeWeights {
  const { regionBiomeId, elevationM, slopeDeg, aspectDeg, moisture01, surfaceId, disturbance01 } = inputs;

  // Aspect (§36): north-facing slopes (aspect ~0/360) run cooler/moister, south-facing
  // (~180) run hotter/drier. northness01 is 1 at due north, 0 at due south.
  const northness01 = (1 + Math.cos((aspectDeg * Math.PI) / 180)) / 2;
  const aspectMoistureBonus = (northness01 - 0.5) * 0.2;

  // Soil (§36): sandy/rocky ground biases toward the dry/steep read of a point even before
  // moisture or slope alone would justify it — soil is a proxy for how quickly water drains.
  const soilDryBonus = surfaceId === 'sand' ? 0.15 : 0;
  const soilSteepBonus = surfaceId === 'rock' || surfaceId === 'gravel' ? 0.15 : 0;
  const soilDisturbedBonus = surfaceId === 'tarmac' ? 0.2 : 0;

  const effectiveMoisture = clamp01(moisture01 + aspectMoistureBonus);
  const wetPush = smoothstep(0.55, 0.9, effectiveMoisture);
  const dryPush = clamp01(smoothstep(0.45, 0.1, effectiveMoisture) + soilDryBonus);

  // Elevation (§36): higher ground amplifies the steepness read (thinner soil, more bare
  // rock exposed at altitude even at moderate slope).
  const elevationBoost = smoothstep(800, 2000, elevationM) * 0.3;
  const steepPush = clamp01(smoothstep(10, 35, slopeDeg) + elevationBoost + soilSteepBonus);

  const disturbedPush = clamp01(disturbance01 + soilDisturbedBonus);

  const adjacency = ADJACENCY[regionBiomeId] ?? {};
  const pushes: Array<[string | undefined, number]> = [
    [adjacency.wet, wetPush],
    [adjacency.dry, dryPush],
    [adjacency.steep, steepPush],
    [adjacency.disturbed, disturbedPush],
  ];

  // Accumulate push weight per distinct target (two factors can point at the same neighbor,
  // e.g. dry + steep both trending toward badlands from xeric_plain).
  const targetWeights = new Map<string, number>();
  for (const [target, push] of pushes) {
    if (!target || push <= 1e-4) continue;
    targetWeights.set(target, (targetWeights.get(target) ?? 0) + push);
  }

  // Keep the anchor biome dominant: at most 3 secondary targets, and secondaries never
  // consume more than 85% of the total so the region's own character always shows through.
  const secondaries = [...targetWeights.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  const secondaryTotalRaw = secondaries.reduce((sum, [, w]) => sum + w, 0);
  const scale = secondaryTotalRaw > 0.85 ? 0.85 / secondaryTotalRaw : 1;

  const weights: BiomeWeights = { [regionBiomeId]: 0 };
  let secondaryTotal = 0;
  for (const [target, w] of secondaries) {
    const scaled = w * scale;
    weights[target] = (weights[target] ?? 0) + scaled;
    secondaryTotal += scaled;
  }
  weights[regionBiomeId] += 1 - secondaryTotal;

  return weights;
}
