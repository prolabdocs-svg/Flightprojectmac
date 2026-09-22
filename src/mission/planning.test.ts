import { describe, expect, it } from 'vitest';
import type { AircraftBuild } from '../core/types';
import { defaultBuild, installPart } from '../content/assembly';
import { computeMassProperties } from '../flight/aircraft/massModel';
import { payloadMassItem } from '../flight/aircraft/payload';
import { definitionFor } from '../flight/analysis/performance';
import { FUEL_DENSITY_KG_L } from '../flight/aircraft/quicksilver';
import { generateContracts, type ContractOffer } from './contracts';
import { clampFuelL, fuelCostCash, fuelFraction, fuelLitres, fuelMassKg } from './fuel';
import { assessContract, emptyMassKg, maxUsefulFuelL, mtowKg, planMission, recommendLoadout, type PlanInput } from './planning';
import { routeContext } from './route';
import { createOperations } from './operationsState';
import type { ArchetypeId } from './types';

const STARTER = defaultBuild();
const BIG_TANK: AircraftBuild = installPart(STARTER, 'fuelTank', 'tank_12');

const board = (build: AircraftBuild, fuelL = 8): ContractOffer[] => {
  const ops = createOperations();
  return generateContracts({ build, reputation: 0, originId: 'field_home', knownAirfieldIds: ops.knownAirfieldIds, visitedAirfieldIds: ops.visitedAirfieldIds, onboardFuelL: fuelL, seed: 1 });
};
const contractTo = (build: AircraftBuild, dest: string, archetype?: ArchetypeId) => {
  const c = board(build).find((o) => o.contract.destinationId === dest)!.contract;
  // Archetype rows are data: re-labelling a generated contract exercises the same revenue/payload rules.
  return archetype && archetype !== c.archetype ? { ...c, archetype, payloadKg: archetype === 'ferry' ? 0 : c.payloadKg || 60, minPayloadKg: 0 } : c;
};
const input = (build: AircraftBuild, dest: string, loadout: { fuelL: number; payloadKg: number }, over: Partial<PlanInput> = {}): PlanInput => ({
  build, route: routeContext('field_home', dest), contract: contractTo(build, dest), loadout, onboardFuelL: 8, ...over,
});

describe('fuel representation', () => {
  it('litres are the truth; mass, cost and the legacy fraction derive from them', () => {
    expect(fuelMassKg(10)).toBeCloseTo(10 * FUEL_DENSITY_KG_L);
    expect(fuelMassKg(-3)).toBe(0);
    expect(fuelFraction(6, 12)).toBeCloseTo(0.5);
    expect(fuelLitres(0.5, 12)).toBeCloseTo(6);
    expect(fuelLitres(fuelFraction(7.3, 12), 12)).toBeCloseTo(7.3);
    expect(clampFuelL(99, 8)).toBe(8);
    expect(fuelCostCash(10)).toBeGreaterThan(0);
  });
  it('the simulation shares the same density as the planner', () => {
    expect(definitionFor(STARTER).mass.fuelDensityKgL).toBe(FUEL_DENSITY_KG_L);
  });
});

describe('mass: fuel and payload go through massModel', () => {
  it('plan mass equals massModel of the aircraft items + fuel + payload', () => {
    const def = definitionFor(STARTER);
    const p = planMission(input(STARTER, 'field_north_strip', { fuelL: 5, payloadKg: 30 }, { contract: { ...contractTo(STARTER, 'field_north_strip'), minPayloadKg: 0, payloadKg: 40 } }));
    const truth = computeMassProperties([...def.mass.items, { id: 'fuel', massKg: 5 * def.mass.fuelDensityKgL, position: def.mass.fuelPosition, size: def.mass.fuelSize }, payloadMassItem(30)]).massKg;
    expect(p.mass.totalKg).toBeCloseTo(truth, 6);
    expect(p.mass.totalKg).toBeCloseTo(emptyMassKg(STARTER) + fuelMassKg(5) + 30, 6);
  });
  it('MTOW comes from the airframe and bounds the useful load', () => {
    expect(mtowKg(STARTER)).toBe(360);
    const route = routeContext('field_home', 'field_north_strip');
    expect(maxUsefulFuelL(STARTER, route, 0, 8)).toBe(8);
    expect(maxUsefulFuelL(BIG_TANK, route, 100, 8)).toBeLessThan(12); // 100 kg of payload leaves room for < 12 L
  });
});

describe('fuel and payload change range, performance and cost together', () => {
  const dest = 'field_east_meadow';
  const cargo = () => ({ ...contractTo(STARTER, dest, 'cargo'), minPayloadKg: 0, payloadKg: 80, ...{} });
  const plan = (loadout: { fuelL: number; payloadKg: number }, build = STARTER) => planMission(input(build, dest, loadout, { contract: cargo() }));

  it('payload adds mass, lengthens the takeoff and shortens the range at equal fuel', () => {
    const light = plan({ fuelL: 8, payloadKg: 0 });
    const heavy = plan({ fuelL: 8, payloadKg: 25 });
    expect(heavy.mass.totalKg - light.mass.totalKg).toBeCloseTo(25, 6);
    expect(heavy.takeoff.rollM).toBeGreaterThan(light.takeoff.rollM);
    expect(heavy.takeoff.climbMs).toBeLessThan(light.takeoff.climbMs);
    expect(heavy.range.estimatedKm).toBeLessThan(light.range.estimatedKm);
    expect(heavy.fuel.tripL).toBeGreaterThan(light.fuel.tripL);
    expect(heavy.landing.rollM).toBeGreaterThan(light.landing.rollM);
    expect(heavy.utilization.mass).toBeGreaterThan(light.utilization.mass);
  });
  it('a 25% heavier aircraft is clearly perceptible (spec 9)', () => {
    const base = plan({ fuelL: 8, payloadKg: 0 });
    const loaded = plan({ fuelL: 8, payloadKg: 0.25 * base.mass.totalKg }, STARTER);
    expect(loaded.takeoff.rollM / base.takeoff.rollM).toBeGreaterThan(1.1);
  });
  it('more fuel extends range but is not free: mass and takeoff roll grow', () => {
    const half = plan({ fuelL: 4, payloadKg: 0 });
    const full = plan({ fuelL: 8, payloadKg: 0 });
    expect(full.range.estimatedKm).toBeGreaterThan(half.range.estimatedKm);
    expect(full.mass.totalKg).toBeGreaterThan(half.mass.totalKg);
    expect(full.takeoff.rollM).toBeGreaterThan(half.takeoff.rollM);
  });
  it('filling the tank is not the optimal loadout: the recommendation carries less and nets more', () => {
    const contract = contractTo(STARTER, 'field_north_strip', 'ferry');
    const route = routeContext('field_home', 'field_north_strip');
    const rec = recommendLoadout(STARTER, route, contract, 8);
    expect(rec.fuelL).toBeLessThan(8);
    const p = (fuelL: number) => planMission({ build: STARTER, route, contract, loadout: { fuelL, payloadKg: 0 }, onboardFuelL: 8 });
    expect(p(rec.fuelL).utilization.range).toBeLessThanOrEqual(0.98);
    expect(p(8).takeoff.rollM).toBeGreaterThan(p(rec.fuelL).takeoff.rollM);
    expect(p(8).economics.expectedNet).toBeLessThanOrEqual(p(rec.fuelL).economics.expectedNet);
  });
  it('wind shortens the takeoff run; a headwind cuts the ground range', () => {
    const c = contractTo(STARTER, dest, 'cargo');
    const bearing = routeContext('field_home', dest).bearingDeg;
    const dir = { x: -Math.sin((bearing * Math.PI) / 180), z: Math.cos((bearing * Math.PI) / 180) };
    const withWind = (ms: number) => planMission(input(STARTER, dest, { fuelL: 8, payloadKg: 0 }, { contract: { ...c, minPayloadKg: 0, weather: { windMs: [-dir.x * ms, 0, -dir.z * ms], gustMs: 0 } } }));
    const head = withWind(5); // air moving against the direction of flight
    const tail = withWind(-5);
    const calm = withWind(0);
    expect(head.wind.headwindMs).toBeCloseTo(5, 5);
    expect(head.takeoff.rollM).toBeLessThan(calm.takeoff.rollM); // pilots depart into the wind
    expect(tail.takeoff.rollM).toBeCloseTo(head.takeoff.rollM, 6);
    expect(head.range.estimatedKm).toBeLessThan(tail.range.estimatedKm); // headwind = lower groundspeed = shorter ground range
  });
  it('expected net = revenue - fuel - fees, from the real economy', () => {
    const p = plan({ fuelL: 6, payloadKg: 0 });
    expect(p.economics.expectedNet).toBe(p.economics.expectedRevenue - p.economics.fuelCost - p.economics.fees);
    expect(p.economics.expectedOperatingCost).toBe(p.economics.fuelCost + p.economics.fees);
    expect(p.economics.expectedRevenue).toBeGreaterThan(0);
  });
});

describe('classification uses more than distance', () => {
  it('the safe short hop is COMFORTABLE or better; the far strip is impossible for the starter', () => {
    const near = assessContract(STARTER, routeContext('field_home', 'field_north_strip'), contractTo(STARTER, 'field_north_strip'), 8);
    expect(['TRIVIAL', 'COMFORTABLE']).toContain(near.difficulty);
    const far = assessContract(STARTER, routeContext('field_home', 'field_far_ridge'), contractTo(STARTER, 'field_far_ridge'), 8);
    expect(far.difficulty).toBe('IMPOSSIBLE');
    expect(far.reach).toBe('OUT_OF_RANGE');
    expect(far.plan.blockers).toContain('INSUFFICIENT_RANGE');
    expect(far.plan.limiting).toBe('range');
    expect(far.available).toBe(false);
  });
  it('a marginal case sits between 80% and 100% of the usable range', () => {
    const a = assessContract(BIG_TANK, routeContext('field_home', 'field_far_ridge'), contractTo(BIG_TANK, 'field_far_ridge'), 12);
    expect(a.difficulty).toBe('MARGINAL');
    expect(a.plan.utilization.range).toBeGreaterThan(0.8);
    expect(a.plan.utilization.range).toBeLessThanOrEqual(1);
    expect(a.plan.range.reserveKm).toBeGreaterThan(0);
  });
  it('a runway too short for the takeoff makes the flight impossible even when the range is trivial', () => {
    const route = routeContext('field_home', 'field_north_strip');
    const short = { ...route, origin: { ...route.origin, runwayLengthM: 70 } };
    const a = assessContract(STARTER, short, contractTo(STARTER, 'field_north_strip'), 8);
    expect(a.plan.utilization.range).toBeLessThan(0.5);
    expect(a.difficulty).toBe('IMPOSSIBLE');
    expect(a.plan.limiting).toBe('takeoff');
    expect(a.plan.blockers).toContain('TAKEOFF_RUNWAY_TOO_SHORT');
    expect(a.reach).not.toBe('OUT_OF_RANGE');
  });
  it('a short destination strip is limited by the landing distance', () => {
    const route = routeContext('field_home', 'field_north_strip');
    const short = { ...route, destination: { ...route.destination, runwayLengthM: 60 } };
    const a = assessContract(STARTER, short, contractTo(STARTER, 'field_north_strip'), 8);
    expect(a.plan.blockers).toContain('LANDING_RUNWAY_TOO_SHORT');
  });
  it('crosswind beyond the demonstrated limit blocks the flight', () => {
    const c = contractTo(STARTER, 'field_north_strip');
    const bearing = routeContext('field_home', 'field_north_strip').bearingDeg;
    const r = (bearing + 90) * Math.PI / 180;
    const p = planMission(input(STARTER, 'field_north_strip', { fuelL: 5, payloadKg: 0 }, { contract: { ...c, minPayloadKg: 0, payloadKg: 0, weather: { windMs: [-Math.sin(r) * 9, 0, Math.cos(r) * 9], gustMs: 0 } } }));
    expect(p.blockers).toContain('CROSSWIND_LIMIT');
  });
  it('rejects loadouts the aircraft cannot take: overweight, out-of-bounds payload, fuel the origin cannot supply', () => {
    const c = { ...contractTo(BIG_TANK, 'field_north_strip', 'cargo'), minPayloadKg: 0, payloadKg: 200 };
    const heavy = planMission(input(BIG_TANK, 'field_north_strip', { fuelL: 12, payloadKg: 150 }, { contract: c }));
    expect(heavy.blockers).toContain('OVERWEIGHT');
    const over = planMission(input(BIG_TANK, 'field_north_strip', { fuelL: 12, payloadKg: 300 }, { contract: { ...c, payloadKg: 100 } }));
    expect(over.blockers).toContain('PAYLOAD_OUT_OF_BOUNDS');
    const route = routeContext('field_home', 'field_north_strip');
    const noFuel = { ...route, origin: { ...route.origin, services: [] } };
    const stranded = planMission({ ...input(STARTER, 'field_north_strip', { fuelL: 8, payloadKg: 0 }, { route: noFuel }), onboardFuelL: 3 });
    expect(stranded.blockers).toContain('FUEL_NOT_AVAILABLE');
  });
});

describe('capacity upgrade changes viability mathematically', () => {
  it('tank_12 raises the estimated range by ~its extra fuel while the requirement stays put', () => {
    const route = routeContext('field_home', 'field_far_ridge');
    const before = assessContract(STARTER, route, contractTo(STARTER, 'field_far_ridge'), 8).plan;
    const after = assessContract(BIG_TANK, route, contractTo(BIG_TANK, 'field_far_ridge'), 12).plan;
    expect(after.range.requiredKm).toBeCloseTo(before.range.requiredKm, 6);
    expect(after.range.estimatedKm).toBeGreaterThan(before.range.estimatedKm * 1.4);
    expect(before.range.usableKm).toBeLessThan(before.range.requiredKm);
    expect(after.range.usableKm).toBeGreaterThan(after.range.requiredKm);
    expect(before.reach).toBe('OUT_OF_RANGE');
    expect(after.reach).toBe('MARGINAL');
  });
});
