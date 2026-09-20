import { describe, expect, it } from 'vitest';
import { getAirfield } from './airfields';
import { getRegion } from '../content/regions';
import { distanceToRiver, FIELD_LAKE, FIELD_RIVER_POINTS, fieldElevation, HOME_DATUM_M, PASS_X, ridgeZ, SEA_LEVEL_M } from './fieldGeography';
import { createTerrainQueryService } from './terrainQuery';

const terrain = createTerrainQueryService(getRegion('the_field'));

describe('The Field geography', () => {
  it('is deterministic and finite across the whole 16 km region', () => {
    for (let x = -8000; x <= 8000; x += 1000) {
      for (let z = -8000; z <= 8000; z += 1000) {
        const h = fieldElevation(x, z);
        expect(Number.isFinite(h)).toBe(true);
        expect(fieldElevation(x, z)).toBe(h);
        expect(Number.isFinite(terrain.getElevation(x, z))).toBe(true);
      }
    }
  });

  it('keeps the home strip near y=0 and grades both strips flat', () => {
    expect(terrain.getElevation(0, 0)).toBeCloseTo(HOME_DATUM_M, 0);
    for (const id of ['field_home', 'field_north_strip']) {
      const [x, , z] = getAirfield(id)!.position;
      const centre = terrain.getElevation(x, z);
      for (const [dx, dz] of [[0, 60], [10, -60], [-10, 0]]) expect(terrain.getElevation(x + dx, z + dz)).toBeCloseTo(centre, 6);
    }
  });

  it('eases from the graded pad into natural terrain without a step', () => {
    let prev = terrain.getElevation(150, 0);
    let maxStep = 0;
    for (let x = 151; x <= 400; x++) {
      const h = terrain.getElevation(x, 0);
      maxStep = Math.max(maxStep, Math.abs(h - prev));
      prev = h;
    }
    expect(maxStep).toBeLessThan(1); // metres per metre: < ~45 degrees everywhere
  });

  it('has a lake basin below the water surface, shore at the water level', () => {
    expect(fieldElevation(FIELD_LAKE.x, FIELD_LAKE.z)).toBeLessThan(FIELD_LAKE.waterLevelM - 10);
    expect(fieldElevation(FIELD_LAKE.x + FIELD_LAKE.radiusM, FIELD_LAKE.z)).toBeCloseTo(FIELD_LAKE.waterLevelM, 3);
    expect(terrain.getWaterDepth(FIELD_LAKE.x, FIELD_LAKE.z)).toBeGreaterThan(10);
    expect(terrain.getElevation(FIELD_LAKE.x, FIELD_LAKE.z)).toBeCloseTo(FIELD_LAKE.waterLevelM, 6);
  });

  it('has a northern range far above the home plain, cut by a clearly lower pass', () => {
    let ridge = -Infinity;
    for (let x = -5000; x <= 5000; x += 250) ridge = Math.max(ridge, fieldElevation(x, ridgeZ(x)));
    expect(ridge).toBeGreaterThan(450);
    const crest = (x: number) => fieldElevation(x, ridgeZ(x));
    const pass = Math.min(...[-200, -100, 0, 100, 200].map((d) => crest(PASS_X + d)));
    // Both shoulders stand well above the saddle: a notch you can spot from the plain.
    expect(crest(PASS_X + 1500)).toBeGreaterThan(pass + 200);
    expect(crest(PASS_X - 1500)).toBeGreaterThan(pass + 200);
    // ...and the saddle opens south into a broad, low, gently graded valley to the plain.
    for (const z of [1500, 2500, 3300]) expect(fieldElevation(PASS_X, z)).toBeLessThan(120);
  });

  it('carves a river valley below its surroundings, ending at the sea', () => {
    for (const i of [8, 20, 30, 40]) {
      const [x, z, floor] = FIELD_RIVER_POINTS[i];
      const bank = Math.max(fieldElevation(x + 700, z), fieldElevation(x - 700, z), fieldElevation(x, z + 700), fieldElevation(x, z - 700));
      if (floor > FIELD_LAKE.waterLevelM - 0.1 && Math.hypot(x - FIELD_LAKE.x, z - FIELD_LAKE.z) > 1600) expect(bank).toBeGreaterThan(fieldElevation(x, z) + 20);
    }
    const [mx, mz] = FIELD_RIVER_POINTS[FIELD_RIVER_POINTS.length - 1];
    expect(fieldElevation(mx, mz)).toBeLessThan(SEA_LEVEL_M);
    expect(fieldElevation(-8000, 0)).toBeLessThan(SEA_LEVEL_M - 10); // the map edge is sea, not a cut
    expect(fieldElevation(0, 8000)).toBeLessThan(SEA_LEVEL_M - 10);
  });

  it('keeps the river clear of both airstrips', () => {
    expect(distanceToRiver(0, 0)).toBeGreaterThan(300);
    expect(distanceToRiver(0, 620)).toBeGreaterThan(300);
  });
});
