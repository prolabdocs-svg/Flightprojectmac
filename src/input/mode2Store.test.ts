import { beforeEach, describe, expect, it } from 'vitest';
import { applyExpo, PRESETS, stepKeyboardThrottle, useMode2Store } from './mode2Store';

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

describe('stepKeyboardThrottle', () => {
  const run = (t: number, up: boolean, down: boolean, seconds: number, fps: number, fine = false) => {
    for (let i = 0; i < Math.round(seconds * fps); i++) t = stepKeyboardThrottle(t, up, down, fine, 1 / fps);
    return t;
  };
  it('tap W / tap S make small changes', () => {
    expect(run(0.5, true, false, 0.08, 60)).toBeCloseTo(0.54, 2);
    expect(run(0.5, false, true, 0.08, 60)).toBeCloseTo(0.452, 2);
  });
  it('hold W / S reaches limits and clamps', () => {
    expect(run(0, true, false, 1, 60)).toBeCloseTo(0.5, 5);
    expect(run(0, true, false, 5, 60)).toBe(1);
    expect(run(1, false, true, 5, 60)).toBe(0);
  });
  it('is framerate independent', () => {
    expect(run(0.2, true, false, 1, 30)).toBeCloseTo(run(0.2, true, false, 1, 144), 5);
  });
  it('fine modifier slows the rate; zero dt (paused) is a no-op', () => {
    expect(run(0, true, false, 1, 60, true)).toBeCloseTo(0.125, 5);
    expect(stepKeyboardThrottle(0.35, true, false, false, 0)).toBe(0.35);
  });
});
