import { describe, expect, it } from 'vitest';
import type { FlightTelemetry } from '../../flight/flightTypes';
import { Needle, dialAngle, readInstruments, unwrapDeg } from './instrumentModel';

const base = { airspeedMs: 20, altitudeM: 100, rpm: 5000, verticalSpeedMs: 2.54, fuelFraction: 0.5, engineTempFrac: 0.7, headingDeg: 90, onGround: false, rollDeg: 0, sideslipDeg: 6, stallSpeedMs: 15, engineOn: true, stallWarning: false, stalled: false } as unknown as FlightTelemetry;

describe('cockpit instrument model', () => {
  it('converts sim units to panel units', () => {
    const r = readInstruments(base);
    expect(r.asiKmh).toBeCloseTo(72);
    expect(r.altFt).toBeCloseTo(328.1);
    expect(r.vsiFpm).toBeCloseTo(500, 0);
    expect(r.slip).toBeCloseTo(0.5); // relative wind from the right -> ball right
    expect(r.fuelLamp).toBe(false);
    expect(readInstruments({ ...base, fuelFraction: 0.1 }).fuelLamp).toBe(true);
  });

  it('ball follows bank on the ground, not the (meaningless) static sideslip', () => {
    expect(readInstruments({ ...base, onGround: true, airspeedMs: 0, sideslipDeg: 80, rollDeg: 0 }).slip).toBe(0);
  });

  it('dial mapping clamps and needles settle without overshoot at zeta=1', () => {
    expect(dialAngle(200, 0, 140, -145, 145)).toBeCloseTo(145 * Math.PI / 180);
    const n = new Needle(9);
    let max = 0;
    for (let i = 0; i < 120; i++) max = Math.max(max, n.update(100, 1 / 60));
    expect(max).toBeLessThanOrEqual(100.0001);
    expect(n.value).toBeGreaterThan(99);
    expect(Number.isFinite(new Needle(14).update(5000, 0.1))).toBe(true); // frame hitch stays stable
  });

  it('compass unwraps across north', () => {
    expect(unwrapDeg(350, 10)).toBe(370);
    expect(unwrapDeg(10, 350)).toBe(-10);
  });
});
