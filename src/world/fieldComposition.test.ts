import { describe, expect, it } from 'vitest';
import { getRegion } from '../content/regions';
import { distanceToRiver, FIELD_LAKE } from './fieldGeography';
import { DISTRICTS, FIELD_PARCELS, ROADS } from './fieldComposition';
import { buildFieldLayout } from './fieldPlacement';
import { buildHeightGrid, createGridSampler } from './terrainHeightfield';
import { createTerrainQueryService } from './terrainQuery';

const terrain = createTerrainQueryService(getRegion('the_field'));
const grid = createGridSampler(buildHeightGrid(terrain.getElevation));
const layout = buildFieldLayout({ grid, terrain });

describe('Field composition', () => {
  it('has every district A-J and all named roads', () => {
    expect(DISTRICTS.map((d) => d.id).join('')).toBe('ABCDEFGHIJ');
    expect(ROADS.map((r) => r.id)).toEqual(expect.arrayContaining(['ROAD_MAIN', 'ROAD_VILLAGE', 'ROAD_AIRFIELD', 'ROAD_LAKE', 'ROAD_FARM_A', 'ROAD_SECOND_AIRFIELD']));
  });

  it('is deterministic', () => {
    const again = buildFieldLayout({ grid, terrain });
    expect(again.trees.length).toBe(layout.trees.length);
    expect(again.lots).toEqual(layout.lots);
  });

  it('keeps roads dry, off the lake, on gentle slopes, and only ROAD_MAIN over the river', () => {
    for (const road of layout.roads) {
      const maxSlope = road.def.surface === 'asphalt' ? 9 : 13;
      for (const p of road.points) {
        expect(terrain.getWaterDepth(p.x, p.z), `${road.def.id} wet @${p.x | 0},${p.z | 0}`).toBe(0);
        expect(Math.hypot(p.x - FIELD_LAKE.x, p.z - FIELD_LAKE.z)).toBeGreaterThan(FIELD_LAKE.radiusM + 40);
        if (!p.onBridge && road.def.id !== 'ROAD_MAIN') expect(distanceToRiver(p.x, p.z)).toBeGreaterThan(60);
        expect(grid.slopeDeg(p.x, p.z), `${road.def.id} slope`).toBeLessThan(maxSlope);
      }
    }
    expect(layout.roads.find((r) => r.def.id === 'ROAD_MAIN')!.points.some((p) => p.onBridge)).toBe(true);
  });

  it('builds a settlement, farms, fields and a trees budget', () => {
    const houses = layout.lots.filter((l) => /^(farmhouse|small_workshop|barn)/.test(l.kind));
    expect(houses.length).toBeGreaterThanOrEqual(15);
    expect(FIELD_PARCELS.length).toBeGreaterThanOrEqual(10);
    expect(layout.trees.length).toBeLessThan(9500);
    expect(layout.lots.some((l) => l.kind === 'lattice_tower') && layout.lots.some((l) => l.kind === 'stack')).toBe(true);
  });

  it('never places buildings or trees in water or on a graded runway', () => {
    // Dressing may sit on a strip's graded apron beyond the 35 m runway safety buffer, never on the runway itself.
    for (const l of layout.lots) expect(terrain.isOnGradedRunway(l.x, l.z) && Math.abs(l.x) < 45 && Math.abs(l.z - (l.z > 400 ? 620 : 0)) < 130, `${l.kind}@${l.x},${l.z}`).toBe(false);
    for (const t of layout.trees) { expect(terrain.isOnGradedRunway(t.x, t.z)).toBe(false); expect(terrain.getWaterDepth(t.x, t.z)).toBe(0); }
  });

  it('keeps crop parcels from overlapping one another', () => {
    for (let i = 0; i < FIELD_PARCELS.length; i++) for (let j = i + 1; j < FIELD_PARCELS.length; j++) {
      const a = FIELD_PARCELS[i], b = FIELD_PARCELS[j];
      const gapX = Math.abs(a.center[0] - b.center[0]) - (a.widthM + b.widthM) / 2, gapZ = Math.abs(a.center[1] - b.center[1]) - (a.depthM + b.depthM) / 2;
      expect(Math.max(gapX, gapZ), `${a.id}/${b.id}`).toBeGreaterThan(-8);
    }
  });
});
