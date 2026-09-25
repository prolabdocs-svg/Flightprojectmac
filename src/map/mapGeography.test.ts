import { describe, expect, it } from 'vitest';
import { FIELD_LAKE, FIELD_RIVER_POINTS, ridgeZ } from '../world/fieldGeography';
import { REGIONS } from '../content/regions';
import { getRegionMap, getRegionRect, RASTER_SIZE } from './mapGeography';
import { STARTER_BASIN } from '../world/master/masterGeography';

const px = (m: ReturnType<typeof getRegionMap>, x: number, z: number) => {
  const N = m.raster.size, cell = (m.rect.maxX - m.rect.minX) / N;
  const i = Math.floor((-x - -m.rect.maxX) / cell), j = Math.floor((m.rect.maxZ - z) / cell);
  const k = (j * N + i) * 4;
  return [m.raster.rgba[k], m.raster.rgba[k + 1], m.raster.rgba[k + 2]] as const;
};

describe('cartographic model of The Field', () => {
  const m = getRegionMap('the_field');
  it('is cached and covers the playable world', () => {
    expect(getRegionMap('the_field')).toBe(m);
    expect(m.raster.rgba.length).toBe(RASTER_SIZE * RASTER_SIZE * 4);
    expect(m.rect.maxX).toBeGreaterThan(6600);
  });
  it('draws the lake in blue where the world puts it', () => {
    const [r, , b] = px(m, FIELD_LAKE.x, FIELD_LAKE.z);
    expect(b).toBeGreaterThan(r + 40);
  });
  it('keeps the river valley land, and the river polyline is the game river', () => {
    expect(m.rivers[0].length).toBe(FIELD_RIVER_POINTS.length);
    const [x, z] = [1900, -800]; // river control point: valley floor, not sea
    const [r, , b] = px(m, x + 400, z);
    expect(b).toBeLessThan(r + 40);
  });
  it('shows the northern chain as brighter/greyer relief than the home plain', () => {
    const home = px(m, 0, 0), ridge = px(m, 2500, ridgeZ(2500));
    expect(home[1]).toBeGreaterThan(home[0]); // plain is green-dominant
    expect(Math.abs(ridge[0] - ridge[1])).toBeLessThan(Math.abs(home[0] - home[1]) + 30); // rock is desaturated
    expect(ridge[0] + ridge[1] + ridge[2]).toBeGreaterThan(home[0] + home[1] + home[2] - 60);
  });
  it('carries roads (incl. the bridge), farm parcels and named places from the composition', () => {
    expect(m.roads.length).toBeGreaterThanOrEqual(10);
    expect(m.bridges).toHaveLength(1);
    expect(m.parcels.length).toBeGreaterThan(10);
    expect(m.pois.map((p) => p.name)).toEqual(expect.arrayContaining(['Aldea', 'Paso del norte', 'Zona industrial', 'Puente']));
  });
});

describe('data-driven regions', () => {
  it('builds a map for every region without special cases', () => {
    for (const r of REGIONS) {
      const map = getRegionMap(r.id);
      expect(map.rect.maxX).toBeGreaterThan(map.rect.minX);
      expect(getRegionRect(r.id)).toEqual(map.rect);
    }
  });
});

describe('continuous master chart', () => {
  it('carries every authored The Field vector layer at the same world offset as its terrain', async () => {
    const { MASTER_MAP_ID } = await import('./masterMapGeography');
    const master = getRegionMap(MASTER_MAP_ID), field = getRegionMap('the_field');
    const dx = STARTER_BASIN.worldOffsetM[0], dz = STARTER_BASIN.worldOffsetM[1];
    expect(master.roads).toHaveLength(field.roads.length);
    expect(master.bridges).toHaveLength(field.bridges.length);
    expect(master.parcels).toHaveLength(field.parcels.length);
    expect(master.pois).toHaveLength(field.pois.length);
    expect(master.roads[0].pts[0]).toEqual([field.roads[0].pts[0][0] + dx, field.roads[0].pts[0][1] + dz]);
    expect(master.parcels[0].center).toEqual([field.parcels[0].center[0] + dx, field.parcels[0].center[1] + dz]);
    expect(master.pois[0].x).toBe(field.pois[0].x + dx);
    expect(master.rect.minX).toBe(-36000);
    expect(master.rect.maxX).toBe(36000);
    expect(master.rect.minZ).toBe(-36000);
    expect(master.rect.maxZ).toBe(36000);
    const islandI = Math.floor((30_000 + 36_000) / 72_000 * master.raster.size);
    const islandJ = Math.floor((36_000 - 15_000) / 72_000 * master.raster.size);
    expect(master.raster.elevation[islandJ * master.raster.size + islandI]).toBeGreaterThan(0);
  }, 60_000);
});
