import { describe, expect, it } from 'vitest';
import { getAmbientTrafficPose } from './ambientTraffic';

describe('ambient traffic routes', () => {
  it('is deterministic for a region, route, and simulation time', () => {
    expect(getAmbientTrafficPose('the_field', 1, 32)).toEqual(getAmbientTrafficPose('the_field', 1, 32));
  });

  it('separates routes vertically and spatially', () => {
    const low = getAmbientTrafficPose('the_field', 0, 0);
    const high = getAmbientTrafficPose('the_field', 2, 0);
    expect(high.y).toBeGreaterThan(low.y);
    expect(Math.hypot(high.x - low.x, high.z - low.z)).toBeGreaterThan(100);
  });

  it('moves a route over time', () => {
    const early = getAmbientTrafficPose('coast_run', 0, 0);
    const later = getAmbientTrafficPose('coast_run', 0, 60);
    expect(Math.hypot(later.x - early.x, later.z - early.z)).toBeGreaterThan(10);
  });
});
