import { createNoise2D } from 'simplex-noise';
import { createSeededRandom } from '../core/seededRandom';
import { RAIL_LINES } from './ambientTraffic';
import {
  distanceToRiver, FIELD_LAKE, FIELD_LAKE_ISLAND, fieldElevation, lakeEdgeDistance, lakeShoreRadius, SEA_LEVEL_M,
} from './fieldGeography';
import {
  FIELD_COMPOSITION_SEED, FIELD_PARCELS, POWER_LINES, pylonPositions, ROADS, WORLD_ANCHORS,
  type Anchor, type CropKind, type FieldParcel, type Vec2,
} from './fieldComposition';
import { catmullRom, createRoadDistance, type RoadPath } from './fieldRoads';
import type { CompositionContext, PropKind } from './regionPlacement';

/**
 * World Density & Composition V2 for The Field. The home basin was hand-dressed, but past ~2 km
 * the region was open grass with a few floating rectangles. This module fills it by COMPOSITION,
 * not by scattering:
 *
 *  MACRO  lake reshaped (fieldGeography.ts), estuary coast, forests (tree budget), a market town
 *  MESO   a cadastral farmland mosaic aligned to the road network, farmsteads, hamlets, harbour,
 *         pylon lines, the rail line carried off the map, roads that run past the horizon
 *  MICRO  townhouses, parked cars, reeds, boats, fences, poles, signs, clutter
 *
 * Open zones are deliberate: a low-frequency "cadastre" noise leaves unfenced commons between
 * farmland belts, the mountains stay wild, and every town has a readable edge. Everything is
 * deterministic from FIELD_COMPOSITION_SEED: procedural placement inside authored intent.
 */

const PI = Math.PI;
const SEED = `${FIELD_COMPOSITION_SEED}:countryside-v2`;
const noise = (channel: string) => { const r = createSeededRandom(SEED, channel); return createNoise2D(() => r.next()); };

const slopeDeg = (x: number, z: number): number => {
  const d = 62, gx = (fieldElevation(x + d, z) - fieldElevation(x - d, z)) / (2 * d), gz = (fieldElevation(x, z + d) - fieldElevation(x, z - d)) / (2 * d);
  return Math.atan(Math.hypot(gx, gz)) * (180 / PI);
};

/** Settlement cores the mosaic stays out of (they compose their own ground). */
const SETTLEMENT_KEEP_OUT: ReadonlyArray<[Anchor, number]> = [
  [WORLD_ANCHORS.homeAirfield, 420], [WORLD_ANCHORS.secondAirfield, 360], [WORLD_ANCHORS.village, 300], [WORLD_ANCHORS.homeApron, 200],
  [WORLD_ANCHORS.industrialArea, 300], [WORLD_ANCHORS.farmClusterA, 200], [WORLD_ANCHORS.farmClusterB, 180], [WORLD_ANCHORS.remoteFarm, 180],
  [WORLD_ANCHORS.lakeVillage, 280], [WORLD_ANCHORS.utilityTower, 90], [WORLD_ANCHORS.easternWindmill, 120],
  [WORLD_ANCHORS.southTown, 470], [WORLD_ANCHORS.estuaryVillage, 260], [WORLD_ANCHORS.eastHamlet, 240], [WORLD_ANCHORS.westHamlet, 240],
  [WORLD_ANCHORS.lighthouse, 160], [WORLD_ANCHORS.eastMast, 80],
];

// 2D road/rail centrelines (control-point splines, no terrain needed) for parcel clearance.
const flatPath = (pts: ReadonlyArray<Vec2>): RoadPath => {
  const raw = catmullRom(pts, 16);
  return { points: raw.map(([x, z], i) => {
    const a = raw[Math.max(0, i - 1)], b = raw[Math.min(raw.length - 1, i + 1)], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return { x, z, groundY: 0, y: 0, s: 0, tx: (b[0] - a[0]) / l, tz: (b[1] - a[1]) / l, onBridge: false };
  }), lengthM: 0 } as unknown as RoadPath;
};
const ROAD_LINES = [...ROADS.map((r) => flatPath(r.points)), ...Object.values(RAIL_LINES).map((r) => flatPath(r.points))];
const roadDist = createRoadDistance(ROAD_LINES, 96);
/** Tangent (heading) of the nearest road within 700 m, for cadastral alignment. */
function nearestRoadHeading(x: number, z: number): number | null {
  let best = 700, heading: number | null = null;
  for (const path of ROAD_LINES) for (let i = 0; i < path.points.length; i += 3) {
    const p = path.points[i], d = Math.hypot(p.x - x, p.z - z);
    if (d < best) { best = d; heading = Math.atan2(p.tx, p.tz); }
  }
  return heading;
}

const rectCorners = (p: FieldParcel, margin = 0): Vec2[] => {
  const c = Math.cos(p.headingRad), s = Math.sin(p.headingRad), hw = p.widthM / 2 + margin, hd = p.depthM / 2 + margin;
  return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd], [0, 0], [0, hd], [0, -hd], [hw, 0], [-hw, 0]].map(([lx, lz]) => [p.center[0] + lx * c + lz * s, p.center[1] - lx * s + lz * c] as Vec2);
};
const inRect = (p: FieldParcel, x: number, z: number, margin: number): boolean => {
  const dx = x - p.center[0], dz = z - p.center[1], c = Math.cos(p.headingRad), s = Math.sin(p.headingRad);
  return Math.abs(c * dx - s * dz) <= p.widthM / 2 + margin && Math.abs(s * dx + c * dz) <= p.depthM / 2 + margin;
};
/** Rotated-rectangle overlap by sampled corners/edge midpoints both ways (parcels are convex, similar size). */
export const parcelsOverlap = (a: FieldParcel, b: FieldParcel, margin: number): boolean =>
  rectCorners(b).some(([x, z]) => inRect(a, x, z, margin)) || rectCorners(a).some(([x, z]) => inRect(b, x, z, margin));

const CROPS_ARABLE: CropKind[] = ['green', 'green', 'dry', 'bare', 'harvested', 'dry', 'green', 'grass'];
const CROPS_PASTURE: CropKind[] = ['grass', 'grass', 'green', 'grass', 'harvested'];
const EDGE_SIDES = ['n', 's', 'e', 'w'] as const;

/**
 * The cadastral mosaic: a jittered 250 m lattice of parcels over workable lowland (below 175 m,
 * under ~6.5 deg, dry, off the river corridor and lake shore), each aligned with its nearest road
 * so field patterns follow the network the way real enclosure does. A low-frequency noise splits
 * the country into arable belts, pasture belts and unparcelled commons (the open zones).
 */
function generateCountryParcels(): FieldParcel[] {
  const cadastre = noise('cadastre'), landUse = noise('land-use'), out: FieldParcel[] = [];
  const all = (): FieldParcel[] => [...FIELD_PARCELS, ...out];
  const G = 250;
  for (let gx = -6150; gx <= 6150; gx += G) for (let gz = -6150; gz <= 6150; gz += G) {
    const rng = createSeededRandom(SEED, 'parcel', gx, gz);
    const x = gx + rng.range(-35, 35), z = gz + rng.range(-35, 35);
    const commons = cadastre(x / 2600, z / 2600);
    if (commons < -0.42 || rng.next() < 0.08) continue; // open zones: commons and the odd fallow gap
    const h = fieldElevation(x, z);
    if (h < SEA_LEVEL_M + 10 || h > 175 || slopeDeg(x, z) > 6.5) continue;
    if (distanceToRiver(x, z) < 180 || lakeEdgeDistance(x, z) < 160) continue;
    if (SETTLEMENT_KEEP_OUT.some(([a, r]) => Math.hypot(x - a.x, z - a.z) < r)) continue;
    const heading = (nearestRoadHeading(x, z) ?? cadastre(x / 5000 + 7, z / 5000) * 0.8) + (rng.next() - 0.5) * 0.12;
    const arable = landUse(x / 1900, z / 1900) > -0.1;
    const p: FieldParcel = {
      id: `g${out.length.toString().padStart(3, '0')}`, center: [Math.round(x), Math.round(z)],
      widthM: Math.round(rng.range(150, 215)), depthM: Math.round(rng.range(115, 200)), headingRad: heading,
      crop: rng.pick(arable ? CROPS_ARABLE : CROPS_PASTURE), rowAngleRad: rng.next() < 0.5 ? 0 : PI / 2,
    };
    // Whole footprint dry, workable and off every road/rail; otherwise try a smaller plot once.
    const fits = (q: FieldParcel) => rectCorners(q, 6).every(([cx, cz]) => roadDist(cx, cz) > 14 && fieldElevation(cx, cz) > SEA_LEVEL_M + 8 && distanceToRiver(cx, cz) > 120 && lakeEdgeDistance(cx, cz) > 110)
      && !all().some((o) => parcelsOverlap(o, q, 8));
    if (!fits(p)) { p.widthM = Math.round(p.widthM * 0.62); p.depthM = Math.round(p.depthM * 0.62); if (!fits(p)) continue; }
    // Field boundaries: hedges and tree lines are what make a mosaic read as farmland from altitude.
    const edges: FieldParcel['edges'] = {};
    const roll = rng.next();
    if (roll < 0.26) edges[rng.pick([...EDGE_SIDES])] = 'hedge';
    else if (roll < 0.4) edges[rng.pick([...EDGE_SIDES])] = 'trees';
    else if (roll < 0.52) edges[rng.pick([...EDGE_SIDES])] = 'fence';
    if (rng.next() < 0.05) edges[rng.pick([...EDGE_SIDES])] = 'trees';
    p.edges = edges;
    out.push(p);
  }
  return out;
}

export const COUNTRY_PARCELS: ReadonlyArray<FieldParcel> = generateCountryParcels();

// ------------------------------------------------------------------------------------------
// Authored settlements and infrastructure (called from fieldPlacement.ts's authored pass).
// ------------------------------------------------------------------------------------------

const TOWN_HOUSES: Array<[PropKind, number]> = [['townhouse', 7], ['farmhouse_a', 1], ['farmhouse_b', 1], ['small_workshop', 1]];
const HAMLET_HOUSES: Array<[PropKind, number]> = [['farmhouse_a', 3], ['farmhouse_b', 3], ['townhouse', 2], ['small_workshop', 1], ['barn_b', 1]];
const SCALE: Record<string, [number, number]> = { townhouse: [0.9, 1.2], farmhouse_a: [1.9, 2.4], farmhouse_b: [1.9, 2.4], small_workshop: [2.6, 3.2], barn_a: [3.0, 3.8], barn_b: [3.0, 3.8] };

const nearestS = (road: RoadPath, x: number, z: number): number =>
  road.points.reduce((b, p) => (Math.hypot(p.x - x, p.z - z) < Math.hypot(b.x - x, b.z - z) ? p : b)).s;

/** A farm compound (house, barn, maybe silos, windbreak, bales, a track to the road) in a local frame. */
function farmstead(ctx: CompositionContext, x: number, z: number, heading: number, variant: number): boolean {
  const a: Anchor = { id: `farm-${Math.round(x)}-${Math.round(z)}`, district: 'C', x, z, headingRad: heading, radiusM: 50 };
  const [hx, hz] = ctx.rot(a, 16, -8);
  if (!ctx.addBuilding(variant % 2 ? 'farmhouse_a' : 'farmhouse_b', hx, hz, heading - PI / 2, 1.9 + (variant % 3) * 0.2)) return false;
  ctx.yard(a, 64, 48, ['#8d7a56', '#86744f', '#948060'][variant % 3]);
  const [bx, bz] = ctx.rot(a, -12, 12);
  ctx.addBuilding(variant % 3 === 0 ? 'barn_a' : 'barn_b', bx, bz, heading + PI / 2, 3.0 + (variant % 2) * 0.6);
  if (variant % 3 !== 1) { const [sx, sz] = ctx.rot(a, -30, -12); ctx.addBuilding('silo', sx, sz, 0, 0.8 + (variant % 2) * 0.3); }
  if (variant % 4 === 0) { const [wx, wz] = ctx.rot(a, 18, 18); ctx.addBuilding('small_workshop', wx, wz, heading - PI / 2, 2.1); }
  ctx.windbreak(a, [-40, -34], [-40, 34], 7);
  if (variant % 2) ctx.windbreak(a, [-36, 36], [30, 38], 6);
  for (let i = 0; i < 3 + (variant % 4); i++) { const [px, pz] = ctx.rot(a, 4 + (i % 3) * 3.5, -26 - Math.floor(i / 3) * 3.5); ctx.addProp('hay_bale', px, pz, i); }
  // Access: a farm track to the nearest road when there is one within reach.
  if (ctx.roadDist(x, z) < 320) {
    let best = { x: 0, z: 0, d: Infinity };
    for (const r of ctx.roads) for (let i = 0; i < r.points.length; i += 2) { const p = r.points[i], d = Math.hypot(p.x - x, p.z - z); if (d < best.d) best = { x: p.x, z: p.z, d }; }
    const len = best.d - 30;
    if (len > 12) {
      const ux = (best.x - x) / best.d, uz = (best.z - z) / best.d;
      ctx.plain(`${a.id}-track`, [x + ux * (30 + len / 2), z + uz * (30 + len / 2)], 3.4, len, Math.atan2(ux, uz), '#94805c', 0.17);
    }
  }
  return true;
}

/** One homestead cluster per parcel-corner where the mosaic leaves room: farms punctuate the fields. */
function countryFarmsteads(ctx: CompositionContext): void {
  const rng = createSeededRandom(SEED, 'farmsteads');
  let variant = 0;
  for (const p of COUNTRY_PARCELS) {
    if (rng.next() > 0.2) continue;
    const c = Math.cos(p.headingRad), s = Math.sin(p.headingRad), sx = rng.next() < 0.5 ? -1 : 1, sz = rng.next() < 0.5 ? -1 : 1;
    const lx = sx * (p.widthM / 2 + 48), lz = sz * (p.depthM / 2 + 40);
    const x = p.center[0] + lx * c + lz * s, z = p.center[1] - lx * s + lz * c;
    if (ctx.inParcel(x, z, 30) || ctx.roadDist(x, z) < 30 || !ctx.okGround(x, z, 7)) continue;
    if (farmstead(ctx, x, z, p.headingRad, variant)) variant++;
  }
}

function marketTown(ctx: CompositionContext): void {
  const T = WORLD_ANCHORS.southTown;
  ctx.ex({ x: T.x, z: T.z }, 60);
  for (const id of ['ROAD_TOWN_HIGH', 'ROAD_TOWN_CROSS_A', 'ROAD_TOWN_CROSS_B', 'ROAD_TOWN_BACK'] as const) {
    const road = ctx.roadById(id);
    ctx.frontage({ road, fromS: 12, toS: road.lengthM - 10, spacing: 21, offsets: [4, 9], sides: [-1, 1], kinds: TOWN_HOUSES, chance: 0.93, scale: SCALE });
  }
  // Suburban ribbon along the approach roads thins out into the country: a readable town edge.
  const south = ctx.roadById('ROAD_SOUTH');
  ctx.frontage({ road: south, fromS: south.lengthM - 420, toS: south.lengthM - 20, spacing: 34, offsets: [8, 20], sides: [-1, 1], kinds: HAMLET_HOUSES, chance: 0.7, scale: SCALE });
  const coast = ctx.roadById('ROAD_COAST');
  ctx.frontage({ road: coast, fromS: 20, toS: 380, spacing: 36, offsets: [8, 22], sides: [-1, 1], kinds: HAMLET_HOUSES, chance: 0.65, scale: SCALE });
  // Square, church (the steeple is the town's silhouette from 5+ km), market hall, parked cars.
  ctx.plain('town-square', ctx.rot(T, 0, 10), 46, 60, T.headingRad, '#9b958a', 0.18);
  ctx.at(T, 'church', 38, 30, PI / 2, 1);
  ctx.at(T, 'warehouse', -40, 40, 0, 0.45);
  for (let i = 0; i < 9; i++) { const [x, z] = ctx.rot(T, -14 + (i % 3) * 3.2, -8 + Math.floor(i / 3) * 6); ctx.addProp('car', x, z, T.headingRad + PI / 2, 1); }
  // Grain co-op by the southern approach: silos and sheds, a landmark cluster at the town gate.
  const G: Anchor = { ...T, id: 'townCoop', x: T.x + 330, z: T.z + 250 };
  ctx.plain('town-coop-yard', [G.x, G.z], 110, 70, T.headingRad, '#7d7a70', 0.17);
  for (let i = 0; i < 4; i++) ctx.at(G, 'silo', -30 + i * 11, 18, 0, 1.25);
  ctx.at(G, 'warehouse', 0, -12, 0, 0.7);
  for (let i = 0; i < 6; i++) { const [x, z] = ctx.rot(G, 30 + (i % 3) * 2.4, -30 + Math.floor(i / 3) * 5); ctx.addProp('car', x, z, T.headingRad, 1); }
  // Allotments and paddocks on the town fringe: small-grain ground texture between town and fields.
  const rng = createSeededRandom(SEED, 'allotments');
  const tones = ['#6f8f45', '#8a7a4f', '#7d9a52', '#a19060', '#5f8540'];
  for (let i = 0; i < 26; i++) {
    const ang = rng.next() * PI * 2, r = 330 + rng.next() * 120, x = T.x + Math.cos(ang) * r, z = T.z + Math.sin(ang) * r;
    if (!ctx.okGround(x, z, 8) || ctx.roadDist(x, z) < 12 || ctx.inParcel(x, z, 10)) continue;
    ctx.plain(`town-plot-${i}`, [x, z], 22 + rng.next() * 20, 30 + rng.next() * 26, T.headingRad + (rng.next() - 0.5) * 0.3, tones[i % tones.length], 0.14);
    if (rng.next() < 0.4) ctx.addProp('hut', x + 6, z + 6, rng.next() * 6, 0.6);
  }
  // Street furniture: poles and signs down the high street.
  const high = ctx.roadById('ROAD_TOWN_HIGH');
  for (let s = 20; s < high.lengthM; s += 42) {
    const p = high.points.reduce((b, q) => (Math.abs(q.s - s) < Math.abs(b.s - s) ? q : b)), off = high.def.widthM / 2 + 2.5;
    ctx.addProp('pole', p.x - p.tz * off, p.z + p.tx * off, Math.atan2(p.tx, p.tz), 0.8);
  }
}

/** Hamlet: frontage either side of the anchor along its road, a chapel and a couple of farms. */
function hamlet(ctx: CompositionContext, a: Anchor, roadId: string, spanM: number, chapel: [number, number]): void {
  const road = ctx.roadById(roadId), s = nearestS(road, a.x, a.z);
  ctx.frontage({ road, fromS: Math.max(10, s - spanM), toS: Math.min(road.lengthM - 10, s + spanM), spacing: 30, offsets: [7, 16], sides: [-1, 1], kinds: HAMLET_HOUSES, chance: 0.8, scale: SCALE });
  ctx.at(a, 'church', chapel[0], chapel[1], PI / 2, 0.7);
  for (let i = 0; i < 4; i++) { const [x, z] = ctx.rot(a, chapel[0] - 14, chapel[1] - 10 + i * 5); ctx.addProp('car', x, z, a.headingRad, 1); }
  farmstead(ctx, ...ctx.rot(a, spanM + 60, 90), a.headingRad, 1);
  farmstead(ctx, ...ctx.rot(a, -spanM - 40, -110), a.headingRad + 0.4, 2);
}

/** Fishing village over the estuary: harbour jetties where the harbour road meets the water. */
function estuaryVillage(ctx: CompositionContext): void {
  const V = WORLD_ANCHORS.estuaryVillage;
  hamlet(ctx, V, 'ROAD_COAST', 260, [30, 60]);
  const harbour = ctx.roadById('ROAD_HARBOUR'), end = harbour.points[harbour.points.length - 1];
  // March on from the road end until the water, then build out from the shore.
  let x = end.x, z = end.z;
  for (let i = 0; i < 80 && !ctx.wet(x, z); i++) { x += end.tx * 8; z += end.tz * 8; }
  if (!ctx.wet(x, z)) return;
  const yaw = Math.atan2(end.tx, end.tz);
  const nx = -end.tz, nz = end.tx;
  ctx.plain('harbour-quay', [x - end.tx * 22, z - end.tz * 22], 60, 30, yaw, '#8f8a7e', 0.18);
  for (const off of [-22, 0, 24]) {
    ctx.addForced('jetty', x + nx * off + end.tx * 18, z + nz * off + end.tz * 18, yaw, 1);
    for (const side of [-1, 1]) ctx.addProp('boat', x + nx * (off + side * 4.5) + end.tx * (18 + side * 8), z + nz * (off + side * 4.5) + end.tz * (18 + side * 8), yaw + (side < 0 ? PI : 0), 1);
  }
  ctx.addForced('boathouse', x - end.tx * 30 + nx * 28, z - end.tz * 30 + nz * 28, yaw, 1);
  ctx.addForced('boathouse', x - end.tx * 30 - nx * 30, z - end.tz * 30 - nz * 30, yaw, 0.85);
  for (let i = 0; i < 8; i++) ctx.addProp(i % 2 ? 'crate' : 'barrel', x - end.tx * 20 + nx * (i * 1.6 - 6), z - end.tz * 20 + nz * (i * 1.6 - 6), i, 1);
  for (let i = 0; i < 4; i++) ctx.addProp('boat', x + end.tx * (70 + i * 25) + nx * (i * 30 - 45), z + end.tz * (70 + i * 25) + nz * (i * 30 - 45), yaw + i, 1);
}

function lighthouseAndMast(ctx: CompositionContext): void {
  const L = WORLD_ANCHORS.lighthouse;
  ctx.addForced('lighthouse', L.x, L.z, 0, 1);
  ctx.addForced('hut', L.x + 14, L.z + 6, 0.3, 1.3);
  ctx.plain('lighthouse-pad', [L.x, L.z], 44, 40, 0.2, '#a39d8e', 0.18);
  ctx.fenceRun([[L.x - 24, L.z - 22], [L.x + 24, L.z - 22], [L.x + 24, L.z + 22], [L.x - 24, L.z + 22], [L.x - 24, L.z - 22]], 'fence_seg', 4, [L.x + 24, L.z], 4);
  const M = WORLD_ANCHORS.eastMast;
  ctx.addForced('lattice_tower', M.x, M.z, 0.4, 1.15);
  ctx.addProp('hut', M.x + 14, M.z - 10, 0.4, 1);
  ctx.plain('mast-pad', [M.x, M.z], 36, 32, 0.4, '#7d7a70', 0.17);
  ctx.fenceRun([[M.x - 18, M.z - 16], [M.x + 18, M.z - 16], [M.x + 18, M.z + 16], [M.x - 18, M.z + 16], [M.x - 18, M.z - 16]], 'fence_seg', 4);
}

function powerLines(ctx: CompositionContext): void {
  for (const line of POWER_LINES) for (const p of pylonPositions(line)) {
    if (!ctx.wet(p.x, p.z)) ctx.addProp('pylon', p.x, p.z, p.yaw, 1);
  }
  // Substation at the industrial end of the lines.
  const [sx, sz] = POWER_LINES[0][0];
  ctx.plain('substation-pad', [sx, sz], 46, 38, 0.5, '#8a8a84', 0.18);
  ctx.fenceRun([[sx - 23, sz - 19], [sx + 23, sz - 19], [sx + 23, sz + 19], [sx - 23, sz + 19], [sx - 23, sz - 19]], 'fence_seg', 4);
  for (let i = 0; i < 4; i++) ctx.addProp('tank', sx - 10 + (i % 2) * 18, sz - 8 + Math.floor(i / 2) * 14, 0, 0.22);
}

/**
 * The lake as a place: reed beds in the shallow bays, a shingle beach with bathing huts by the
 * lake village, a boathouse and moored boats at the dock, a fishing jetty on the west peninsula
 * (rocks and pines), and a wooded island with a ruined chapel.
 */
function lakeDressing(ctx: CompositionContext): void {
  const rng = createSeededRandom(SEED, 'lake');
  const L = FIELD_LAKE;
  const shore = (a: number, off: number): Vec2 => { const r = lakeShoreRadius(a) + off; return [L.x + Math.cos(a) * r, L.z + Math.sin(a) * r]; };
  // Reeds: dense in the river arm and the north-east bay, sparse elsewhere; standing in the shallows.
  for (let i = 0; i < 520; i++) {
    const a = rng.next() * PI * 2;
    const bay = Math.max(Math.exp(-((Math.atan2(Math.sin(a - 0.86), Math.cos(a - 0.86)) / 0.3) ** 2)), Math.exp(-((Math.atan2(Math.sin(a - 2.35), Math.cos(a - 2.35)) / 0.4) ** 2)));
    if (rng.next() > 0.12 + 0.88 * bay) continue;
    const [x, z] = shore(a, -4 - rng.next() * 26);
    ctx.addProp('reeds', x, z, rng.next() * 6.28, 0.8 + rng.next() * 0.7);
  }
  // Dock: boathouse, moored boats either side of the jetty, a slipway patch.
  const D = WORLD_ANCHORS.lakeDock;
  ctx.addForced('boathouse', D.x - 34, D.z + 8, PI, 1);
  for (const [dx, dz, r] of [[-5, 40, 0.1], [5, 30, -0.1], [-5, 18, 0.05], [30, 45, 1.2], [-40, 60, 2.2]] as const) ctx.addProp('boat', D.x + dx, D.z + dz, r, 1);
  ctx.plain('lake-slipway', [D.x - 34, D.z + 22], 8, 26, 0, '#8a8579', 0.2);
  // Beach south-east of the dock (toward the outflow): shingle strip + bathing huts + upturned boats.
  const beachA = -1.95;
  for (let k = 0; k < 7; k++) {
    const a = beachA - 0.09 + k * 0.03, [x, z] = shore(a, 10), t = Math.atan2(-Math.sin(a), Math.cos(a));
    ctx.plain(`lake-beach-${k}`, [x, z], 26, 30, t, '#cfc4a0', 0.15);
    if (k % 2 === 0) { const [hx, hz] = shore(a, 34); ctx.addProp('hut', hx, hz, t, 0.55); }
  }
  // West peninsula: rocky point, pines, a fishing jetty off the tip.
  const P = -0.35, [px, pz] = shore(P, -10);
  for (let i = 0; i < 10; i++) { const [x, z] = shore(P + (rng.next() - 0.5) * 0.35, 4 + rng.next() * 40); ctx.rockCluster(x, z, 2 + rng.next() * 2.5, 3, 7); }
  for (let i = 0; i < 26; i++) { const [x, z] = shore(P + (rng.next() - 0.5) * 0.3, 30 + rng.next() * 110); if (ctx.okGround(x, z, 20)) ctx.addTree('evergreen', x, z, 1.5 + rng.next() * 0.8, rng.next() * 6.28, rng.next(), false); }
  ctx.addForced('jetty', px - Math.cos(P) * 20, pz - Math.sin(P) * 20, Math.atan2(-Math.cos(P), -Math.sin(P)), 0.7);
  ctx.addProp('boat', px - Math.cos(P) * 30 + 5, pz - Math.sin(P) * 30, P, 1);
  // Island: wooded crown, a ruined chapel on the crest, rocks on its shore.
  const I = FIELD_LAKE_ISLAND;
  for (let i = 0; i < 70; i++) {
    const a = rng.next() * PI * 2, r = Math.sqrt(rng.next()) * I.radiusM * 0.85, x = I.x + Math.cos(a) * r, z = I.z + Math.sin(a) * r;
    if (Math.hypot(x - I.x - 10, z - I.z - 5) < 22 || ctx.wet(x, z)) continue;
    ctx.addTree(rng.next() < 0.55 ? 'evergreen' : 'canopy', x, z, 1.4 + rng.next() * 0.9, rng.next() * 6.28, rng.next(), false);
  }
  ctx.addForced('church', I.x + 10, I.z + 5, 0.6, 0.45);
  for (let i = 0; i < 8; i++) { const a = rng.next() * PI * 2, r = I.radiusM * (0.85 + rng.next() * 0.15); ctx.addRock('rock2', I.x + Math.cos(a) * r, I.z + Math.sin(a) * r, 1.5 + rng.next() * 2, rng.next() * 6, 0.1, false); }
}

/** Country furniture along the long roads: a junction sign, the odd lone house, poles in settled stretches. */
function roadsideLife(ctx: CompositionContext): void {
  const rng = createSeededRandom(SEED, 'roadside');
  for (const id of ['ROAD_SOUTH', 'ROAD_COAST', 'ROAD_EAST', 'ROAD_WEST'] as const) {
    const road = ctx.roadById(id);
    // Lone houses: sparse frontage the whole way, so no long stretch is empty from the air.
    ctx.frontage({ road, fromS: 60, toS: road.lengthM - 60, spacing: 190, offsets: [10, 26], sides: [-1, 1], kinds: HAMLET_HOUSES, chance: 0.22, scale: SCALE });
    for (let s = 30; s < road.lengthM - 20; s += 70) {
      if (rng.next() < 0.35) continue;
      const p = road.points.reduce((b, q) => (Math.abs(q.s - s) < Math.abs(b.s - s) ? q : b)), off = road.def.widthM / 2 + 4;
      const x = p.x - p.tz * off, z = p.z + p.tx * off;
      if (ctx.okGround(x, z, 14) && !ctx.nearPad(x, z, 20)) ctx.addProp('pole', x, z, Math.atan2(p.tx, p.tz), 1);
    }
    const p0 = road.points[2];
    ctx.addProp('sign', p0.x - p0.tz * (road.def.widthM / 2 + 3), p0.z + p0.tx * (road.def.widthM / 2 + 3), Math.atan2(p0.tx, p0.tz));
  }
}

export function authoredCountryside(ctx: CompositionContext): void {
  for (const [a, r] of [[WORLD_ANCHORS.southTown, 90], [WORLD_ANCHORS.lighthouse, 30], [WORLD_ANCHORS.eastMast, 30]] as const) ctx.ex(a, r);
  marketTown(ctx);
  estuaryVillage(ctx);
  hamlet(ctx, WORLD_ANCHORS.eastHamlet, 'ROAD_EAST', 230, [-30, 40]);
  hamlet(ctx, WORLD_ANCHORS.westHamlet, 'ROAD_WEST', 220, [30, -40]);
  lighthouseAndMast(ctx);
  powerLines(ctx);
  lakeDressing(ctx);
  roadsideLife(ctx);
  countryFarmsteads(ctx);
}
