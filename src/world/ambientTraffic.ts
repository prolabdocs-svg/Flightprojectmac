import { createSeededRandom } from '../core/seededRandom';
import type { RoadDef, RoadSurface } from './fieldComposition';
import { createRoadDistance, type RoadPath, type RoadPoint } from './fieldRoads';
import type { RegionLayout } from './regionPlacement';

/** Deterministic, presentation-only traffic routes. They are deliberately separate
 * from physics: distant aircraft make free flight feel inhabited without creating
 * unpredictable collision hazards or consuming the player's simulation budget. */
export interface AmbientTrafficPose {
  x: number;
  y: number;
  z: number;
  headingRad: number;
}

function regionPhase(regionId: string): number {
  let hash = 2166136261;
  for (let i = 0; i < regionId.length; i++) {
    hash ^= regionId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 628) / 100;
}

export function getAmbientTrafficPose(regionId: string, routeIndex: number, elapsedS: number): AmbientTrafficPose {
  const radius = 360 + routeIndex * 170;
  const angle = regionPhase(regionId) + routeIndex * 1.9 + elapsedS * (0.035 + routeIndex * 0.006);
  const x = Math.cos(angle) * radius;
  const z = 260 + Math.sin(angle) * radius * 0.58;
  // Tangent heading: Three's local +Z faces the direction of travel.
  const headingRad = Math.atan2(-Math.sin(angle), Math.cos(angle) * 0.58);
  return { x, y: 72 + routeIndex * 36 + Math.sin(angle * 2.3) * 12, z, headingRad };
}

// ---------------------------------------------------------------------------------------
// Ground NPCs: road vehicles, a shuttle train, boats and bird flocks. Same contract as the
// aircraft above — pure functions of time, presentation only, never colliders.
// ---------------------------------------------------------------------------------------

/** Distance along a span for an out-and-back shuttle: accelerate, cruise, brake, dwell,
 * return. `dir` is the direction of travel (or of the leg just finished while dwelling). */
export function shuttleDistance(tS: number, spanM: number, vmaxMs: number, accelMs2: number, dwellS: number): { s: number; dir: 1 | -1 } {
  const vPeak = Math.min(vmaxMs, Math.sqrt(accelMs2 * spanM));
  const tAcc = vPeak / accelMs2, dAcc = 0.5 * accelMs2 * tAcc * tAcc;
  const legS = 2 * tAcc + (spanM - 2 * dAcc) / vPeak;
  const cycle = 2 * (legS + dwellS);
  const t = ((tS % cycle) + cycle) % cycle;
  const forward = t < legS + dwellS;
  const tl = forward ? t : t - legS - dwellS;
  let d: number;
  if (tl >= legS) d = spanM;
  else if (tl < tAcc) d = 0.5 * accelMs2 * tl * tl;
  else if (tl > legS - tAcc) d = spanM - 0.5 * accelMs2 * (legS - tl) ** 2;
  else d = dAcc + (tl - tAcc) * vPeak;
  return forward ? { s: d, dir: 1 } : { s: spanM - d, dir: -1 };
}

export interface PathSample { x: number; y: number; z: number; tx: number; tz: number; /** dy/ds */ grade: number }

/** Point at arc length `s` on a draped road/rail path (clamped to its ends). */
export function samplePath(points: ReadonlyArray<RoadPoint>, s: number): PathSample {
  let lo = 0, hi = points.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (points[mid].s <= s) lo = mid; else hi = mid; }
  const a = points[lo], b = points[hi], ds = b.s - a.s || 1;
  const u = Math.min(1, Math.max(0, (s - a.s) / ds));
  const tx = b.x - a.x, tz = b.z - a.z, len = Math.hypot(tx, tz) || 1;
  return { x: a.x + tx * u, y: a.y + (b.y - a.y) * u, z: a.z + tz * u, tx: tx / len, tz: tz / len, grade: (b.y - a.y) / ds };
}

export type VehicleKind = 'car' | 'truck' | 'bus' | 'tractor';
export interface RoadVehicle { roadIndex: number; kind: VehicleKind; vmaxMs: number; accelMs2: number; dwellS: number; phaseS: number; colorHex: string }

/** Stop this far short of a road's ends so vehicles parked at a shared junction don't overlap. */
export const ROAD_END_MARGIN_M = 15;
const SURFACE_TRAFFIC: Record<RoadSurface, { spacingM: number; speed: [number, number]; kinds: VehicleKind[] }> = {
  asphalt: { spacingM: 320, speed: [14, 20], kinds: ['car', 'car', 'car', 'truck', 'bus'] },
  gravel: { spacingM: 520, speed: [9, 13], kinds: ['car', 'truck'] },
  dirt: { spacingM: 600, speed: [5, 8], kinds: ['tractor', 'car'] },
};
const TRACTOR_COLORS = ['#3f7a3a', '#c9423a', '#d98c2b'];
const VEHICLE_COLORS = ['#c9423a', '#e8e3d4', '#2f5d8a', '#d9a441', '#3f6b45', '#5a5e63', '#8a2f2f', '#f0efe8'];

/** Who drives where. Vehicles on one road share speed/accel/dwell and are spread evenly in
 * phase, so a lane never has one car driving through another. */
export function planRoadTraffic(roads: ReadonlyArray<RoadPath>, seed: string): RoadVehicle[] {
  const rng = createSeededRandom(seed, 'road-traffic');
  const out: RoadVehicle[] = [];
  roads.forEach((road, roadIndex) => {
    const spec = SURFACE_TRAFFIC[road.def.surface];
    const span = road.lengthM - 2 * ROAD_END_MARGIN_M;
    if (span < 80) return;
    const count = Math.max(1, Math.round(road.lengthM / spec.spacingM));
    const vmaxMs = rng.range(spec.speed[0], spec.speed[1]), accelMs2 = 2.2, dwellS = rng.range(4, 9);
    const cycle = 2 * (span / vmaxMs + vmaxMs / accelMs2 + dwellS);
    const base = rng.range(0, cycle);
    for (let i = 0; i < count; i++) {
      const kind = rng.pick(spec.kinds);
      out.push({ roadIndex, kind, vmaxMs, accelMs2, dwellS, phaseS: base + (i * cycle) / count, colorHex: rng.pick(kind === 'tractor' ? TRACTOR_COLORS : VEHICLE_COLORS) });
    }
  });
  return out;
}

/** Authored rail lines (world x/z control points), reusing the road drape/spline. The Field's
 * runs across the flat south plain: river-side industrial halt -> level crossing with
 * ROAD_INDUSTRIAL -> south of the strips -> remote farm halt -> east edge. */
export const RAIL_LINES: Record<string, RoadDef> = {
  the_field: {
    id: 'RAIL_SOUTH', surface: 'gravel', widthM: 4.4, priority: 6,
    points: [[1150, -660], [950, -640], [700, -605], [450, -580], [200, -570], [-50, -585], [-300, -625], [-600, -700], [-900, -790], [-1100, -830], [-1260, -840],
      // V2: the line continues east over the uplands and off the map, so the train comes from somewhere.
      [-1800, -900], [-2500, -950], [-3400, -980], [-4400, -950], [-5400, -900], [-6450, -880]],
  },
};

/** Drops trees, rocks, lots and props that the layout scattered onto a rail corridor. */
export function clearCorridor(layout: RegionLayout, path: RoadPath, clearM: number): RegionLayout {
  const dist = createRoadDistance([path]);
  const keep = <T extends { x: number; z: number }>(items: T[]) => items.filter((i) => dist(i.x, i.z) > clearM);
  return { ...layout, trees: keep(layout.trees), rocks: keep(layout.rocks), lots: keep(layout.lots), props: keep(layout.props) };
}
