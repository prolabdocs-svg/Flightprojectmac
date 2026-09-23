import { describe, expect, it } from 'vitest';
import { clearCorridor, getAmbientTrafficPose, planRoadTraffic, samplePath, shuttleDistance } from './ambientTraffic';
import type { RoadPath } from './fieldRoads';
import type { RegionLayout } from './regionPlacement';

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

describe('ground NPC traffic', () => {
  const road = (id: string, surface: 'asphalt' | 'dirt', lengthM: number): RoadPath => {
    const points = Array.from({ length: Math.round(lengthM / 10) + 1 }, (_, i) => ({ x: i * 10, z: 0, groundY: 0, y: i * 0.5, s: i * 10, tx: 1, tz: 0, onBridge: false }));
    return { def: { id, surface, widthM: 6, priority: 1, points: [] }, points, lengthM };
  };

  it('shuttles out, dwells at the far end and comes back continuously', () => {
    const at = (t: number) => shuttleDistance(t, 1000, 20, 1, 10);
    expect(at(0)).toEqual({ s: 0, dir: 1 });
    // leg = 2*20 s ramps + 600 m / 20 m/s = 70 s
    expect(at(70).s).toBeCloseTo(1000);
    expect(at(75)).toEqual({ s: 1000, dir: 1 });
    expect(at(80.01).dir).toBe(-1);
    expect(at(160).s).toBeCloseTo(0);
    for (let t = 0; t < 400; t += 0.5) expect(Math.abs(at(t + 0.5).s - at(t).s)).toBeLessThanOrEqual(20 * 0.5 + 1e-6);
  });

  it('interpolates position, heading and grade along a path', () => {
    const p = samplePath(road('r', 'asphalt', 100).points, 25);
    expect(p).toMatchObject({ x: 25, z: 0, tx: 1, tz: 0 });
    expect(p.y).toBeCloseTo(1.25);
    expect(p.grade).toBeCloseTo(0.05);
    expect(samplePath(road('r', 'asphalt', 100).points, 999).x).toBe(100);
  });

  it('plans deterministic traffic that shares one speed profile per road', () => {
    const roads = [road('main', 'asphalt', 2000), road('farm', 'dirt', 600), road('stub', 'dirt', 60)];
    const plan = planRoadTraffic(roads, 'seed');
    expect(plan).toEqual(planRoadTraffic(roads, 'seed'));
    expect(plan.some((v) => v.roadIndex === 2)).toBe(false);
    const main = plan.filter((v) => v.roadIndex === 0);
    expect(main.length).toBeGreaterThan(3);
    expect(new Set(main.map((v) => v.vmaxMs)).size).toBe(1);
    expect(plan.filter((v) => v.roadIndex === 1).every((v) => v.vmaxMs <= 8)).toBe(true);
  });

  it('clears scatter off a rail corridor', () => {
    const rail = road('rail', 'dirt', 200);
    const tree = (x: number, z: number) => ({ x, z }) as RegionLayout['trees'][number];
    const layout = { roads: [], trees: [tree(50, 2), tree(50, 40)], rocks: [], lots: [], props: [], patches: [], exclusions: [] } as unknown as RegionLayout;
    expect(clearCorridor(layout, rail, 8).trees).toEqual([tree(50, 40)]);
  });
});
