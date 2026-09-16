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

export const REGIONS: RegionDefinition[] = [THE_FIELD, SCRAP_VALLEY];

export function getRegion(id: string): RegionDefinition {
  return REGIONS.find((r) => r.id === id) ?? THE_FIELD;
}

/** Spec 12.1/5: a region is reachable once its unlock requirement (if any) has been
 * completed at least once. Region 1 has no requirement and is always unlocked. */
export function isRegionUnlocked(region: RegionDefinition, profile: PlayerProfile): boolean {
  if (!region.unlockRequirement) return true;
  return Boolean(profile.completedMissions[region.unlockRequirement.requiredMissionId]);
}
