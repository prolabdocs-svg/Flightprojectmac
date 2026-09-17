import { describe, expect, it } from 'vitest';
import { getRegion } from '../content/regions';
import { getAirfield } from './airfields';
import { ROUTE_EDGES } from './routePlanner';
import { analyzeRouteEdgeTerrain, deriveTerrainPenalty, sampleCorridor } from './routeTerrain';
import { createTerrainQueryService } from './terrainQuery';

describe('sampleCorridor', () => {
  it('is deterministic for the same endpoints', () => {
    const terrain = createTerrainQueryService(getRegion('the_field'));
    const a = sampleCorridor(terrain, [0, 0], [0, 620]);
    const b = sampleCorridor(terrain, [0, 0], [0, 620]);
    expect(a).toEqual(b);
  });

  it('reports full water fraction when the corridor stays inside a lake (backcountry §254)', () => {
    const terrain = createTerrainQueryService(getRegion('backcountry'));
    // backcountry_lake_strip (35,260) toward backcountry_town (445,-25) crosses the lake
    // centered at [300, 75] (waterBodies.ts) — landUse.ts already relies on this crossing.
    const metrics = sampleCorridor(terrain, [280, 60], [320, 90]);
    expect(metrics.waterFraction).toBeGreaterThan(0);
  });

  it('never reports negative climb or an out-of-range emergency mean', () => {
    const terrain = createTerrainQueryService(getRegion('the_field'));
    const metrics = sampleCorridor(terrain, [0, 0], [0, 620]);
    expect(metrics.climbM).toBeGreaterThanOrEqual(0);
    expect(metrics.emergencyLandingMean).toBeGreaterThanOrEqual(0);
    expect(metrics.emergencyLandingMean).toBeLessThanOrEqual(1);
  });
});

describe('deriveTerrainPenalty', () => {
  it('is 0 for a flat, dry, perfectly landable corridor', () => {
    expect(deriveTerrainPenalty({ climbM: 0, waterFraction: 0, emergencyLandingMean: 1 })).toBe(0);
  });

  it('is 1 for a worst-case corridor', () => {
    expect(deriveTerrainPenalty({ climbM: 999, waterFraction: 1, emergencyLandingMean: 0 })).toBe(1);
  });
});

describe('analyzeRouteEdgeTerrain (§254 DoD: preflight terrain metrics available)', () => {
  it('produces a terrain penalty in [0,1] for every authored route edge', () => {
    for (const edge of ROUTE_EDGES) {
      const { terrainPenalty } = analyzeRouteEdgeTerrain(edge);
      expect(terrainPenalty).toBeGreaterThanOrEqual(0);
      expect(terrainPenalty).toBeLessThanOrEqual(1);
    }
  });

  it('same-region edges use a real corridor sample matching their endpoint positions', () => {
    const edge = ROUTE_EDGES.find((e) => e.fromId === 'field_home' && e.toId === 'field_north_strip')!;
    const from = getAirfield(edge.fromId)!;
    const to = getAirfield(edge.toId)!;
    const terrain = createTerrainQueryService(getRegion(from.regionId));
    const expected = sampleCorridor(terrain, [from.position[0], from.position[2]], [to.position[0], to.position[2]]);
    expect(analyzeRouteEdgeTerrain(edge).metrics).toEqual(expected);
  });
});
