import type { RegionDefinition } from '../core/types';

/**
 * One distant, readable landmark per terrain family. This is deliberately data rather
 * than a sequence of fall-through conditionals so campaign additions cannot silently
 * inherit the meadow's rural silhouette.
 */
export type LandmarkKind = 'silos' | 'headframe' | 'rock-gateway' | 'lookout' | 'lighthouse' | 'stacks' | 'radio-mast';

export const LANDMARK_BY_TERRAIN: Record<RegionDefinition['environment']['terrain'], LandmarkKind> = {
  meadow: 'silos',
  quarry: 'headframe',
  canyon: 'rock-gateway',
  forest: 'lookout',
  coast: 'lighthouse',
  industrial: 'stacks',
  desert: 'radio-mast',
  range: 'lookout',
};

export const LANDMARK_PRESENTATION: Record<LandmarkKind, { glyph: string; label: string }> = {
  silos: { glyph: '◒', label: 'Silos de referencia' },
  headframe: { glyph: '△', label: 'Torre minera' },
  'rock-gateway': { glyph: '∩', label: 'Puerta de roca' },
  lookout: { glyph: '⌂', label: 'Torre de vigilancia' },
  lighthouse: { glyph: '✦', label: 'Faro costero' },
  stacks: { glyph: '≋', label: 'Chimeneas industriales' },
  'radio-mast': { glyph: '†', label: 'Mástil de radio' },
};

export function getDistantLandmarkKind(region: RegionDefinition): LandmarkKind {
  return LANDMARK_BY_TERRAIN[region.environment.terrain];
}

/** How a terrain family reads from the air: whether the ground shows cultivated
 * parcels/furrows or organic mottling, how irregular the horizon silhouette is, and
 * how dense its vegetation clusters are. Drives the procedural terrain texture and
 * ridgeline in WorldEnvironment so every terrain type is visually distinct rather than
 * one shared flat-color/ring treatment (see WorldEnvironment.addTerrain/addRidgeline). */
export interface TerrainVisualProfile {
  /** Secondary tone blended into the base ground color for macro mottling. */
  groundAccent: string;
  /** Tertiary tone for fine micro-detail speckle/furrows. */
  groundDetail: string;
  /** Whether the ground reads as tended farmland (parcels + furrows) or wild ground
   * (organic blob mottling only). */
  parcels: boolean;
  /** Approximate size in meters of one ground texture tile/parcel. */
  parcelScaleM: number;
  /** 0..1 relative density multiplier for vegetation cluster counts. */
  vegetationDensity: number;
  /** 0..1 how irregular/jagged the distant ridgeline silhouette is. */
  horizonJaggedness: number;
  /** Receding atmospheric layers, kept per-biome so a desert never inherits green hills. */
  horizonColors: readonly [string, string, string];
}

export const TERRAIN_VISUAL_PROFILE: Record<RegionDefinition['environment']['terrain'], TerrainVisualProfile> = {
  meadow: { groundAccent: '#8fa15a', groundDetail: '#5f7a3a', parcels: true, parcelScaleM: 90, vegetationDensity: 0.75, horizonJaggedness: 0.35, horizonColors: ['#385445', '#66806b', '#a8bea9'] },
  quarry: { groundAccent: '#8a7f6c', groundDetail: '#5a5145', parcels: false, parcelScaleM: 140, vegetationDensity: 0.1, horizonJaggedness: 0.55, horizonColors: ['#403b37', '#63594d', '#908575'] },
  canyon: { groundAccent: '#a65a3a', groundDetail: '#7a3d24', parcels: false, parcelScaleM: 160, vegetationDensity: 0.15, horizonJaggedness: 0.85, horizonColors: ['#63331f', '#9a5433', '#d19a70'] },
  forest: { groundAccent: '#3f6b3a', groundDetail: '#274a26', parcels: false, parcelScaleM: 70, vegetationDensity: 1, horizonJaggedness: 0.5, horizonColors: ['#1f3e34', '#3f6553', '#87a18b'] },
  coast: { groundAccent: '#c8b984', groundDetail: '#9a8a5a', parcels: false, parcelScaleM: 110, vegetationDensity: 0.35, horizonJaggedness: 0.25, horizonColors: ['#35555b', '#62858a', '#b1c7c9'] },
  industrial: { groundAccent: '#75705f', groundDetail: '#443f33', parcels: true, parcelScaleM: 60, vegetationDensity: 0.25, horizonJaggedness: 0.4, horizonColors: ['#41484a', '#697071', '#a1a5a1'] },
  desert: { groundAccent: '#c2a568', groundDetail: '#9c7f4a', parcels: false, parcelScaleM: 180, vegetationDensity: 0.08, horizonJaggedness: 0.65, horizonColors: ['#765039', '#a97a52', '#d9b882'] },
  range: { groundAccent: '#7d8a63', groundDetail: '#4f5c3f', parcels: false, parcelScaleM: 130, vegetationDensity: 0.55, horizonJaggedness: 0.9, horizonColors: ['#35434a', '#617178', '#a9b5b6'] },
};

export function getTerrainVisualProfile(region: RegionDefinition): TerrainVisualProfile {
  return TERRAIN_VISUAL_PROFILE[region.environment.terrain];
}
