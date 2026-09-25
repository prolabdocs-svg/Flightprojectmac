// Economic invariants (anti-softlock). Whatever the player does — crash, go broke, buy the wrong
// thing, reload, switch aircraft, move region — there is always an available contract they can
// accept, prepare and fly. Money only buys optional progress; it never gates flying.
import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import type { PlayerProfile } from '../core/types';
import { createDefaultProfile } from '../save/save';
import { useProfileStore } from '../state/profileStore';
import { createAircraftCondition, componentTopology } from './aircraftCondition';
import {
  acceptContract, aircraftAirworthiness, getOffers, prepareMission, reconcileAfterLoad, recoverAircraft, settleActive, suggestedLoadout,
} from './operations';
import { applyEvent } from './stateMachine';
import { nominalTelemetry } from './settlement';
import type { MissionEvent } from './types';

vi.setConfig({ testTimeout: 120_000 });

const fresh = (): PlayerProfile => ({ ...createDefaultProfile(), createdAt: 0 });
const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
  if (!r.ok) throw new Error(`expected ok: ${(r as { error?: string }).error}`);
  return r as Extract<T, { ok: true }>;
};
const destroyed = () => {
  const c = createAircraftCondition();
  for (const id of componentTopology()) c[id] = { integrity: 0 };
  return c;
};

/** THE invariant: some offer is available, and it can be accepted and prepared (= flown). */
function canKeepPlaying(p: PlayerProfile): PlayerProfile {
  expect(aircraftAirworthiness(p).status).not.toBe('GROUNDED');
  const offer = getOffers(p).find((o) => o.available);
  expect(offer, 'an available contract').toBeDefined();
  const acc = ok(acceptContract(p, offer!.contract.id));
  const prep = ok(prepareMission(acc.profile, suggestedLoadout(acc.profile)!));
  expect(prep.plan.feasible).toBe(true);
  return prep.profile;
}

function run(p: PlayerProfile, ...events: MissionEvent[]): PlayerProfile {
  let a = p.operations.active!;
  for (const e of events) a = { ...a, session: ok(applyEvent(a.session, e)).session };
  return { ...p, operations: { ...p.operations, active: a } };
}

/** Takes off and crashes (totalLoss, everything broken), settles and recovers. */
function crashAndRecover(p: PlayerProfile): PlayerProfile {
  const flying = run(canKeepPlaying(p), { type: 'ENGINE_STARTED' }, { type: 'TAKEOFF_ROLL' }, { type: 'AIRBORNE' }, { type: 'CRASH', reason: 'terrain' });
  const tel = {
    ...nominalTelemetry({ distanceM: 400, elapsedS: 40, fuelFraction: 0.1, endPosition: [0, 0, 0] }),
    crashed: true, landed: false, crashOutcome: 'totalLoss' as const, damagedPartIds: ['gear', 'wing'], detachedPartIds: ['wing'],
  };
  const failed = ok(settleActive(flying, tel)).profile;
  expect(failed.cash).toBeGreaterThanOrEqual(0);
  return ok(recoverAircraft({ ...failed, operations: { ...failed.operations, aircraftCondition: destroyed() } })).profile;
}

describe('economic invariants: the save can never be softlocked', () => {
  it('money = 0 + aircraft destroyed: the player can continue playing', () => {
    const p = reconcileAfterLoad({ ...fresh(), cash: 0, operations: { ...fresh().operations, aircraftCondition: destroyed(), debtCash: 500 } });
    canKeepPlaying(p);
  });

  it('a failed mission never takes cash below 0; debt is capped', () => {
    const p = crashAndRecover({ ...fresh(), cash: 0 });
    expect(p.cash).toBe(0);
    expect(p.operations.debtCash).toBeLessThanOrEqual(500);
    canKeepPlaying(p);
  });

  it('many crashes in a row: still playable, cash never negative, debt capped', () => {
    let p = fresh();
    for (let i = 0; i < 8; i++) {
      p = crashAndRecover(p);
      expect(p.cash).toBeGreaterThanOrEqual(0);
      expect(p.operations.debtCash).toBeLessThanOrEqual(500);
      expect(p.reputation).toBeGreaterThanOrEqual(0);
    }
    canKeepPlaying(p);
  });

  it('a wrong purchase (all cash spent) never removes the ability to fly', () => {
    useProfileStore.setState({ profile: fresh() });
    const store = useProfileStore.getState();
    expect(store.buyPart('some_expensive_part', store.profile.cash)).toBe(true);
    expect(useProfileStore.getState().profile.cash).toBe(0);
    expect(useProfileStore.getState().buyPart('another_part', 1)).toBe(false); // cannot overspend
    canKeepPlaying(useProfileStore.getState().profile);
  });

  it('survives a reload: a grounded, broke save loads airworthy and playable', async () => {
    const broken = { ...fresh(), cash: 0, operations: { ...fresh().operations, aircraftCondition: destroyed() } };
    useProfileStore.setState({ profile: broken });
    useProfileStore.getState().persist();
    useProfileStore.setState({ profile: fresh() });
    await useProfileStore.getState().load();
    const loaded = useProfileStore.getState().profile;
    expect(loaded.cash).toBe(0);
    canKeepPlaying(loaded);
  });

  it('a crash mid-flight followed by a reload settles and stays playable', () => {
    const flying = run(canKeepPlaying({ ...fresh(), cash: 0 }), { type: 'ENGINE_STARTED' }, { type: 'TAKEOFF_ROLL' }, { type: 'AIRBORNE' });
    const reloaded = reconcileAfterLoad(flying);
    const p = ok(recoverAircraft(reloaded)).profile;
    expect(p.cash).toBeGreaterThanOrEqual(0);
    canKeepPlaying(p);
  });

  it('a new (switched-to) aircraft starts flyable even when broke', () => {
    useProfileStore.setState({ profile: { ...fresh(), cash: 0 } });
    const frames = useProfileStore.getState().profile.ownedFrameIds;
    useProfileStore.getState().selectFrame(frames[frames.length - 1]);
    canKeepPlaying(useProfileStore.getState().profile);
  });

  it('a new region: broke and wrecked at a foreign strip, the player can still fly out', () => {
    const base = fresh();
    const p = reconcileAfterLoad({
      ...base, cash: 0,
      operations: { ...base.operations, locationId: 'scrap_yard_strip', visitedAirfieldIds: [...base.operations.visitedAirfieldIds, 'scrap_yard_strip'], aircraftCondition: destroyed() },
    });
    canKeepPlaying(p);
  });

  it('new mission types are earned through reputation, not money', () => {
    const archetypes = (rep: number) => new Set([1, 2, 3, 4].flatMap((seed) => {
      const p = fresh();
      return getOffers({ ...p, reputation: rep, operations: { ...p.operations, contractSeed: seed } }).map((o) => o.contract.archetype);
    }));
    const novice = archetypes(0);
    for (const locked of ['navigation', 'precisionLanding', 'weather', 'heavyLift', 'rescue']) expect(novice.has(locked as never)).toBe(false);
    expect(archetypes(100).size).toBeGreaterThan(novice.size);
  });
});
