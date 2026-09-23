import type { RegionDefinition } from '../core/types';

/**
 * Regional identity: the "what makes this biome recognizable without opening the map"
 * catalog. One entry per region terrain type (world spec biome catalog, `terrainQuery.ts`'s
 * TERRAIN_SURFACE_AND_BIOME). Pure data — consumed by placement/material/vegetation systems
 * to pick region-appropriate variants instead of using one global look everywhere.
 */

export type TerrainType = RegionDefinition['environment']['terrain'];

export interface RegionArtBible {
  /** Human label for docs/UI, e.g. mission debrief flavor text. */
  label: string;
  /** Hex accent colors layered over the base biome color (BIOME_COLORS) for signage,
   * roofs, vehicle liveries — the palette detail that reads at 100-500m. */
  accentColors: string[];
  /** Dominant rock/soil material ids this region should favor when blending terrain
   * materials by slope/elevation (keys into a future terrain-material catalog). */
  geologyIds: string[];
  /** Vegetation archetype tags this region draws from (keys into vegetation species
   * catalogs) — kept as tags, not concrete species, so the vegetation system owns species. */
  vegetationArchetypes: string[];
  /** Relative settlement/building density multiplier vs. baseline (1 = D-system default). */
  settlementDensityBias: number;
  /** Road surface character: what unpaved/paved ratio and edge treatment feels native here. */
  roadCharacter: 'paved-grid' | 'paved-rural' | 'gravel-track' | 'dirt-trail' | 'service-only';
  /** Landmark density target per 10km x10km tile — kept low deliberately (spec: "scarce and
   * useful for VFR", not a theme park). */
  landmarksPer100km2: number;
  /** Fog/haze/light tag for atmosphere pass (consumed by env lighting, not defined here). */
  atmosphere: 'clear-highland' | 'humid-lowland' | 'dusty-arid' | 'coastal-marine' | 'industrial-haze';
  /** One-line silhouette description for the 3-20km read (docs / art review only). */
  silhouette: string;
}

export const REGION_ART_BIBLE: Record<TerrainType, RegionArtBible> = {
  meadow: {
    label: 'Temperate Farmland',
    accentColors: ['#8a6d3b', '#c9a24a', '#3f6b35'],
    geologyIds: ['loam', 'river_gravel'],
    vegetationArchetypes: ['deciduous_hedgerow', 'pasture_grass', 'crop_rows'],
    settlementDensityBias: 1.2,
    roadCharacter: 'paved-rural',
    landmarksPer100km2: 3,
    atmosphere: 'humid-lowland',
    silhouette: 'Rolling hedge-lined fields with a river valley and a village spire on the ridge.',
  },
  quarry: {
    label: 'Rocky Mountain Quarry',
    accentColors: ['#6b6660', '#a3d5ff', '#b0491f'],
    geologyIds: ['granite', 'scree', 'ore_stain'],
    vegetationArchetypes: ['alpine_conifer', 'lichen_rock', 'sparse_scrub'],
    settlementDensityBias: 0.4,
    roadCharacter: 'gravel-track',
    landmarksPer100km2: 4,
    atmosphere: 'clear-highland',
    silhouette: 'Jagged grey peaks with terraced quarry cuts and a switchback haul road.',
  },
  canyon: {
    label: 'Red Canyon Badlands',
    accentColors: ['#a8451f', '#d98c3c', '#5b3a29'],
    geologyIds: ['red_sandstone', 'eroded_mesa', 'dry_wash_gravel'],
    vegetationArchetypes: ['desert_scrub', 'canyon_cottonwood', 'cactus'],
    settlementDensityBias: 0.2,
    roadCharacter: 'dirt-trail',
    landmarksPer100km2: 5,
    atmosphere: 'dusty-arid',
    silhouette: 'Layered red mesas cut by a dry wash, sheer canyon walls, no visible grid.',
  },
  forest: {
    label: 'Temperate Woodland',
    accentColors: ['#2e4b2b', '#5c4326', '#7a8f5a'],
    geologyIds: ['forest_loam', 'mossy_rock'],
    vegetationArchetypes: ['dense_conifer', 'mixed_canopy', 'fern_understory', 'riparian_alder'],
    settlementDensityBias: 0.6,
    roadCharacter: 'gravel-track',
    landmarksPer100km2: 3,
    atmosphere: 'humid-lowland',
    silhouette: 'Unbroken dark-green canopy with a single logging road and a ranger clearing.',
  },
  coast: {
    label: 'Coastal Dune Run',
    accentColors: ['#2f6f8f', '#e8d9a0', '#ffffff'],
    geologyIds: ['dune_sand', 'tide_rock'],
    vegetationArchetypes: ['dune_grass', 'salt_scrub', 'coastal_pine'],
    settlementDensityBias: 1.0,
    roadCharacter: 'paved-rural',
    landmarksPer100km2: 4,
    atmosphere: 'coastal-marine',
    silhouette: 'White dune line against blue water, a harbor town and a lighthouse point.',
  },
  industrial: {
    label: 'Industrial Periurban',
    accentColors: ['#5a5f66', '#c94c2b', '#d9d9d9'],
    geologyIds: ['tarmac_fill', 'gravel_yard'],
    vegetationArchetypes: ['ruderal_weed', 'windbreak_poplar'],
    settlementDensityBias: 1.6,
    roadCharacter: 'paved-grid',
    landmarksPer100km2: 6,
    atmosphere: 'industrial-haze',
    silhouette: 'Grid streets, tank farms and a rail spur under a low haze, stacks on the horizon.',
  },
  desert: {
    label: 'Xeric Plain',
    accentColors: ['#c9a24a', '#8f6b3d', '#e8dcc0'],
    geologyIds: ['dune_sand', 'hardpan', 'salt_flat'],
    vegetationArchetypes: ['desert_scrub', 'isolated_palm'],
    settlementDensityBias: 0.15,
    roadCharacter: 'dirt-trail',
    landmarksPer100km2: 2,
    atmosphere: 'dusty-arid',
    silhouette: 'Flat pale plain to the horizon, heat shimmer, one dead-straight service road.',
  },
  range: {
    label: 'Highland Scrub Range',
    accentColors: ['#7a7a4f', '#9c8358', '#5f6b52'],
    geologyIds: ['weathered_shale', 'scrub_soil'],
    vegetationArchetypes: ['sagebrush', 'sparse_scrub', 'isolated_oak'],
    settlementDensityBias: 0.35,
    roadCharacter: 'gravel-track',
    landmarksPer100km2: 3,
    atmosphere: 'clear-highland',
    silhouette: 'Open rolling scrubland, a windmill and scattered cattle fencing.',
  },
};

export function getRegionArtBible(terrain: TerrainType): RegionArtBible {
  return REGION_ART_BIBLE[terrain];
}
