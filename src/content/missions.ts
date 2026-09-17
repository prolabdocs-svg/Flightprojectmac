import type { MissionDefinition } from '../core/types';

/** Optional world-graph references, layered on top of MissionDefinition without
 * touching its existing local-coordinate fields (FlightScreen still consumes
 * spawnPoint/targetPoint directly). Lets the map/route UI show which airfields a
 * mission connects while missions keep flying purely off local coordinates. */
export interface MissionAirfieldLinks {
  originAirfieldId?: string;
  destinationAirfieldId?: string;
}

// Familias implementadas en este slice: Distance Run, Precision Landing, STOL Challenge (spec 13.2).
export const MISSIONS: Array<MissionDefinition & MissionAirfieldLinks> = [
  {
    id: 'field_distance_01',
    regionId: 'the_field',
    family: 'distanceRun',
    name: 'Primer salto',
    description: 'Despega desde el taller y llega lo más lejos posible antes de perder el control.',
    spawnPoint: [0, 1.2, 0],
    spawnHeadingDeg: 0,
    minDistanceM: 300,
    originAirfieldId: 'field_home',
    rewardBaseCash: 60,
    rewardBaseRp: 10,
    bonuses: [
      { id: 'no_damage', label: 'Sin daños', check: 'noDamage', rewardCash: 25, rewardRp: 5 },
      { id: 'fuel_50', label: 'Combustible > 50%', check: 'fuelRemaining', value: 0.5, rewardCash: 15, rewardRp: 0 },
    ],
  },
  {
    id: 'field_precision_01',
    regionId: 'the_field',
    family: 'precisionLanding',
    name: 'Aterrizaje junto al granero',
    description: 'Aterriza dentro del círculo marcado junto al granero.',
    spawnPoint: [0, 1.2, 0],
    spawnHeadingDeg: 0,
    targetPoint: [40, 0, 260],
    targetRadiusM: 18,
    originAirfieldId: 'field_home',
    destinationAirfieldId: 'field_north_strip',
    rewardBaseCash: 90,
    rewardBaseRp: 15,
    bonuses: [
      { id: 'landing_quality', label: 'Aterrizaje suave', check: 'landingQuality', value: 0.7, rewardCash: 30, rewardRp: 5 },
      { id: 'no_damage', label: 'Sin daños', check: 'noDamage', rewardCash: 20, rewardRp: 0 },
    ],
  },
  {
    id: 'field_stol_01',
    regionId: 'the_field',
    family: 'stolChallenge',
    name: 'Pista corta',
    description: 'Despega y aterriza dentro de la franja de césped corta sin salirte.',
    spawnPoint: [0, 1.2, 0],
    spawnHeadingDeg: 0,
    minDistanceM: 150,
    targetPoint: [0, 0, 180],
    targetRadiusM: 22,
    rewardBaseCash: 110,
    rewardBaseRp: 20,
    bonuses: [
      { id: 'no_damage', label: 'Sin daños', check: 'noDamage', rewardCash: 25, rewardRp: 5 },
    ],
  },
  // Región 2 — SCRAP VALLEY (spec 12.3): "aterrizajes en espacios limitados" and
  // "contratos de entrega" become a tight precision landing and a delivery-run distance
  // mission, both flavored around the junkyard/quarry setting and its cross-structure
  // turbulence (region windBaseMs is stronger/gustier than The Field's).
  {
    id: 'scrap_delivery_01',
    regionId: 'scrap_valley',
    family: 'distanceRun',
    name: 'Contrato de entrega',
    description:
      'Lleva piezas rescatadas al otro extremo del deshuesadero, sorteando líneas eléctricas y grúas oxidadas.',
    spawnPoint: [0, 1.2, 0],
    spawnHeadingDeg: 0,
    minDistanceM: 420,
    rewardBaseCash: 140,
    rewardBaseRp: 25,
    bonuses: [
      { id: 'no_damage', label: 'Sin daños', check: 'noDamage', rewardCash: 35, rewardRp: 5 },
      { id: 'fuel_50', label: 'Combustible > 50%', check: 'fuelRemaining', value: 0.5, rewardCash: 20, rewardRp: 0 },
    ],
  },
  {
    id: 'scrap_precision_01',
    regionId: 'scrap_valley',
    family: 'precisionLanding',
    name: 'Aterrizaje entre la chatarra',
    description:
      'Posa el avión en el claro despejado junto a la grúa, entre pilas de chatarra apiladas a ambos lados.',
    spawnPoint: [0, 1.2, 0],
    spawnHeadingDeg: 0,
    targetPoint: [-25, 0, 300],
    targetRadiusM: 14,
    rewardBaseCash: 160,
    rewardBaseRp: 30,
    bonuses: [
      { id: 'landing_quality', label: 'Aterrizaje suave', check: 'landingQuality', value: 0.75, rewardCash: 40, rewardRp: 5 },
      { id: 'no_damage', label: 'Sin daños', check: 'noDamage', rewardCash: 25, rewardRp: 0 },
    ],
  },
];

export function getMission(id: string): MissionDefinition | undefined {
  return MISSIONS.find((m) => m.id === id);
}

/** Missions belonging to a single region, in campaign order. */
export function getRegionMissions(regionId: string): MissionDefinition[] {
  return MISSIONS.filter((m) => m.regionId === regionId);
}
