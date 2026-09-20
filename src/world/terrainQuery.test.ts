import { describe, expect, it } from 'vitest';
import { REGIONS, THE_FIELD, getRegion } from '../content/regions';
import { AIRFIELDS, getAirfield } from './airfields';
import { createTerrainQueryService, NATURAL_ELEVATION_PROFILES } from './terrainQuery';

/** Samples a profile on a coarse grid to characterize its relief range/roughness. */
function sampleGrid(profile: (x: number, y: number) => number, extent = 1200, step = 40): number[] {
  const values: number[] = [];
  for (let x = -extent; x <= extent; x += step) {
    for (let y = -extent; y <= extent; y += step) {
      values.push(profile(x, y));
    }
  }
  return values;
}

function rangeOf(values: number[]): number {
  return Math.max(...values) - Math.min(...values);
}

describe('createTerrainQueryService', () => {
  it('is flat across an airfield graded pad (two different points, same elevation)', () => {
    const terrain = createTerrainQueryService(THE_FIELD);
    expect(terrain.getElevation(30, 40)).toBe(terrain.getElevation(-50, -100));
  });

  it('grades every airfield in a region, not just the first one', () => {
    // Before WLD-02, only one hand-placed flat disc existed per world, so a second
    // airfield in the same region (field_north_strip, z=620) sat on raw undulating noise.
    const terrain = createTerrainQueryService(THE_FIELD);
    const northStrip = getAirfield('field_north_strip')!;
    const [x, , z] = northStrip.position;
    expect(terrain.getElevation(x + 20, z)).toBe(terrain.getElevation(x - 20, z));
    expect(terrain.isOnGradedRunway(x, z)).toBe(true);
  });

  it('every airfield sits on its own graded pad', () => {
    for (const airfield of AIRFIELDS) {
      const terrain = createTerrainQueryService(getRegion(airfield.regionId));
      const [x, , z] = airfield.position;
      expect(terrain.isOnGradedRunway(x, z)).toBe(true);
      expect(terrain.getSurfaceId(x, z)).toBe(airfield.surface);
    }
  });

  it('produces non-trivial relief away from the runway pad', () => {
    const terrain = createTerrainQueryService(THE_FIELD);
    const elevation = terrain.getElevation(1200, 900);
    expect(elevation).not.toBe(0);
    expect(Number.isFinite(elevation)).toBe(true);
  });

  it('is deterministic: same inputs always produce the same outputs', () => {
    const terrainA = createTerrainQueryService(THE_FIELD);
    const terrainB = createTerrainQueryService(THE_FIELD);
    for (const [x, z] of [[100, 200], [-450, 30], [1800, -900]] as const) {
      expect(terrainA.getElevation(x, z)).toBe(terrainB.getElevation(x, z));
      expect(terrainA.getSlopeDeg(x, z)).toBe(terrainB.getSlopeDeg(x, z));
    }
  });

  it('scales relief by terrain roughness (quarry rougher than open terrain)', () => {
    const quarryRegion = getRegion('scrap_valley');
    const terrain = createTerrainQueryService(THE_FIELD);
    const quarryTerrain = createTerrainQueryService(quarryRegion);
    expect(quarryRegion.environment.terrain).toBe('quarry');
    const flatElevation = Math.abs(terrain.getElevation(1200, 900));
    const quarryElevation = Math.abs(quarryTerrain.getElevation(1200, 900));
    expect(quarryElevation).toBeGreaterThan(flatElevation);
  });

  it('reports ~0 degrees slope on the flat runway pad', () => {
    const terrain = createTerrainQueryService(THE_FIELD);
    expect(terrain.getSlopeDeg(0, 0)).toBeCloseTo(0, 5);
  });

  it('reports a positive, finite slope on sloped terrain', () => {
    const terrain = createTerrainQueryService(THE_FIELD);
    const slope = terrain.getSlopeDeg(1200, 900);
    expect(slope).toBeGreaterThan(0);
    expect(Number.isFinite(slope)).toBe(true);
  });

  it('is repeatable across many calls with the same coordinates (no hidden randomness)', () => {
    const terrain = createTerrainQueryService(THE_FIELD);
    const first = terrain.getElevation(777, -333);
    for (let i = 0; i < 25; i++) {
      expect(terrain.getElevation(777, -333)).toBe(first);
    }
  });

  it('derives surface/biome from region terrain type (meadow -> grass)', () => {
    const terrain = createTerrainQueryService(THE_FIELD);
    expect(terrain.getSurfaceId(0, 0)).toBe('grass');
  });

  it('derives a different surface for a different region terrain type (quarry -> rock)', () => {
    const quarryTerrain = createTerrainQueryService(getRegion('scrap_valley'));
    expect(quarryTerrain.getSurfaceId(0, 0)).toBe('rock');
  });

  it('reports 0 depth for regions with no water body', () => {
    const terrain = createTerrainQueryService(THE_FIELD);
    expect(terrain.getWaterDepth(1200, 900)).toBe(0);
    expect(terrain.getWaterDepth(300, 300)).toBe(0);
  });

  it('reports 0 depth well outside any water body', () => {
    const terrain = createTerrainQueryService(getRegion('backcountry'));
    expect(terrain.getWaterDepth(-5000, -5000)).toBe(0);
  });

  it('reports depth > 0 inside the lake footprint where terrain dips below the surface', () => {
    const terrain = createTerrainQueryService(getRegion('backcountry'));
    expect(terrain.getWaterDepth(300, 145)).toBeGreaterThan(0);
  });

  it('is deterministic across repeated water-depth calls', () => {
    const terrain = createTerrainQueryService(getRegion('coast_run'));
    const first = terrain.getWaterDepth(300, 75);
    for (let i = 0; i < 10; i++) {
      expect(terrain.getWaterDepth(300, 75)).toBe(first);
    }
  });

  it('sample() bundles elevation/slope/surface/biome/emergency-landing consistently', () => {
    const terrain = createTerrainQueryService(THE_FIELD);
    const sample = terrain.sample(1200, 900);
    expect(sample.elevationM).toBe(terrain.getElevation(1200, 900));
    expect(sample.slopeDeg).toBe(terrain.getSlopeDeg(1200, 900));
    expect(sample.surfaceId).toBe('grass');
    // WLD-04: dominantBiomeId is now derived from the blend, not a flat per-region lookup,
    // so it can legitimately drift from the region's anchor biome at a given point.
    expect(sample.dominantBiomeId).toBe(
      Object.entries(sample.biomeWeights).sort((a, b) => b[1] - a[1])[0][0],
    );
    expect(sample.waterDepthM).toBe(0);
    expect(sample.emergencyLandingSuitability).toBeGreaterThanOrEqual(0);
    expect(sample.emergencyLandingSuitability).toBeLessThanOrEqual(1);
  });

  it('scores the flat runway pad as an excellent emergency landing site', () => {
    const terrain = createTerrainQueryService(THE_FIELD);
    expect(terrain.sample(0, 0).emergencyLandingSuitability).toBeGreaterThan(0.8);
  });

  it('scores steep terrain as a worse emergency landing site than the flat pad', () => {
    const terrain = createTerrainQueryService(THE_FIELD);
    const flat = terrain.sample(0, 0).emergencyLandingSuitability;
    const rough = terrain.sample(1200, 900).emergencyLandingSuitability;
    expect(rough).toBeLessThan(flat);
  });

  it('sample().biomeWeights sums to ~1 and dominantBiomeId is the highest-weight key', () => {
    const terrain = createTerrainQueryService(THE_FIELD);
    const sample = terrain.sample(1200, 900);
    const total = Object.values(sample.biomeWeights).reduce((sum, w) => sum + w, 0);
    expect(total).toBeCloseTo(1, 5);
    const highest = Object.entries(sample.biomeWeights).sort((a, b) => b[1] - a[1])[0][0];
    expect(sample.dominantBiomeId).toBe(highest);
  });

  it('getBiomeWeights matches sample().biomeWeights (computed once, not twice)', () => {
    const terrain = createTerrainQueryService(THE_FIELD);
    expect(terrain.getBiomeWeights(1200, 900)).toEqual(terrain.sample(1200, 900).biomeWeights);
  });

  it('biome weights near a water body differ from weights far from it', () => {
    const terrain = createTerrainQueryService(getRegion('backcountry'));
    const near = terrain.getBiomeWeights(300, 145); // near the backcountry lake edge
    const far = terrain.getBiomeWeights(-5000, -5000);
    expect(near).not.toEqual(far);
  });
});

describe('per-terrain-type geography (NATURAL_ELEVATION_PROFILES)', () => {
  it('every terrain type has a distinct profile (no two produce identical grids)', () => {
    const grids = Object.entries(NATURAL_ELEVATION_PROFILES).map(
      ([terrain, profile]) => [terrain, sampleGrid(profile)] as const,
    );
    for (let i = 0; i < grids.length; i++) {
      for (let j = i + 1; j < grids.length; j++) {
        expect(grids[i][1], `${grids[i][0]} vs ${grids[j][0]}`).not.toEqual(grids[j][1]);
      }
    }
  });

  it('meadow has a smaller relief range than canyon and range', () => {
    // The Field's authored geography (mountains, eastern hills) starts beyond its home plain,
    // so compare relief over the playable home area only.
    const meadowRange = rangeOf(sampleGrid(NATURAL_ELEVATION_PROFILES.meadow, 600));
    const canyonRange = rangeOf(sampleGrid(NATURAL_ELEVATION_PROFILES.canyon));
    const rangeRange = rangeOf(sampleGrid(NATURAL_ELEVATION_PROFILES.range));
    expect(meadowRange).toBeLessThan(canyonRange);
    expect(meadowRange).toBeLessThan(rangeRange);
  });

  it('meadow has a gentler average slope than canyon and range', () => {
    const terrain = createTerrainQueryService(THE_FIELD);
    const canyonTerrain = createTerrainQueryService(getRegion('red_canyon'));
    const rangeTerrain = createTerrainQueryService(getRegion('the_range'));
    const points: Array<[number, number]> = [];
    // Home area only: The Field's authored hills/mountains start beyond the hub plain.
    for (let x = -600; x <= 600; x += 80) {
      for (let z = -600; z <= 600; z += 80) points.push([x, z]);
    }
    const avg = (svc: ReturnType<typeof createTerrainQueryService>) =>
      points.reduce((sum, [x, z]) => sum + svc.getSlopeDeg(x, z), 0) / points.length;
    expect(avg(terrain)).toBeLessThan(avg(canyonTerrain));
    expect(avg(terrain)).toBeLessThan(avg(rangeTerrain));
  });

  it('coast has a directional gradient toward the sea (not symmetric noise)', () => {
    const coast = NATURAL_ELEVATION_PROFILES.coast;
    // Local plane y maps to -worldZ; Coast Run opens out to sea in +worldZ,
    // therefore increasingly negative local y must descend.
    const near = coast(0, 0);
    const mid = coast(0, -400);
    const far = coast(0, -1200);
    expect(near).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(far);
  });

  it('quarry has at least one hard bench/step (a jump much larger than the local roughness)', () => {
    const quarry = NATURAL_ELEVATION_PROFILES.quarry;
    const diffs: number[] = [];
    for (let x = 0; x < 600; x += 2) {
      diffs.push(Math.abs(quarry(x + 2, 900) - quarry(x, 900)));
    }
    const sorted = [...diffs].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    expect(Math.max(...diffs)).toBeGreaterThan(median * 3);
  });

  it('desert has wide (low-frequency) undulation: adjacent samples barely change', () => {
    const desert = NATURAL_ELEVATION_PROFILES.desert;
    const quarry = NATURAL_ELEVATION_PROFILES.quarry;
    const step = 5;
    const desertDelta = Math.abs(desert(500 + step, 500) - desert(500, 500));
    const quarryDelta = Math.abs(quarry(500 + step, 500) - quarry(500, 500));
    expect(desertDelta).toBeLessThan(quarryDelta);
  });

  it('every airfield in every region still sits on a perfectly flat graded pad', () => {
    for (const region of REGIONS) {
      const terrain = createTerrainQueryService(region);
      const regionAirfields = AIRFIELDS.filter((a) => a.regionId === region.id);
      for (const airfield of regionAirfields) {
        const [x, , z] = airfield.position;
        expect(terrain.getSlopeDeg(x, z)).toBeCloseTo(0, 5);
        expect(terrain.getElevation(x + 15, z)).toBe(terrain.getElevation(x - 15, z));
      }
    }
  });
});
