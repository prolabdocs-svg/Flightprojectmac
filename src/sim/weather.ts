import * as THREE from 'three';
import type { RegionDefinition } from '../core/types';

/**
 * Deterministic low-frequency wind.  It deliberately has no random state: the same
 * region/time always produces the same air mass, which makes the flight model replayable
 * and avoids a frame-rate-dependent weather advantage.
 */
export function getEnvironmentWind(region: RegionDefinition, elapsedS: number): THREE.Vector3 {
  const base = new THREE.Vector3(...region.windBaseMs);
  const { gustStrengthMs, gustPeriodS } = region.environment;
  if (gustStrengthMs <= 0 || gustPeriodS <= 0) return base;

  const phase = (elapsedS / gustPeriodS) * Math.PI * 2;
  // Two incommensurate waves produce a natural, bounded gust envelope without noise.
  const envelope = 0.5 + 0.32 * Math.sin(phase) + 0.18 * Math.sin(phase * 2.17 + 0.8);
  const crosswind = gustStrengthMs * envelope;
  return base.add(new THREE.Vector3(crosswind, Math.sin(phase * 1.61) * gustStrengthMs * 0.08, crosswind * 0.38));
}
