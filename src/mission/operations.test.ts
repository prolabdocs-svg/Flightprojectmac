import { describe, expect, it } from 'vitest';
import type { PlayerProfile } from '../core/types';
import { createDefaultProfile } from '../save/save';
import { isMissionCompleted } from '../content/missionProgress';
import { getAirfield } from '../world/airfields';
import { generateContracts } from './contracts';
import {
  abandonMission, acceptContract, applySettlement, getDestinationStatuses, getOffers, prepareMission, reconcileAfterLoad, recoverAircraft, resolveMission, settleActive, suggestedLoadout,
} from './operations';
import { applyEvent } from './stateMachine';
import { nominalTelemetry, settleContract } from './settlement';
import type { ActiveContract, MissionEvent } from './types';

const fresh = (): PlayerProfile => ({ ...createDefaultProfile(), createdAt: 0 });
const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
  if (!r.ok) throw new Error(`expected ok: ${(r as { error?: string }).error}`);
  return r as Extract<T, { ok: true }>;
};

function withEvents(p: PlayerProfile, ...events: MissionEvent[]): PlayerProfile {
  let a = p.operations.active as ActiveContract;
  for (const e of events) {
    const r = applyEvent(a.session, e);
    if (!r.ok) throw new Error(`${e.type}: ${r.error.message}`);
    a = { ...a, session: r.session };
  }
  return { ...p, operations: { ...p.operations, active: a } };
}
const TO_LANDED: MissionEvent[] = [
  { type: 'ENGINE_STARTED' }, { type: 'TAKEOFF_ROLL' }, { type: 'AIRBORNE' }, { type: 'DEPARTURE_EXITED' }, { type: 'DESTINATION_PROXIMITY' },
  { type: 'GROUND_CONTACT', atDestination: true },
];

/** Accepts + prepares the first available offer to `dest` with the suggested loadout. */
function prepared(dest = 'field_north_strip', archetype?: string, profile = fresh()) {
  const offer = getOffers(profile).find((o) => o.contract.destinationId === dest && o.available && (!archetype || o.contract.archetype === archetype))!;
  const acc = ok(acceptContract(profile, offer.contract.id));
  const prep = ok(prepareMission(acc.profile, suggestedLoadout(acc.profile)!));
  return { profile: prep.profile, contract: offer.contract, plan: prep.plan };
}
const cleanTelemetry = (p: PlayerProfile, over: Partial<ReturnType<typeof nominalTelemetry>> = {}) => {
  const a = p.operations.active!;
  const dest = getAirfield(a.contract.destinationId)!;
  return { ...nominalTelemetry({ distanceM: a.contract.distanceM, elapsedS: 60, fuelFraction: a.startFuelFraction! * 0.5, endPosition: [dest.position[0], 0, dest.position[2]] }), ...over };
};

describe('contract generator', () => {
  const ctx = (seed: number) => ({ build: fresh().currentBuild, reputation: 0, originId: 'field_home', knownAirfieldIds: fresh().operations.knownAirfieldIds, visitedAirfieldIds: ['field_home'], onboardFuelL: 8, seed });

  it('is deterministic: same world + seed = same board; a new seed reshuffles', () => {
    const a = generateContracts(ctx(1)).map((o) => o.contract);
    expect(generateContracts(ctx(1)).map((o) => o.contract)).toEqual(a);
    expect(generateContracts(ctx(2)).map((o) => o.contract.id)).not.toEqual(a.map((c) => c.id));
  });
  it('offers 5-10 contracts covering several archetypes, all with unique ids', () => {
    const offers = generateContracts(ctx(1));
    expect(offers.length).toBeGreaterThanOrEqual(5);
    expect(offers.length).toBeLessThanOrEqual(10);
    expect(new Set(offers.map((o) => o.contract.id)).size).toBe(offers.length);
    const seen = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) generateContracts(ctx(seed)).forEach((o) => seen.add(o.contract.archetype));
    expect(seen).toEqual(new Set(['cargo', 'passenger', 'urgent', 'ferry', 'exploration']));
  });
  it('exploration is only offered for airfields not yet visited', () => {
    const visited = { ...ctx(1), visitedAirfieldIds: ['field_home', 'field_north_strip'] };
    const offers = generateContracts(visited).filter((o) => o.contract.destinationId === 'field_north_strip');
    expect(offers.every((o) => o.contract.archetype !== 'exploration')).toBe(true);
  });
  it('a contract is playable by the existing mission layer: target, radius, payoff and completion check', () => {
    const c = generateContracts(ctx(1))[0].contract;
    const dest = getAirfield(c.destinationId)!;
    expect(c.mission.targetPoint![0]).toBe(dest.position[0]);
    expect(c.mission.targetRadiusM).toBeGreaterThan(dest.runwayLengthM / 2);
    expect(c.mission.rewardBaseCash).toBe(c.revenueCash);
    const t = nominalTelemetry({ distanceM: c.distanceM, elapsedS: 50, fuelFraction: 0.4, endPosition: [dest.position[0], 0, dest.position[2]] });
    expect(isMissionCompleted(c.mission, t)).toBe(true);
    expect(isMissionCompleted(c.mission, { ...t, position: [dest.position[0] + 500, 0, dest.position[2]] })).toBe(false);
  });
  it('payload contracts size their load from the aircraft, urgent ones carry a time limit', () => {
    let urgent, cargo;
    for (let seed = 1; seed <= 12 && !(urgent && cargo); seed++) for (const o of generateContracts(ctx(seed))) { if (o.contract.archetype === 'urgent') urgent = o.contract; if (o.contract.archetype === 'cargo') cargo = o.contract; }
    expect(urgent!.timeLimitS).toBeGreaterThan(0);
    expect(urgent!.payloadKg).toBeGreaterThan(0);
    expect(cargo!.payloadKg).toBeGreaterThan(cargo!.minPayloadKg);
    expect(cargo!.payloadKg).toBeLessThan(105); // useful load of the starter
  });
  it('the far strip is visible but locked; nothing about it is hidden from the player', () => {
    const far = getOffers(fresh()).filter((o) => o.contract.destinationId === 'field_far_ridge');
    expect(far.length).toBeGreaterThan(0);
    for (const o of far) {
      expect(o.available).toBe(false);
      expect(o.lockedReason).toBe('INSUFFICIENT_RANGE');
      expect(o.assessment.reach).toBe('OUT_OF_RANGE');
    }
  });
});

describe('lifecycle', () => {
  it('cannot accept a locked or unknown contract, nor two at once', () => {
    const p = fresh();
    const locked = getOffers(p).find((o) => !o.available)!;
    expect(acceptContract(p, locked.contract.id)).toEqual({ ok: false, error: expect.stringContaining('CONTRACT_LOCKED') });
    expect(acceptContract(p, 'nope')).toEqual({ ok: false, error: 'UNKNOWN_CONTRACT' });
    const a = ok(acceptContract(p, getOffers(p).find((o) => o.available)!.contract.id));
    expect(acceptContract(a.profile, getOffers(p).filter((o) => o.available)[1].contract.id)).toEqual({ ok: false, error: 'CONTRACT_ALREADY_ACTIVE' });
  });
  it('rejects an infeasible loadout, then accepts the suggested one; the tank content becomes the loadout', () => {
    const p = fresh();
    const offer = getOffers(p).find((o) => o.contract.destinationId === 'field_east_meadow' && o.available)!;
    const acc = ok(acceptContract(p, offer.contract.id));
    const dry = prepareMission(acc.profile, { fuelL: 1, payloadKg: offer.contract.minPayloadKg });
    expect(dry).toEqual({ ok: false, error: expect.stringContaining('INSUFFICIENT_RANGE') });
    const good = ok(prepareMission(acc.profile, suggestedLoadout(acc.profile)!));
    expect(good.profile.operations.active!.session.state).toBe('PREPARED');
    expect(good.profile.operations.fuelL).toBe(good.plan.loadout.fuelL);
    expect(good.profile.operations.active!.startFuelFraction).toBeCloseTo(good.plan.loadout.fuelL / 8, 9);
  });
  it('abandoning before the engine starts is free and frees the slot', () => {
    const { profile } = prepared();
    const r = ok(abandonMission(profile));
    expect(r.profile.cash).toBe(profile.cash);
    expect(r.profile.operations.active).toBeNull();
    expect(r.settlement).toBeNull();
    expect(r.profile.operations.log.map((l) => l.kind)).toContain('mission_abandon');
  });
  it('recover is refused for a contract that never left the hangar', () => {
    const { profile } = prepared();
    expect(recoverAircraft(profile).ok).toBe(false);
  });
});

describe('settlement and economy', () => {
  it('a clean delivery pays Revenue + Bonuses + Discovery - Fuel - Fees, exactly once', () => {
    const { profile: p0, contract } = prepared();
    const p1 = withEvents(p0, ...TO_LANDED, { type: 'AIRCRAFT_STOPPED', atDestination: true });
    const tel = cleanTelemetry(p1);
    const r = ok(settleActive(p1, tel));
    const s = r.settlement;
    expect(s.outcome).toBe('COMPLETED');
    expect(s.net).toBe(s.revenue.total - s.costs.total - s.penalties.total);
    expect(s.revenue.discovery).toBeGreaterThan(0); // first visit to the strip
    expect(s.costs.fuel).toBeGreaterThan(0);
    expect(s.costs.fees).toBeGreaterThan(0);
    expect(s.revenue.total).toBe(s.flight!.rewardCash + s.revenue.discovery);
    expect(r.profile.cash).toBe(p0.cash + s.net);
    expect(r.profile.operations.locationId).toBe(contract.destinationId);
    expect(r.profile.operations.active).toBeNull();
    expect(r.profile.operations.settledContractIds).toEqual([contract.id]);
    expect(r.profile.reputation).toBeGreaterThan(p0.reputation);
    expect(r.profile.completedMissions[contract.id]).toBeDefined();
  });
  it('firing completion twice never pays twice (ledger)', () => {
    const { profile: p0, contract } = prepared();
    const p1 = withEvents(p0, ...TO_LANDED, { type: 'AIRCRAFT_STOPPED', atDestination: true });
    const tel = cleanTelemetry(p1);
    const first = ok(settleActive(p1, tel));
    expect(settleActive(first.profile, tel)).toEqual({ ok: false, error: 'NO_ACTIVE_CONTRACT' });
    // Same settlement object applied again to the already-settled profile: unchanged.
    const again = applySettlement(first.profile, first.settlement, { telemetry: tel, contract, capacityL: 8 });
    expect(again).toBe(first.profile);
    // Even re-staging the old active contract cannot be paid a second time.
    const restaged = { ...first.profile, operations: { ...first.profile.operations, active: p1.operations.active } };
    expect(settleActive(restaged, tel)).toEqual({ ok: false, error: 'ALREADY_SETTLED' });
    expect(restaged.cash).toBe(first.profile.cash);
  });
  it('discovery pays only on the first visit and reveals what lies beyond', () => {
    const p = { ...fresh() };
    const { profile: p0 } = prepared('field_north_strip', undefined, p);
    const p1 = withEvents(p0, ...TO_LANDED, { type: 'AIRCRAFT_STOPPED', atDestination: true });
    const first = ok(settleActive(p1, cleanTelemetry(p1)));
    expect(first.settlement.revenue.discovery).toBeGreaterThan(0);
    expect(first.profile.operations.visitedAirfieldIds).toContain('field_north_strip');
    expect(first.profile.operations.log.map((l) => l.kind)).toContain('destination_discovered');
    // Second visit (fly back to the strip later): no discovery bonus.
    const second = settleContract({ contract: p1.operations.active!.contract, session: { ...p1.operations.active!.session, state: 'COMPLETED' }, telemetry: cleanTelemetry(p1), loadout: p1.operations.active!.loadout, startFuelFraction: p1.operations.active!.startFuelFraction, build: p1.currentBuild, firstVisitToDestination: false });
    expect(second.revenue.discovery).toBe(0);
  });
  it('landing at the far strip reveals the hollow beyond it', () => {
    const base = fresh();
    const bigTank = { ...base, currentBuild: { ...base.currentBuild, installed: { ...base.currentBuild.installed, fuelTank: 'tank_12' } }, operations: { ...base.operations, fuelL: 12 } };
    const { profile: p0 } = prepared('field_far_ridge', 'exploration', bigTank);
    const p1 = withEvents(p0, ...TO_LANDED, { type: 'AIRCRAFT_STOPPED', atDestination: true });
    const r = ok(settleActive(p1, cleanTelemetry(p1)));
    expect(r.profile.operations.knownAirfieldIds).toContain('field_ridge_hollow');
    expect(r.profile.operations.locationId).toBe('field_far_ridge');
    expect(getOffers(r.profile).some((o) => o.contract.destinationId === 'field_ridge_hollow')).toBe(true);
  });
  it('a late urgent delivery is penalised', () => {
    let found: ReturnType<typeof prepared> | undefined;
    for (let seed = 1; seed < 20 && !found; seed++) {
      const p = { ...fresh(), operations: { ...fresh().operations, contractSeed: seed } };
      const o = getOffers(p).find((x) => x.contract.archetype === 'urgent' && x.available);
      if (o) found = prepared(o.contract.destinationId, 'urgent', p);
    }
    const p1 = withEvents(found!.profile, ...TO_LANDED, { type: 'AIRCRAFT_STOPPED', atDestination: true });
    const late = ok(settleActive(p1, cleanTelemetry(p1, { elapsedS: found!.contract.timeLimitS! + 30 }))).settlement;
    const onTime = ok(settleActive(p1, cleanTelemetry(p1, { elapsedS: 10 }))).settlement;
    expect(late.penalties.late).toBeGreaterThan(0);
    expect(onTime.penalties.late).toBe(0);
    expect(late.net).toBeLessThan(onTime.net);
  });
  it('damage is charged as repair cost and hard landings pay less', () => {
    const { profile: p0 } = prepared();
    const p1 = withEvents(p0, ...TO_LANDED, { type: 'AIRCRAFT_STOPPED', atDestination: true });
    const clean = ok(settleActive(p1, cleanTelemetry(p1))).settlement;
    const hurt = ok(settleActive(p1, cleanTelemetry(p1, { crashOutcome: 'hardLanding', damagedPartIds: ['gear'] }))).settlement;
    expect(hurt.costs.damage).toBeGreaterThan(0);
    expect(hurt.net).toBeLessThan(clean.net);
  });
});

describe('failure, abort and recovery', () => {
  it('a crash pays nothing, charges fuel + recovery + cargo loss, costs reputation and needs recovery', () => {
    const { profile: p0, contract } = prepared('field_east_meadow', 'cargo');
    const p1 = withEvents(p0, { type: 'ENGINE_STARTED' }, { type: 'TAKEOFF_ROLL' }, { type: 'AIRBORNE' }, { type: 'CRASH', reason: 'hardLanding' });
    const tel = cleanTelemetry(p1, { crashed: true, landed: false, crashOutcome: 'totalLoss', damagedPartIds: ['gear'], detachedPartIds: [], fuelFraction: p0.operations.active!.startFuelFraction! * 0.4, distanceM: 700 });
    const r = ok(settleActive(p1, tel));
    const s = r.settlement;
    expect(s.outcome).toBe('FAILED');
    expect(s.revenue.total).toBe(0);
    expect(s.costs.recovery).toBeGreaterThan(0);
    expect(s.costs.damage).toBeGreaterThan(0);
    expect(s.penalties.cargoLoss).toBeGreaterThan(0);
    expect(s.net).toBeLessThan(0);
    expect(s.reputationDelta).toBeLessThan(0);
    expect(r.profile.operations.active).not.toBeNull(); // waits for recovery
    expect(acceptContract(r.profile, getOffers(r.profile)[0].contract.id)).toEqual({ ok: false, error: 'CONTRACT_ALREADY_ACTIVE' });
    const rec = ok(recoverAircraft(r.profile));
    expect(rec.profile.operations.active).toBeNull();
    expect(rec.profile.operations.locationId).toBe(contract.originId);
    expect(getOffers(rec.profile).some((o) => o.available)).toBe(true); // no soft-lock
  });
  it('never soft-locks: a broke player owes debt, keeps flying, and repays half of the next payout', () => {
    const broke = { ...fresh(), cash: 0 };
    const { profile: p0 } = prepared('field_east_meadow', 'cargo', broke);
    const p1 = withEvents(p0, { type: 'ENGINE_STARTED' }, { type: 'TAKEOFF_ROLL' }, { type: 'AIRBORNE' }, { type: 'CRASH', reason: 'terrain' });
    const failed = ok(settleActive(p1, cleanTelemetry(p1, { crashed: true, landed: false, crashOutcome: 'totalLoss', damagedPartIds: ['gear'], fuelFraction: 0.1, distanceM: 500 })));
    expect(failed.profile.cash).toBe(0);
    expect(failed.profile.operations.debtCash).toBeGreaterThan(0);
    expect(failed.profile.operations.debtCash).toBeLessThanOrEqual(500);
    const recovered = ok(recoverAircraft(failed.profile)).profile;
    expect(getOffers(recovered).filter((o) => o.available).length).toBeGreaterThan(0);
    const { profile: q0 } = prepared('field_north_strip', undefined, recovered);
    const q1 = withEvents(q0, ...TO_LANDED, { type: 'AIRCRAFT_STOPPED', atDestination: true });
    const paid = ok(settleActive(q1, cleanTelemetry(q1)));
    expect(paid.profile.operations.debtCash).toBeLessThan(recovered.operations.debtCash);
    expect(paid.profile.cash).toBeGreaterThan(0);
    expect(paid.profile.cash + (recovered.operations.debtCash - paid.profile.operations.debtCash)).toBe(paid.settlement.net);
  });
  it('abandoning in the air costs a penalty; a diversion lands at the strip where it stopped', () => {
    const { profile: p0 } = prepared('field_east_meadow', 'cargo');
    const p1 = withEvents(p0, { type: 'ENGINE_STARTED' }, { type: 'TAKEOFF_ROLL' }, { type: 'AIRBORNE' }, { type: 'DEPARTURE_EXITED' });
    const tel = cleanTelemetry(p1, { landed: false, fuelFraction: p0.operations.active!.startFuelFraction! * 0.8 });
    const ab = ok(abandonMission(p1, tel));
    expect(ab.settlement!.outcome).toBe('ABORTED');
    expect(ab.settlement!.penalties.abandonment).toBeGreaterThan(0);
    expect(ab.settlement!.revenue.total).toBe(0);

    const p2 = withEvents(p0, { type: 'ENGINE_STARTED' }, { type: 'TAKEOFF_ROLL' }, { type: 'AIRBORNE' }, { type: 'DEPARTURE_EXITED' }, { type: 'GROUND_CONTACT', atDestination: false }, { type: 'AIRCRAFT_STOPPED', atDestination: false, divertedTo: 'field_north_strip' });
    const dv = ok(settleActive(p2, cleanTelemetry(p2, { position: [0, 0, 620] })));
    expect(dv.settlement.outcome).toBe('ABORTED');
    expect(ok(recoverAircraft(dv.profile)).profile.operations.locationId).toBe('field_north_strip');
  });
});

describe('map status follows the aircraft', () => {
  it('reports out-of-range now, and the same pin turns marginal after a tank upgrade', () => {
    const p = fresh();
    const before = getDestinationStatuses(p).find((s) => s.airfieldId === 'field_far_ridge')!;
    expect(before.assessment.reach).toBe('OUT_OF_RANGE');
    const up = { ...p, currentBuild: { ...p.currentBuild, installed: { ...p.currentBuild.installed, fuelTank: 'tank_12' } } };
    const after = getDestinationStatuses(up).find((s) => s.airfieldId === 'field_far_ridge')!;
    expect(after.assessment.reach).toBe('MARGINAL');
    expect(after.assessment.plan.range.estimatedKm).toBeGreaterThan(before.assessment.plan.range.estimatedKm);
  });
});

describe('load-time reconciliation and resolution (reload safety)', () => {
  it('an ended-but-unpaid flight is paid exactly once from its captured final telemetry, then reload is a no-op', () => {
    const { profile: p0 } = prepared();
    const p1 = withEvents(p0, ...TO_LANDED);
    const tel = cleanTelemetry(p1);
    // The simulation reached the end (advanceMission captures the final sample) but the app closed before Results.
    const active = { ...p1.operations.active!, finalTelemetry: tel };
    const stopped = applyEvent(active.session, { type: 'AIRCRAFT_STOPPED', atDestination: true });
    if (!stopped.ok) throw new Error(stopped.error.message);
    const crashedMidResults = { ...p1, operations: { ...p1.operations, active: { ...active, session: stopped.session } } };
    const once = reconcileAfterLoad(crashedMidResults);
    expect(once.operations.settledContractIds).toEqual([p0.operations.active!.contract.id]);
    expect(once.cash).toBe(p0.cash + once.operations.lastSettlement!.net);
    expect(once.operations.active).toBeNull();
    expect(reconcileAfterLoad(once)).toEqual(once);
  });
  it('a flight in progress at load is abandoned with its penalty; a PREPARED contract is left alone', () => {
    const { profile: prep } = prepared();
    expect(reconcileAfterLoad(prep)).toBe(prep);
    const flying = withEvents(prep, { type: 'ENGINE_STARTED' }, { type: 'TAKEOFF_ROLL' }, { type: 'AIRBORNE' });
    const r = reconcileAfterLoad(flying);
    expect(r.operations.lastSettlement!.outcome).toBe('ABORTED');
    expect(r.operations.lastSettlement!.penalties.abandonment).toBeGreaterThan(0);
    expect(r.operations.active!.session.state).toBe('ABORTED'); // waits for recovery, never soft-locks
    expect(ok(recoverAircraft(r)).profile.operations.active).toBeNull();
  });
  it('resolves a dynamic contract from the persisted active contract, static missions from the campaign, nothing otherwise', () => {
    const { profile, contract } = prepared();
    expect(resolveMission(profile, contract.id).contract?.id).toBe(contract.id);
    expect(resolveMission(profile, contract.id).mission?.targetPoint).toEqual(contract.mission.targetPoint);
    expect(resolveMission(profile, 'field_distance_01').mission?.id).toBe('field_distance_01');
    expect(resolveMission(profile, 'nope')).toEqual({ mission: null, contract: null });
    expect(resolveMission(fresh(), contract.id).mission).toBeNull(); // not generated for a fresh profile: no phantom contracts
  });
});
