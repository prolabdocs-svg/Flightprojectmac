import { createNoise2D } from 'simplex-noise';
import { createSeededRandom, type SeededRandom } from '../core/seededRandom';
import { buildAirportOverrides } from './airfieldTerrain';
import { distanceToRiver, FIELD_LAKE, FIELD_RIVER_POINTS, homePlainMask, SEA_LEVEL_M, smoothstep } from './fieldGeography';
import { scatterFieldRocks } from './fieldRocks';
import {
  FIELD_COMPOSITION_SEED, FIELD_PARCELS, MAX_TREE_MASS_INSTANCES, WORLD_ANCHORS,
  type Anchor, type CropKind, type FieldParcel, type Vec2,
} from './fieldComposition';
import { allRoadPaths, createRoadDistance, type RoadPath } from './fieldRoads';
import type { TerrainGridSampler } from './terrainHeightfield';
import type { TerrainQueryService } from './terrainQuery';

/**
 * Deterministic generators that turn WORLD_ANCHORS / ROADS / FIELD_PARCELS into placements:
 * settlement lots along road frontage, tree masses from clustered noise, rock groups on
 * steep/watery ground, airfield/industrial/farm dressing in anchor-local frames.
 * Pure data out (no Three.js); render/fieldWorld.ts instances it.
 */

/** GLB props authored in Blender (Z-down, see blenderAxisFix.ts). */
export type BlenderKind = 'farmhouse_a' | 'farmhouse_b' | 'small_workshop' | 'barn_a' | 'barn_b' | 'windmill_landmark' | 'water_tower';
/** GLB props from the airfield ground-ops pack (Y-up). */
export type AirfieldKind = 'af_control_tower' | 'af_crew_building' | 'af_gse_store' | 'af_hangar_compound' | 'af_fuel_bowser' | 'af_tug' | 'af_floodlight' | 'af_cone_row' | 'af_chock' | 'af_fence' | 'af_gate' | 'af_ground_power' | 'af_bus' | 'af_taxiway_sign' | 'af_stand_guidance' | 'af_windsock';
/** Procedural merged-geometry props (fieldWorld.ts builds them). */
export type ProcKind = 'silo' | 'tank' | 'warehouse' | 'stack' | 'lattice_tower' | 'fence_seg' | 'pole' | 'hay_bale' | 'barrel' | 'crate' | 'sign' | 'jetty' | 'hut';
export type PropKind = BlenderKind | AirfieldKind | ProcKind;

export interface Placement { kind: PropKind; x: number; z: number; rotY: number; scale: number }
export interface TreePlacement { kind: 'broadleaf' | 'conifer' | 'shrub'; x: number; z: number; scale: number; rotY: number; tint: number; /** near-detail Quaternius tree (village/airfield/road) instead of a mass tree */ hero: boolean }
export interface RockPlacement { kind: 'rock1' | 'rock2' | 'rock3' | 'pebble'; x: number; z: number; scale: number; rotY: number; tilt: number; /** big formation rock */ large: boolean }
export interface GroundPatch { id: string; center: Vec2; widthM: number; depthM: number; headingRad: number; color: string; /** 'field' patches carry crop rows, 'plain' are flat surface colour */ kind: 'field' | 'plain'; rowAngleRad: number; liftM: number }

export interface FieldLayout {
  roads: RoadPath[];
  /** Buildings and large structures. */
  lots: Placement[];
  /** Small props: fences, poles, bales, barrels, airfield ground equipment. */
  props: Placement[];
  trees: TreePlacement[];
  rocks: RockPlacement[];
  patches: GroundPatch[];
  /** Places where nothing else may be generated (discs). */
  exclusions: Array<{ x: number; z: number; r: number }>;
}

const PI = Math.PI;

const rot = (a: Anchor, lx: number, lz: number): Vec2 => [
  a.x + lx * Math.cos(a.headingRad) + lz * Math.sin(a.headingRad),
  a.z - lx * Math.sin(a.headingRad) + lz * Math.cos(a.headingRad),
];
const facing = (dx: number, dz: number): number => Math.atan2(dx, dz);

/** Footprint radius (m, at the scale used) per building kind; drives lot spacing checks. */
const FOOTPRINT_R: Partial<Record<PropKind, number>> = {
  farmhouse_a: 8, farmhouse_b: 8, small_workshop: 9, barn_a: 15, barn_b: 15, silo: 6, tank: 9, warehouse: 30, stack: 6, lattice_tower: 8, hut: 5,
};

export interface LayoutInput { grid: TerrainGridSampler; terrain: TerrainQueryService }

function inParcel(p: FieldParcel, x: number, z: number, margin: number): boolean {
  const dx = x - p.center[0], dz = z - p.center[1];
  const c = Math.cos(p.headingRad), s = Math.sin(p.headingRad);
  const lx = c * dx - s * dz, lz = s * dx + c * dz;
  return Math.abs(lx) <= p.widthM / 2 + margin && Math.abs(lz) <= p.depthM / 2 + margin;
}

const CROP_COLORS: Record<CropKind, string[]> = {
  green: ['#4f8a34', '#58923a'],
  dry: ['#c2ac58', '#b8a250'],
  bare: ['#8b6c48', '#93744e'],
  grass: ['#8cb45a', '#84ae56'],
  harvested: ['#c8b67c', '#bfae74'],
};

export function buildFieldLayout(input: LayoutInput): FieldLayout {
  const { grid, terrain } = input;
  const rng = createSeededRandom(FIELD_COMPOSITION_SEED, 'layout');
  const roads = allRoadPaths(grid);
  const roadDist = createRoadDistance(roads);
  const roadById = (id: string) => roads.find((r) => r.def.id === id)!;
  const pads = buildAirportOverrides('the_field');

  const lots: Placement[] = [];
  const props: Placement[] = [];
  const trees: TreePlacement[] = [];
  const patches: GroundPatch[] = [];
  const exclusions: Array<{ x: number; z: number; r: number }> = [];

  // ---- exclusion knowledge shared by every generator -------------------------------------
  const nearPad = (x: number, z: number, margin: number) => pads.some((p) => Math.hypot(x - p.center[0], z - p.center[1]) < p.radiusM + margin);
  const inField = (x: number, z: number, margin: number) => FIELD_PARCELS.some((p) => inParcel(p, x, z, margin));
  const inExclusion = (x: number, z: number, margin = 0) => exclusions.some((e) => Math.hypot(x - e.x, z - e.z) < e.r + margin);
  const wet = (x: number, z: number) => terrain.getWaterDepth(x, z) > 0 || grid.height(x, z) < SEA_LEVEL_M + 1;
  const nearRiver = (x: number, z: number, m: number) => distanceToRiver(x, z) < m;
  const okGround = (x: number, z: number, maxSlope: number) => !wet(x, z) && grid.slopeDeg(x, z) <= maxSlope;
  const ex = (a: Anchor | { x: number; z: number }, r: number) => exclusions.push({ x: a.x, z: a.z, r });

  // Reserved places first: tree masses and lots avoid them.
  ex(WORLD_ANCHORS.villageCore, 56);
  ex({ x: 120, z: 290 }, 14); // water tower
  ex({ x: -40, z: 20 }, 16); // runway-side workshop
  ex(WORLD_ANCHORS.homeApron, 78);
  ex({ x: 172, z: -62 }, 22);
  ex({ x: WORLD_ANCHORS.industrialArea.x, z: WORLD_ANCHORS.industrialArea.z }, 120);
  ex(WORLD_ANCHORS.farmClusterA, 75);
  ex(WORLD_ANCHORS.farmClusterB, 60);
  ex(WORLD_ANCHORS.remoteFarm, 60);
  ex(WORLD_ANCHORS.lakeVillage, 110);
  ex(WORLD_ANCHORS.utilityTower, 30);
  ex(WORLD_ANCHORS.secondAirfield, 50); // strip surroundings kept open apart from authored dressing

  const footprints: Array<{ x: number; z: number; r: number }> = [];
  const canPlaceBuilding = (x: number, z: number, r: number, ownRoad?: string): boolean => {
    if (!okGround(x, z, 6) || nearPad(x, z, r + 45) || inField(x, z, r + 4) || nearRiver(x, z, 90)) return false;
    if (footprints.some((f) => Math.hypot(x - f.x, z - f.z) < f.r + r + 3)) return false;
    // Keep off every road except by design: centreline must be clear of the footprint.
    for (const road of roads) {
      if (road.def.id === ownRoad) continue;
      for (const p of road.points) if (Math.hypot(p.x - x, p.z - z) < r + road.def.widthM / 2 + 3) return false;
    }
    return true;
  };
  const addBuilding = (kind: PropKind, x: number, z: number, rotY: number, scale: number, ownRoad?: string): boolean => {
    const r = FOOTPRINT_R[kind] ?? 8;
    if (!canPlaceBuilding(x, z, r, ownRoad)) return false;
    footprints.push({ x, z, r });
    lots.push({ kind, x, z, rotY, scale });
    return true;
  };
  const addForced = (kind: PropKind, x: number, z: number, rotY: number, scale: number) => { lots.push({ kind, x, z, rotY, scale }); footprints.push({ x, z, r: FOOTPRINT_R[kind] ?? 8 }); };
  const addProp = (kind: PropKind, x: number, z: number, rotY = 0, scale = 1) => { props.push({ kind, x, z, rotY, scale }); };

  // ---- ground patches: parcels, yards, apron, strips --------------------------------------
  FIELD_PARCELS.forEach((p, i) => {
    const colors = CROP_COLORS[p.crop];
    patches.push({ id: p.id, center: p.center, widthM: p.widthM, depthM: p.depthM, headingRad: p.headingRad, color: colors[i % colors.length], kind: 'field', rowAngleRad: p.rowAngleRad, liftM: 0.12 });
  });
  const plain = (id: string, a: Vec2, w: number, d: number, heading: number, color: string, lift = 0.16) =>
    patches.push({ id, center: a, widthM: w, depthM: d, headingRad: heading, color, kind: 'plain', rowAngleRad: 0, liftM: lift });

  // ---- roadside lots: the single rule that makes settlement structure ---------------------
  interface FrontageOpts { road: RoadPath; fromS: number; toS: number; spacing: number; offsets: [number, number]; sides: Array<-1 | 1>; kinds: Array<[PropKind, number]>; chance: number; scale: Record<string, [number, number]> }
  const frontage = (o: FrontageOpts): number => {
    let placed = 0;
    const total = o.kinds.reduce((a, [, w]) => a + w, 0);
    for (let s = o.fromS; s < o.toS; s += o.spacing) {
      const p = o.road.points.reduce((best, q) => (Math.abs(q.s - s) < Math.abs(best.s - s) ? q : best));
      for (const side of o.sides) {
        if (rng.next() > o.chance) continue;
        const nx = -p.tz * side, nz = p.tx * side; // outward normal from the road
        let pick = rng.next() * total, kind = o.kinds[0][0];
        for (const [k, w] of o.kinds) { pick -= w; if (pick <= 0) { kind = k; break; } }
        const [smin, smax] = o.scale[kind] ?? [1, 1];
        const scale = smin + rng.next() * (smax - smin);
        const off = o.offsets[0] + rng.next() * (o.offsets[1] - o.offsets[0]) + (FOOTPRINT_R[kind] ?? 8) * 0.4;
        const jitter = (rng.next() - 0.5) * o.spacing * 0.35;
        const x = p.x + nx * (o.road.def.widthM / 2 + off) + p.tx * jitter, z = p.z + nz * (o.road.def.widthM / 2 + off) + p.tz * jitter;
        // Front (local +Z) toward the road, loosely.
        if (addBuilding(kind, x, z, facing(-nx, -nz) + (rng.next() - 0.5) * 0.14, scale, o.road.def.id)) placed++;
      }
    }
    return placed;
  };
  const HOUSE_SCALE = { farmhouse_a: [1.5, 1.9], farmhouse_b: [1.5, 1.9], small_workshop: [2.2, 2.7], barn_a: [2.6, 3.2], barn_b: [2.6, 3.2] } as Record<string, [number, number]>;
  const village = roadById('ROAD_VILLAGE'), main = roadById('ROAD_MAIN'), airfieldRoad = roadById('ROAD_AIRFIELD'), lakeRoad = roadById('ROAD_LAKE');
  const villageKinds: Array<[PropKind, number]> = [['farmhouse_a', 4], ['farmhouse_b', 4], ['small_workshop', 2], ['barn_b', 1.2]];
  frontage({ road: village, fromS: 10, toS: village.lengthM - 30, spacing: 30, offsets: [10, 24], sides: [-1, 1], kinds: villageKinds, chance: 0.86, scale: HOUSE_SCALE });
  frontage({ road: main, fromS: main.lengthM - 330, toS: main.lengthM - 30, spacing: 34, offsets: [10, 26], sides: [-1, 1], kinds: villageKinds, chance: 0.75, scale: HOUSE_SCALE });
  frontage({ road: airfieldRoad, fromS: airfieldRoad.lengthM - 180, toS: airfieldRoad.lengthM - 40, spacing: 52, offsets: [12, 26], sides: [-1], kinds: [['farmhouse_b', 2], ['small_workshop', 2]], chance: 0.8, scale: HOUSE_SCALE });
  // Secondary settlement on the lake shore (smaller, houses only).
  frontage({ road: main, fromS: 0, toS: 220, spacing: 40, offsets: [10, 22], sides: [-1, 1], kinds: [['farmhouse_a', 3], ['farmhouse_b', 3], ['small_workshop', 1]], chance: 0.8, scale: HOUSE_SCALE });
  frontage({ road: lakeRoad, fromS: 20, toS: 240, spacing: 46, offsets: [10, 26], sides: [-1], kinds: [['farmhouse_a', 2], ['farmhouse_b', 2], ['small_workshop', 1]], chance: 0.7, scale: HOUSE_SCALE });

  // ---- home airfield: subzones around the existing hangar compound ------------------------
  const apron = WORLD_ANCHORS.homeApron;
  plain('home-apron', [apron.x - 2, apron.z + 4], 64, 58, 0, '#9a968c', 0.18);
  plain('home-parking', [206, -108], 26, 34, 0, '#6d7073', 0.19);
  plain('home-fuel-pad', [154, -101], 14, 20, 0, '#5a5c5e', 0.2);
  plain('home-maint-pad', [96, -136], 30, 30, 0, '#7f7c74', 0.19);
  // PERIMETER: chain-link fence on three sides with an airside gate; the runway side stays open apart from the gate.
  const fenceRun = (pts: Vec2[], kind: 'af_fence' | 'fence_seg', seg: number, gapAt?: Vec2, gapR = 0) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, z0] = pts[i], [x1, z1] = pts[i + 1];
      const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(len / seg)), dx = (x1 - x0) / len, dz = (z1 - z0) / len;
      for (let k = 0; k < n; k++) {
        const t = ((k + 0.5) / n) * len, x = x0 + dx * t, z = z0 + dz * t;
        if (gapAt && Math.hypot(x - gapAt[0], z - gapAt[1]) < gapR) continue;
        addProp(kind, x, z, kind === 'af_fence' ? Math.atan2(-dz, dx) : facing(dx, dz), (len / n) / seg);
      }
    }
  };
  fenceRun([[86, -168], [212, -168], [212, -50], [140, -50]], 'af_fence', 8.3, [212, -75], 9);
  addProp('af_gate', 86, -108, PI / 2, 1);
  addProp('af_gate', 212, -75, PI / 2, 1);
  // HANGAR / MAINTENANCE / FUEL / PARKING equipment.
  addForced('af_hangar_compound', 186, -150, -PI / 2, 0.9);
  addProp('af_ground_power', 104, -118, 0.3); addProp('af_ground_power', 158, -128, -0.4);
  addProp('af_tug', 100, -132, 1.4); addProp('af_taxiway_sign', 80, -86, PI / 2); addProp('af_stand_guidance', 121, -80, 0);
  addProp('af_chock', 132, -98, 0.2); addProp('af_chock', 112, -104, -0.3);
  addProp('af_cone_row', 108, -76, 0.1); addProp('af_cone_row', 148, -76, 0.1);
  addProp('af_bus', 204, -96, 0.05); addProp('af_bus', 206, -118, PI);
  for (let i = 0; i < 6; i++) addProp('barrel', 163 + (i % 3) * 1.4, -108 + Math.floor(i / 3) * 1.4, i, 1);
  for (let i = 0; i < 4; i++) addProp('crate', 92 + i * 1.6, -150, i * 0.4, 1);
  // Windbreak / perimeter hero trees (sparse, controlled).
  for (let i = 0; i < 7; i++) trees.push({ kind: 'broadleaf', x: 230 + (i % 2) * 6, z: -170 + i * 20, scale: 0.9 + rng.next() * 0.4, rotY: rng.next() * 6, tint: rng.next(), hero: true });

  // ---- second airfield: short, rough, farm-strip identity ---------------------------------
  const strip = WORLD_ANCHORS.secondAirfield;
  plain('strip2-surface', [strip.x, strip.z], 16, 172, 0, '#8ea25a', 0.14);
  plain('strip2-wear', [strip.x, strip.z], 4, 150, 0, '#a99a66', 0.16);
  plain('strip2-apron', [66, 640], 24, 30, 0, '#8a7a55', 0.17);
  addForced('small_workshop', 62, 655, PI / 2 + 0.1, 2.8);
  addProp('af_windsock', -26, 548, 0, 1.6);
  addProp('af_tug', 60, 628, 2.4);
  addProp('af_floodlight', 50, 676, 0, 0.8);
  for (let i = 0; i < 5; i++) addProp('barrel', 74 + (i % 3) * 1.3, 664 + Math.floor(i / 3) * 1.3, i, 1);
  addProp('af_cone_row', 0, 536, PI / 2); addProp('af_cone_row', 0, 704, PI / 2);
  fenceRun([[40, 690], [40, 720], [96, 720], [96, 690]], 'fence_seg', 4);
  fenceRun([[44, 594], [44, 566], [80, 566]], 'fence_seg', 4);
  for (let i = 0; i < 3; i++) addProp('hay_bale', 90 + i * 4, 610, i, 1);

  // ---- named farms -------------------------------------------------------------------------
  const yard = (a: Anchor, w: number, d: number, color = '#8d7a56') => plain(`yard-${a.id}`, [a.x, a.z], w, d, a.headingRad, color, 0.17);
  const windbreak = (a: Anchor, from: Vec2, to: Vec2, count: number) => {
    for (let i = 0; i < count; i++) {
      const t = i / Math.max(1, count - 1), [lx, lz] = [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
      const [x, z] = rot(a, lx, lz);
      trees.push({ kind: i % 3 === 0 ? 'broadleaf' : 'conifer', x, z, scale: 1.1 + rng.next() * 0.5, rotY: rng.next() * 6, tint: rng.next(), hero: false });
    }
  };
  const A = WORLD_ANCHORS.farmClusterA;
  yard(A, 84, 62);
  const at = (a: Anchor, kind: PropKind, lx: number, lz: number, ry: number, s: number) => { const [x, z] = rot(a, lx, lz); addForced(kind, x, z, ry + a.headingRad, s); };
  // Prominent farm: silos + big barn on the rise, house facing the lane.
  at(A, 'silo', -22, 12, 0, 1.3); at(A, 'silo', -22, -2, 0, 1.3); at(A, 'silo', -22, 26, 0, 1.0);
  at(A, 'barn_a', 8, 22, PI / 2, 3.9); at(A, 'barn_b', 8, -14, PI / 2, 3.0);
  at(A, 'farmhouse_a', 32, -12, -PI / 2, 2.0); at(A, 'small_workshop', 34, 14, -PI / 2, 2.3);
  for (let i = 0; i < 5; i++) { const [x, z] = rot(A, 24 + (i % 3) * 5, 28 + Math.floor(i / 3) * 5); addProp('hay_bale', x, z, i); }
  windbreak(A, [-44, -50], [-44, 50], 12); windbreak(A, [-44, 52], [40, 56], 10);
  const B = WORLD_ANCHORS.farmClusterB;
  yard(B, 60, 46);
  at(B, 'barn_a', -6, 10, PI / 2, 3.2); at(B, 'farmhouse_b', 20, -6, -PI / 2, 1.8); at(B, 'small_workshop', 20, 16, -PI / 2, 2.0);
  windbreak(B, [-30, -34], [-30, 34], 8); for (let i = 0; i < 4; i++) { const [x, z] = rot(B, 8 + i * 4, -26); addProp('hay_bale', x, z, i); }
  const J = WORLD_ANCHORS.remoteFarm;
  yard(J, 70, 54, '#86744f');
  at(J, 'farmhouse_a', 0, -8, PI, 1.9); at(J, 'barn_b', -22, 12, PI / 2, 3.4); at(J, 'small_workshop', 20, 10, -PI / 2, 2.2);
  windbreak(J, [-46, -40], [-46, 40], 10); windbreak(J, [-46, 42], [30, 46], 8);
  for (let i = 0; i < 6; i++) { const [x, z] = rot(J, -8 + (i % 3) * 4, 30 + Math.floor(i / 3) * 4); addProp('hay_bale', x, z, i); }
  fenceRun([rot(J, -40, -34), rot(J, 38, -34), rot(J, 38, 34)] as Vec2[], 'fence_seg', 4);

  // ---- lake village: dock and jetty ---------------------------------------------------------
  const dock = WORLD_ANCHORS.lakeDock;
  addForced('jetty', dock.x, dock.z + 26, 0, 1);
  addProp('hut', dock.x + 22, dock.z - 6, 0.4, 1); addProp('hut', dock.x - 26, dock.z - 10, -0.5, 1);
  for (let i = 0; i < 3; i++) addProp('crate', dock.x + 6 + i * 1.6, dock.z - 2, i, 1);
  plain('lake-dock-yard', [dock.x, dock.z - 14], 40, 34, 0, '#a19675', 0.17);
  plain('lake-village-square', [WORLD_ANCHORS.lakeVillage.x, WORLD_ANCHORS.lakeVillage.z], 40, 30, 0, '#8d8b84', 0.17);

  // ---- industrial / utility cluster ---------------------------------------------------------
  const I = WORLD_ANCHORS.industrialArea;
  plain('industrial-yard', [I.x, I.z], 150, 100, I.headingRad, '#6b6e70', 0.17);
  plain('industrial-parking', rot(I, -84, -30), 34, 36, I.headingRad, '#575a5d', 0.19);
  at(I, 'warehouse', 0, 24, 0, 1.0); at(I, 'warehouse', 0, -14, 0, 0.8);
  for (let i = 0; i < 4; i++) at(I, 'tank', 46 + (i % 2) * 20, -30 + Math.floor(i / 2) * 22, 0, 1.0 + (i % 2) * 0.15);
  at(I, 'stack', 60, 30, 0, 1.0); at(I, 'hut', -46, -30, 0.3, 1.0); at(I, 'silo', 44, 22, 0, 1.0);
  at(I, 'af_bus', -84, -30, 0.2, 1); at(I, 'af_tug', -76, -44, 1.0, 1); at(I, 'af_ground_power', -70, -20, 0.3, 1);
  for (let i = 0; i < 8; i++) { const [x, z] = rot(I, -24 + i * 1.5, -52); addProp('barrel', x, z, i); }
  for (let i = 0; i < 5; i++) { const [x, z] = rot(I, 20 + i * 1.7, -52); addProp('crate', x, z, i * 0.7); }
  fenceRun([rot(I, -90, -56), rot(I, 90, -56), rot(I, 90, 58), rot(I, -90, 58), rot(I, -90, -56)] as Vec2[], 'fence_seg', 4, rot(I, -90, -30), 12);
  // Utility tower on its own hill, fenced compound.
  const U = WORLD_ANCHORS.utilityTower;
  addForced('lattice_tower', U.x, U.z, 0, 1); addProp('hut', U.x + 12, U.z - 8, 0, 1);
  fenceRun([[U.x - 16, U.z - 14], [U.x + 16, U.z - 14], [U.x + 16, U.z + 14], [U.x - 16, U.z + 14], [U.x - 16, U.z - 14]], 'fence_seg', 4);
  plain('utility-pad', [U.x, U.z], 34, 30, 0, '#7d7a70', 0.17);
  // Eastern hills windmill + water tower on the village edge.
  const W = WORLD_ANCHORS.easternWindmill;
  addForced('windmill_landmark', W.x, W.z, 0.3, 5.5);

  // ---- utility poles along the industrial and airfield roads ---------------------------------
  for (const id of ['ROAD_INDUSTRIAL', 'ROAD_AIRFIELD', 'ROAD_VILLAGE'] as const) {
    const road = roadById(id);
    for (let s = 40; s < road.lengthM - 20; s += 55) {
      const p = road.points.reduce((best, q) => (Math.abs(q.s - s) < Math.abs(best.s - s) ? q : best));
      const off = road.def.widthM / 2 + 4.5;
      const x = p.x - p.tz * off, z = p.z + p.tx * off;
      if (okGround(x, z, 12) && !nearPad(x, z, 20)) addProp('pole', x, z, facing(p.tx, p.tz), 1);
    }
  }
  // Road signs at the junctions and pass.
  for (const [x, z, r] of [[262, 312, 0.6], [1010, 342, 0.3], [2090, 350, -0.4], [250, 470, -1.2]] as const) addProp('sign', x, z, r);

  // ---- field furniture: boundary trees / hedges / fences, bales ------------------------------
  for (const p of FIELD_PARCELS) {
    const c = Math.cos(p.headingRad), s = Math.sin(p.headingRad);
    const local = (lx: number, lz: number): Vec2 => [p.center[0] + lx * c + lz * s, p.center[1] - lx * s + lz * c];
    const hw = p.widthM / 2 + 4, hd = p.depthM / 2 + 4;
    const edges: Record<'n' | 's' | 'e' | 'w', [Vec2, Vec2]> = { n: [[-hw, hd], [hw, hd]], s: [[-hw, -hd], [hw, -hd]], e: [[hw, -hd], [hw, hd]], w: [[-hw, -hd], [-hw, hd]] };
    for (const [side, kind] of Object.entries(p.edges ?? {}) as Array<['n' | 's' | 'e' | 'w', string]>) {
      const [a, b] = edges[side].map(([lx, lz]) => local(lx, lz)) as [Vec2, Vec2];
      if (kind === 'fence') { fenceRun([a, b], 'fence_seg', 4); continue; }
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]), step = kind === 'trees' ? 11 : 6, n = Math.floor(len / step);
      for (let i = 0; i <= n; i++) {
        const t = i / Math.max(1, n), x = a[0] + (b[0] - a[0]) * t + (rng.next() - 0.5) * 3, z = a[1] + (b[1] - a[1]) * t + (rng.next() - 0.5) * 3;
        if (wet(x, z) || nearPad(x, z, 30) || roadDist(x, z) < 9) continue;
        trees.push({ kind: kind === 'trees' ? (rng.next() < 0.7 ? 'broadleaf' : 'conifer') : 'shrub', x, z, scale: kind === 'trees' ? 1.1 + rng.next() * 0.5 : 1.3 + rng.next() * 0.5, rotY: rng.next() * 6, tint: rng.next(), hero: false });
      }
    }
    if (p.crop === 'harvested' || p.crop === 'dry') {
      const n = p.crop === 'harvested' ? 14 : 5;
      for (let i = 0; i < n; i++) {
        const [x, z] = local((rng.next() - 0.5) * p.widthM * 0.85, (rng.next() - 0.5) * p.depthM * 0.85);
        addProp('hay_bale', x, z, rng.next() * 3, 1);
      }
    }
  }

  // ---- trees --------------------------------------------------------------------------------
  const extraExclusion = (x: number, z: number) => inExclusion(x, z);
  void nearRiver;
  trees.push(...generateTreeMasses({ grid, roadDist, inField, nearPad, wet, extraExclusion, rng }));
  addRoadsideTrees(roads, trees, { grid, wet, nearPad, inField, inExclusion: extraExclusion, rng });
  addVillageHeroTrees(lots, trees, rng, wet);

  // ---- rocks ---------------------------------------------------------------------------------
  const rocks = buildRockCompositions(input, roads, rng, { nearPad, inField, extraExclusion });

  return { roads, lots, props, trees, rocks, patches, exclusions };
}

// ----------------------------------------------------------------------------------------
// Vegetation masses
// ----------------------------------------------------------------------------------------

interface TreeCtx {
  grid: TerrainGridSampler;
  roadDist: (x: number, z: number) => number;
  inField: (x: number, z: number, m: number) => boolean;
  nearPad: (x: number, z: number, m: number) => boolean;
  wet: (x: number, z: number) => boolean;
  extraExclusion: (x: number, z: number) => boolean;
  rng: SeededRandom;
}

const noiseFor = (channel: string) => { const r = createSeededRandom(FIELD_COMPOSITION_SEED, channel); return createNoise2D(() => r.next()); };

/** 0..1 tree density at a point from geography masks: river woodland, lake ring, valley
 * patches, mountain forest patches, sparse high ground; never uniform. */
export function treeDensity(grid: TerrainGridSampler, patchN: (x: number, y: number) => number, x: number, z: number): number {
  const h = grid.height(x, z), slope = grid.slopeDeg(x, z);
  if (h < SEA_LEVEL_M + 1.5 || slope > 34) return 0;
  const dr = distanceToRiver(x, z);
  const lakeEdge = Math.hypot(x - FIELD_LAKE.x, z - FIELD_LAKE.z) - FIELD_LAKE.radiusM;
  const patch = smoothstep(-0.05, 0.4, patchN(x / 850, z / 850));
  const plain = homePlainMask(x, z);
  const river = dr < 30 ? 0 : 0.9 * Math.exp(-(((dr - 30) / 230) ** 2)) * (0.55 + 0.45 * patch);
  const lake = lakeEdge < 26 ? 0 : 0.7 * Math.exp(-(((lakeEdge - 26) / 190) ** 2)) * (0.5 + 0.5 * patch);
  const mountain = smoothstep(55, 150, h) * (1 - smoothstep(360, 500, h));
  const forest = mountain * patch * 0.78 * (1 - smoothstep(24, 34, slope));
  const valley = (1 - plain) * (1 - mountain) * patch * 0.24;
  const agri = plain * 0.02;
  const east = smoothstep(1500, 3200, -x) * patch * 0.22;
  return 1 - (1 - river) * (1 - lake) * (1 - forest) * (1 - valley) * (1 - agri) * (1 - east);
}

function generateTreeMasses(ctx: TreeCtx): TreePlacement[] {
  const { grid, roadDist, inField, nearPad, wet, extraExclusion, rng } = ctx;
  const patchN = noiseFor('tree-patch'), typeN = noiseFor('tree-type');
  const CELL = 84, EXTENT = 6300;
  interface Grove { x: number; z: number; d: number; score: number }
  const groves: Grove[] = [];
  for (let cx = -EXTENT; cx < EXTENT; cx += CELL) {
    for (let cz = -EXTENT; cz < EXTENT; cz += CELL) {
      const x = cx + rng.next() * CELL, z = cz + rng.next() * CELL;
      const roll = rng.next();
      const d = treeDensity(grid, patchN, x, z);
      if (d < 0.05 || roll > d * 1.15) continue;
      if (wet(x, z) || nearPad(x, z, 90) || inField(x, z, 8) || extraExclusion(x, z) || roadDist(x, z) < 14) continue;
      // Budget priority: water-side masses and land near the flown core beat remote mountain forest.
      const water = distanceToRiver(x, z) < 260 || Math.hypot(x - FIELD_LAKE.x, z - FIELD_LAKE.z) < FIELD_LAKE.radiusM + 260 ? 0.35 : 0;
      const core = 1 - 0.55 * smoothstep(1800, 6500, Math.hypot(x - 700, z - 900));
      groves.push({ x, z, d, score: (d + water) * core });
    }
  }
  const out: TreePlacement[] = [];
  // Highest-density groves win when the mobile budget is hit (keeps river/lake masses intact).
  groves.sort((a, b) => b.score - a.score || a.x - b.x || a.z - b.z);
  for (const g of groves) {
    const count = 4 + Math.round(g.d * 8);
    if (out.length + count > MAX_TREE_MASS_INSTANCES) continue;
    const h = grid.height(g.x, g.z);
    const conifer = h > 105 || typeN(g.x / 700, g.z / 700) > 0.35 + (h < 40 ? 0.4 : 0);
    for (let i = 0; i < count; i++) {
      const a = rng.next() * PI * 2, r = 6 + Math.sqrt(rng.next()) * 32;
      const x = g.x + Math.cos(a) * r, z = g.z + Math.sin(a) * r;
      if (wet(x, z) || nearPad(x, z, 70) || roadDist(x, z) < 10 || grid.slopeDeg(x, z) > 38 || inField(x, z, 4)) continue;
      out.push({ kind: conifer && rng.next() < 0.9 ? 'conifer' : 'broadleaf', x, z, scale: 1.0 + rng.next() * 0.9, rotY: rng.next() * 6.28, tint: rng.next(), hero: false });
    }
  }
  return out;
}

/** Occasional aligned groups along roads (an avenue here and there), not a continuous row. */
function addRoadsideTrees(roads: RoadPath[], out: TreePlacement[], c: { grid: TerrainGridSampler; wet: (x: number, z: number) => boolean; nearPad: (x: number, z: number, m: number) => boolean; inField: (x: number, z: number, m: number) => boolean; inExclusion: (x: number, z: number) => boolean; rng: SeededRandom }) {
  for (const road of roads) {
    if (road.def.surface === 'dirt' && road.def.id !== 'ROAD_FARM_A') continue;
    let s = 50 + c.rng.next() * 60;
    while (s < road.lengthM - 40) {
      const p = road.points.reduce((best, q) => (Math.abs(q.s - s) < Math.abs(best.s - s) ? q : best));
      if (!p.onBridge) {
        const side = c.rng.next() < 0.5 ? -1 : 1, n = 4 + Math.floor(c.rng.next() * 4), off = road.def.widthM / 2 + 6 + c.rng.next() * 3;
        const conifer = p.y > 90 || c.rng.next() < 0.25;
        for (let i = 0; i < n; i++) {
          const t = (i - n / 2) * 9;
          const x = p.x - p.tz * off * side + p.tx * t, z = p.z + p.tx * off * side + p.tz * t;
          if (c.wet(x, z) || c.nearPad(x, z, 50) || c.inField(x, z, 2) || c.inExclusion(x, z)) continue;
          out.push({ kind: conifer ? 'conifer' : 'broadleaf', x, z, scale: 1.05 + c.rng.next() * 0.45, rotY: c.rng.next() * 6.28, tint: c.rng.next(), hero: false });
        }
      }
      s += 120 + c.rng.next() * 190;
    }
  }
}

/** Near-detail trees beside village/farm buildings; these use the Quaternius GLBs. */
function addVillageHeroTrees(lots: Placement[], out: TreePlacement[], rng: SeededRandom, wet: (x: number, z: number) => boolean) {
  for (const lot of lots) {
    if (!(lot.kind === 'farmhouse_a' || lot.kind === 'farmhouse_b') || rng.next() < 0.35) continue;
    const a = rng.next() * PI * 2, r = 12 + rng.next() * 6, x = lot.x + Math.cos(a) * r, z = lot.z + Math.sin(a) * r;
    if (!wet(x, z)) out.push({ kind: rng.next() < 0.3 ? 'conifer' : 'broadleaf', x, z, scale: 0.9 + rng.next() * 0.5, rotY: rng.next() * 6.28, tint: rng.next(), hero: true });
  }
}

// ----------------------------------------------------------------------------------------
// Rock compositions
// ----------------------------------------------------------------------------------------

function buildRockCompositions(
  input: LayoutInput, roads: RoadPath[], rng: SeededRandom,
  ex: { nearPad: (x: number, z: number, m: number) => boolean; inField: (x: number, z: number, m: number) => boolean; extraExclusion: (x: number, z: number) => boolean },
): RockPlacement[] {
  const { grid, terrain } = input;
  const out: RockPlacement[] = [];
  const kinds = ['rock1', 'rock2', 'rock3'] as const;
  const wet = (x: number, z: number) => terrain.getWaterDepth(x, z) > 0 || grid.height(x, z) < SEA_LEVEL_M + 5;
  const cluster = (x: number, z: number, baseScale: number, n: number, spread: number) => {
    if (wet(x, z) || ex.nearPad(x, z, 60) || ex.inField(x, z, 2) || ex.extraExclusion(x, z)) return;
    for (let i = 0; i < n; i++) {
      const a = rng.next() * PI * 2, r = i === 0 ? 0 : spread * (0.4 + rng.next() * 0.6);
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      if (wet(px, pz)) continue;
      const scale = i === 0 ? baseScale : baseScale * (0.35 + rng.next() * 0.4);
      out.push({ kind: kinds[Math.floor(rng.next() * 3)], x: px, z: pz, scale, rotY: rng.next() * 6.28, tilt: (rng.next() - 0.5) * 0.4, large: scale > 5 });
    }
  };
  // Mountain shoulders / steep and high ground: existing scatter rule, grown into groups.
  for (const r of scatterFieldRocks(terrain)) cluster(r.x, r.z, r.scale, 1 + Math.floor(rng.next() * 3), 6 + r.scale * 2);
  // River cuts: rocky banks where the valley walls steepen.
  FIELD_RIVER_POINTS.forEach(([rx, rz], i) => {
    const q = FIELD_RIVER_POINTS[Math.min(FIELD_RIVER_POINTS.length - 1, i + 1)], len = Math.hypot(q[0] - rx, q[1] - rz) || 1;
    const nx = -(q[1] - rz) / len, nz = (q[0] - rx) / len;
    for (let k = 0; k < 6; k++) {
      const off = (rng.next() < 0.5 ? -1 : 1) * (70 + rng.next() * 190), x = rx + nx * off, z = rz + nz * off;
      if (grid.slopeDeg(x, z) < 4 || grid.height(x, z) > 200) continue;
      cluster(x, z, 1.8 + rng.next() * 2.2, 2 + Math.floor(rng.next() * 3), 7);
    }
  });
  // Lake shore: small groups just above the waterline.
  for (let i = 0; i < 46; i++) {
    const a = rng.next() * PI * 2, rr = FIELD_LAKE.radiusM + 14 + rng.next() * 60;
    cluster(FIELD_LAKE.x + Math.cos(a) * rr, FIELD_LAKE.z + Math.sin(a) * rr, 1.6 + rng.next() * 2.4, 2 + Math.floor(rng.next() * 3), 6);
  }
  // Mountain pass: outcrops flanking the road, more where the corridor narrows.
  const pass = roads.find((r) => r.def.id === 'ROAD_PASS')!;
  for (const p of pass.points) {
    if (p.z < 2150 || rng.next() > 0.16) continue;
    const side = rng.next() < 0.5 ? -1 : 1, off = 22 + rng.next() * 70;
    cluster(p.x - p.tz * off * side, p.z + p.tx * off * side, 2.5 + rng.next() * 4, 2 + Math.floor(rng.next() * 3), 9);
  }
  // Pass gate: two tall outcrops either side of the road, the region's distinctive formation.
  const g = WORLD_ANCHORS.passGate;
  for (const [ox, oz, s0] of [[-58, 0, 13], [-70, 22, 9], [-52, -24, 8], [62, 6, 14], [78, -16, 9.5], [56, 30, 8]] as const) {
    const x = g.x + ox, z = g.z + oz;
    out.push({ kind: kinds[out.length % 3], x, z, scale: s0, rotY: rng.next() * 6.28, tilt: 0.05, large: true });
    out.push({ kind: kinds[(out.length + 1) % 3], x: x + 3, z: z + 4, scale: s0 * 0.6, rotY: rng.next() * 6.28, tilt: -0.1, large: true });
  }
  // Saddle cairn field at the top of the pass.
  const n = WORLD_ANCHORS.northPass;
  for (let i = 0; i < 9; i++) { const a = rng.next() * PI * 2, r = 25 + rng.next() * 90; cluster(n.x + Math.cos(a) * r, n.z - 60 + Math.sin(a) * r, 3 + rng.next() * 4, 3, 10); }
  return out;
}
