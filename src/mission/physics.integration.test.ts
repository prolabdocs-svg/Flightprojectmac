// Fuel and payload on the REAL flight model, planner-vs-simulation agreement, and the failure branches
// (crash, dry tank) driven by the simulation rather than by hand-fed events.
import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { defaultBuild } from '../content/assembly';
import { createHarness, hold } from '../sim/flightHarness';
import { definitionFor } from '../flight/analysis/performance';
import { createDefaultProfile } from '../save/save';
import { acceptContract, getOffers, prepareMission, recoverAircraft, settleActive, suggestedLoadout } from './operations';
import { emptyMassKg, planMission } from './planning';
import { routeContext } from './route';
import { flyActiveContract } from './testing/driver';
import { fuelMassKg } from './fuel';

vi.setConfig({ testTimeout: 120_000 });
const build = defaultBuild();

describe('fuel and payload reach the flight model', () => {
  it('spawns with exactly the loaded fuel and mass (litres -> legacy fraction, litres -> kg)', async () => {
    const h = await createHarness({ load: { fuelL: 5, payloadKg: 30 } });
    const s = h.run(0.1, { engineOn: false });
    expect(s.fuelFraction).toBeCloseTo(5 / 8, 3);
    expect(h.fc.sim.physics.mass.massKg).toBeCloseTo(emptyMassKg(build) + fuelMassKg(5) + 30, 1);
  });
  it('defaults are unchanged: full tank, no payload', async () => {
    const h = await createHarness();
    const s = h.run(0.1, { engineOn: false });
    expect(s.fuelFraction).toBeCloseTo(1, 3);
    expect(h.fc.sim.physics.mass.massKg).toBeCloseTo(emptyMassKg(build) + fuelMassKg(8), 1);
  });
  it('burns fuel in flight, and a heavier aircraft burns it faster over the same manoeuvre', async () => {
    const burn = async (payloadKg: number) => {
      const h = await createHarness({ load: { fuelL: 6, payloadKg } });
      h.run(9, (s) => ({ throttle: 1, pitch: s && s.airspeedMs > s.stallSpeedMs * 1.05 ? 0.6 : 0 }));
      h.run(20, (s) => ({ throttle: 0.65, ...hold(s, 3) }));
      return { used: 6 - h.log.at(-1)!.fuelFraction * 8, roll: h.log.find((x) => x.wheelsOnGround === 0)!.distanceM };
    };
    const light = await burn(0);
    const heavy = await burn(28);
    expect(light.used).toBeGreaterThan(0.5);
    expect(heavy.roll).toBeGreaterThan(light.roll * 1.08); // +28 kg (~11%) is felt in the takeoff run
  });
});

describe('planner agrees with the simulation', () => {
  const dest = 'field_east_meadow';
  it('predicted takeoff roll and trip fuel are within a useful band of the real flight (and conservative)', async () => {
    const p0 = createDefaultProfile();
    const offer = getOffers(p0).find((o) => o.contract.destinationId === dest && o.available)!;
    const acc = acceptContract(p0, offer.contract.id);
    if (!acc.ok) throw new Error(acc.error);
    const prep = prepareMission(acc.profile, suggestedLoadout(acc.profile)!);
    if (!prep.ok) throw new Error(prep.error);
    const plan = planMission({ build, route: routeContext('field_home', dest), contract: offer.contract, loadout: prep.plan.loadout, onboardFuelL: 8 });
    const f = await flyActiveContract(prep.profile);
    const liftoff = f.log.find((s) => s.wheelsOnGround === 0 && s.altitudeM > 0.3)!;
    expect(plan.takeoff.rollM).toBeGreaterThan(liftoff.distanceM * 0.7);
    expect(plan.takeoff.rollM).toBeLessThan(liftoff.distanceM * 1.5);
    const burned = prep.plan.loadout.fuelL - f.final.fuelFraction * 8;
    expect(burned).toBeGreaterThan(0);
    expect(plan.fuel.tripL).toBeGreaterThanOrEqual(burned * 0.9); // never promises more range than the engine delivers
    expect(plan.fuel.tripL).toBeLessThan(burned * 1.6); // ... nor wildly less
    expect(f.final.fuelFraction).toBeGreaterThan(0);
  });
});

describe('failure branches driven by the simulation', () => {
  function prepared() {
    const p0 = createDefaultProfile();
    const offer = getOffers(p0).find((o) => o.contract.destinationId === 'field_east_meadow' && o.available && o.contract.archetype === 'cargo')!;
    const acc = acceptContract(p0, offer.contract.id);
    if (!acc.ok) throw new Error(acc.error);
    const prep = prepareMission(acc.profile, suggestedLoadout(acc.profile)!);
    if (!prep.ok) throw new Error(prep.error);
    return prep.profile;
  }

  it('a nose-first dive is a crash: FAILED with the simulation reason, costed, recoverable, no soft-lock', async () => {
    const prep = prepared();
    let diving = false; // once committed, hold the dive into the ground (no pull-out)
    const f = await flyActiveContract(prep, {
      control: (s) => ((diving ||= !!s && s.altitudeM > 12) ? { throttle: 1, pitch: Math.max(-1, Math.min(1, (-40 - s!.pitchDeg) * 0.2)), assistMode: 'acro' } : { throttle: 1, pitch: s && s.airspeedMs > s.stallSpeedMs * 1.05 ? 0.6 : 0 }),
    });
    const session = f.profile.operations.active!.session;
    expect(session.state).toBe('FAILED');
    expect(session.failure?.code).toBe('CRASH');
    expect(f.events).toContain('CRASH');
    const settled = settleActive(f.profile, f.final);
    if (!settled.ok) throw new Error(settled.error);
    expect(settled.settlement.outcome).toBe('FAILED');
    expect(settled.settlement.revenue.total).toBe(0);
    expect(settled.settlement.net).toBeLessThan(0);
    expect(settled.profile.cash).toBeGreaterThanOrEqual(0);
    expect(settled.profile.operations.log.map((l) => l.kind)).toContain('crash');
    const rec = recoverAircraft(settled.profile);
    if (!rec.ok) throw new Error(rec.error);
    expect(rec.profile.operations.active).toBeNull();
    expect(rec.profile.operations.locationId).toBe('field_home');
    expect(getOffers(rec.profile).some((o) => o.available)).toBe(true);
  });

  it('running out of fuel on the ground (fault injected: 0.2 L in the tank) fails the contract as FUEL_EXHAUSTED', async () => {
    const prep = prepared();
    const injected = { ...prep, operations: { ...prep.operations, active: { ...prep.operations.active!, loadout: { ...prep.operations.active!.loadout!, fuelL: 0.2 } } } };
    const f = await flyActiveContract(injected, { maxSeconds: 60 });
    const session = f.profile.operations.active!.session;
    expect(f.events).toContain('FUEL_EXHAUSTED');
    expect(session.state).toBe('FAILED');
    expect(session.failure?.code).toBe('FUEL_EXHAUSTED');
    expect(definitionFor(build).mass.fuelCapacityL).toBe(8);
  });
});
