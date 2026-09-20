import { describe, expect, it } from 'vitest';
import { getRegion } from '../content/regions';
import { createWorld, initPhysics } from '../sim/physics';
import { getAirfield } from './airfields';
import { FIELD_LAKE, PASS_X, ridgeZ } from './fieldGeography';
import { buildHeightGrid, createHeightfieldCollider, FIELD_TERRAIN_SEGMENTS, FIELD_TERRAIN_SIZE_M } from './terrainHeightfield';
import { createTerrainQueryService } from './terrainQuery';

/** Named sites. Tolerance is grid-interpolation error of a 62.5 m cell over the local
 * curvature, so smooth ground must be tight and only crests/creases get slack. */
const SITES: Array<{ name: string; x: number; z: number; tolM: number }> = [
  { name: 'home runway centre', x: 0, z: 0, tolM: 0.01 },
  { name: 'home runway south end', x: 0, z: -105, tolM: 0.01 },
  { name: 'home runway north end', x: 0, z: 105, tolM: 0.01 },
  { name: 'home runway edge', x: 13, z: 40, tolM: 0.01 },
  { name: 'home plain', x: 700, z: -500, tolM: 0.6 },
  { name: 'rolling hills', x: -3400, z: 1200, tolM: 2.5 },
  { name: 'mountain slope', x: -1100, z: 3100, tolM: 4 },
  { name: 'ridge crest', x: 1500, z: ridgeZ(1500), tolM: 4 },
  { name: 'mountain pass', x: PASS_X, z: 4100, tolM: 3 },
  { name: 'lake shore', x: FIELD_LAKE.x + FIELD_LAKE.radiusM, z: FIELD_LAKE.z, tolM: 1.5 },
  { name: 'lake bed', x: FIELD_LAKE.x, z: FIELD_LAKE.z, tolM: 0.5 },
  { name: 'river valley', x: 1000, z: -2300, tolM: 2 },
  { name: 'second strip centre', x: 0, z: 620, tolM: 0.01 },
  { name: 'second strip end', x: 0, z: 700, tolM: 0.01 },
];

describe('Rapier heightfield is the terrainQuery surface', () => {
  it('vertical raycasts match getElevation at named sites, and exactly at grid nodes', async () => {
    const RAPIER = await initPhysics();
    const world = createWorld();
    const terrain = createTerrainQueryService(getRegion('the_field'));
    createHeightfieldCollider(RAPIER, world, buildHeightGrid(terrain.getElevation));
    world.step();
    const cast = (x: number, z: number) => 2000 - world.castRay(new RAPIER.Ray({ x, y: 2000, z }, { x: 0, y: -1, z: 0 }), 4000, true)!.timeOfImpact;

    const errors: string[] = [];
    for (const s of SITES) {
      const err = Math.abs(cast(s.x, s.z) - terrain.getElevation(s.x, s.z));
      errors.push(`${s.name}: ${err.toFixed(3)} m`);
      expect(err, `${s.name} (${s.x},${s.z})`).toBeLessThan(s.tolM);
    }
    console.log(errors.join('\n'));
    // Whole-map statistics: interpolation error stays small away from crests.
    const errs: number[] = [];
    for (let i = 0; i < 1500; i++) {
      const x = -7500 + ((i * 7919) % 15000) + 0.37, z = -7500 + ((i * 104729) % 15000) + 0.61;
      errs.push(Math.abs(cast(x, z) - terrain.getElevation(x, z)));
    }
    errs.sort((a, b) => a - b);
    console.log(`map-wide error: p50 ${errs[750].toFixed(2)} p95 ${errs[1425].toFixed(2)} max ${errs[1499].toFixed(2)} m`);
    expect(errs[1425]).toBeLessThan(2);
    expect(errs[1499]).toBeLessThan(10); // sharpest crest corner of the whole map
    // Grid nodes (x != z, asymmetric) catch any row/column mix-up or offset: float32 exact.
    for (const [x, z] of [[0, 0], [-1500, 3500], [2500, 1875], [-5000, 5000], [-4000, -3000], [125, 625]]) {
      const n = (v: number) => Math.round(v / 62.5) * 62.5;
      expect(cast(n(x), n(z))).toBeCloseTo(terrain.getElevation(n(x), n(z)), 2);
    }
  });

  it('rendered/collision grid is flat under both strips (ends, sides, one cell of margin)', () => {
    const terrain = createTerrainQueryService(getRegion('the_field'));
    const grid = buildHeightGrid(terrain.getElevation);
    const cell = FIELD_TERRAIN_SIZE_M / FIELD_TERRAIN_SEGMENTS, n = FIELD_TERRAIN_SEGMENTS + 1;
    for (const id of ['field_home', 'field_north_strip']) {
      const a = getAirfield(id)!;
      const [cx, , cz] = a.position;
      const graded = terrain.getElevation(cx, cz);
      let worst = 0, nodes = 0;
      for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) {
        const x = -FIELD_TERRAIN_SIZE_M / 2 + ix * cell, z = -FIELD_TERRAIN_SIZE_M / 2 + iz * cell;
        if (Math.abs(x - cx) > a.runwayWidthM / 2 + cell || Math.abs(z - cz) > a.runwayLengthM / 2 + cell) continue;
        worst = Math.max(worst, Math.abs(grid[iz * n + ix] - graded));
        nodes++;
      }
      expect(nodes).toBeGreaterThan(6);
      expect(worst, `${id} grid deviation`).toBeLessThan(0.5);
    }
  });
});
