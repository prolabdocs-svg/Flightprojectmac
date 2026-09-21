import { beforeEach, describe, expect, it } from 'vitest';
import { applyExpo, PRESETS, useMode2Store } from './mode2Store';

describe('Mode 2 focus safety', () => {
  beforeEach(() => useMode2Store.getState().reset());

  it('releases transient axes and brake without cutting sticky throttle', () => {
    useMode2Store.getState().setThrottle(.72);
    useMode2Store.getState().setRudder(.5);
    useMode2Store.getState().setElevator(-.8);
    useMode2Store.getState().setAileron(.3);
    useMode2Store.getState().setBrake(true);
    useMode2Store.getState().releaseMomentaryControls();
    expect(useMode2Store.getState()).toMatchObject({ throttle: .72, rudder: 0, elevator: 0, aileron: 0, brake: false });
  });
});

describe('touch pipeline: dead zone -> expo -> rate', () => {
  it('ignores stick jitter inside the dead zone and still reaches full travel', () => {
    const p = PRESETS.normal;
    expect(applyExpo(0.03, p)).toBe(0);
    expect(applyExpo(-0.03, p)).toBe(0);
    expect(applyExpo(1, p)).toBeCloseTo(1, 6);
    expect(applyExpo(-1, p)).toBeCloseTo(-1, 6);
  });

  it('is monotonic and odd-symmetric', () => {
    const p = PRESETS.beginner;
    let prev = -Infinity;
    for (let x = -1; x <= 1; x += 0.05) {
      const v = applyExpo(x, p);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
      expect(applyExpo(-x, p)).toBeCloseTo(-v, 9);
    }
  });
});
