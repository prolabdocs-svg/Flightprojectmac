import { ROADS, WORLD_ANCHORS, type Anchor, type RoadDef, type Vec2 } from './fieldComposition';
import type { TerrainGridSampler } from './terrainHeightfield';

/** Pure road geometry for The Field: Catmull-Rom the authored control points, drape them on
 * the rendered terrain, and emit ribbon vertex/index data. No Three.js here, so routing,
 * slope and water rules are unit-testable. */

export interface RoadPoint {
  x: number;
  z: number;
  /** Ground height under the centreline (rendered terrain). */
  groundY: number;
  /** Height the road surface is drawn at (== groundY except on the bridge and its ramps). */
  y: number;
  /** Distance travelled along the road (m). */
  s: number;
  /** Unit tangent in XZ. */
  tx: number;
  tz: number;
  onBridge: boolean;
}

export interface RoadPath {
  def: RoadDef;
  points: RoadPoint[];
  lengthM: number;
}

export const ROAD_STEP_M = 8;
/** How far above the terrain (rendered surface) each road class is drawn; higher classes win overlaps. */
export const roadLiftM = (def: RoadDef): number => 0.22 + def.priority * 0.03;
export const BRIDGE_RAMP_M = 36;
export const BRIDGE_CLEARANCE_M = 2.2;

export function catmullRom(pts: ReadonlyArray<Vec2>, stepM: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const at = (i: number) => pts[Math.min(pts.length - 1, Math.max(0, i))];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const segLen = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const k = Math.max(1, Math.ceil(segLen / stepM));
    for (let j = 0; j < k; j++) {
      const t = j / k, t2 = t * t, t3 = t2 * t;
      const cr = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([cr(p0[0], p1[0], p2[0], p3[0]), cr(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  const last = pts[pts.length - 1];
  out.push([last[0], last[1]]);
  return out;
}

export function buildRoadPath(def: RoadDef, terrain: TerrainGridSampler, anchors: Record<string, Anchor> = WORLD_ANCHORS): RoadPath {
  const raw = catmullRom(def.points, ROAD_STEP_M);
  const points: RoadPoint[] = [];
  let s = 0;
  raw.forEach(([x, z], i) => {
    if (i > 0) s += Math.hypot(x - raw[i - 1][0], z - raw[i - 1][1]);
    const a = raw[Math.max(0, i - 1)], b = raw[Math.min(raw.length - 1, i + 1)];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const groundY = terrain.height(x, z);
    points.push({ x, z, groundY, y: groundY, s, tx: (b[0] - a[0]) / len, tz: (b[1] - a[1]) / len, onBridge: false });
  });

  if (def.bridge) {
    const anchor = anchors[def.bridge.anchor];
    const half = def.bridge.halfSpanM;
    let center = 0, best = Infinity;
    points.forEach((p, i) => { const d = Math.hypot(p.x - anchor.x, p.z - anchor.z); if (d < best) { best = d; center = i; } });
    const sc = points[center].s;
    const inRamp = points.filter((p) => Math.abs(p.s - sc) <= half + BRIDGE_RAMP_M);
    const bankHeight = Math.max(...points.filter((p) => Math.abs(Math.abs(p.s - sc) - half) < ROAD_STEP_M).map((p) => p.groundY));
    const deck = Math.max(bankHeight, ...inRamp.filter((p) => Math.abs(p.s - sc) <= half).map((p) => p.groundY)) + BRIDGE_CLEARANCE_M;
    for (const p of inRamp) {
      const d = Math.abs(p.s - sc);
      if (d <= half) { p.y = deck; p.onBridge = true; } else p.y = p.groundY + (deck - p.groundY) * (1 - (d - half) / BRIDGE_RAMP_M);
    }
  }
  return { def, points, lengthM: s };
}

export interface RoadRibbon {
  positions: number[];
  uvs: number[];
  index: number[];
}

/** Ribbon of `def.widthM`: each edge vertex is draped on the terrain (rendered mesh height)
 * so the road follows side-slopes; on the bridge both edges share the deck height. */
export function buildRoadRibbon(path: RoadPath, terrain: TerrainGridSampler, tileLengthM = 12): RoadRibbon {
  const { def, points } = path;
  const lift = roadLiftM(def), hw = def.widthM / 2;
  const positions: number[] = [], uvs: number[] = [], index: number[] = [];
  points.forEach((p, i) => {
    const nx = -p.tz, nz = p.tx;
    for (const side of [-1, 1] as const) {
      const x = p.x + nx * hw * side, z = p.z + nz * hw * side;
      const onDeck = p.y !== p.groundY;
      const y = onDeck ? p.y + lift : Math.max(terrain.height(x, z), p.groundY - 0.4) + lift;
      positions.push(x, y, z);
      uvs.push(side < 0 ? 0 : 1, p.s / tileLengthM);
    }
    if (i > 0) { const a = (i - 1) * 2, b = i * 2; index.push(a, a + 1, b, a + 1, b + 1, b); }
  });
  return { positions, uvs, index };
}

/** Distance from (x,z) to the nearest road centreline sample (spatial hash over path points). */
export function createRoadDistance(paths: ReadonlyArray<RoadPath>, cellM = 64): (x: number, z: number) => number {
  const grid = new Map<string, Array<[number, number]>>();
  const key = (cx: number, cz: number) => `${cx},${cz}`;
  for (const path of paths) for (const p of path.points) {
    const k = key(Math.floor(p.x / cellM), Math.floor(p.z / cellM));
    (grid.get(k) ?? grid.set(k, []).get(k)!).push([p.x, p.z]);
  }
  return (x, z) => {
    const cx = Math.floor(x / cellM), cz = Math.floor(z / cellM);
    let best = Infinity;
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      const cell = grid.get(key(cx + dx, cz + dz));
      if (cell) for (const [px, pz] of cell) best = Math.min(best, Math.hypot(x - px, z - pz));
    }
    return best;
  };
}

export const allRoadPaths = (terrain: TerrainGridSampler, roads: ReadonlyArray<RoadDef> = ROADS, anchors: Record<string, Anchor> = WORLD_ANCHORS): RoadPath[] => roads.map((def) => buildRoadPath(def, terrain, anchors));
