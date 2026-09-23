import { describe, expect, it } from 'vitest';
import { gearPartId } from '../sim/damageSystem';
import { nominalTelemetry } from './settlement';
import { createAircraftCondition } from './aircraftCondition';
import { applyFlightDamage, conditionToPartIntegrity, conditionToPowerMultiplier } from './damageIntegration';

const SURFACES = ['aileron_l', 'aileron_r', 'wing_root_main', 'elevator', 'rudder'];

describe('applyFlightDamage', () => {
  it('a clean flight (no partIntegrity reported) leaves condition untouched', () => {
    const c = createAircraftCondition();
    const t = nominalTelemetry({ distanceM: 1000, elapsedS: 60, fuelFraction: 0.5, endPosition: [0, 0, 0] });
    expect(applyFlightDamage(c, t)).toEqual(c);
  });

  it('assigns left/right wing damage from the matching surface id, not the other side', () => {
    const c = createAircraftCondition();
    const t = nominalTelemetry({ distanceM: 1000, elapsedS: 60, fuelFraction: 0.5, endPosition: [0, 0, 0] });
    t.partIntegrity = { aileron_l: 0.4, aileron_r: 1, wing_root_main: 1, elevator: 1, rudder: 1, [gearPartId()]: 1 };
    const next = applyFlightDamage(c, t);
    expect(next.wingLeft.integrity).toBeCloseTo(0.4);
    expect(next.wingRight.integrity).toBe(1);
  });

  it('a shared surface (wing_root_main) degrades both wings', () => {
    const c = createAircraftCondition();
    const t = nominalTelemetry({ distanceM: 1000, elapsedS: 60, fuelFraction: 0.5, endPosition: [0, 0, 0] });
    t.partIntegrity = { aileron_l: 1, aileron_r: 1, wing_root_main: 0.5, elevator: 1, rudder: 1, [gearPartId()]: 1 };
    const next = applyFlightDamage(c, t);
    expect(next.wingLeft.integrity).toBeCloseTo(0.5);
    expect(next.wingRight.integrity).toBeCloseTo(0.5);
  });

  it('elevator -> stabHorizontal, rudder -> stabVertical', () => {
    const c = createAircraftCondition();
    const t = nominalTelemetry({ distanceM: 1000, elapsedS: 60, fuelFraction: 0.5, endPosition: [0, 0, 0] });
    t.partIntegrity = { aileron_l: 1, aileron_r: 1, wing_root_main: 1, elevator: 0.3, rudder: 0.9, [gearPartId()]: 1 };
    const next = applyFlightDamage(c, t);
    expect(next.stabHorizontal.integrity).toBeCloseTo(0.3);
    expect(next.stabVertical.integrity).toBeCloseTo(0.9);
  });

  it('the single gear scalar degrades all three gear components equally', () => {
    const c = createAircraftCondition();
    const t = nominalTelemetry({ distanceM: 1000, elapsedS: 60, fuelFraction: 0.5, endPosition: [0, 0, 0] });
    t.partIntegrity = { aileron_l: 1, aileron_r: 1, wing_root_main: 1, elevator: 1, rudder: 1, [gearPartId()]: 0.2 };
    const next = applyFlightDamage(c, t);
    expect(next.gearLeft.integrity).toBeCloseTo(0.2);
    expect(next.gearRight.integrity).toBeCloseTo(0.2);
    expect(next.gearNose.integrity).toBeCloseTo(0.2);
  });

  it('a total-loss crash proxy-damages engine/propeller/fuselage without a per-surface report', () => {
    const c = createAircraftCondition();
    const t = nominalTelemetry({ distanceM: 1000, elapsedS: 60, fuelFraction: 0.5, endPosition: [0, 0, 0] });
    t.crashOutcome = 'totalLoss';
    const next = applyFlightDamage(c, t);
    expect(next.engine.integrity).toBeLessThan(0.5);
    expect(next.propeller.integrity).toBeLessThan(0.5);
    expect(next.fuselage.integrity).toBeLessThan(0.5);
  });
});

describe('conditionToPartIntegrity / conditionToPowerMultiplier (round trip into a new flight)', () => {
  it('maps persistent condition back onto sim surface ids', () => {
    const c = createAircraftCondition();
    c.wingLeft = { integrity: 0.4 };
    c.stabVertical = { integrity: 0.6 };
    c.gearLeft = { integrity: 0.3 };
    c.gearRight = { integrity: 0.9 };
    c.gearNose = { integrity: 0.9 };
    const map = conditionToPartIntegrity(c, SURFACES);
    expect(map.aileron_l).toBeCloseTo(0.4);
    expect(map.aileron_r).toBe(1);
    expect(map.rudder).toBeCloseTo(0.6);
    // Worst of the three gear struts, since the sim only has one gear scalar.
    expect(map[gearPartId()]).toBeCloseTo(0.3);
  });

  it('power multiplier is 1 when healthy and drops as engine/propeller degrade', () => {
    const healthy = createAircraftCondition();
    expect(conditionToPowerMultiplier(healthy)).toBe(1);
    const hurt = createAircraftCondition();
    hurt.engine = { integrity: 0.2 };
    expect(conditionToPowerMultiplier(hurt)).toBeLessThan(1);
  });
});
