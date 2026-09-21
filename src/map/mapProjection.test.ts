import { describe, expect, it } from 'vitest';
import { clampView, fitRect, homeView, mapToWorld, panBy, pointsVisible, scaleLimits, screenToWorld, worldToMap, worldToScreen, zoomAt } from './mapProjection';

const size = { w: 1000, h: 600 };
const view = { centerEast: 0, centerNorth: 0, scale: 0.1 };

describe('world <-> map projection', () => {
  it('follows the project compass: +Z is north (up), east is -X (right)', () => {
    expect(worldToMap(0, 100)).toEqual({ east: -0, north: 100 });
    const home = worldToScreen(view, size, 0, 0), north = worldToScreen(view, size, 0, 620), east = worldToScreen(view, size, -300, 0);
    expect(north.sy).toBeLessThan(home.sy); // north is up
    expect(north.sx).toBeCloseTo(home.sx);
    expect(east.sx).toBeGreaterThan(home.sx); // east (-X) is to the right
  });
  it('round-trips world -> screen -> world and map -> world', () => {
    const { sx, sy } = worldToScreen(view, size, 1234, -567);
    const w = screenToWorld(view, size, sx, sy);
    expect(w.x).toBeCloseTo(1234); expect(w.z).toBeCloseTo(-567);
    expect(mapToWorld(worldToMap(12, 34).east, worldToMap(12, 34).north)).toEqual({ x: 12, z: 34 });
  });
  it('zoomAt keeps the map point under the cursor fixed', () => {
    const rect = { minX: -6000, maxX: 6000, minZ: -6000, maxZ: 6000 };
    const before = screenToWorld(view, size, 800, 150);
    const zoomed = zoomAt(view, size, 800, 150, 2, scaleLimits(rect, size));
    expect(zoomed.scale).toBeCloseTo(0.2);
    const after = screenToWorld(zoomed, size, 800, 150);
    expect(after.x).toBeCloseTo(before.x); expect(after.z).toBeCloseTo(before.z);
  });
  it('panBy drags the map with the pointer', () => {
    const p = panBy(view, 100, 0); // drag right -> content moves right -> centre moves west (+X world / -east)
    expect(worldToScreen(p, size, 0, 0).sx).toBeCloseTo(worldToScreen(view, size, 0, 0).sx + 100);
  });
  it('clamps zoom and keeps the centre inside the region', () => {
    const rect = { minX: -6600, maxX: 6600, minZ: -6600, maxZ: 6600 };
    const lim = scaleLimits(rect, size);
    const c = clampView({ centerEast: 99999, centerNorth: -99999, scale: 100 }, size, rect);
    expect(c.scale).toBe(lim.max);
    expect(c.centerEast).toBe(6600); // east limit = -minX
    expect(c.centerNorth).toBe(-6600);
    expect(clampView({ ...view, scale: 0.00001 }, size, rect).scale).toBe(lim.min);
    expect(lim.min * 13200).toBeLessThanOrEqual(size.h); // min zoom shows the whole region
  });
  it('fitRect centres a rect in the free area and pointsVisible respects insets', () => {
    const rect = { minX: -500, maxX: 500, minZ: 0, maxZ: 1000 };
    const insets = { left: 0, right: 300, top: 0, bottom: 0 };
    const v = fitRect(rect, size, insets);
    expect(pointsVisible(v, size, [[-500, 0], [500, 1000]], insets, 0)).toBe(true);
    expect(pointsVisible(view, size, [[100000, 0]])).toBe(false);
  });
  it('homeView frames the origin with its whole range ring visible, not the entire world', () => {
    const rect = { minX: -7900, maxX: 7900, minZ: -7900, maxZ: 7900 };
    const v = homeView({ x: 0, z: 0 }, { usableM: 3400, comfortableM: 2720 }, size, rect);
    const ring = [[3400, 0], [-3400, 0], [0, 3400], [0, -3400]] as const;
    expect(pointsVisible(v, size, ring, undefined, 0)).toBe(true);
    expect(v.scale).toBeGreaterThan(scaleLimits(rect, size).min * 1.5); // zoomed well in from the full world
  });
});
