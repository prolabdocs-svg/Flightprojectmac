// Profile-level operations (master spec 64, slices 1-2): the only place that turns contract events
// into wallet / reputation / discovery / persistence changes. Every function is pure
// (PlayerProfile in, PlayerProfile out) so profileStore is a thin wrapper and the whole loop can run
// headless. Nothing here reads a screen.

import type { PlayerProfile } from '../core/types';
import type { FlightTelemetry } from '../flight/flightTypes';
import { resolveAircraft } from '../content/assembly';
import { getAirfield } from '../world/airfields';
import { getMission } from '../content/missions';
import { getRegion } from '../content/regions';
import { generateContracts, weatherFor, type ContractOffer } from './contracts';
import { fuelFraction } from './fuel';
import { assessContract, planMission, recommendLoadout, type Assessment, type MissionPlan } from './planning';
import { routeContext } from './route';
import { settleContract, type Settlement } from './settlement';
import { applyEvent, createSession } from './stateMachine';
import { observe } from './telemetryEvents';
import type { ActiveContract, AppliedSettlement, Contract, Loadout, LogKind, MissionEvent, OperationsState, TransitionError } from './types';
import { applyFlightDamage } from './damageIntegration';
import { applyNormalWear, basicRepair, estimateRepair, isRepairReady, type RepairOrder } from './maintenance';
import { evaluateAirworthiness, damageAccumulated, type Airworthiness, type ComponentId } from './aircraftCondition';

const DEBT_CAP_CASH = 500;
const DEBT_REPAY_SHARE = 0.5;
const LOG_LIMIT = 200;
/** In-flight checkpoint cadence (spec item 11): frequent enough that an abrupt close never
 * refunds more than a few seconds of burned fuel, sparse enough to never write IndexedDB
 * every physics tick. */
const CHECKPOINT_INTERVAL_S = 5;

export type OpResult<T> = ({ ok: true; profile: PlayerProfile } & T) | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const errText = (e: TransitionError) => `${e.code}: ${e.message}`;

const withOps = (p: PlayerProfile, patch: Partial<OperationsState>): PlayerProfile => ({ ...p, operations: { ...p.operations, ...patch } });
const log = (ops: OperationsState, kind: LogKind, contractId?: string, value?: number, note?: string): OperationsState['log'] =>
  [...ops.log, { kind, contractId, value, note }].slice(-LOG_LIMIT);

// --- Offers & map --------------------------------------------------------------------------------

export function getOffers(profile: PlayerProfile): ContractOffer[] {
  const ops = profile.operations;
  return generateContracts({
    build: profile.currentBuild, homeBase: profile.homeBase, reputation: profile.reputation, originId: ops.locationId,
    knownAirfieldIds: ops.knownAirfieldIds, visitedAirfieldIds: ops.visitedAirfieldIds, onboardFuelL: ops.fuelL, seed: ops.contractSeed,
  }).filter((o) => !ops.settledContractIds.includes(o.contract.id));
}

export interface DestinationStatus {
  airfieldId: string;
  visited: boolean;
  assessment: Assessment;
}

/** What each known destination looks like RIGHT NOW for the current aircraft, independent of any
 * contract (ferry probe in the region's mean wind). This is what colours the map pins. */
export function getDestinationStatuses(profile: PlayerProfile): DestinationStatus[] {
  const ops = profile.operations;
  const home = getAirfield(ops.locationId);
  if (!home) return [];
  const probe: Pick<Contract, 'archetype' | 'weather' | 'payloadKg' | 'minPayloadKg' | 'mission'> = {
    archetype: 'ferry', weather: weatherFor(home.regionId, 0, 'map'), payloadKg: 0, minPayloadKg: 0,
    mission: { id: 'probe', regionId: home.regionId, family: 'distanceRun', name: '', description: '', spawnPoint: [0, 0, 0], spawnHeadingDeg: 0, rewardBaseCash: 0, rewardBaseRp: 0, bonuses: [] },
  };
  probe.weather = { windMs: getRegion(home.regionId).windBaseMs, gustMs: getRegion(home.regionId).environment.gustStrengthMs };
  return ops.knownAirfieldIds
    .filter((id) => id !== ops.locationId)
    .map((id) => ({ airfieldId: id, visited: ops.visitedAirfieldIds.includes(id), assessment: assessContract(profile.currentBuild, routeContext(ops.locationId, id), probe, ops.fuelL, profile.homeBase) }));
}

// --- Lifecycle -----------------------------------------------------------------------------------

export function acceptContract(profile: PlayerProfile, contractId: string): OpResult<{ active: ActiveContract }> {
  if (profile.operations.active) return fail('CONTRACT_ALREADY_ACTIVE');
  const offer = getOffers(profile).find((o) => o.contract.id === contractId);
  if (!offer) return fail('UNKNOWN_CONTRACT');
  if (!offer.available) return fail(`CONTRACT_LOCKED: ${offer.lockedReason ?? 'unavailable'}`);
  const r = applyEvent(createSession(contractId), { type: 'ACCEPT', difficulty: offer.assessment.difficulty });
  if (!r.ok) return fail(errText(r.error));
  const active: ActiveContract = { contract: offer.contract, session: r.session, loadout: null, startFuelFraction: null, finalTelemetry: null, checkpoint: null };
  return { ok: true, profile: withOps(profile, { active }), active };
}

export function planFor(profile: PlayerProfile, loadout: Loadout): MissionPlan | null {
  const active = profile.operations.active;
  if (!active) return null;
  const plan = planMission({
    build: profile.currentBuild, route: routeContext(active.contract.originId, active.contract.destinationId),
    contract: active.contract, loadout, onboardFuelL: profile.operations.fuelL, homeBase: profile.homeBase,
  });
  // Airworthiness gate (spec item 7), applied here so the planner shows it live and
  // prepareMission's PREPARE guard sees the exact same blockers — one source of truth.
  if (evaluateAirworthiness(profile.operations.aircraftCondition).status !== 'GROUNDED') return plan;
  return { ...plan, feasible: false, blockers: [...plan.blockers, 'AIRCRAFT_GROUNDED'] };
}

export function suggestedLoadout(profile: PlayerProfile): Loadout | null {
  const active = profile.operations.active;
  if (!active) return null;
  return recommendLoadout(profile.currentBuild, routeContext(active.contract.originId, active.contract.destinationId), active.contract, profile.operations.fuelL, profile.homeBase);
}

/** Fuel/payload go on board: the tank content becomes the chosen fuel and the mission is PREPARED. */
export function prepareMission(profile: PlayerProfile, loadout: Loadout): OpResult<{ plan: MissionPlan }> {
  const active = profile.operations.active;
  if (!active) return fail('NO_ACTIVE_CONTRACT');
  const plan = planFor(profile, loadout)!;
  const r = applyEvent(active.session, { type: 'PREPARE', feasible: plan.feasible, blockers: plan.blockers });
  if (!r.ok) return fail(errText(r.error));
  const capacityL = resolveAircraft(profile.currentBuild).fuelCapacityL;
  const next: ActiveContract = { ...active, session: r.session, loadout: plan.loadout, startFuelFraction: fuelFraction(plan.loadout.fuelL, capacityL) };
  return { ok: true, profile: withOps(profile, { active: next, fuelL: plan.loadout.fuelL }), plan };
}

/** Feeds a telemetry sample to the active contract. Returns the same profile object if nothing
 * changed. Also refreshes the in-flight checkpoint (spec item 11) on an interval, independent of
 * mission events, so a periodic persist (see state/profileStore.ts) never goes longer than
 * CHECKPOINT_INTERVAL_S without capturing fuel burned. */
export function advanceMission(profile: PlayerProfile, telemetry: FlightTelemetry): { profile: PlayerProfile; events: MissionEvent[] } {
  const active = profile.operations.active;
  if (!active) return { profile, events: [] };
  const { session, events } = observe(active.session, telemetry, active.contract);
  const checkpointDue = active.session.state === 'ACTIVE'
    && (active.checkpoint === null || telemetry.elapsedS - active.checkpoint.elapsedS >= CHECKPOINT_INTERVAL_S);
  if (events.length === 0 && !checkpointDue) return { profile, events };
  const terminal = session.state === 'OBJECTIVE_MET' || session.state === 'FAILED' || session.state === 'ABORTED';
  const checkpoint = active.session.state === 'ACTIVE' ? { fuelFraction: telemetry.fuelFraction, elapsedS: telemetry.elapsedS } : active.checkpoint;
  let ops = { ...profile.operations, active: { ...active, session, finalTelemetry: terminal ? telemetry : active.finalTelemetry, checkpoint } };
  for (const e of events) {
    if (e.type === 'ENGINE_STARTED') ops = { ...ops, log: log(ops, 'mission_start', active.contract.id) };
    if (e.type === 'AIRBORNE') ops = { ...ops, log: log(ops, 'takeoff', active.contract.id) };
    if (e.type === 'CRASH') ops = { ...ops, log: log(ops, 'crash', active.contract.id, undefined, e.reason) };
  }
  return { profile: { ...profile, operations: ops }, events };
}

/** Player gives up (menu action). Before takeoff it is free; in the air it costs a penalty at settlement. */
export function abandonMission(profile: PlayerProfile, telemetry?: FlightTelemetry): OpResult<{ settlement: Settlement | null }> {
  const active = profile.operations.active;
  if (!active) return fail('NO_ACTIVE_CONTRACT');
  const st = active.session.state;
  if (st === 'OBJECTIVE_MET' || st === 'COMPLETED' || st === 'FAILED' || st === 'ABORTED' || st === 'RECOVERED') {
    // Already over (e.g. crashed, then left without recovering): settle if still owed, then free the slot.
    let p = profile;
    let settlement: Settlement | null = null;
    if (!p.operations.settledContractIds.includes(active.contract.id)) {
      const s = settleActive(p, telemetry ?? null);
      if (s.ok) { p = s.profile; settlement = s.settlement; }
    }
    const rec = recoverAircraft(p);
    return { ok: true, profile: rec.ok ? rec.profile : withOps(p, { active: null }), settlement };
  }
  const r = applyEvent(active.session, { type: 'ABANDON' });
  if (!r.ok) return fail(errText(r.error));
  const aborted: ActiveContract = { ...active, session: r.session };
  const started = r.session.history.some((h) => h.event === 'ENGINE_STARTED');
  let next = withOps(profile, { active: aborted, log: log(profile.operations, 'mission_abandon', active.contract.id) });
  if (!started) return { ok: true, profile: withOps(next, { active: null }), settlement: null };
  const s = settleActive(next, telemetry ?? null);
  return s.ok ? { ok: true, profile: s.profile, settlement: s.settlement } : s;
}

// --- Settlement ----------------------------------------------------------------------------------

/** Pays (or charges) the contract exactly once. A second call with the same settlement is a no-op. */
export function applySettlement(profile: PlayerProfile, s: Settlement, final: { telemetry: FlightTelemetry | null; contract: Contract; capacityL: number }): PlayerProfile {
  const ops = profile.operations;
  if (ops.settledContractIds.includes(s.contractId)) return profile;

  let cash = profile.cash;
  let debt = ops.debtCash;
  if (s.net >= 0) {
    const repay = Math.min(debt, Math.round(s.net * DEBT_REPAY_SHARE));
    cash += s.net - repay;
    debt -= repay;
  } else {
    cash += s.net;
    if (cash < 0) { debt = Math.min(DEBT_CAP_CASH, debt - cash); cash = 0; }
  }

  const t = final.telemetry;
  const c = final.contract;
  let log2 = ops.log;
  const push = (kind: LogKind, value?: number, note?: string) => { log2 = [...log2, { kind, contractId: s.contractId, value, note }].slice(-LOG_LIMIT); };
  const burnedL = t && ops.active?.startFuelFraction != null ? Math.max(0, ops.active.startFuelFraction - t.fuelFraction) * final.capacityL : 0;
  if (burnedL > 0) push('fuel_used', burnedL);
  if (t && (t.damagedPartIds.length + t.detachedPartIds.length) > 0) push('damage', s.costs.damage);
  if (s.outcome === 'COMPLETED') { push('landing', t?.lastTouchdownVsMs ?? undefined); push('mission_complete', s.net); }

  const landedAtDestination = s.outcome === 'COMPLETED';
  const dest = getAirfield(c.destinationId);
  const firstVisit = landedAtDestination && !ops.visitedAirfieldIds.includes(c.destinationId);
  if (firstVisit) push('destination_discovered', undefined, c.destinationId);
  const known = new Set(ops.knownAirfieldIds);
  const visited = new Set(ops.visitedAirfieldIds);
  if (landedAtDestination) { visited.add(c.destinationId); known.add(c.destinationId); (dest?.reveals ?? []).forEach((id) => known.add(id)); }

  const remainingL = t ? t.fuelFraction * final.capacityL : ops.fuelL;
  const nextActive = landedAtDestination || !ops.active ? null : ops.active;
  const completed = { ...profile.completedMissions };
  if (landedAtDestination) {
    const prior = completed[c.mission.id];
    completed[c.mission.id] = { bestScore: Math.max(prior?.bestScore ?? 0, t?.distanceM ?? 0), attempts: (prior?.attempts ?? 0) + 1 };
  }

  const revealed = landedAtDestination ? (dest?.reveals ?? []).filter((id) => !ops.knownAirfieldIds.includes(id)) : [];
  const conditionAfter = {
    flights: ops.condition.flights + (t ? 1 : 0),
    landings: ops.condition.landings + (landedAtDestination ? 1 : 0),
    hardLandings: ops.condition.hardLandings + (t?.crashOutcome === 'hardLanding' ? 1 : 0),
  };

  // Persistent per-component condition (spec items 1-3): the sim's own output for this flight
  // (t.partIntegrity et al) folded onto what came in, then ordinary wear for the use this flight
  // represented. A flight that never left the ground (t === null) touches neither.
  const conditionBefore = ops.aircraftCondition;
  const conditionAfterDamage = t ? applyFlightDamage(conditionBefore, t) : conditionBefore;
  // damagedComponentIds reports damage only, not ordinary wear, so Results doesn't flag a
  // clean flight as "damaged" over a fraction of a percent of routine use.
  const damagedComponentIds = (Object.keys(conditionAfterDamage) as ComponentId[]).filter(
    (id) => damageAccumulated(conditionAfterDamage[id]) > damageAccumulated(conditionBefore[id]) + 1e-6,
  );
  const aircraftCondition = t
    ? applyNormalWear(conditionAfterDamage, { distanceM: t.distanceM, elapsedS: t.elapsedS, landed: landedAtDestination || t.landed })
    : conditionAfterDamage;

  const applied: AppliedSettlement = {
    ...s, title: c.title, originId: c.originId, destinationId: c.destinationId, failure: ops.active?.session.failure, abortReason: ops.active?.session.abortReason,
    cashChange: cash - profile.cash, debtChange: debt - ops.debtCash, cashAfter: cash, debtAfter: debt,
    discoveredAirfieldId: firstVisit ? c.destinationId : null, revealedAirfieldIds: revealed, fuelRemainingL: remainingL, conditionAfter, damagedComponentIds,
  };
  return {
    ...profile,
    cash,
    researchPoints: profile.researchPoints + s.researchPoints,
    reputation: Math.max(0, profile.reputation + s.reputationDelta),
    completedMissions: completed,
    operations: {
      ...ops,
      debtCash: debt,
      fuelL: remainingL,
      locationId: landedAtDestination ? c.destinationId : ops.locationId,
      knownAirfieldIds: [...known],
      visitedAirfieldIds: [...visited],
      settledContractIds: [...ops.settledContractIds, s.contractId],
      contractSeed: ops.contractSeed + 1,
      condition: conditionAfter,
      // Parked at the destination = the ground crew's free basic repair; still out there (awaiting
      // recovery) = recoverAircraft applies it.
      aircraftCondition: nextActive ? aircraftCondition : basicRepair(aircraftCondition),
      active: nextActive,
      log: log2,
      lastSettlement: applied,
    },
  };
}

/** Closes the active contract: completes it if the objective was met, then settles once. */
export function settleActive(profile: PlayerProfile, telemetryIn?: FlightTelemetry | null): OpResult<{ settlement: Settlement }> {
  let active = profile.operations.active;
  if (!active) return fail('NO_ACTIVE_CONTRACT');
  const telemetry = telemetryIn ?? active.finalTelemetry ?? null;
  if (profile.operations.settledContractIds.includes(active.contract.id)) return fail('ALREADY_SETTLED');
  if (active.session.state === 'OBJECTIVE_MET') {
    const r = applyEvent(active.session, { type: 'COMPLETE' });
    if (!r.ok) return fail(errText(r.error));
    active = { ...active, session: r.session };
  }
  const state = active.session.state;
  if (state !== 'COMPLETED' && state !== 'FAILED' && state !== 'ABORTED') return fail(`NOT_SETTLEABLE: ${state}`);

  const capacityL = resolveAircraft(profile.currentBuild).fuelCapacityL;
  const settlement = settleContract({
    contract: active.contract, session: active.session, telemetry, loadout: active.loadout, startFuelFraction: active.startFuelFraction,
    build: profile.currentBuild, homeBase: profile.homeBase,
    firstVisitToDestination: !profile.operations.visitedAirfieldIds.includes(active.contract.destinationId),
  });
  const staged = withOps(profile, { active });
  const next = applySettlement(staged, settlement, { telemetry, contract: active.contract, capacityL });
  // A failed/diverted flight stays open until the aircraft is recovered; a diverted one lands where it stopped.
  return { ok: true, profile: next, settlement };
}

/** Brings a failed / diverted aircraft back to the origin strip and frees the contract slot. */
export function recoverAircraft(profile: PlayerProfile): OpResult<{ locationId: string }> {
  const active = profile.operations.active;
  if (!active) return fail('NO_ACTIVE_CONTRACT');
  const r = applyEvent(active.session, { type: 'RECOVER' });
  if (!r.ok) return fail(errText(r.error));
  const locationId = active.session.divertedTo ?? active.contract.originId;
  return { ok: true, profile: withOps(profile, { active: null, locationId, aircraftCondition: basicRepair(profile.operations.aircraftCondition) }), locationId };
}

/** Local balance telemetry (spec 52). */
export function recordUpgrade(profile: PlayerProfile, partId: string): PlayerProfile {
  return withOps(profile, { log: log(profile.operations, 'upgrade_purchased', undefined, undefined, partId) });
}

// --- Resolution & load-time reconciliation --------------------------------------------------------

/** The mission a screen should fly for `id`: the persisted active contract first (so a dynamic contract
 * still resolves after a reload), then the static campaign. */
export function resolveMission(profile: PlayerProfile, id: string | null): { mission: (Contract['mission']) | null; contract: Contract | null } {
  if (!id) return { mission: null, contract: null };
  const active = profile.operations.active;
  if (active && active.contract.id === id) return { mission: active.contract.mission, contract: active.contract };
  return { mission: getMission(id) ?? null, contract: null };
}

/** Region the operations domain currently models: where the aircraft is parked. */
export function operationsRegionId(profile: PlayerProfile): string {
  return getAirfield(profile.operations.locationId)?.regionId ?? 'the_field';
}

/**
 * A save can be loaded in the middle of a contract. The physics of a flight in progress is not persisted,
 * so: an ACTIVE flight is abandoned (with its penalty), a flight that had already ended but was never paid
 * is settled from its captured final telemetry, and PREPARED/ACCEPTED contracts simply resume. Everything
 * goes through the same state machine + ledger as a normal flight, so it can never pay twice.
 */
export function reconcileAfterLoad(profile: PlayerProfile): PlayerProfile {
  let p = profile;
  let active = p.operations.active;
  // Saves from before the free basic repair may be parked GROUNDED: patch them on load.
  if (!active) {
    const patched = basicRepair(p.operations.aircraftCondition);
    return patched === p.operations.aircraftCondition ? p : withOps(p, { aircraftCondition: patched });
  }
  if (active.session.state === 'ACTIVE') {
    const r = applyEvent(active.session, { type: 'ABANDON' });
    if (!r.ok) return p;
    // A crash / abrupt close mid-flight never had a terminal event to capture finalTelemetry, so
    // without this the settlement below would see telemetry === null and treat the flight as if
    // it never left the ground — silently refunding every liter of fuel burned (spec item 11).
    // Fall back to the last periodic checkpoint instead.
    const finalTelemetry = active.finalTelemetry ?? (active.checkpoint ? syntheticTelemetryFromCheckpoint(active.checkpoint) : null);
    p = withOps(p, { active: { ...active, session: r.session, finalTelemetry }, log: log(p.operations, 'mission_abandon', active.contract.id, undefined, 'reload') });
    active = p.operations.active!;
  }
  const s = active.session.state;
  if (!p.operations.settledContractIds.includes(active.contract.id) && (s === 'OBJECTIVE_MET' || s === 'FAILED' || s === 'ABORTED')) {
    const settled = settleActive(p);
    if (settled.ok) p = settled.profile;
  }
  return p;
}

/** The contract behind a screen's selected id: the persisted active one, else a currently generated offer. */
export function findContract(profile: PlayerProfile, id: string | null): Contract | null {
  if (!id) return null;
  if (profile.operations.active?.contract.id === id) return profile.operations.active.contract;
  return getOffers(profile).find((o) => o.contract.id === id)?.contract ?? null;
}

/** A minimal, honest telemetry sample for the sole purpose of settling fuel burn against a
 * checkpoint (see reconcileAfterLoad above) — every other field is a safe "nothing happened"
 * default since ABORTED settlement never reads them. */
function syntheticTelemetryFromCheckpoint(checkpoint: NonNullable<ActiveContract['checkpoint']>): FlightTelemetry {
  return {
    state: 'stopped', speedMs: 0, altitudeM: 0, aoaDeg: 0, distanceM: 0, maxAltitudeM: 0, maxSpeedMs: 0,
    fuelFraction: checkpoint.fuelFraction, crashed: false, landed: false, landingQuality: 0, rpm: 0, onGround: true,
    crashOutcome: 'none', damagedPartIds: [], detachedPartIds: [], landingFailures: [], elapsedS: checkpoint.elapsedS, position: [0, 0, 0],
    headingDeg: 0, airspeedMs: 0, groundSpeedMs: 0, verticalSpeedMs: 0, pitchDeg: 0, rollDeg: 0, throttle: 0, engineOn: false,
    outOfFuel: checkpoint.fuelFraction <= 0, stallWarning: false, stalled: false, stallSpeedMs: 0, wheelsOnGround: 3, gForce: 1, lastTouchdownVsMs: null, crashReason: null,
  };
}

// --- Airworthiness & maintenance (spec items 6-7) -------------------------------------------------

export function aircraftAirworthiness(profile: PlayerProfile): Airworthiness {
  return evaluateAirworthiness(profile.operations.aircraftCondition);
}

export function repairEstimateFor(profile: PlayerProfile, componentIds?: ComponentId[]) {
  return estimateRepair(profile.operations.aircraftCondition, componentIds);
}

/** Purchases a repair (spec item 6): charges cash now, resolves later at `order.readyAtMs`. Only
 * the components actually damaged are billed — nothing here ever pretends a repair happened
 * before collectRepair() says so. */
export function startRepair(profile: PlayerProfile, componentIds?: ComponentId[], nowMs = Date.now()): OpResult<{ order: RepairOrder }> {
  if (profile.operations.pendingRepair) return fail('REPAIR_ALREADY_IN_PROGRESS');
  const estimate = estimateRepair(profile.operations.aircraftCondition, componentIds);
  if (estimate.componentIds.length === 0) return fail('NOTHING_TO_REPAIR');
  // A totalLoss crash can ground the aircraft (engine/propeller INOPERATIVE) with the player at
  // $0 and no way to earn more without flying. Same debt mechanism settlement already uses
  // (spec item 8) keeps this from becoming an irreversible soft-lock: what cash can't cover is
  // borrowed, up to the same cap, before the player has to fall back to a cheaper partial repair.
  const debtRoom = Math.max(0, DEBT_CAP_CASH - profile.operations.debtCash);
  if (profile.cash + debtRoom < estimate.costCash) return fail('INSUFFICIENT_FUNDS');
  const fromCash = Math.min(profile.cash, estimate.costCash);
  const fromDebt = estimate.costCash - fromCash;
  const order: RepairOrder = { componentIds: estimate.componentIds, costCash: estimate.costCash, startedAtMs: nowMs, readyAtMs: nowMs + estimate.durationMs };
  const next: PlayerProfile = { ...profile, cash: profile.cash - fromCash };
  return {
    ok: true,
    profile: withOps(next, {
      pendingRepair: order,
      debtCash: profile.operations.debtCash + fromDebt,
      log: log(profile.operations, 'repair_started', undefined, estimate.costCash, order.componentIds.join(',')),
    }),
    order,
  };
}

/** Finishes a ready repair, restoring exactly the components it billed for to full integrity.
 * A no-op (fails cleanly) if nothing is pending or it isn't ready yet — so a screen can call it
 * optimistically without its own clock math. */
export function collectRepair(profile: PlayerProfile, nowMs = Date.now()): OpResult<{ componentIds: ComponentId[] }> {
  const order = profile.operations.pendingRepair;
  if (!order) return fail('NO_PENDING_REPAIR');
  if (!isRepairReady(order, nowMs)) return fail('REPAIR_NOT_READY');
  const condition = { ...profile.operations.aircraftCondition };
  for (const id of order.componentIds) condition[id] = { integrity: 1 };
  return {
    ok: true,
    profile: withOps(profile, {
      aircraftCondition: condition,
      pendingRepair: null,
      log: log(profile.operations, 'repair_completed', undefined, order.costCash, order.componentIds.join(',')),
    }),
    componentIds: order.componentIds,
  };
}
