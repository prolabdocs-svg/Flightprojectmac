import { describe, expect, it } from 'vitest';
import { getRunwaySafeZone, isInsideZone, layoutRoadTiles, routeAroundSafeZone, RUNWAY_SAFE_BUFFER_M } from './fieldAirfieldLayout';

const fieldHome = { position: [0, 0, 0] as const, runwayWidthM: 24, runwayLengthM: 220 };

describe('getRunwaySafeZone', () => {
  it('pads the runway rectangle by the safety buffer on every side', () => {
    const zone = getRunwaySafeZone(fieldHome);
    expect(zone).toEqual({
      minX: -12 - RUNWAY_SAFE_BUFFER_M,
      maxX: 12 + RUNWAY_SAFE_BUFFER_M,
      minZ: -110 - RUNWAY_SAFE_BUFFER_M,
      maxZ: 110 + RUNWAY_SAFE_BUFFER_M,
    });
  });

  it('recenters on an off-origin airfield position', () => {
    const zone = getRunwaySafeZone({ position: [35, 0, 260], runwayWidthM: 16, runwayLengthM: 150 });
    expect(zone.minX).toBeCloseTo(35 - 8 - 35);
    expect(zone.maxZ).toBeCloseTo(260 + 75 + 35);
  });
});

describe('isInsideZone', () => {
  it('flags the runway centerline and its buffer as unsafe', () => {
    const zone = getRunwaySafeZone(fieldHome);
    expect(isInsideZone(0, 0, zone)).toBe(true);
    expect(isInsideZone(12 + 34, 0, zone)).toBe(true); // still inside the 35m buffer
    expect(isInsideZone(12 + 36, 0, zone)).toBe(false); // just past the buffer
  });
});

describe('routeAroundSafeZone', () => {
  const zone = getRunwaySafeZone(fieldHome);

  it('keeps a straight two-point route when it never crosses the safe zone', () => {
    const route = routeAroundSafeZone([80, -30], [80, 200], zone);
    expect(route).toEqual([[80, -30], [80, 200]]);
  });

  it('inserts a bend so the road never re-enters the safe zone', () => {
    const route = routeAroundSafeZone([80, -20], [-180, 40], zone);
    expect(route.length).toBe(4);
    for (let i = 0; i < route.length - 1; i++) {
      const [x0, z0] = route[i], [x1, z1] = route[i + 1];
      for (let t = 0; t <= 1; t += 0.05) {
        expect(isInsideZone(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, zone)).toBe(false);
      }
    }
  });
});

describe('layoutRoadTiles', () => {
  it('covers each waypoint segment with evenly spaced, correctly oriented tiles', () => {
    const tiles = layoutRoadTiles([[0, 0], [0, 100]], 20);
    expect(tiles).toHaveLength(5);
    for (const tile of tiles) expect(tile.rotationY).toBeCloseTo(0);
    expect(tiles[0].z).toBeCloseTo(10);
    expect(tiles[4].z).toBeCloseTo(90);
  });

  it('produces no tiles for a degenerate zero-length segment', () => {
    expect(layoutRoadTiles([[5, 5], [5, 5]], 10)).toEqual([]);
  });
});
