// Headless gameplay loop (master spec 64/91). No UI, no mocks of the game: the real profile store, the
// contract generator, the planner, the REAL flight model (Rapier + terrain + wind + fuel burn) flown by a
// scripted pilot, the mission state machine fed by simulation telemetry, the economy, and a real
// IndexedDB reload. The only thing the test "sets" is the starting profile; every state change after that
// is a consequence of the systems.
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerProfile } from '../core/types';
import { createDefaultProfile } from '../save/save';
import { installPart } from '../content/assembly';
import { getPart } from '../content/parts';
import { useProfileStore } from '../state/profileStore';
import { getDestinationStatuses, getOffers, planFor, suggestedLoadout } from './operations';
import { flyActiveContract } from './testing/driver';
import type { Settlement } from './settlement';

vi.setConfig({ testTimeout: 240_000 });

const store = () => useProfileStore.getState();
const profile = (): PlayerProfile => store().profile;
const statusOf = (dest: string) => getDestinationStatuses(profile()).find((s) => s.airfieldId === dest)!.assessment;

interface Flight { settlement: Settlement; events: string[]; startL: number; endL: number }

/** accept -> configure -> fly on the real physics -> settle, through the store's public actions. */
async function flyContract(dest: string, prefer: string[] = []): Promise<Flight> {
  const offers = getOffers(profile()).filter((o) => o.contract.destinationId === dest && o.available);
  const offer = prefer.map((a) => offers.find((o) => o.contract.archetype === a)).find(Boolean) ?? offers[0];
  expect(offer, `an available contract to ${dest}`).toBeDefined();
  expect(store().acceptContract(offer!.contract.id).ok).toBe(true);
  const loadout = suggestedLoadout(profile())!;
  const prep = store().prepareMission(loadout);
  expect(prep.ok, JSON.stringify(prep)).toBe(true);
  const startL = profile().operations.fuelL;

  const f = await flyActiveContract(profile());
  useProfileStore.setState({ profile: f.profile });
  expect(f.profile.operations.active!.session.state, `flight to ${dest}: ${f.events.join(',')} / ${f.final.state} ${f.final.crashReason ?? ''}`).toBe('OBJECTIVE_MET');
  const settled = store().settleMission(f.final);
  if (!settled.ok) throw new Error(settled.error);
  const settlement = settled.settlement;
  return { settlement, events: f.events, startL, endL: profile().operations.fuelL };
}

beforeEach(() => {
  useProfileStore.setState({ profile: createDefaultProfile() });
});

describe('master loop: A safe, B demanding, C out of range -> upgrade -> C marginal -> fly -> discover', () => {
  it('plays the whole story end to end and it survives save/reload', async () => {
    // ---- 1. Load profile, generate contracts, inspect C -------------------------------------------------
    const start = profile();
    expect(start.operations.locationId).toBe('field_home');
    expect(start.currentBuild.installed.fuelTank).toBe('tank_8');
    const a0 = statusOf('field_north_strip');
    const b0 = statusOf('field_east_meadow');
    const c0 = statusOf('field_far_ridge');
    expect(['TRIVIAL', 'COMFORTABLE']).toContain(a0.difficulty);
    expect(['COMFORTABLE', 'CHALLENGING']).toContain(b0.difficulty);
    expect(c0.reach).toBe('OUT_OF_RANGE');
    expect(c0.difficulty).toBe('IMPOSSIBLE');
    const cOffers = getOffers(profile()).filter((o) => o.contract.destinationId === 'field_far_ridge');
    expect(cOffers.length).toBeGreaterThan(0);
    expect(cOffers.every((o) => !o.available && o.lockedReason === 'INSUFFICIENT_RANGE')).toBe(true);
    // C cannot be accepted, whatever the player tries.
    expect(store().acceptContract(cOffers[0].contract.id)).toEqual({ ok: false, error: expect.stringContaining('CONTRACT_LOCKED') });
    expect(profile().operations.active).toBeNull();

    // ---- 2. Viable operations: A there and back, B there and back --------------------------------------
    const flights: Flight[] = [];
    flights.push(await flyContract('field_north_strip'));
    expect(profile().operations.locationId).toBe('field_north_strip');
    flights.push(await flyContract('field_home'));
    flights.push(await flyContract('field_east_meadow', ['cargo']));
    expect(profile().operations.locationId).toBe('field_east_meadow');
    flights.push(await flyContract('field_home'));
    expect(profile().operations.locationId).toBe('field_home');

    for (const f of flights) {
      expect(f.events).toEqual(expect.arrayContaining(['ENGINE_STARTED', 'TAKEOFF_ROLL', 'AIRBORNE', 'DEPARTURE_EXITED', 'DESTINATION_PROXIMITY', 'GROUND_CONTACT', 'AIRCRAFT_STOPPED']));
      expect(f.settlement.outcome).toBe('COMPLETED');
      expect(f.settlement.net).toBe(f.settlement.revenue.total - f.settlement.costs.total - f.settlement.penalties.total);
      expect(f.endL).toBeGreaterThan(0); // never ran dry
    }
    const earned = flights.reduce((t, f) => t + f.settlement.net, 0);
    expect(profile().cash).toBe(start.cash + earned);
    expect(profile().operations.condition.landings).toBe(4);
    expect(profile().operations.visitedAirfieldIds).toEqual(expect.arrayContaining(['field_north_strip', 'field_east_meadow']));

    // C is still out of range: money alone changed nothing.
    expect(statusOf('field_far_ridge').reach).toBe('OUT_OF_RANGE');

    // ---- 3. Capacity upgrade: bigger tank (real purchase + install through the store) --------------------
    const tank = getPart('tank_12')!;
    expect(profile().cash).toBeGreaterThanOrEqual(tank.priceCash); // the loop must not dead-end before the upgrade
    const cashBefore = profile().cash;
    const rangeBefore = statusOf('field_far_ridge').plan.range;
    expect(store().buyPart('tank_12', tank.priceCash)).toBe(true);
    store().setBuild(installPart(profile().currentBuild, 'fuelTank', 'tank_12'));
    expect(profile().cash).toBe(cashBefore - tank.priceCash);

    // ---- 4. Map recomputed: C changed because the aircraft can now do more, not because of a flag -------
    const c1 = statusOf('field_far_ridge');
    expect(c1.reach).toBe('MARGINAL');
    expect(c1.difficulty).toBe('MARGINAL');
    expect(c1.plan.range.requiredKm).toBeCloseTo(rangeBefore.requiredKm, 6);
    expect(c1.plan.range.estimatedKm).toBeGreaterThan(rangeBefore.estimatedKm);
    expect(c1.plan.range.usableKm).toBeGreaterThan(c1.plan.range.requiredKm);
    expect(rangeBefore.usableKm).toBeLessThan(rangeBefore.requiredKm);

    // ---- 5. Accept C, configure fuel: too little is refused, the suggested loadout is accepted ----------
    const cOffer = getOffers(profile()).find((o) => o.contract.destinationId === 'field_far_ridge' && o.available && o.contract.archetype === 'exploration')!;
    expect(cOffer).toBeDefined();
    expect(cOffer.contract.archetype).toBe('exploration');
    expect(store().acceptContract(cOffer.contract.id).ok).toBe(true);
    const tooLittle = planFor(profile(), { fuelL: 4, payloadKg: 0 })!;
    expect(tooLittle.blockers).toContain('INSUFFICIENT_RANGE');
    expect(store().prepareMission({ fuelL: 4, payloadKg: 0 }).ok).toBe(false);
    expect(profile().operations.active!.session.state).toBe('ACCEPTED');
    const loadout = suggestedLoadout(profile())!;
    expect(loadout.fuelL).toBeLessThan(12); // marginal, but not "fill the tank"
    const plan = planFor(profile(), loadout)!;
    expect(plan.feasible).toBe(true);
    expect(store().prepareMission(loadout).ok).toBe(true);
    expect(profile().operations.active!.session.state).toBe('PREPARED');
    expect(profile().operations.fuelL).toBeCloseTo(loadout.fuelL, 9);

    // ---- 6. Fly it for real ----------------------------------------------------------------------------
    const cashPreFlight = profile().cash;
    const f = await flyActiveContract(profile());
    useProfileStore.setState({ profile: f.profile });
    expect(f.events).toEqual(['ENGINE_STARTED', 'TAXI_DETECTED', 'TAKEOFF_ROLL', 'AIRBORNE', 'DEPARTURE_EXITED', 'DESTINATION_PROXIMITY', 'GROUND_CONTACT', 'AIRCRAFT_STOPPED']);
    const session = profile().operations.active!.session;
    expect(session.state).toBe('OBJECTIVE_MET');
    expect(session.history.map((h) => h.to.phase ?? h.to.state)).toEqual(expect.arrayContaining(['TAXI', 'TAKEOFF', 'ENROUTE', 'APPROACH', 'LANDED']));
    expect(f.final.crashed).toBe(false);
    const burnedL = (profile().operations.active!.startFuelFraction! - f.final.fuelFraction) * 12;
    expect(burnedL).toBeGreaterThan(plan.fuel.tripL * 0.5); // the real engine consumed real fuel
    expect(burnedL).toBeLessThanOrEqual(loadout.fuelL);
    expect(f.final.fuelFraction * 12).toBeLessThan(0.45 * 12); // arrived with little fuel
    expect(f.final.fuelFraction).toBeGreaterThan(0); // ... but arrived

    // ---- 7. Settle, discover, persist ------------------------------------------------------------------
    const settled = store().settleMission(f.final);
    if (!settled.ok) throw new Error(settled.error);
    const s = settled.settlement;
    expect(s.outcome).toBe('COMPLETED');
    expect(s.revenue.discovery).toBeGreaterThan(0);
    expect(s.costs.fuel).toBeGreaterThan(0);
    expect(s.net).toBe(s.revenue.total - s.costs.total - s.penalties.total);
    expect(profile().cash).toBe(cashPreFlight + s.net);
    const ops = profile().operations;
    expect(ops.locationId).toBe('field_far_ridge');
    expect(ops.visitedAirfieldIds).toContain('field_far_ridge');
    expect(ops.knownAirfieldIds).toContain('field_ridge_hollow'); // new region revealed
    expect(ops.fuelL).toBeCloseTo(f.final.fuelFraction * 12, 6);
    expect(ops.active).toBeNull();
    expect(ops.log.map((l) => l.kind)).toEqual(expect.arrayContaining(['mission_start', 'takeoff', 'landing', 'mission_complete', 'fuel_used', 'destination_discovered', 'upgrade_purchased']));

    // ---- 8. New opportunities from the new place --------------------------------------------------------
    const next = getOffers(profile());
    expect(next.some((o) => o.contract.destinationId === 'field_ridge_hollow' && o.available)).toBe(true);
    expect(next.every((o) => o.contract.originId === 'field_far_ridge')).toBe(true);
    expect(next.every((o) => !ops.settledContractIds.includes(o.contract.id))).toBe(true);

    // ---- 9. Save -> real reload from IndexedDB -> everything is still true ------------------------------
    const saved = profile();
    await new Promise((r) => setTimeout(r, 80));
    const reloaded = await import(/* @vite-ignore */ `../save/save?t=${Date.now()}-loop`);
    await reloaded.whenSaveRepositoryReady();
    const back = reloaded.saveRepository.load() as PlayerProfile;
    expect(back).toEqual(saved);
    expect(back.cash).toBe(saved.cash);
    expect(back.currentBuild.installed.fuelTank).toBe('tank_12');
    expect(back.operations.locationId).toBe('field_far_ridge');
    expect(back.operations.visitedAirfieldIds).toContain('field_far_ridge');
    expect(back.operations.settledContractIds.length).toBe(5);
    expect(getOffers(back).map((o) => o.contract.id)).toEqual(next.map((o) => o.contract.id));
  });
});
