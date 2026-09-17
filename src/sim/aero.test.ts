import { describe, expect, it } from 'vitest';
import { airDensityAtAltitude, dynamicPressure, finiteWingLiftSlope, groundEffectInducedDragFactor, liftDragCurve } from './aero';

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

  it('a lower-aspect-ratio surface has a shallower lift-curve slope than a higher-AR one', () => {
    // Finite-wing (Prandtl) correction: a stubby rudder-like panel (AR ~1.5) must generate
    // less CL per degree of AoA than a wing-like panel (AR ~7) of the same area, exactly
    // the shape-dependence a single shared slope constant couldn't express.
    const lowAr = liftDragCurve(5, stallPos, stallNeg, parasiticCd, inducedDragFactor, 1.5);
    const highAr = liftDragCurve(5, stallPos, stallNeg, parasiticCd, inducedDragFactor, 7);
    expect(lowAr.cl).toBeGreaterThan(0);
    expect(lowAr.cl).toBeLessThan(highAr.cl);
  });

  it('deep stall (approaching 90 degrees AoA) correctly returns lift toward zero', () => {
    // A flat plate broadside to the flow produces (near) zero lift, all drag - the old
    // model incorrectly plateaued at ~35% of peak CL forever, including at 90 degrees.
    const nearNinety = liftDragCurve(89, stallPos, stallNeg, parasiticCd, inducedDragFactor);
    expect(Math.abs(nearNinety.cl)).toBeLessThan(0.1);
  });

  it('drag keeps rising through deep stall instead of following lift back down', () => {
    // Separated (stalled) flow is a high-drag, not low-drag, state - CD must stay high (in
    // fact keep climbing toward the flat-plate maximum) even as CL collapses past 45-60
    // degrees AoA, since drag in this regime comes from separation, not from lift-induced
    // downwash (which is what the parasitic+induced formula alone would imply).
    const atStall = liftDragCurve(stallPos, stallPos, stallNeg, parasiticCd, inducedDragFactor);
    const deepStall = liftDragCurve(75, stallPos, stallNeg, parasiticCd, inducedDragFactor);
    expect(deepStall.cd).toBeGreaterThan(atStall.cd);
  });
});

describe('finiteWingLiftSlope', () => {
  it('stays below the 2*pi thin-airfoil theoretical ceiling for any finite aspect ratio', () => {
    expect(finiteWingLiftSlope(50)).toBeLessThan(2 * Math.PI);
    expect(finiteWingLiftSlope(1)).toBeLessThan(2 * Math.PI);
  });

  it('increases monotonically with aspect ratio (slender wings lift more efficiently)', () => {
    expect(finiteWingLiftSlope(2)).toBeLessThan(finiteWingLiftSlope(6));
    expect(finiteWingLiftSlope(6)).toBeLessThan(finiteWingLiftSlope(15));
  });
});

describe('groundEffectInducedDragFactor', () => {
  it('approaches 1 (no effect) far from the ground', () => {
    expect(groundEffectInducedDragFactor(50, 9)).toBeGreaterThan(0.99);
  });

  it('approaches 0 (induced drag vanishes) right at the ground', () => {
    expect(groundEffectInducedDragFactor(0, 9)).toBe(0);
    expect(groundEffectInducedDragFactor(0.1, 9)).toBeLessThan(0.1);
  });

  it('increases monotonically with height above ground', () => {
    const low = groundEffectInducedDragFactor(0.5, 9);
    const mid = groundEffectInducedDragFactor(2, 9);
    const high = groundEffectInducedDragFactor(10, 9);
    expect(low).toBeLessThan(mid);
    expect(mid).toBeLessThan(high);
  });
});
