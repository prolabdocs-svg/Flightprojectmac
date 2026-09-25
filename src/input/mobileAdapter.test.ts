import { afterEach, describe, expect, it } from 'vitest';
import { getResolvedControls, useMode2Store } from './mode2Store';
import { applyMobileFlightAxes, releaseMobileFlightAxes } from './mobileAdapter';

describe('mobile flight input adapter', () => {
  afterEach(() => useMode2Store.getState().reset());

  it('writes all four axes to the store consumed by the flight model with Mode 2 signs', () => {
    applyMobileFlightAxes({ throttle: 0.72, pitch: 0.4, roll: 0.6, yaw: -0.3, brake: true });
    const flightControls = getResolvedControls();
    expect(flightControls.throttle).toBeCloseTo(0.72);
    expect(flightControls.pitch).toBeGreaterThan(0);
    expect(flightControls.roll).toBeGreaterThan(0);
    expect(flightControls.rudder).toBeLessThan(0);
    expect(flightControls.brake).toBe(true);
  });

  it('releases momentary controls after link loss while retaining throttle', () => {
    applyMobileFlightAxes({ throttle: 0.63, pitch: 0.2, roll: -0.5, yaw: 0.7, brake: true });
    releaseMobileFlightAxes();
    const flightControls = getResolvedControls();
    expect(flightControls.throttle).toBeCloseTo(0.63);
    expect(flightControls.pitch).toBe(0);
    expect(flightControls.roll).toBe(0);
    expect(flightControls.rudder).toBe(0);
    expect(flightControls.brake).toBe(false);
  });
});
