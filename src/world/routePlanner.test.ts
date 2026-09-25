import { describe, expect, it } from 'vitest';
import { ROUTE_EDGES, RouteGraph, findRoute, isRouteReachable } from './routePlanner';
import { campaignLocalToMaster } from './master/masterGeography';
import { getAirfield } from './airfields';

describe('ROUTE_EDGES', () => {
  it('every edge has a positive computed distance', () => {
    for (const edge of ROUTE_EDGES) {
      expect(edge.distanceM).toBeGreaterThan(0);
      expect(Number.isFinite(edge.distanceM)).toBe(true);
    }
  });

  it('derives inter-region edge length from continuous master-world coordinates', () => {
    const from = getAirfield('field_north_strip')!;
    const to = getAirfield('scrap_yard_strip')!;
    const [fx, fz] = campaignLocalToMaster(from.regionId, from.position[0], from.position[2]);
    const [tx, tz] = campaignLocalToMaster(to.regionId, to.position[0], to.position[2]);
    const expected = Math.hypot(tx - fx, tz - fz);
    const edge = ROUTE_EDGES.find((route) => route.fromId === from.id && route.toId === to.id)!;
    expect(edge.distanceM).toBeCloseTo(expected, 6);
    expect(edge.distanceM).toBeGreaterThan(1000);
  });
});

describe('RouteGraph', () => {
  it('finds a direct path between connected airfields', () => {
    const result = findRoute('field_home', 'field_north_strip');
    expect(result).not.toBeNull();
    expect(result?.path).toEqual(['field_home', 'field_north_strip']);
  });

  it('finds a multi-hop path across the graph', () => {
    const result = findRoute('field_home', 'red_canyon_mesa');
    expect(result).not.toBeNull();
    expect(result?.path[0]).toBe('field_home');
    expect(result?.path[result.path.length - 1]).toBe('red_canyon_mesa');
    expect(result?.path.length).toBeGreaterThan(2);
    expect(result?.totalDistanceM).toBeGreaterThan(0);
  });

  it('treats the graph as undirected', () => {
    const forward = findRoute('field_home', 'scrap_quarry_strip');
    const backward = findRoute('scrap_quarry_strip', 'field_home');
    expect(forward?.totalDistanceM).toBeCloseTo(backward?.totalDistanceM ?? -1);
  });

  it('returns a trivial path when from and to are the same airfield', () => {
    const result = findRoute('field_home', 'field_home');
    expect(result).toEqual({ path: ['field_home'], totalDistanceM: 0 });
  });

  it('returns null for an unreachable or unknown airfield', () => {
    expect(findRoute('field_home', 'nonexistent_airfield')).toBeNull();
  });

  it('isRouteReachable mirrors findRoute', () => {
    expect(isRouteReachable('field_home', 'coast_run_pier')).toBe(true);
    expect(isRouteReachable('field_home', 'nonexistent_airfield')).toBe(false);
  });

  it('reports no path across disconnected edge subsets', () => {
    const isolatedEdges = [{ fromId: 'field_home', toId: 'field_north_strip', distanceM: 620, difficulty: 0.1 }];
    const graph = new RouteGraph(isolatedEdges);
    expect(graph.isReachable('field_home', 'scrap_yard_strip')).toBe(false);
  });

  it('connects every authored campaign airfield to the home network', () => {
    const graph = new RouteGraph();
    for (const target of ['backcountry_lake_strip', 'industrial_cargo_yard', 'desert_salt_strip', 'range_summit_pad']) {
      expect(graph.isReachable('field_home', target), `route missing to ${target}`).toBe(true);
    }
  });
});
