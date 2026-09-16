import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { THE_FIELD, SCRAP_VALLEY } from '../content/regions';
import { getEnvironmentWind } from './weather';

describe('environment wind', () => {
  it('is deterministic for a region and elapsed time', () => {
    expect(getEnvironmentWind(SCRAP_VALLEY, 4.25).toArray()).toEqual(getEnvironmentWind(SCRAP_VALLEY, 4.25).toArray());
  });

  it('keeps a calm region close to its authored base wind', () => {
    const base = THE_FIELD.windBaseMs;
    const wind = getEnvironmentWind(THE_FIELD, 3);
    expect(wind.distanceTo(new THREE.Vector3(...base))).toBeLessThan(1.2);
  });

  it('gives the exposed quarry a materially stronger gust envelope', () => {
    const fieldDelta = getEnvironmentWind(THE_FIELD, 2).distanceTo(new THREE.Vector3(...THE_FIELD.windBaseMs));
    const quarryDelta = getEnvironmentWind(SCRAP_VALLEY, 2).distanceTo(new THREE.Vector3(...SCRAP_VALLEY.windBaseMs));
    expect(quarryDelta).toBeGreaterThan(fieldDelta);
  });
});
