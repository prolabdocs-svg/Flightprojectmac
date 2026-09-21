// Reward calculation (spec 14.2). Conceptually:
// Reward = missionBase + distanceComponent + landingComponent + objectiveBonuses
//        + skillBonus - catastrophicRepairPenaltyCap
// A bad flight never wipes out all progress: the penalty is capped.

import type { AircraftBuild, FlightResult, HomeBaseState, MissionDefinition, PartCategory } from '../core/types';
import type { FlightTelemetry } from '../flight/flightTypes';
import type { ResolvedAircraft } from './assembly';
import { getPart } from './parts';
import { roleForSurfaceId, gearPartId, type PartRole } from '../sim/damageSystem';
import { isMissionCompleted } from './missionProgress';
import { getHomeBaseBenefits } from './homeBase';

// --- Operating costs (audit gap: the economy previously only ever paid the player,
// never charged them, so cash only went up). Two real sinks: fuel burned this flight and
// repairs for anything the damage system (src/sim/damageSystem.ts) marked as damaged or
// detached. Kept as a small pure function, mirroring computeFlightResult's style, so it's
// trivially unit-testable and easy to wire into the reward/cost breakdown below.

/** Cash charged per liter of fuel actually burned. A gameplay abstraction, not a real
 * fuel price (see parts.ts's "Nota de seguridad" comment for the same disclaimer). */
const FUEL_COST_PER_LITER_CASH = 0.9;
/** Fallback fuel tank size if no aircraft is supplied (matches assembly.ts's own default
 * fallback for an unrecognized/empty build). */
const DEFAULT_FUEL_CAPACITY_L = 8;

/** A damaged (but still attached) part is patched up for a fraction of its replacement
 * value; a detached part needs a full replacement, so it costs much more. */
const DAMAGED_REPAIR_FRACTION = 0.35;
const DETACHED_REPAIR_FRACTION = 0.9;

/** Elevator/rudder are part of the base frame (spec: FRAME_ZERO.baseAeroSurfaces) and are
 * never bought/sold via parts.ts, so they have no catalog price to repair against. Wing
 * and gear parts are catalog items, but the cheapest starter parts (wing_a_basic,
 * gear_light) are priced at 0 cash since they come free with the frame — that shouldn't
 * mean "free to repair" (they still cost material/labor), so these act as a floor under
 * whatever the installed part's catalog price is. */
const ROLE_REPAIR_FLOOR_CASH: Record<PartRole, number> = {
  wing: 80,
  tail: 40,
  gear: 60,
};

const ROLE_TO_CATEGORY: Partial<Record<PartRole, PartCategory>> = {
  wing: 'wingSet',
  gear: 'landingGear',
  // 'tail' has no purchasable category (see comment above) - always falls back to the floor.
};

/** Repair penalty is capped so a bad flight can never make the player go cash-negative
 * or wipe out everything they just earned - same "never wipe out all progress" principle
 * computeFlightResult already applies to the crash reward penalty above. */
const MIN_NET_CASH_AFTER_COSTS = 5;

export { isMissionCompleted } from './missionProgress';

function referenceRepairValue(role: PartRole, build?: AircraftBuild): number {
  const category = ROLE_TO_CATEGORY[role];
  const floor = ROLE_REPAIR_FLOOR_CASH[role];
  if (!category || !build) return floor;
  const installedId = build.installed[category];
  const part = installedId ? getPart(installedId) : undefined;
  return part ? Math.max(part.priceCash, floor) : floor;
}

export interface OperatingCosts {
  fuelCost: number;
  repairCost: number;
  totalCost: number;
}

/**
 * Pure operating-cost calculation for one completed flight. `aircraft` supplies fuel tank
 * capacity (for fuel cost); `build` supplies which parts are installed (for repair cost
 * pricing). Both are optional so existing callers/tests that only care about reward math
 * keep compiling - costs just fall back to role-floor defaults.
 */
export function computeOperatingCosts(
  telemetry: FlightTelemetry,
  aircraft?: ResolvedAircraft,
  build?: AircraftBuild,
  homeBase?: HomeBaseState,
): OperatingCosts {
  const fuelCapacityL = aircraft?.fuelCapacityL ?? DEFAULT_FUEL_CAPACITY_L;
  const fuelBurnedL = Math.max(0, 1 - telemetry.fuelFraction) * fuelCapacityL;
  const fuelCost = fuelBurnedL * FUEL_COST_PER_LITER_CASH;

  let repairCost = 0;
  for (const partId of telemetry.damagedPartIds ?? []) {
    const role = partId === gearPartId() ? 'gear' : roleForSurfaceId(partId);
    repairCost += referenceRepairValue(role, build) * DAMAGED_REPAIR_FRACTION;
  }
  for (const partId of telemetry.detachedPartIds ?? []) {
    const role = partId === gearPartId() ? 'gear' : roleForSurfaceId(partId);
    repairCost += referenceRepairValue(role, build) * DETACHED_REPAIR_FRACTION;
  }

  // Total loss: the whole airframe needs rebuilding, not just the individually flagged
  // parts (some structural damage isn't tracked per-part). Scale up to roughly a full
  // wing+tail+gear replacement instead of stacking on top of whatever was already summed.
  if (telemetry.crashOutcome === 'totalLoss') {
    const fullAirframeCost =
      referenceRepairValue('wing', build) * DETACHED_REPAIR_FRACTION +
      referenceRepairValue('tail', build) * DETACHED_REPAIR_FRACTION +
      referenceRepairValue('gear', build) * DETACHED_REPAIR_FRACTION;
    repairCost = Math.max(repairCost, fullAirframeCost);
  }

  repairCost *= 1 - getHomeBaseBenefits(homeBase).repairDiscount;
  return {
    fuelCost: Math.round(fuelCost),
    repairCost: Math.round(repairCost),
    totalCost: Math.round(fuelCost + repairCost),
  };
}

export function computeFlightResult(
  mission: MissionDefinition | null,
  telemetry: FlightTelemetry,
  aircraft?: ResolvedAircraft,
  build?: AircraftBuild,
  homeBase?: HomeBaseState,
): FlightResult {
  let rewardCash = mission?.rewardBaseCash ?? 20;
  let rewardRp = mission?.rewardBaseRp ?? 3;
  const bonusesAchieved: string[] = [];

  const distanceComponent = Math.min(200, telemetry.distanceM * 0.15);
  rewardCash += distanceComponent;

  if (telemetry.landed) {
    rewardCash += telemetry.landingQuality * 40;
    rewardRp += Math.round(telemetry.landingQuality * 5);
  }

  if (mission) {
    for (const bonus of mission.bonuses) {
      let achieved = false;
      switch (bonus.check) {
        case 'noDamage':
          achieved = !telemetry.crashed;
          break;
        case 'fuelRemaining':
          achieved = telemetry.fuelFraction >= (bonus.value ?? 0.5);
          break;
        case 'landingQuality':
          achieved = telemetry.landed && telemetry.landingQuality >= (bonus.value ?? 0.6);
          break;
        case 'timeUnder':
          // `elapsedS` comes from the fixed-step simulation, so pausing the game
          // cannot invalidate a time-trial bonus. A time objective only counts on
          // a completed (non-crashed) flight; otherwise a quick crash would be a
          // loophole.
          achieved = isMissionCompleted(mission, telemetry) && telemetry.elapsedS <= (bonus.value ?? 60);
          break;
      }
      if (achieved) {
        rewardCash += bonus.rewardCash;
        rewardRp += bonus.rewardRp;
        bonusesAchieved.push(bonus.id);
      }
    }
  }

  if (telemetry.crashed) {
    rewardCash = Math.max(10, rewardCash * 0.4);
  } else if (telemetry.crashOutcome === 'hardLanding') {
    // Damage system (src/sim/damageSystem.ts): a hard-but-survivable impact damages parts
    // without tripping the full `crashed` flag. Lighter penalty than a total loss, still
    // capped so a rough landing never wipes out the run (spec 14.2 catastrophicRepairPenaltyCap).
    rewardCash = Math.max(15, rewardCash * 0.75);
  }

  const roundedRewardCash = Math.round(rewardCash);
  const operatingCosts = computeOperatingCosts(telemetry, aircraft, build, homeBase);
  // Never let costs push the flight's net cash below a small floor - same "a bad flight
  // never wipes out all progress" guarantee the crash-penalty cap already gives the
  // reward side above, just applied to the reward-minus-cost total instead. When the raw
  // total would breach the floor, scale fuel and repair down together so the breakdown
  // shown to the player still adds up to the (capped) total.
  const uncappedTotal = operatingCosts.totalCost;
  const maxAffordableCost = Math.max(0, roundedRewardCash - MIN_NET_CASH_AFTER_COSTS);
  const costScale = uncappedTotal > maxAffordableCost && uncappedTotal > 0 ? maxAffordableCost / uncappedTotal : 1;
  const fuelCost = Math.round(operatingCosts.fuelCost * costScale);
  const repairCost = Math.round(operatingCosts.repairCost * costScale);
  const netCash = roundedRewardCash - fuelCost - repairCost;

  return {
    missionId: mission?.id ?? null,
    distanceM: telemetry.distanceM,
    maxAltitudeM: telemetry.maxAltitudeM,
    maxSpeedMs: telemetry.maxSpeedMs,
    crashed: telemetry.crashed,
    landed: telemetry.landed,
    landingQuality: telemetry.landingQuality,
    timeS: telemetry.elapsedS,
    fuelRemaining: telemetry.fuelFraction,
    rewardCash: roundedRewardCash,
    rewardRp: Math.round(rewardRp),
    bonusesAchieved,
    missionCompleted: isMissionCompleted(mission, telemetry),
    reputationGain: telemetry.crashed ? 0.5 : isMissionCompleted(mission, telemetry) ? 3 : telemetry.landed ? 1.5 : 1,
    crashOutcome: telemetry.crashOutcome,
    damagedPartIds: telemetry.damagedPartIds,
    detachedPartIds: telemetry.detachedPartIds,
    fuelCost,
    repairCost,
    netCash,
  };
}
