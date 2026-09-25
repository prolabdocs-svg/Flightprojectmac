import { describe, expect, it } from 'vitest';
import { getRegion } from '../content/regions';
import { distanceToRiver, lakeEdgeDistance } from './fieldGeography';
import { DISTRICTS, FIELD_BUDGETS, FIELD_PARCELS, ROADS } from './fieldComposition';
import { COUNTRY_PARCELS, parcelsOverlap } from './fieldCountryside';
import { deadSpaceReport } from './worldDensityMetrics';
import { buildFieldLayout } from './fieldPlacement';
import { buildHeightGrid, createGridSampler } from './terrainHeightfield';
import { createTerrainQueryService } from './terrainQuery';

const terrain = createTerrainQueryService(getRegion('the_field'));
const grid = createGridSampler(buildHeightGrid(terrain.getElevation));
const layout = buildFieldLayout({ grid, terrain });

describe('Field composition', () => {
  it('has every district A-J and all named roads', () => {
    expect(DISTRICTS.map((d) => d.id).join('')).toBe('ABCDEFGHIJKLMN');
    expect(ROADS.map((r) => r.id)).toEqual(expect.arrayContaining(['ROAD_MAIN', 'ROAD_VILLAGE', 'ROAD_AIRFIELD', 'ROAD_LAKE', 'ROAD_FARM_A', 'ROAD_SECOND_AIRFIELD']));
  });

  it('is deterministic', () => {
    const again = buildFieldLayout({ grid, terrain });
    expect(again.trees.length).toBe(layout.trees.length);
    expect(again.lots).toEqual(layout.lots);
  });

  it('keeps roads dry, off the lake, on gentle slopes, and only ROAD_MAIN over the river', () => {
    for (const road of layout.roads) {
      const maxSlope = road.def.surface === 'asphalt' ? 9 : road.def.terrainFollowing ? 17 : 13;
      for (const p of road.points) {
        if (!p.onBridge) expect(terrain.getWaterDepth(p.x, p.z), `${road.def.id} wet @${p.x | 0},${p.z | 0}`).toBe(0);
        expect(lakeEdgeDistance(p.x, p.z)).toBeGreaterThan(40);
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
    expect(layout.trees.length).toBeLessThan(FIELD_BUDGETS.trees);
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

  it('stays inside the V2 world budgets', () => {
    expect(layout.trees.length).toBeLessThan(FIELD_BUDGETS.trees);
    expect(layout.lots.length).toBeLessThan(FIELD_BUDGETS.lots);
    expect(layout.props.length).toBeLessThan(FIELD_BUDGETS.props);
    expect(layout.rocks.length).toBeLessThan(FIELD_BUDGETS.rocks);
    expect(FIELD_PARCELS.length + COUNTRY_PARCELS.length).toBeLessThan(FIELD_BUDGETS.parcels);
  });

  it('generated farmland never overlaps itself or the authored parcels', () => {
    const all = [...FIELD_PARCELS, ...COUNTRY_PARCELS];
    for (let i = 0; i < all.length; i++) for (let j = Math.max(i + 1, FIELD_PARCELS.length); j < all.length; j++) {
      expect(parcelsOverlap(all[i], all[j], 2), `${all[i].id}/${all[j].id}`).toBe(false);
    }
    for (const p of COUNTRY_PARCELS) expect(terrain.getWaterDepth(p.center[0], p.center[1])).toBe(0);
  });

  it('leaves little dead space in the lowlands but keeps open zones (composition, not noise)', () => {
    const r = deadSpaceReport(layout, grid, terrain);
    // Lowland 500 m cells with nothing meaningful in them: was ~60% before V2.
    expect(r.lowlandDeadFraction).toBeLessThan(0.2);
    // ...but not uniform saturation: some lowland cells stay open (commons, meadows, shore).
    expect(r.lowlandSparseFraction).toBeGreaterThan(0.05);
  });

  it('the lake is a shaped place: irregular shore, island, reeds, boats, beach', () => {
    const island = layout.trees.filter((t) => Math.hypot(t.x - 2330, t.z - 2230) < 120);
    expect(island.length).toBeGreaterThan(20);
    expect(terrain.getWaterDepth(2330, 2230)).toBe(0); // island is land
    expect(terrain.getWaterDepth(2500, 1900)).toBeGreaterThan(10); // open water
    expect(layout.props.filter((p) => p.kind === 'reeds').length).toBeGreaterThan(60);
    expect(layout.props.filter((p) => p.kind === 'boat').length).toBeGreaterThan(5);
  });
});

