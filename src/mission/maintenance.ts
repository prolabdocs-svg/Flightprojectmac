// Maintenance (slow, ordinary wear) and repair pricing/duration (spec items 5-6). Kept apart from
// damageIntegration.ts (which only ever moves the sim's own numbers into persistence) so the two
// degradation sources stay easy to reason about separately, as the spec asks.

import type { AircraftCondition, ComponentId } from './aircraftCondition';
import { INTEGRITY_CRITICAL, componentTopology, damageAccumulated } from './aircraftCondition';

// --- Normal wear (very slow; hard landings/impacts are damage, handled elsewhere) -----------------

interface UsageSample {
  distanceM: number;
  elapsedS: number;
  landed: boolean;
}

/** Integrity lost per component per unit of ordinary use. Small enough that a normal flight is
 * not worth a line item — dozens of clean flights before anything crosses into WORN. */
const WEAR_PER_1000KM: Partial<Record<ComponentId, number>> = {
  wingLeft: 0.003, wingRight: 0.003, stabHorizontal: 0.002, stabVertical: 0.002, fuselage: 0.0015,
};
const WEAR_PER_FLIGHT_HOUR: Partial<Record<ComponentId, number>> = {
  engine: 0.015, propeller: 0.012,
};
const WEAR_PER_LANDING: Partial<Record<ComponentId, number>> = {
  gearLeft: 0.006, gearRight: 0.006, gearNose: 0.004,
};

export function applyNormalWear(condition: AircraftCondition, usage: UsageSample): AircraftCondition {
  const next: AircraftCondition = { ...condition };
  const distanceFactor = usage.distanceM / 1000 / 1000; // per 1000 km
  const hours = usage.elapsedS / 3600;
  for (const id of componentTopology()) {
    let wear = (WEAR_PER_1000KM[id] ?? 0) * distanceFactor + (WEAR_PER_FLIGHT_HOUR[id] ?? 0) * hours;
    if (usage.landed) wear += WEAR_PER_LANDING[id] ?? 0;
    if (wear <= 0) continue;
    next[id] = { integrity: Math.max(0, condition[id].integrity - wear) };
  }
  return next;
}

// --- Repair pricing (spec item 6) -------------------------------------------------------------

/** Cash floor to fully restore one component from zero integrity. Deliberately coarse (a game
 * abstraction, not a parts catalog) — flight-surface components cost more than the airframe
 * proxy pieces, matching content/economy.ts's existing wing > gear > tail ordering. */
const COMPONENT_REPLACEMENT_CASH: Record<ComponentId, number> = {
  wingLeft: 90, wingRight: 90, stabHorizontal: 45, stabVertical: 45,
  gearLeft: 55, gearRight: 55, gearNose: 45,
  engine: 140, propeller: 70, fuselage: 100,
};

/** A patch (partial integrity loss) costs less than replacing the component outright. */
const REPAIR_FRACTION_OF_REPLACEMENT = 0.6;
const MS_PER_INTEGRITY_POINT = 45_000; // 45s of downtime per 1.0 of integrity restored
const MIN_REPAIR_DURATION_MS = 20_000;

/** A repair actually purchased (spec item 6: separate from the estimate above). Deferred, not
 * instant: it resolves at `readyAtMs`, checked with the ordinary wall clock (Date.now()) the same
 * way the rest of the profile already timestamps itself (save.ts's createdAt). */
export interface RepairOrder {
  componentIds: ComponentId[];
  costCash: number;
  startedAtMs: number;
  readyAtMs: number;
}

export function isRepairReady(order: RepairOrder, nowMs: number): boolean {
  return nowMs >= order.readyAtMs;
}

export interface RepairEstimate {
  componentIds: ComponentId[];
  costCash: number;
  durationMs: number;
}

/** Cost/duration to restore the given components (default: everything not already HEALTHY) to
 * full integrity. Pure — does not touch cash or the condition itself; see operations.ts for the
 * "actually purchased" half (spec item 6's estimate/purchase split). */
export function estimateRepair(condition: AircraftCondition, componentIds?: ComponentId[]): RepairEstimate {
  const ids = (componentIds ?? componentTopology()).filter((id) => damageAccumulated(condition[id]) > 0);
  let costCash = 0;
  let maxIntegrityRestored = 0;
  for (const id of ids) {
    const lost = damageAccumulated(condition[id]);
    costCash += lost * COMPONENT_REPLACEMENT_CASH[id] * REPAIR_FRACTION_OF_REPLACEMENT;
    maxIntegrityRestored = Math.max(maxIntegrityRestored, lost);
  }
  const durationMs = ids.length === 0 ? 0 : Math.max(MIN_REPAIR_DURATION_MS, Math.round(maxIntegrityRestored * MS_PER_INTEGRITY_POINT));
  return { componentIds: ids, costCash: Math.round(costCash), durationMs };
}

// --- Free basic repair (anti-softlock) ----------------------------------------------------------

/** What the recovery crew does for free: every CRITICAL/INOPERATIVE component is patched up to the
 * DAMAGED band, so the aircraft is always airworthy again. Never raises anything above that — the
 * performance hit of a DAMAGED aircraft stays, and a full restoration is still a paid repair.
 * Invariant: a parked aircraft is never GROUNDED, so cash can never gate flying. */
export function basicRepair(condition: AircraftCondition): AircraftCondition {
  const low = componentTopology().filter((id) => condition[id].integrity < INTEGRITY_CRITICAL);
  if (low.length === 0) return condition;
  const next: AircraftCondition = { ...condition };
  for (const id of low) next[id] = { integrity: INTEGRITY_CRITICAL };
  return next;
}
