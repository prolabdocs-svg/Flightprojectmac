import type { PlayerProfile, RegionDefinition } from '../core/types';

// Región 1 — THE FIELD (spec 12.2).
export const THE_FIELD: RegionDefinition = {
  id: 'the_field',
  name: 'The Field',
  description: 'Granja y taller rural. Viento bajo, térmicas suaves, visibilidad alta. Origen del taller.',
  windBaseMs: [1.5, 0, 0.5],
  groundColor: '#5f8a4a',
  skyColor: '#bfe3ff',
  environment: {
    timeOfDay: 'afternoon', weather: 'clear', terrain: 'meadow',
    gustStrengthMs: 0.8, gustPeriodS: 11, cloudCover: 0.22,
  },
  windVolumes: [
    { id: 'field_midday_thermal', center: [-75, 0, 245], radiusM: 95, heightM: 260, windDeltaMs: [0, 1.15, 0.18] },
  ],
};

// Región 2 — SCRAP VALLEY (spec 12.3): deshuesadero/cantera, turbulencia entre
// estructuras, salvage abundante, aterrizajes en espacios limitados, contratos de
// entrega. Unlocks after clearing The Field's tutorial distance run.
export const SCRAP_VALLEY: RegionDefinition = {
  id: 'scrap_valley',
  name: 'Scrap Valley',
  description:
    'Deshuesadero y cantera abandonada. Turbulencia entre estructuras, chatarra industrial y pistas improvisadas. Piezas de motor rescatadas por todos lados.',
  windBaseMs: [3.5, 0, 1.5],
  groundColor: '#8a7a5f',
  skyColor: '#cdd1c8',
  environment: {
    timeOfDay: 'overcast', weather: 'windy', terrain: 'quarry',
    gustStrengthMs: 2.6, gustPeriodS: 6, cloudCover: 0.72,
  },
  windVolumes: [
    { id: 'scrap_crane_rotor', center: [-25, 0, 300], radiusM: 72, heightM: 105, windDeltaMs: [1.3, -0.55, 0.7] },
    { id: 'scrap_quarry_lift', center: [95, 0, 180], radiusM: 120, heightM: 180, windDeltaMs: [-0.4, 0.85, 0.25] },
  ],
  unlockRequirement: { requiredMissionId: 'field_distance_01' },
};

// Regions 3–8 establish the authored campaign/world contract from GDD §12.  They are
// intentionally data-only until their mission packs and prop kits are streamed on demand.
export const RED_CANYON: RegionDefinition = {
  id: 'red_canyon', name: 'Red Canyon', description: 'Cañones rojos, mesas y corredores de aire caliente.',
  windBaseMs: [4.2, 0, 1.1], groundColor: '#9a553a', skyColor: '#d9b18d',
  environment: { timeOfDay: 'sunset', weather: 'windy', terrain: 'canyon', gustStrengthMs: 2.1, gustPeriodS: 8, cloudCover: 0.18 },
  windVolumes: [{ id: 'canyon_ridge_lift', center: [60, 0, 320], radiusM: 150, heightM: 330, windDeltaMs: [0, 1.7, 0.45] }],
  unlockRequirement: { requiredMissionId: 'scrap_precision_01' },
};
export const BACKCOUNTRY: RegionDefinition = {
  id: 'backcountry', name: 'Backcountry', description: 'Bosques, lagos y pistas cortas entre montañas.',
  windBaseMs: [2.6, 0, 2], groundColor: '#426846', skyColor: '#b8d4df',
  environment: { timeOfDay: 'morning', weather: 'overcast', terrain: 'forest', gustStrengthMs: 2.2, gustPeriodS: 7, cloudCover: 0.65 },
  unlockRequirement: { requiredMissionId: 'red_canyon_route_01' },
};
export const COAST_RUN: RegionDefinition = {
  id: 'coast_run', name: 'Coast Run', description: 'Acantilados, playas y viento cruzado sobre el agua.',
  windBaseMs: [5.2, 0, 0.8], groundColor: '#c8b780', skyColor: '#91c6dc',
  environment: { timeOfDay: 'afternoon', weather: 'windy', terrain: 'coast', gustStrengthMs: 2.7, gustPeriodS: 9, cloudCover: 0.38 },
  unlockRequirement: { requiredMissionId: 'backcountry_stol_01' },
};
export const INDUSTRIAL_BELT: RegionDefinition = {
  id: 'industrial_belt', name: 'Industrial Belt', description: 'Puentes, almacenes y corredores de precisión.',
  windBaseMs: [3.1, 0, 2.8], groundColor: '#65635c', skyColor: '#aeb3b3',
  environment: { timeOfDay: 'overcast', weather: 'overcast', terrain: 'industrial', gustStrengthMs: 2.4, gustPeriodS: 5, cloudCover: 0.82 },
  unlockRequirement: { requiredMissionId: 'coast_navigation_01' },
};
export const HIGH_DESERT_TEST_RANGE: RegionDefinition = {
  id: 'high_desert_test_range', name: 'High Desert Test Range', description: 'Salina, hangares de prueba y récords de velocidad.',
  windBaseMs: [4.6, 0, 0.6], groundColor: '#b4a076', skyColor: '#c9d6e8',
  environment: { timeOfDay: 'afternoon', weather: 'clear', terrain: 'desert', gustStrengthMs: 3.4, gustPeriodS: 12, cloudCover: 0.08 },
  unlockRequirement: { requiredMissionId: 'industrial_speed_01' },
};
export const THE_RANGE: RegionDefinition = {
  id: 'the_range', name: 'The Range', description: 'Valles altos, cumbres y el cruce final de la campaña.',
  windBaseMs: [5.1, 0, 2.6], groundColor: '#7c8377', skyColor: '#c5d1df',
  environment: { timeOfDay: 'morning', weather: 'windy', terrain: 'range', gustStrengthMs: 3.1, gustPeriodS: 8, cloudCover: 0.54 },
  unlockRequirement: { requiredMissionId: 'desert_record_01' },
};

export const REGIONS: RegionDefinition[] = [THE_FIELD, SCRAP_VALLEY, RED_CANYON, BACKCOUNTRY, COAST_RUN, INDUSTRIAL_BELT, HIGH_DESERT_TEST_RANGE, THE_RANGE];

export function getRegion(id: string): RegionDefinition {
  return REGIONS.find((r) => r.id === id) ?? THE_FIELD;
}

/** Spec 12.1/5: a region is reachable once its unlock requirement (if any) has been
 * completed at least once. Region 1 has no requirement and is always unlocked. */
export function isRegionUnlocked(region: RegionDefinition, profile: PlayerProfile): boolean {
  if (!region.unlockRequirement) return true;
  return Boolean(profile.completedMissions[region.unlockRequirement.requiredMissionId]);
}
