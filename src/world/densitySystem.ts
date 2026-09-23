import { createSeededRandom } from '../core/seededRandom';
import { REGION_ART_BIBLE, type TerrainType } from './regionArtBible';

/**
 * Deterministic density-level system (world spec DENSITY SYSTEM section): every composition
 * module (settlement, vegetation, roads, props) should ask "what density level am I at" here
 * instead of inventing its own object-count knob. D0-D5 controls coherent *sets* of objects
 * per level (via `DENSITY_BUDGETS`), not just a raw count.
 */

export type DensityLevel = 0 | 1 | 2 | 3 | 4 | 5;

export const DENSITY_LEVEL_NAMES: Record<DensityLevel, string> = {
  0: 'wilderness',
  1: 'sparse',
  2: 'rural',
  3: 'settled',
  4: 'town',
  5: 'industrial_airport',
};

/** Per-level object-set budgets (instances per 100m x 100m cell). Composition modules read
 * these instead of hardcoding counts, so tuning density stays in one place. */
export interface DensityBudget {
  vegetationInstances: number;
  buildingLots: number;
  props: number;
  ambientTrafficSlots: number;
}

export const DENSITY_BUDGETS: Record<DensityLevel, DensityBudget> = {
  0: { vegetationInstances: 14, buildingLots: 0, props: 0, ambientTrafficSlots: 0 },
  1: { vegetationInstances: 10, buildingLots: 0, props: 1, ambientTrafficSlots: 0 },
  2: { vegetationInstances: 7, buildingLots: 1, props: 3, ambientTrafficSlots: 1 },
  3: { vegetationInstances: 5, buildingLots: 3, props: 6, ambientTrafficSlots: 2 },
  4: { vegetationInstances: 3, buildingLots: 6, props: 12, ambientTrafficSlots: 4 },
  5: { vegetationInstances: 1, buildingLots: 8, props: 18, ambientTrafficSlots: 3 },
};

/** A settlement/airfield anchor that pulls density up nearby (source-agnostic: callers pass
 * whatever anchors they already have — fieldComposition WORLD_ANCHORS, landUse Towns,
 * airfields AIRFIELDS — normalized to this minimal shape). */
export interface DensityAnchor {
  x: number;
  z: number;
  /** Radius (m) at full D4/D5 strength before falling off. */
  coreRadiusM: number;
  /** Distance (m) beyond coreRadiusM over which density decays back to regional baseline. */
  falloffM: number;
  level: DensityLevel;
}

export interface DensityQueryInput {
  regionId: string;
  terrain: TerrainType;
  x: number;
  z: number;
  anchors: DensityAnchor[];
}

/** Regional baseline density level when far from any anchor, derived from the art bible's
 * settlementDensityBias (>1 biases toward rural/settled even in open country, <1 toward
 * wilderness/sparse). */
function baselineLevel(terrain: TerrainType): DensityLevel {
  const bias = REGION_ART_BIBLE[terrain].settlementDensityBias;
  if (bias >= 1.4) return 2;
  if (bias >= 0.8) return 1;
  return 0;
}

/** Nearest anchor's contribution at this point: `level` inside coreRadiusM, linearly decaying
 * to the regional baseline over `falloffM`, 0 contribution beyond that. */
function anchorLevelAt(anchor: DensityAnchor, x: number, z: number, baseline: DensityLevel): number {
  const d = Math.hypot(x - anchor.x, z - anchor.z);
  if (d <= anchor.coreRadiusM) return anchor.level;
  if (d >= anchor.coreRadiusM + anchor.falloffM) return baseline;
  const t = (d - anchor.coreRadiusM) / anchor.falloffM;
  return anchor.level + (baseline - anchor.level) * t;
}

/** Deterministic jitter (+/- 0.3 levels) so density doesn't step in perfectly geometric rings
 * around anchors — seeded by region+cell so it's stable across sessions/reloads. */
function densityJitter(regionId: string, x: number, z: number): number {
  const cellX = Math.round(x / 100);
  const cellZ = Math.round(z / 100);
  const rng = createSeededRandom(regionId, 'density', cellX, cellZ);
  return rng.range(-0.3, 0.3);
}

/** Resolve the density level at a world point: max of the regional baseline and every anchor's
 * decayed contribution, plus small deterministic jitter, clamped to D0-D5. */
export function getDensityLevel(input: DensityQueryInput): DensityLevel {
  const baseline = baselineLevel(input.terrain);
  let level = baseline as number;
  for (const anchor of input.anchors) {
    level = Math.max(level, anchorLevelAt(anchor, input.x, input.z, baseline));
  }
  level += densityJitter(input.regionId, input.x, input.z);
  return Math.max(0, Math.min(5, Math.round(level))) as DensityLevel;
}

export function getDensityBudget(level: DensityLevel): DensityBudget {
  return DENSITY_BUDGETS[level];
}
