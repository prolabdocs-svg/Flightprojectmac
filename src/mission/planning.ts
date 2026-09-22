// Mission planning (master spec 8-11): pure model turning "this aircraft, this fuel, this payload, this
// route, this weather" into everything a briefing card needs. Built on the same aerodynamic +
// propulsion analysis the simulation flies (flight/analysis/performance.ts) and on massModel, so
// fuel, payload, range, takeoff and cost move together instead of being separate stat bars.

import type { AircraftBuild, HomeBaseState } from '../core/types';
import { resolveAircraft } from '../content/assembly';
import { computeFlightResult, computeOperatingCosts } from '../content/economy';
import { computeMassProperties } from '../flight/aircraft/massModel';
import { analyzeLoaded, definitionFor, type LoadedPerformance, type OperatingCondition } from '../flight/analysis/performance';
import { classifyRange, RANGE_RESERVE } from '../map/mapPlan';
import { GROUND_SURFACES } from '../world/surfaces';
import { contractRevenueCash, getArchetype } from './archetypes';
import { clampFuelL, fuelFraction, fuelMassKg } from './fuel';
import { windComponents, type RouteContext } from './route';
import { LANDING_FEE_CASH, nominalTelemetry } from './settlement';
import type { Contract, Difficulty, Loadout, Reachability } from './types';

/** Flown path vs straight line (turns, navigation error). */
export const ROUTE_FACTOR = 1.05;
/** Cruise altitude above the field, m: sets the climb allowance. */
const CRUISE_ALT_M = 30;
const APPROACH_S = 20;
const CLIMB_SPEED_SHARE = 0.85;
/** Runway margin applied to computed ground rolls (pilot variability). */
export const RUNWAY_SAFETY = 1.15;
/** Demonstrated crosswind of an ultralight, m/s. */
const MAX_CROSSWIND_MS = 6;
const MIN_CLIMB_MS = 0.8;

export type Blocker =
  | 'FUEL_OVER_CAPACITY' | 'FUEL_NOT_AVAILABLE' | 'PAYLOAD_OUT_OF_BOUNDS' | 'OVERWEIGHT'
  | 'INSUFFICIENT_RANGE' | 'TAKEOFF_RUNWAY_TOO_SHORT' | 'LANDING_RUNWAY_TOO_SHORT'
  | 'CANNOT_CLIMB' | 'CRUISE_NOT_HOLDABLE' | 'CROSSWIND_LIMIT';

export type UtilizationKey = 'range' | 'takeoff' | 'landing' | 'mass' | 'crosswind';

export interface PlanInput {
  build: AircraftBuild;
  route: RouteContext;
  contract: Pick<Contract, 'archetype' | 'weather' | 'payloadKg' | 'minPayloadKg' | 'mission'>;
  loadout: Loadout;
  onboardFuelL: number;
  homeBase?: HomeBaseState;
}

export interface MissionPlan {
  loadout: Loadout;
  mass: { emptyKg: number; fuelKg: number; payloadKg: number; totalKg: number; mtowKg: number };
  range: { distanceKm: number; estimatedKm: number; usableKm: number; requiredKm: number; reserveKm: number; groundSpeedKmh: number };
  fuel: { capacityL: number; loadedL: number; tripL: number; climbL: number; arrivalL: number; arrivalFraction: number; startFraction: number };
  takeoff: { rollM: number; runwayM: number; climbMs: number };
  landing: { rollM: number; runwayM: number };
  wind: { headwindMs: number; crosswindMs: number };
  timeEstimateS: number;
  economics: { expectedRevenue: number; fuelCost: number; fees: number; expectedOperatingCost: number; expectedNet: number };
  utilization: Record<UtilizationKey, number>;
  limiting: UtilizationKey;
  difficulty: Difficulty;
  reach: Reachability;
  blockers: Blocker[];
  feasible: boolean;
}

export function emptyMassKg(build: AircraftBuild): number {
  return computeMassProperties(definitionFor(build).mass.items).massKg;
}

export function mtowKg(build: AircraftBuild): number {
  return resolveAircraft(build).frame.mtowKg ?? emptyMassKg(build) * 1.3;
}

function band(u: number): Difficulty {
  return u > 1 ? 'IMPOSSIBLE' : u > 0.8 ? 'MARGINAL' : u > 0.6 ? 'CHALLENGING' : u > 0.3 ? 'COMFORTABLE' : 'TRIVIAL';
}
const RANK: Difficulty[] = ['TRIVIAL', 'COMFORTABLE', 'CHALLENGING', 'MARGINAL', 'IMPOSSIBLE'];

const conditions = (route: RouteContext, headwindMs: number, atDestination: boolean): OperatingCondition => {
  const dep = GROUND_SURFACES[route.origin.surface];
  const arr = GROUND_SURFACES[route.destination.surface];
  return {
    altM: atDestination ? route.destElevM : route.originElevM,
    headwindMs, departureRr: dep.rollingResistance, arrivalRr: arr.rollingResistance, arrivalBrakingGrip: arr.brakingGripDry,
  };
};

export function planMission(input: PlanInput): MissionPlan {
  const { build, route, contract, homeBase } = input;
  const def = definitionFor(build);
  const capacityL = def.mass.fuelCapacityL;
  const fuelL = clampFuelL(input.loadout.fuelL, capacityL);
  const payloadKg = Math.max(0, input.loadout.payloadKg);
  const wind = windComponents(contract.weather, route.bearingDeg);
  const depCond = conditions(route, wind.runwayHeadwindMs, false);

  const dep = analyzeLoaded(build, { fuelL, payloadKg }, depCond);
  const gs = Math.max(5, dep.cruiseSpeedMs - wind.cruiseHeadwindMs);
  const requiredM = route.distanceM * ROUTE_FACTOR;

  const gainM = Math.max(0, route.destElevM - route.originElevM);
  const climbS = dep.takeoffRollM / (0.5 * dep.liftoffSpeedMs) + (CRUISE_ALT_M + gainM) / Math.max(0.5, dep.bestClimbMs);
  const climbL = (climbS * dep.fullBurnLph) / 3600;
  // The climb covers ground too (at ~85% of cruise groundspeed); only the rest is cruise.
  const climbDistM = Math.min(requiredM * 0.8, climbS * CLIMB_SPEED_SHARE * gs);
  // Burn at the mean mass of the cruise (the tank empties on the way): one refinement pass.
  const firstTripL = climbL + ((requiredM - climbDistM) / gs) * (dep.cruiseBurnLph / 3600);
  const mid: LoadedPerformance = analyzeLoaded(build, { fuelL: Math.max(0, fuelL - firstTripL / 2), payloadKg }, depCond);
  const burnLps = mid.cruiseBurnLph / 3600;
  const approachL = APPROACH_S * 0.5 * burnLps;
  const cruiseL = ((requiredM - climbDistM) / gs) * burnLps;
  const tripL = climbL + approachL + cruiseL;
  const estimatedKm = Math.max(0, (((fuelL - climbL - approachL) / burnLps) * gs + climbDistM) / 1000);
  const requiredKm = requiredM / 1000;
  const usableKm = estimatedKm * RANGE_RESERVE;

  const arrivalL = Math.max(0, fuelL - tripL);
  const arr = analyzeLoaded(build, { fuelL: arrivalL, payloadKg }, conditions(route, wind.runwayHeadwindMs, true));

  const emptyKg = emptyMassKg(build);
  const totalKg = emptyKg + fuelMassKg(fuelL) + payloadKg;
  const mtow = mtowKg(build);
  const utilization: Record<UtilizationKey, number> = {
    range: usableKm > 0 ? requiredKm / usableKm : Infinity,
    takeoff: (dep.takeoffRollM * RUNWAY_SAFETY) / route.origin.runwayLengthM,
    landing: (arr.landingRollM * RUNWAY_SAFETY) / route.destination.runwayLengthM,
    mass: mtow > emptyKg ? (totalKg - emptyKg) / (mtow - emptyKg) : Infinity,
    crosswind: (wind.crosswindMs + 0.5 * wind.gustMs) / MAX_CROSSWIND_MS,
  };
  const keys = Object.keys(utilization) as UtilizationKey[];
  const limiting = keys.reduce((a, k) => (utilization[k] > utilization[a] ? k : a), keys[0]);
  const difficulty = keys.map((k) => band(utilization[k])).reduce((a, b) => (RANK.indexOf(b) > RANK.indexOf(a) ? b : a), 'TRIVIAL' as Difficulty);
  const rangeStatus = classifyRange(requiredKm, usableKm);
  const reach: Reachability = rangeStatus === 'insufficient' ? 'OUT_OF_RANGE' : rangeStatus === 'marginal' ? 'MARGINAL' : 'REACHABLE';

  const blockers: Blocker[] = [];
  if (input.loadout.fuelL > capacityL + 1e-6) blockers.push('FUEL_OVER_CAPACITY');
  if (input.loadout.fuelL > input.onboardFuelL + 1e-6 && !route.origin.services.includes('fuel')) blockers.push('FUEL_NOT_AVAILABLE');
  if (payloadKg < contract.minPayloadKg - 1e-6 || payloadKg > contract.payloadKg + 1e-6) blockers.push('PAYLOAD_OUT_OF_BOUNDS');
  if (totalKg > mtow + 1e-6) blockers.push('OVERWEIGHT');
  if (utilization.range > 1) blockers.push('INSUFFICIENT_RANGE');
  if (utilization.takeoff > 1) blockers.push('TAKEOFF_RUNWAY_TOO_SHORT');
  if (utilization.landing > 1) blockers.push('LANDING_RUNWAY_TOO_SHORT');
  if (dep.bestClimbMs < MIN_CLIMB_MS) blockers.push('CANNOT_CLIMB');
  if (!dep.cruiseHoldable) blockers.push('CRUISE_NOT_HOLDABLE');
  if (utilization.crosswind > 1) blockers.push('CROSSWIND_LIMIT');

  // Expected money through the same economy the settlement uses (nominal clean flight, landing 0.7).
  const timeEstimateS = climbS + (requiredM - climbDistM) / gs + APPROACH_S + 30;
  const startFraction = fuelFraction(fuelL, capacityL);
  const arrivalFraction = fuelFraction(arrivalL, capacityL);
  const tel = nominalTelemetry({ distanceM: route.distanceM, elapsedS: timeEstimateS, fuelFraction: arrivalFraction, endPosition: route.destination.position });
  const aircraft = resolveAircraft(build);
  const revenueBase = contractRevenueCash(getArchetype(contract.archetype), route.distanceM, payloadKg);
  const flight = computeFlightResult({ ...contract.mission, rewardBaseCash: revenueBase }, tel, aircraft, build, homeBase, startFraction);
  const fuelCost = computeOperatingCosts(tel, aircraft, build, homeBase, startFraction).fuelCost;
  const fees = LANDING_FEE_CASH[route.destination.surface];

  return {
    loadout: { fuelL, payloadKg },
    mass: { emptyKg, fuelKg: fuelMassKg(fuelL), payloadKg, totalKg, mtowKg: mtow },
    range: { distanceKm: route.distanceM / 1000, estimatedKm, usableKm, requiredKm, reserveKm: estimatedKm - requiredKm, groundSpeedKmh: gs * 3.6 },
    fuel: { capacityL, loadedL: fuelL, tripL, climbL, arrivalL, arrivalFraction, startFraction },
    takeoff: { rollM: dep.takeoffRollM, runwayM: route.origin.runwayLengthM, climbMs: dep.bestClimbMs },
    landing: { rollM: arr.landingRollM, runwayM: route.destination.runwayLengthM },
    wind: { headwindMs: wind.cruiseHeadwindMs, crosswindMs: wind.crosswindMs },
    timeEstimateS,
    economics: { expectedRevenue: flight.rewardCash, fuelCost, fees, expectedOperatingCost: fuelCost + fees, expectedNet: flight.rewardCash - fuelCost - fees },
    utilization, limiting, difficulty, reach, blockers, feasible: blockers.length === 0,
  };
}

// --- Loadout helpers ------------------------------------------------------------------------------

/** Most fuel worth carrying: tank capacity, MTOW, and what the origin can supply. More fuel is heavier
 * but always extends range, so this is the loadout that shows what the aircraft is capable of. */
export function maxUsefulFuelL(build: AircraftBuild, route: RouteContext, payloadKg: number, onboardFuelL: number): number {
  const capacityL = definitionFor(build).mass.fuelCapacityL;
  const massLimitL = Math.max(0, (mtowKg(build) - emptyMassKg(build) - payloadKg) / fuelMassKg(1));
  const supplyL = route.origin.services.includes('fuel') ? capacityL : onboardFuelL;
  return Math.min(capacityL, massLimitL, supplyL);
}

export interface Assessment {
  /** Plan at the best loadout the aircraft could take for this contract (minimum payload, max useful fuel). */
  plan: MissionPlan;
  difficulty: Difficulty;
  reach: Reachability;
  available: boolean;
}

export function assessContract(build: AircraftBuild, route: RouteContext, contract: PlanInput['contract'], onboardFuelL: number, homeBase?: HomeBaseState): Assessment {
  const payloadKg = contract.minPayloadKg;
  const fuelL = maxUsefulFuelL(build, route, payloadKg, onboardFuelL);
  const plan = planMission({ build, route, contract, loadout: { fuelL, payloadKg }, onboardFuelL, homeBase });
  return { plan, difficulty: plan.difficulty, reach: plan.reach, available: plan.feasible };
}

/** Range utilisation the default loadout aims for: almost twice the range the route needs, so a routine hop
 * is not briefed as "marginal" just because the tank was trimmed to the bone. */
const RECOMMENDED_RANGE_UTILIZATION = 0.55;

/** Sensible default for the briefing: full offered payload and the least fuel that keeps a comfortable range margin
 * (or, when the aircraft can barely make it, the most it can usefully carry minus a sliver). */
export function recommendLoadout(build: AircraftBuild, route: RouteContext, contract: PlanInput['contract'], onboardFuelL: number, homeBase?: HomeBaseState): Loadout {
  const payloadKg = contract.payloadKg;
  let hi = maxUsefulFuelL(build, route, payloadKg, onboardFuelL);
  const util = (fuelL: number) => planMission({ build, route, contract, loadout: { fuelL, payloadKg }, onboardFuelL, homeBase }).utilization.range;
  const best = util(hi);
  if (best > 1) return { fuelL: hi, payloadKg };
  const target = Math.min(0.98, Math.max(RECOMMENDED_RANGE_UTILIZATION, best * 1.05));
  let lo = 0;
  for (let i = 0; i < 9; i++) {
    const mid = (lo + hi) / 2;
    if (util(mid) <= target) hi = mid; else lo = mid;
  }
  return { fuelL: Math.ceil(hi * 10) / 10, payloadKg };
}
