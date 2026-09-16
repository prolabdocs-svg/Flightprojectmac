import type { MissionDefinition } from '../core/types';

// Familias implementadas en este slice: Distance Run, Precision Landing, STOL Challenge (spec 13.2).
export const MISSIONS: MissionDefinition[] = [
  {
    id: 'field_distance_01',
    regionId: 'the_field',
    family: 'distanceRun',
    name: 'Primer salto',
    description: 'Despega desde el taller y llega lo más lejos posible antes de perder el control.',
    spawnPoint: [0, 1.2, 0],
    spawnHeadingDeg: 0,
    minDistanceM: 300,
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
];

export function getMission(id: string): MissionDefinition | undefined {
  return MISSIONS.find((m) => m.id === id);
}
