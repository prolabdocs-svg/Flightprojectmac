import { describe, expect, it } from 'vitest';
import { AIRFIELDS, getAirfield, getRegionAirfields } from '../world/airfields';
import { MISSIONS } from '../content/missions';
import { REGIONS } from '../content/regions';
import { estimatePerformance } from '../sim/performance';
import { createDefaultProfile } from '../save/save';
import { classifyRange, contractsForAirfield, flightTimeS, formatDistance, formatDuration, getMapTargets, getMasterAirRoutes, getMasterMapTargets, getOrigin, getRegionAirRoutes, missionAirfieldId, regionTerrain, routeTags, sampleRouteProfile, usableRangeKm } from './mapPlan';
import { distanceM, worldToScreen } from './mapProjection';
import { getRegionMap } from './mapGeography';

const home = getAirfield('field_home')!, north = getAirfield('field_north_strip')!;

describe('distance', () => {
  it('is computed from real airfield coordinates', () => {
    expect(distanceM(home.position[0], home.position[2], north.position[0], north.position[2])).toBe(620);
    const scrap = getRegionAirfields('scrap_valley');
    expect(distanceM(scrap[0].position[0], scrap[0].position[2], scrap[1].position[0], scrap[1].position[2])).toBe(520);
    expect(getRegionAirRoutes('scrap_valley')[0].distanceM).toBe(520);
  });
  it('formats short and long distances', () => {
    expect(formatDistance(620)).toBe('620 m');
    expect(formatDistance(460)).toBe('460 m');
    expect(formatDistance(4220)).toBe('4.22 km');
    expect(formatDistance(18200)).toBe('18.2 km');
    expect(formatDuration(24)).toBe('24 s');
    expect(formatDuration(162)).toBe('2:42 min');
  });
});

describe('airfields on the map', () => {
  it('puts every authored airfield on the master chart and connects them with a route tree', () => {
    const targets = getMasterMapTargets();
    expect(targets.map((t) => t.id).sort()).toEqual(AIRFIELDS.map((field) => field.id).sort());
    const routes = getMasterAirRoutes();
    expect(routes).toHaveLength(targets.length - 1);
    const connected = new Set([targets[0].id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const route of routes) {
        if (connected.has(route.fromId) && !connected.has(route.toId)) { connected.add(route.toId); changed = true; }
        if (connected.has(route.toId) && !connected.has(route.fromId)) { connected.add(route.fromId); changed = true; }
      }
    }
    expect(connected.size).toBe(targets.length);
    for (const target of targets) {
      const field = getMasterMapTargets().find((candidate) => candidate.id === target.id)!;
      expect(Number.isFinite(field.x) && Number.isFinite(field.z)).toBe(true);
      expect(field.airfield?.regionId).toBe(AIRFIELDS.find((candidate) => candidate.id === target.id)?.regionId);
    }
  }, 20_000);
  it('sit at their real relative positions: the north strip is straight north of home', () => {
    const view = { centerEast: 0, centerNorth: 300, scale: 0.2 }, size = { w: 900, h: 600 };
    const h = worldToScreen(view, size, home.position[0], home.position[2]), n = worldToScreen(view, size, north.position[0], north.position[2]);
    expect(n.sy).toBeLessThan(h.sy);
    expect(n.sx).toBeCloseTo(h.sx);
    expect(h.sy - n.sy).toBeCloseTo(620 * 0.2);
  });
  it('every region has a origin airfield inside its map extent', () => {
    for (const r of REGIONS) {
      const map = getRegionMap(r.id), origin = getOrigin(r.id);
      if (!origin) continue;
      expect(origin.position[0]).toBeGreaterThanOrEqual(map.rect.minX); expect(origin.position[0]).toBeLessThanOrEqual(map.rect.maxX);
      expect(origin.position[2]).toBeGreaterThanOrEqual(map.rect.minZ); expect(origin.position[2]).toBeLessThanOrEqual(map.rect.maxZ);
    }
  });
  it('the map shows every airfield of the region, hidden ones stay "?" unless a contract points at them', () => {
    const t = getMapTargets('the_field').filter((x) => x.kind === 'airfield');
    expect(t.map((x) => x.id).sort()).toEqual(['field_east_meadow', 'field_far_ridge', 'field_home', 'field_north_strip', 'field_ridge_hollow']);
    expect(t.find((x) => x.id === 'field_north_strip')!.revealed).toBe(true); // precision contract targets it
    const coast = getMapTargets('coast_run').find((x) => x.id === 'coast_run_pier')!;
    expect(coast.airfield!.discoveryState).toBe('rumored');
  });
});

describe('range', () => {
  const perf = estimatePerformance(createDefaultProfile().currentBuild);
  it('comes from the current aircraft performance with a reserve', () => {
    expect(perf.rangeKm).toBeGreaterThan(0);
    expect(usableRangeKm(perf.rangeKm)).toBeLessThan(perf.rangeKm);
  });
  it('classifies comfortable / marginal / insufficient', () => {
    expect(classifyRange(18.2, 24)).toBe('comfortable');
    expect(classifyRange(20, 24)).toBe('marginal');
    expect(classifyRange(43, 36)).toBe('insufficient');
    expect(classifyRange(1, 0)).toBe('insufficient');
  });
  it('A0 reaches its neighbour strip comfortably but not the northern pass', () => {
    const usable = usableRangeKm(perf.rangeKm);
    expect(classifyRange(0.62, usable)).toBe('comfortable');
    const pass = getMapTargets('the_field').find((t) => t.id === 'poi_northPass')!;
    expect(classifyRange(distanceM(0, 0, pass.x, pass.z) / 1000, usable)).toBe('insufficient');
  });
  it('flight time uses cruise speed', () => {
    expect(flightTimeS(1000, 36)).toBeCloseTo(100);
  });
});

describe('contracts by destination', () => {
  it('attaches every mission to exactly one airfield of its region', () => {
    for (const m of MISSIONS) {
      const id = missionAirfieldId(m);
      expect(id, m.id).toBeDefined();
      expect(getAirfield(id!)?.regionId, m.id).toBe(m.regionId);
    }
  });
  it('The Field: distance run + STOL belong to home, the barn landing to the north strip', () => {
    expect(contractsForAirfield('the_field', 'field_home').map((m) => m.id)).toEqual(['field_distance_01', 'field_stol_01']);
    expect(contractsForAirfield('the_field', 'field_north_strip').map((m) => m.id)).toEqual(['field_precision_01']);
  });
  it('no contract is dropped: union over airfields == all missions', () => {
    const all = AIRFIELDS.flatMap((a) => contractsForAirfield(a.regionId, a.id));
    expect(all.length).toBe(MISSIONS.length);
  });
});

describe('route terrain profile', () => {
  const terrain = regionTerrain('the_field');
  it('samples the same elevations as terrainQuery, start to end', () => {
    const p = sampleRouteProfile(terrain, [0, 0], [0, 620], 32);
    expect(p.elevM).toHaveLength(32);
    expect(p.distM[0]).toBe(0);
    expect(p.distM[31]).toBeCloseTo(620);
    expect(p.elevM[0]).toBeCloseTo(terrain.getElevation(0, 0));
    expect(p.elevM[31]).toBeCloseTo(terrain.getElevation(0, 620));
    expect(p.maxM).toBeGreaterThanOrEqual(p.minM);
  });
  it('tags a flat hop as plain + short grass strip, and the pass route as mountainous or hilly', () => {
    const t = getMapTargets('the_field');
    const strip = t.find((x) => x.id === 'field_north_strip')!;
    const tags = routeTags(sampleRouteProfile(terrain, [0, 0], [strip.x, strip.z]), strip, terrain);
    expect(tags).toContain('PISTA CORTA'); expect(tags).toContain('CÉSPED');
    const pass = t.find((x) => x.id === 'poi_northPass')!;
    expect(routeTags(sampleRouteProfile(terrain, [0, 0], [pass.x, pass.z]), pass, terrain)).toContain('PASO DE MONTAÑA');
  });
  it('reports water under the route when it crosses the lake', () => {
    const p = sampleRouteProfile(terrain, [1800, 1900], [3200, 1900]);
    expect(p.wet.some(Boolean)).toBe(true);
  });
});
