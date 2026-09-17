import { describe, expect, it } from 'vitest';
import { FixedStepClock } from './fixedStepClock';

describe('FixedStepClock', () => {
  it('advances in fixed increments and exposes interpolation alpha', () => {
    const clock = new FixedStepClock(0.02, 0.1, 8);
    expect(clock.advance(0.01)).toMatchObject({ steps: 0, alpha: 0.5 });
    const frame = clock.advance(0.015);
    expect(frame.steps).toBe(1);
    expect(frame.alpha).toBeCloseTo(0.25, 8);
  });

  it('clamps pathological frame deltas', () => {
    const clock = new FixedStepClock(1 / 60, 0.1, 8);
    const frame = clock.advance(5);
    expect(frame.frameDtS).toBe(0.1);
    expect(frame.steps).toBe(6);
  });

  it('bounds catch-up and retains only a fractional remainder', () => {
    const clock = new FixedStepClock(0.05, 1, 2);
    const frame = clock.advance(0.23);
    expect(frame.steps).toBe(2);
    expect(frame.droppedTimeS).toBeCloseTo(0.1, 8);
    expect(frame.alpha).toBeCloseTo(0.6, 8);
  });

  it('reset clears accumulated wall-clock time', () => {
    const clock = new FixedStepClock(0.02, 0.1, 8);
    clock.advance(0.01);
    clock.reset();
    expect(clock.advance(0)).toMatchObject({ steps: 0, alpha: 0 });
  });
});
