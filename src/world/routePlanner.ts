import { AIRFIELDS, getAirfield } from './airfields';

export interface RouteEdge {
  fromId: string;
  toId: string;
  distanceM: number;
  /** 0 (easy hop) to 1 (very demanding: crosswind, terrain, short field). */
  difficulty: number;
}

function distanceBetween(aId: string, bId: string): number {
  const a = getAirfield(aId);
  const b = getAirfield(bId);
  if (!a || !b) return Infinity;
  const [ax, ay, az] = a.position;
  const [bx, by, bz] = b.position;
  return Math.hypot(bx - ax, by - ay, bz - az);
}

/** Hand-authored connections between airfields (GDD world-graph foundation). Edges are
 * undirected — both directions are exposed by the graph helpers below. Distances are
 * derived from airfield positions so edge data never drifts from the world layout. */
const ROUTE_LINKS: Array<{ fromId: string; toId: string; difficulty: number }> = [
  { fromId: 'field_home', toId: 'field_north_strip', difficulty: 0.1 },
  { fromId: 'field_north_strip', toId: 'scrap_yard_strip', difficulty: 0.35 },
  { fromId: 'scrap_yard_strip', toId: 'scrap_quarry_strip', difficulty: 0.3 },
  { fromId: 'scrap_quarry_strip', toId: 'red_canyon_mesa', difficulty: 0.5 },
  { fromId: 'red_canyon_mesa', toId: 'backcountry_lake_strip', difficulty: 0.52 },
  { fromId: 'backcountry_lake_strip', toId: 'coast_run_pier', difficulty: 0.58 },
  { fromId: 'coast_run_pier', toId: 'industrial_cargo_yard', difficulty: 0.62 },
  { fromId: 'industrial_cargo_yard', toId: 'desert_salt_strip', difficulty: 0.68 },
  { fromId: 'desert_salt_strip', toId: 'range_summit_pad', difficulty: 0.8 },
];

export const ROUTE_EDGES: RouteEdge[] = ROUTE_LINKS.map((link) => ({
  ...link,
  distanceM: distanceBetween(link.fromId, link.toId),
}));

/** Adjacency graph over airfield ids, built once from ROUTE_EDGES. Undirected: each
 * edge contributes an entry to both endpoints' neighbor lists. */
export class RouteGraph {
  private readonly adjacency = new Map<string, RouteEdge[]>();

  constructor(edges: RouteEdge[] = ROUTE_EDGES) {
    for (const airfield of AIRFIELDS) this.adjacency.set(airfield.id, []);
    for (const edge of edges) {
      this.addDirected(edge.fromId, edge);
      this.addDirected(edge.toId, { ...edge, fromId: edge.toId, toId: edge.fromId });
    }
  }

  private addDirected(fromId: string, edge: RouteEdge) {
    if (!this.adjacency.has(fromId)) this.adjacency.set(fromId, []);
    this.adjacency.get(fromId)!.push(edge);
  }

  neighbors(airfieldId: string): RouteEdge[] {
    return this.adjacency.get(airfieldId) ?? [];
  }

  /** Dijkstra shortest path by distance. Returns null if unreachable or either id is
   * unknown to the graph. */
  findPath(fromId: string, targetId: string): { path: string[]; totalDistanceM: number } | null {
    if (!this.adjacency.has(fromId) || !this.adjacency.has(targetId)) return null;
    if (fromId === targetId) return { path: [fromId], totalDistanceM: 0 };

    const dist = new Map<string, number>([[fromId, 0]]);
    const prev = new Map<string, string>();
    const visited = new Set<string>();
    const unvisited = new Set(this.adjacency.keys());

    while (unvisited.size > 0) {
      let current: string | null = null;
      let currentDist = Infinity;
      for (const id of unvisited) {
        const d = dist.get(id) ?? Infinity;
        if (d < currentDist) {
          currentDist = d;
          current = id;
        }
      }
      if (current === null || currentDist === Infinity) break;
      unvisited.delete(current);
      visited.add(current);
      if (current === targetId) break;

      for (const edge of this.neighbors(current)) {
        if (visited.has(edge.toId)) continue;
        const candidate = currentDist + edge.distanceM;
        if (candidate < (dist.get(edge.toId) ?? Infinity)) {
          dist.set(edge.toId, candidate);
          prev.set(edge.toId, current);
        }
      }
    }

    if (!dist.has(targetId) || dist.get(targetId) === Infinity) return null;

    const path: string[] = [targetId];
    let cursor = targetId;
    while (cursor !== fromId) {
      const previous = prev.get(cursor);
      if (!previous) return null;
      path.unshift(previous);
      cursor = previous;
    }
    return { path, totalDistanceM: dist.get(targetId) ?? Infinity };
  }

  isReachable(fromId: string, toId: string): boolean {
    return this.findPath(fromId, toId) !== null;
  }
}

/** Pure convenience wrapper over the default route graph. */
export function findRoute(fromId: string, toId: string, edges: RouteEdge[] = ROUTE_EDGES) {
  return new RouteGraph(edges).findPath(fromId, toId);
}

export function isRouteReachable(fromId: string, toId: string, edges: RouteEdge[] = ROUTE_EDGES) {
  return new RouteGraph(edges).isReachable(fromId, toId);
}
