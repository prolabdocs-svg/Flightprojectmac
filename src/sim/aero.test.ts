import { describe, expect, it } from 'vitest';
import { airDensityAtAltitude, dynamicPressure, liftDragCurve } from './aero';

describe('airDensityAtAltitude', () => {
  it('returns sea-level density at altitude 0', () => {
    expect(airDensityAtAltitude(0)).toBeCloseTo(1.225, 5);
  });

  it('decreases as altitude increases', () => {
    const low = airDensityAtAltitude(1000);
    const high = airDensityAtAltitude(5000);
    expect(high).toBeLessThan(low);
    expect(low).toBeLessThan(1.225);
  });

  it('clamps negative altitude to sea level (no denser-than-sea-level air)', () => {
    expect(airDensityAtAltitude(-500)).toBeCloseTo(1.225, 5);
  });
});

describe('dynamicPressure', () => {
  it('computes 0.5 * rho * v^2', () => {
    expect(dynamicPressure(1.225, 10)).toBeCloseTo(0.5 * 1.225 * 100, 6);
  });

  it('is zero at zero speed', () => {
    expect(dynamicPressure(1.225, 0)).toBe(0);
  });
});

describe('liftDragCurve', () => {
  const stallPos = 15;
  const stallNeg = -13;
  const parasiticCd = 0.028;
  const inducedDragFactor = 0.045;

  it('produces zero lift at zero angle of attack', () => {
    const { cl } = liftDragCurve(0, stallPos, stallNeg, parasiticCd, inducedDragFactor);
    expect(cl).toBeCloseTo(0, 6);
  });

  it('increases lift roughly linearly before stall', () => {
    const low = liftDragCurve(5, stallPos, stallNeg, parasiticCd, inducedDragFactor);
    const mid = liftDragCurve(10, stallPos, stallNeg, parasiticCd, inducedDragFactor);
    expect(mid.cl).toBeGreaterThan(low.cl);
  });

  it('falls off past the positive stall angle instead of continuing to climb', () => {
    const atStall = liftDragCurve(stallPos, stallPos, stallNeg, parasiticCd, inducedDragFactor);
    const wayPastStall = liftDragCurve(60, stallPos, stallNeg, parasiticCd, inducedDragFactor);
    expect(wayPastStall.cl).toBeLessThan(atStall.cl);
    expect(wayPastStall.cl).toBeGreaterThan(0);
  });

  it('mirrors falloff behavior on the negative side past negative stall', () => {
    const atStall = liftDragCurve(stallNeg, stallPos, stallNeg, parasiticCd, inducedDragFactor);
    const wayPastStall = liftDragCurve(-60, stallPos, stallNeg, parasiticCd, inducedDragFactor);
    expect(wayPastStall.cl).toBeGreaterThan(atStall.cl); // less negative (magnitude falls off)
    expect(wayPastStall.cl).toBeLessThan(0);
  });

  it('drag is always at least the parasitic drag coefficient', () => {
    const { cd } = liftDragCurve(0, stallPos, stallNeg, parasiticCd, inducedDragFactor);
    expect(cd).toBeCloseTo(parasiticCd, 6);
  });

  it('induced drag grows with the square of lift', () => {
    const low = liftDragCurve(5, stallPos, stallNeg, parasiticCd, inducedDragFactor);
    const high = liftDragCurve(10, stallPos, stallNeg, parasiticCd, inducedDragFactor);
    const lowInduced = low.cd - parasiticCd;
    const highInduced = high.cd - parasiticCd;
    expect(highInduced).toBeGreaterThan(lowInduced);
    expect(lowInduced).toBeCloseTo(inducedDragFactor * low.cl * low.cl, 6);
  });
});
