import type { EngineSpec } from '../core/types';

/** Converts the simulation's smoothed throttle into an instrument reading. Keeping
 * this pure prevents a stopped motor from visually reading as though it were idling. */
export function computeEngineRpm(engine: EngineSpec | null | undefined, engineOn: boolean, fuelL: number, throttle: number): number {
  if (!engine || !engineOn || fuelL <= 0) return 0;
  const clampedThrottle = Math.min(1, Math.max(0, throttle));
  return engine.idleRpm + clampedThrottle * (engine.redlineRpm - engine.idleRpm);
}
