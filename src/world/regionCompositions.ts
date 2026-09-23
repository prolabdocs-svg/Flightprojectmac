import { FIELD_COMPOSITION } from './fieldPlacement';
import { RED_CANYON_COMPOSITION } from './regions/redCanyonComposition';
import type { RegionCompositionSpec } from './regionPlacement';

/**
 * Registry of regions that have an authored composition (anchors/roads/parcels + dressing
 * script) for the shared composer in `regionPlacement.ts`. A region absent from here still
 * renders — it just falls back to WorldEnvironment's generic scatter/ridgeline dressing, which
 * is the pre-existing behaviour for the other six regions.
 */
export const REGION_COMPOSITIONS: Record<string, RegionCompositionSpec> = {
  the_field: FIELD_COMPOSITION,
  red_canyon: RED_CANYON_COMPOSITION,
};

export const getRegionComposition = (regionId: string): RegionCompositionSpec | undefined =>
  REGION_COMPOSITIONS[regionId];

export const hasRegionComposition = (regionId: string): boolean => regionId in REGION_COMPOSITIONS;
