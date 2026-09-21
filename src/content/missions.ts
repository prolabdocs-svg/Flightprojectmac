import type { MissionDefinition, PlayerProfile } from '../core/types';
import { getRegion, isRegionUnlocked } from './regions';

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
  // Región 3 — RED CANYON: first long crosswind route. This id is the authored
  // gate used by BACKCOUNTRY, so the campaign no longer stops after Scrap Valley.
  {
    id: 'red_canyon_route_01',
    regionId: 'red_canyon',
    family: 'distanceRun',
    name: 'Corredor de la mesa',
    description: 'Sigue el cañón hasta Mesa Roja y aterriza dentro de su plataforma de tierra.',
    spawnPoint: [0, 1.2, 0],
    spawnHeadingDeg: 0,
    targetPoint: [60, 0, 320],
    targetRadiusM: 24,
    minDistanceM: 280,
    originAirfieldId: 'red_canyon_mesa',
    destinationAirfieldId: 'red_canyon_mesa',
    rewardBaseCash: 190,
    rewardBaseRp: 35,
    bonuses: [
      { id: 'no_damage', label: 'Sin daños', check: 'noDamage', rewardCash: 35, rewardRp: 5 },
      { id: 'fuel_45', label: 'Combustible > 45%', check: 'fuelRemaining', value: 0.45, rewardCash: 25, rewardRp: 0 },
    ],
  },
  {
    id: 'red_canyon_sprint_01',
    regionId: 'red_canyon',
    family: 'timeTrial',
    name: 'Viento de cresta',
    description: 'Aprovecha la corriente ascendente y toca tierra en la mesa antes de que cierre la ventana de viento.',
    spawnPoint: [0, 1.2, 0],
    spawnHeadingDeg: 0,
    targetPoint: [60, 0, 320],
    targetRadiusM: 24,
    rewardBaseCash: 210,
    rewardBaseRp: 38,
    bonuses: [{ id: 'under_75', label: 'Menos de 75 s', check: 'timeUnder', value: 75, rewardCash: 45, rewardRp: 8 }],
    // Side contract (not on the mandatory unlock path — red_canyon_route_01 alone opens
    // Backcountry). Riding the ridge launch needs real acceleration off the ground; a
    // Field Twin 18hp or the high-lift wing (both cheap, tech-free Builder buys) clears it.
    aircraftRequirement: { maxTakeoffRollM: 55, label: 'Necesitas más aceleración en despegue (motor o ala mejorados)' },
  },
  // Región 4 — BACKCOUNTRY.
  {
    id: 'backcountry_stol_01',
    regionId: 'backcountry',
    family: 'stolChallenge',
    name: 'Claro entre pinos',
    description: 'Completa un circuito corto y posa el avión en el claro del bosque sin tocar los árboles.',
    spawnPoint: [0, 1.2, 0],
    spawnHeadingDeg: 0,
    targetPoint: [35, 0, 260],
    targetRadiusM: 18,
    minDistanceM: 220,
    destinationAirfieldId: 'backcountry_lake_strip',
    rewardBaseCash: 230,
    rewardBaseRp: 42,
    bonuses: [
      { id: 'landing_quality', label: 'Aterrizaje suave', check: 'landingQuality', value: 0.72, rewardCash: 45, rewardRp: 7 },
      { id: 'no_damage', label: 'Sin daños', check: 'noDamage', rewardCash: 30, rewardRp: 4 },
    ],
  },
  {
    id: 'backcountry_lake_01',
    regionId: 'backcountry',
    family: 'precisionLanding',
    name: 'Orilla del lago',
    description: 'Cruza el valle y aterriza en la estrecha orilla junto al lago.',
    spawnPoint: [0, 1.2, 0],
    spawnHeadingDeg: 0,
    targetPoint: [-70, 0, 380],
    targetRadiusM: 16,
    destinationAirfieldId: 'backcountry_lake_strip',
    rewardBaseCash: 245,
    rewardBaseRp: 45,
    bonuses: [{ id: 'fuel_55', label: 'Combustible > 55%', check: 'fuelRemaining', value: 0.55, rewardCash: 35, rewardRp: 0 }],
    // Side contract (backcountry_stol_01 alone opens Coast Run). The narrow shoreline
    // punishes a hard touchdown; the tech-free gear_field upgrade covers it.
    aircraftRequirement: { minGearToleranceMs: 4.5, label: 'El tren ligero no aguanta la orilla: monta un tren de campo o mejor' },
  },
  // Región 5 — COAST RUN.
  {
    id: 'coast_navigation_01',
    regionId: 'coast_run',
    family: 'distanceRun',
    name: 'Ruta de acantilados',
    description: 'Navega el viento cruzado de la costa y aterriza junto al muelle.',
    spawnPoint: [0, 1.2, 0],
    spawnHeadingDeg: 0,
    targetPoint: [0, 0, 400],
    targetRadiusM: 22,
    minDistanceM: 350,
    destinationAirfieldId: 'coast_run_pier',
    rewardBaseCash: 270,
    rewardBaseRp: 50,
    bonuses: [
      { id: 'no_damage', label: 'Sin daños', check: 'noDamage', rewardCash: 40, rewardRp: 6 },
      { id: 'landing_quality', label: 'Aterrizaje suave', check: 'landingQuality', value: 0.7, rewardCash: 40, rewardRp: 6 },
    ],
  },
  {
    id: 'coast_crosswind_01',
    regionId: 'coast_run',
    family: 'precisionLanding',
    name: 'Viento de través',
    description: 'Mantén el control con ráfagas marinas y toma el muelle en un aterrizaje preciso.',
    spawnPoint: [0, 1.2, 0],
    spawnHeadingDeg: 0,
    targetPoint: [0, 0, 400],
    targetRadiusM: 18,
    destinationAirfieldId: 'coast_run_pier',
    rewardBaseCash: 285,
    rewardBaseRp: 52,
    bonuses: [{ id: 'under_90', label: 'Menos de 90 s', check: 'timeUnder', value: 90, rewardCash: 50, rewardRp: 8 }],
    // Side contract (coast_navigation_01 alone opens Industrial Belt). Sea gusts punish a
    // stiff touchdown the same way the backcountry shoreline does.
    aircraftRequirement: { minGearToleranceMs: 4.5, label: 'Las ráfagas marinas exigen un tren más resistente' },
  },
  // Región 6 — INDUSTRIAL BELT.
  {
    id: 'industrial_speed_01',
    regionId: 'industrial_belt',
    family: 'timeTrial',
    name: 'Mensajero industrial',
    description: 'Entrega el paquete por el corredor de almacenes antes de que cierre el turno.',
    spawnPoint: [0, 1.2, 0],
    spawnHeadingDeg: 0,
    targetPoint: [70, 0, 420],
    targetRadiusM: 20,
    destinationAirfieldId: 'industrial_cargo_yard',
    rewardBaseCash: 310,
    rewardBaseRp: 58,
    bonuses: [{ id: 'under_85', label: 'Menos de 85 s', check: 'timeUnder', value: 85, rewardCash: 55, rewardRp: 8 }],
  },
  {
    id: 'industrial_bridge_01',
    regionId: 'industrial_belt',
    family: 'precisionLanding',
    name: 'Bajo los cables',
    description: 'Cruza el cinturón industrial y aterriza en el patio de carga marcado.',
    spawnPoint: [0, 1.2, 0],
    spawnHeadingDeg: 0,
    targetPoint: [-55, 0, 330],
    targetRadiusM: 15,
    destinationAirfieldId: 'industrial_cargo_yard',
    rewardBaseCash: 325,
    rewardBaseRp: 60,
    bonuses: [{ id: 'no_damage', label: 'Sin daños', check: 'noDamage', rewardCash: 45, rewardRp: 6 }],
    // Side contract (industrial_speed_01 alone opens High Desert). The full corridor
    // crossing needs more fuel margin than the starter tank carries; tank_12 (tech-free) covers it.
    aircraftRequirement: { minRangeKm: 5.5, label: 'El tanque de 8L no llega: monta el tanque de 12L o mejor' },
  },
  // Región 7 — HIGH DESERT TEST RANGE.
  {
    id: 'desert_record_01',
    regionId: 'high_desert_test_range',
    family: 'distanceRun',
    name: 'Récord de salina',
    description: 'Completa la carrera de pruebas y detén el avión en la franja de la salina.',
    spawnPoint: [0, 1.2, 0],
    spawnHeadingDeg: 0,
    targetPoint: [0, 0, 500],
    targetRadiusM: 28,
    minDistanceM: 460,
    destinationAirfieldId: 'desert_salt_strip',
    rewardBaseCash: 355,
    rewardBaseRp: 65,
    bonuses: [
      { id: 'fuel_50', label: 'Combustible > 50%', check: 'fuelRemaining', value: 0.5, rewardCash: 50, rewardRp: 0 },
      { id: 'under_100', label: 'Menos de 100 s', check: 'timeUnder', value: 100, rewardCash: 55, rewardRp: 8 },
    ],
  },
  {
    id: 'desert_gust_01',
    regionId: 'high_desert_test_range',
    family: 'stolChallenge',
    name: 'Ráfaga de prueba',
    description: 'Domina las ráfagas del desierto y aterriza con precisión en la pista de ensayo.',
    spawnPoint: [0, 1.2, 0],
    spawnHeadingDeg: 0,
    targetPoint: [45, 0, 250],
    targetRadiusM: 18,
    minDistanceM: 200,
    destinationAirfieldId: 'desert_salt_strip',
    rewardBaseCash: 370,
    rewardBaseRp: 68,
    bonuses: [{ id: 'landing_quality', label: 'Aterrizaje suave', check: 'landingQuality', value: 0.76, rewardCash: 55, rewardRp: 8 }],
    // Side contract (desert_record_01 alone opens The Range). A STOL contract living up
    // to its name: the same short-roll bar as the ridge launch clears it.
    aircraftRequirement: { maxTakeoffRollM: 55, label: 'Necesitas un despegue más corto (motor o ala mejorados)' },
  },
  // Región 8 — THE RANGE, the end-game mountain crossing.
  {
    id: 'range_crossing_01',
    regionId: 'the_range',
    family: 'distanceRun',
    name: 'Cruce final',
    description: 'Cruza el valle alto y llega a la plataforma final sin perder el control.',
    spawnPoint: [0, 1.2, 0],
    spawnHeadingDeg: 0,
    targetPoint: [90, 0, 540],
    targetRadiusM: 24,
    minDistanceM: 500,
    destinationAirfieldId: 'range_summit_pad',
    rewardBaseCash: 420,
    rewardBaseRp: 80,
    bonuses: [
      { id: 'no_damage', label: 'Sin daños', check: 'noDamage', rewardCash: 65, rewardRp: 10 },
      { id: 'fuel_40', label: 'Combustible > 40%', check: 'fuelRemaining', value: 0.4, rewardCash: 45, rewardRp: 0 },
    ],
  },
  {
    id: 'range_finale_01',
    regionId: 'the_range',
    family: 'precisionLanding',
    name: 'Última plataforma',
    description: 'Termina la campaña con un aterrizaje limpio en la plataforma de la cumbre.',
    spawnPoint: [0, 1.2, 0],
    spawnHeadingDeg: 0,
    targetPoint: [90, 0, 540],
    targetRadiusM: 14,
    destinationAirfieldId: 'range_summit_pad',
    rewardBaseCash: 450,
    rewardBaseRp: 90,
    bonuses: [{ id: 'landing_quality', label: 'Aterrizaje impecable', check: 'landingQuality', value: 0.82, rewardCash: 80, rewardRp: 12 }],
    // Campaign capstone, not on the mandatory unlock path (range_crossing_01 alone is the
    // last required gate). Asks for both range and a landing-worthy gear at once; a
    // tank_12 + gear_field starter build (both tech-free Builder buys) clears both bars.
    aircraftRequirement: {
      minRangeKm: 5.5,
      minGearToleranceMs: 4.5,
      label: 'La plataforma final exige más autonomía y un tren capaz de aguantar el aterrizaje',
    },
  },
];

/** Straight-line route length (origin spawn -> destination), meters. Readiness/briefing use it. */
export function getMissionRouteDistanceM(mission: MissionDefinition): number {
  if (!mission.targetPoint) return mission.minDistanceM ?? 0;
  return Math.hypot(mission.targetPoint[0] - mission.spawnPoint[0], mission.targetPoint[2] - mission.spawnPoint[2]);
}

export function getMission(id: string): (MissionDefinition & MissionAirfieldLinks) | undefined {
  return MISSIONS.find((m) => m.id === id);
}

/** Missions belonging to a single region, in campaign order. */
export function getRegionMissions(regionId: string): MissionDefinition[] {
  return MISSIONS.filter((m) => m.regionId === regionId);
}

/** A region's contracts unlock in authored array order. Keeping this in content instead
 * of duplicating it in screens makes the map and primary "Fly now" action agree. */
export function isMissionAvailableToProfile(mission: MissionDefinition, profile: PlayerProfile): boolean {
  if (!isRegionUnlocked(getRegion(mission.regionId), profile)) return false;
  const regionMissions = getRegionMissions(mission.regionId);
  const index = regionMissions.findIndex((candidate) => candidate.id === mission.id);
  if (index <= 0) return true;
  return Boolean(profile.completedMissions[regionMissions[index - 1].id]);
}

/** First unfinished, currently available campaign contract in global authored order. */
export function getNextAvailableMission(profile: PlayerProfile): MissionDefinition | undefined {
  return MISSIONS.find((mission) =>
    !profile.completedMissions[mission.id] && isMissionAvailableToProfile(mission, profile),
  );
}
