import * as THREE from 'three';
import type { RegionDefinition } from '../core/types';
import { worldToGeo } from '../world/master/masterGeography';

/**
 * Deterministic low-frequency wind.  It deliberately has no random state: the same
 * region/time always produces the same air mass, which makes the flight model replayable
 * and avoids a frame-rate-dependent weather advantage.
 */
export function getEnvironmentWind(region: RegionDefinition, elapsedS: number, position = new THREE.Vector3()): THREE.Vector3 {
  const base = new THREE.Vector3(...region.windBaseMs);
  const { gustStrengthMs, gustPeriodS } = region.environment;
  if (gustStrengthMs <= 0 || gustPeriodS <= 0) return applyWindVolumes(region, base, position);

  const phase = (elapsedS / gustPeriodS) * Math.PI * 2;
  // Two incommensurate waves produce a natural, bounded gust envelope without noise.
  const envelope = 0.5 + 0.32 * Math.sin(phase) + 0.18 * Math.sin(phase * 2.17 + 0.8);
  const crosswind = gustStrengthMs * envelope;
  return applyWindVolumes(region, base.add(new THREE.Vector3(crosswind, Math.sin(phase * 1.61) * gustStrengthMs * 0.08, crosswind * 0.38)), position);
}

/** Deterministic weather field sampled in canonical master-world coordinates. The regional argument is only a legacy preset
 * for existing missions; world position, time and master geography make the field continuous across named-area seams. */
export function getWorldWind(region: RegionDefinition, elapsedS: number, worldPosition: THREE.Vector3): THREE.Vector3 {
  const localPreset = getEnvironmentWind(region, elapsedS, worldPosition);
  const [eastKm, northKm] = worldToGeo(worldPosition.x, worldPosition.z);
  const phase = elapsedS * 0.0017 + eastKm * 0.19 - northKm * 0.13;
  const broad = 1.8 * Math.sin(phase) + 0.9 * Math.sin(phase * 0.47 + eastKm * 0.08);
  const shear = 0.55 * Math.sin(northKm * 0.31 + elapsedS * 0.0008);
  // Keep the legacy authored wind as a baseline but add a smooth, bounded world-scale air mass.
  return localPreset.add(new THREE.Vector3(broad, shear, broad * 0.38));
}

/** Position/time-only atmosphere for continuous free flight across every authored region seam. */
export function getWorldClimateWind(elapsedS: number, worldPosition: THREE.Vector3): THREE.Vector3 {
  const [eastKm, northKm] = worldToGeo(worldPosition.x, worldPosition.z);
  const phase = elapsedS * 0.0017 + eastKm * 0.19 - northKm * 0.13;
  const cross = 2.2 + 2.8 * Math.sin(phase) + 1.1 * Math.sin(phase * 0.47 + eastKm * 0.08);
  const along = 1.4 * Math.cos(phase * 0.71 + northKm * 0.12);
  const shear = 0.55 * Math.sin(northKm * 0.31 + elapsedS * 0.0008);
  return new THREE.Vector3(cross, shear, along);
}

function applyWindVolumes(region: RegionDefinition, wind: THREE.Vector3, position: THREE.Vector3): THREE.Vector3 {
  for (const volume of region.windVolumes ?? []) {
    const center = new THREE.Vector3(...volume.center);
    const horizontal = new THREE.Vector2(position.x - center.x, position.z - center.z).length();
    const vertical = Math.abs(position.y - center.y);
    if (horizontal >= volume.radiusM || vertical >= volume.heightM) continue;
    // Smoothstep removes an abrupt force change at the authored volume boundary.
    const edge = Math.max(horizontal / volume.radiusM, vertical / volume.heightM);
    const weight = 1 - edge * edge * (3 - 2 * edge);
    wind.addScaledVector(new THREE.Vector3(...volume.windDeltaMs), weight);
  }
  return wind;
}
