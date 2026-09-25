import { describe, expect, it } from 'vitest';
import { DEG } from '../core/constants';
import { FlightAssistance } from './flightAssistance';
import { FlightControls, NEUTRAL_COMMAND } from './flightControls';

const CONTROL_DEF = { elevatorMaxDeg: 22, aileronUpMaxDeg: 18, aileronDownRatio: .6, rudderMaxDeg: 22, surfaceRateDegS: 90 };

describe('high-lift flap command path', () => {
  it('passes the toggle through assistance and the actuator, then retracts to zero', () => {
    const assistance = new FlightAssistance();
    const assisted = { ...NEUTRAL_COMMAND };
    assistance.apply({ ...NEUTRAL_COMMAND, flaps: true }, {
      bankRad: 0, pitchRad: 0, p: 0, q: 0, r: 0, betaRad: 0, airspeedMs: 30, stallMarginRad: 1, onGround: true,
    }, .05, assisted);
    expect(assisted.flaps).toBe(true);

    const controls = new FlightControls(CONTROL_DEF);
    expect(controls.step(assisted, .5).flaps).toBeCloseTo(25 * DEG, 8);
    expect(controls.step({ ...NEUTRAL_COMMAND, flaps: false }, .5).flaps).toBeCloseTo(0, 8);
  });
});
