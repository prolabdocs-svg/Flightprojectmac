import { distanceToRiver, FIELD_LAKE, lakeEdgeDistance, lakeShoreRadius, FIELD_RIVER_POINTS, homePlainMask, SEA_LEVEL_M, smoothstep } from './fieldGeography';
import { scatterFieldRocks } from './fieldRocks';
import { authoredCountryside, COUNTRY_PARCELS } from './fieldCountryside';
import {
  FIELD_COMPOSITION_SEED, FIELD_PARCELS, MAX_TREE_MASS_INSTANCES, ROADS, WORLD_ANCHORS,
  type CropKind, type Vec2,
} from './fieldComposition';
import {
  buildRegionLayout, type CompositionContext, type LayoutInput, type PropKind,
  type RegionCompositionSpec, type RegionLayout,
} from './regionPlacement';
import type { TerrainGridSampler } from './terrainHeightfield';

/**
 * The Field's DATA for the shared composer (`regionPlacement.ts`). This file used to *be* the
 * composer; every algorithm it owned (frontage, fences, compounds, tree masses, rock clusters)
 * now lives in regionPlacement.ts and is shared with every other region. What is left here is
 * The Field's authored content: which anchors get what, which road frontages build out, and
 * the region's tree-density field.
 */

// Re-exported so existing importers (render/fieldWorld.ts, tests) keep working; the types are
// owned by regionPlacement.ts now.
export type {
  AirfieldKind, BlenderKind, FieldLayout, GroundPatch, LayoutInput, Placement, ProcKind, PropKind,
  RegionLayout, RockPlacement, TreePlacement,
} from './regionPlacement';

const PI = Math.PI;

const CROP_COLORS: Record<CropKind, string[]> = {
  green: ['#4f8a34', '#58923a'],
  dry: ['#c2ac58', '#b8a250'],
  bare: ['#8b6c48', '#93744e'],
  grass: ['#8cb45a', '#84ae56'],
  harvested: ['#c8b67c', '#bfae74'],
};

/** 0..1 tree density at a point from geography masks: river woodland, lake ring, valley
 * patches, mountain forest patches, sparse high ground; never uniform. */
export function treeDensity(grid: TerrainGridSampler, patchN: (x: number, y: number) => number, x: number, z: number): number {
  const h = grid.height(x, z), slope = grid.slopeDeg(x, z);
  if (h < SEA_LEVEL_M + 1.5 || slope > 34) return 0;
  const dr = distanceToRiver(x, z);
  const lakeEdge = lakeEdgeDistance(x, z);
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

const HOUSE_SCALE = { farmhouse_a: [1.9, 2.4], farmhouse_b: [1.9, 2.4], small_workshop: [2.8, 3.4], barn_a: [3.2, 4.0], barn_b: [3.2, 4.0] } as Record<string, [number, number]>;
const VILLAGE_KINDS: Array<[PropKind, number]> = [['farmhouse_a', 4], ['farmhouse_b', 4], ['small_workshop', 2], ['barn_b', 1.2]];

function authoredField(ctx: CompositionContext): void {
  const { rng } = ctx;
  const A_ = WORLD_ANCHORS;

  // Reserved places first: tree masses and lots avoid them.
  ctx.ex(A_.villageCore, 56);
  ctx.ex({ x: 120, z: 290 }, 14); // water tower
  ctx.ex({ x: -40, z: 20 }, 16); // runway-side workshop
  ctx.ex(A_.homeApron, 78);
  ctx.ex({ x: 172, z: -62 }, 22);
  ctx.ex({ x: A_.industrialArea.x, z: A_.industrialArea.z }, 120);
  ctx.ex(A_.farmClusterA, 75);
  ctx.ex(A_.farmClusterB, 60);
  ctx.ex(A_.remoteFarm, 60);
  ctx.ex(A_.lakeVillage, 110);
  ctx.ex(A_.utilityTower, 30);
  ctx.ex(A_.secondAirfield, 50); // strip surroundings kept open apart from authored dressing

  // ---- roadside lots: the single rule that makes settlement structure -------------------
  const village = ctx.roadById('ROAD_VILLAGE'), main = ctx.roadById('ROAD_MAIN'),
    airfieldRoad = ctx.roadById('ROAD_AIRFIELD'), lakeRoad = ctx.roadById('ROAD_LAKE');
  ctx.frontage({ road: village, fromS: 10, toS: village.lengthM - 30, spacing: 30, offsets: [10, 24], sides: [-1, 1], kinds: VILLAGE_KINDS, chance: 0.86, scale: HOUSE_SCALE });
  ctx.frontage({ road: main, fromS: main.lengthM - 330, toS: main.lengthM - 30, spacing: 34, offsets: [10, 26], sides: [-1, 1], kinds: VILLAGE_KINDS, chance: 0.75, scale: HOUSE_SCALE });
  ctx.frontage({ road: airfieldRoad, fromS: airfieldRoad.lengthM - 180, toS: airfieldRoad.lengthM - 40, spacing: 52, offsets: [12, 26], sides: [-1], kinds: [['farmhouse_b', 2], ['small_workshop', 2]], chance: 0.8, scale: HOUSE_SCALE });
  // Secondary settlement on the lake shore (smaller, houses only).
  ctx.frontage({ road: main, fromS: 0, toS: 220, spacing: 40, offsets: [10, 22], sides: [-1, 1], kinds: [['farmhouse_a', 3], ['farmhouse_b', 3], ['small_workshop', 1]], chance: 0.8, scale: HOUSE_SCALE });
  ctx.frontage({ road: lakeRoad, fromS: 20, toS: 240, spacing: 46, offsets: [10, 26], sides: [-1], kinds: [['farmhouse_a', 2], ['farmhouse_b', 2], ['small_workshop', 1]], chance: 0.7, scale: HOUSE_SCALE });

  // ---- home airfield: subzones around the existing hangar compound ----------------------
  const apron = A_.homeApron;
  ctx.plain('home-apron', [apron.x - 2, apron.z + 4], 64, 58, 0, '#9a968c', 0.18);
  ctx.plain('home-parking', [206, -108], 26, 34, 0, '#6d7073', 0.19);
  ctx.plain('home-fuel-pad', [154, -101], 14, 20, 0, '#5a5c5e', 0.2);
  ctx.plain('home-maint-pad', [96, -136], 30, 30, 0, '#7f7c74', 0.19);
  // Worn taxi tracks (trodden grass band + two wheel ruts): strip -> airside gate -> apron, and
  // strip -> the runway-side workshop's apron. Patches, not ROADS, so no traffic/map road.
  const taxiTrack = (id: string, [x0, z0]: Vec2, [x1, z1]: Vec2, w: number) => {
    const len = Math.hypot(x1 - x0, z1 - z0), h = Math.atan2(x1 - x0, z1 - z0), c: Vec2 = [(x0 + x1) / 2, (z0 + z1) / 2];
    ctx.plain(`${id}-worn`, c, w, len, h, '#8e9361', 0.15);
    for (const s of [-1, 1]) ctx.plain(`${id}-rut${s}`, [c[0] + Math.cos(h) * s * w * 0.17, c[1] - Math.sin(h) * s * w * 0.17], w * 0.14, len, h, '#93774d', 0.17);
  };
  taxiTrack('home-taxi-a', [11, -92], [52, -99], 8);
  taxiTrack('home-taxi-b', [50, -99], [100, -106], 8);
  taxiTrack('workshop-taxi', [-11, 29], [-30, 31], 7);
  // PERIMETER: chain-link fence on three sides with an airside gate.
  ctx.fenceRun([[86, -168], [212, -168], [212, -50], [140, -50]], 'af_fence', 8.3, [212, -75], 9);
  ctx.addProp('af_gate', 86, -108, PI / 2, 1);
  ctx.addProp('af_gate', 212, -75, PI / 2, 1);
  // HANGAR / MAINTENANCE / FUEL / PARKING equipment.
  ctx.addForced('af_hangar_compound', 186, -150, -PI / 2, 0.9);
  ctx.addProp('af_ground_power', 104, -118, 0.3); ctx.addProp('af_ground_power', 158, -128, -0.4);
  ctx.addProp('af_tug', 100, -132, 1.4); ctx.addProp('af_taxiway_sign', 80, -86, PI / 2); ctx.addProp('af_stand_guidance', 121, -80, 0);
  ctx.addProp('af_chock', 132, -98, 0.2); ctx.addProp('af_chock', 112, -104, -0.3);
  ctx.addProp('af_cone_row', 108, -76, 0.1); ctx.addProp('af_cone_row', 148, -76, 0.1);
  ctx.addProp('af_bus', 204, -96, 0.05); ctx.addProp('af_bus', 206, -118, PI);
  for (let i = 0; i < 6; i++) ctx.addProp('barrel', 163 + (i % 3) * 1.4, -108 + Math.floor(i / 3) * 1.4, i, 1);
  for (let i = 0; i < 4; i++) ctx.addProp('crate', 92 + i * 1.6, -150, i * 0.4, 1);
  // Windbreak / perimeter hero trees (sparse, controlled).
  for (let i = 0; i < 7; i++) ctx.addTree('canopy', 230 + (i % 2) * 6, -170 + i * 20, 0.9 + rng.next() * 0.4, rng.next() * 6, rng.next(), true);

  // ---- second airfield: short, rough, farm-strip identity -------------------------------
  const strip = A_.secondAirfield;
  ctx.plain('strip2-surface', [strip.x, strip.z], 16, 172, 0, '#8ea25a', 0.14);
  ctx.plain('strip2-wear', [strip.x, strip.z], 4, 150, 0, '#a99a66', 0.16);
  ctx.plain('strip2-apron', [66, 640], 24, 30, 0, '#8a7a55', 0.17);
  ctx.addForced('small_workshop', 62, 655, PI / 2 + 0.1, 2.8);
  ctx.addProp('af_windsock', -26, 548, 0, 1.6);
  ctx.addProp('af_tug', 60, 628, 2.4);
  ctx.addProp('af_floodlight', 50, 676, 0, 0.8);
  for (let i = 0; i < 5; i++) ctx.addProp('barrel', 74 + (i % 3) * 1.3, 664 + Math.floor(i / 3) * 1.3, i, 1);
  ctx.addProp('af_cone_row', 0, 536, PI / 2); ctx.addProp('af_cone_row', 0, 704, PI / 2);
  ctx.fenceRun([[40, 690], [40, 720], [96, 720], [96, 690]], 'fence_seg', 4);
  ctx.fenceRun([[44, 594], [44, 566], [80, 566]], 'fence_seg', 4);
  for (let i = 0; i < 3; i++) ctx.addProp('hay_bale', 90 + i * 4, 610, i, 1);

  // ---- named farms -----------------------------------------------------------------------
  const A = A_.farmClusterA;
  ctx.yard(A, 84, 62);
  ctx.at(A, 'silo', -22, 12, 0, 1.3); ctx.at(A, 'silo', -22, -2, 0, 1.3); ctx.at(A, 'silo', -22, 26, 0, 1.0);
  ctx.at(A, 'barn_a', 8, 22, PI / 2, 3.9); ctx.at(A, 'barn_b', 8, -14, PI / 2, 3.0);
  ctx.at(A, 'farmhouse_a', 32, -12, -PI / 2, 2.0); ctx.at(A, 'small_workshop', 34, 14, -PI / 2, 2.3);
  for (let i = 0; i < 5; i++) { const [x, z] = ctx.rot(A, 24 + (i % 3) * 5, 28 + Math.floor(i / 3) * 5); ctx.addProp('hay_bale', x, z, i); }
  ctx.windbreak(A, [-44, -50], [-44, 50], 12); ctx.windbreak(A, [-44, 52], [40, 56], 10);
  const B = A_.farmClusterB;
  ctx.yard(B, 60, 46);
  ctx.at(B, 'barn_a', -6, 10, PI / 2, 3.2); ctx.at(B, 'farmhouse_b', 20, -6, -PI / 2, 1.8); ctx.at(B, 'small_workshop', 20, 16, -PI / 2, 2.0);
  ctx.windbreak(B, [-30, -34], [-30, 34], 8);
  for (let i = 0; i < 4; i++) { const [x, z] = ctx.rot(B, 8 + i * 4, -26); ctx.addProp('hay_bale', x, z, i); }
  const J = A_.remoteFarm;
  ctx.yard(J, 70, 54, '#86744f');
  ctx.at(J, 'farmhouse_a', 0, -8, PI, 1.9); ctx.at(J, 'barn_b', -22, 12, PI / 2, 3.4); ctx.at(J, 'small_workshop', 20, 10, -PI / 2, 2.2);
  ctx.windbreak(J, [-46, -40], [-46, 40], 10); ctx.windbreak(J, [-46, 42], [30, 46], 8);
  for (let i = 0; i < 6; i++) { const [x, z] = ctx.rot(J, -8 + (i % 3) * 4, 30 + Math.floor(i / 3) * 4); ctx.addProp('hay_bale', x, z, i); }
  ctx.fenceRun([ctx.rot(J, -40, -34), ctx.rot(J, 38, -34), ctx.rot(J, 38, 34)] as Vec2[], 'fence_seg', 4);

  // ---- lake village: dock and jetty -------------------------------------------------------
  const dock = A_.lakeDock;
  ctx.addForced('jetty', dock.x, dock.z + 26, 0, 1);
  ctx.addProp('hut', dock.x + 22, dock.z - 6, 0.4, 1); ctx.addProp('hut', dock.x - 26, dock.z - 10, -0.5, 1);
  for (let i = 0; i < 3; i++) ctx.addProp('crate', dock.x + 6 + i * 1.6, dock.z - 2, i, 1);
  ctx.plain('lake-dock-yard', [dock.x, dock.z - 14], 40, 34, 0, '#a19675', 0.17);
  ctx.plain('lake-village-square', [A_.lakeVillage.x, A_.lakeVillage.z], 40, 30, 0, '#8d8b84', 0.17);

  // ---- industrial / utility cluster -------------------------------------------------------
  const I = A_.industrialArea;
  ctx.plain('industrial-yard', [I.x, I.z], 150, 100, I.headingRad, '#6b6e70', 0.17);
  ctx.plain('industrial-parking', ctx.rot(I, -84, -30), 34, 36, I.headingRad, '#575a5d', 0.19);
  ctx.at(I, 'warehouse', 0, 24, 0, 1.0); ctx.at(I, 'warehouse', 0, -14, 0, 0.8);
  for (let i = 0; i < 4; i++) ctx.at(I, 'tank', 46 + (i % 2) * 20, -30 + Math.floor(i / 2) * 22, 0, 1.0 + (i % 2) * 0.15);
  ctx.at(I, 'stack', 60, 30, 0, 1.0); ctx.at(I, 'hut', -46, -30, 0.3, 1.0); ctx.at(I, 'silo', 44, 22, 0, 1.0);
  ctx.at(I, 'af_bus', -84, -30, 0.2, 1); ctx.at(I, 'af_tug', -76, -44, 1.0, 1); ctx.at(I, 'af_ground_power', -70, -20, 0.3, 1);
  for (let i = 0; i < 8; i++) { const [x, z] = ctx.rot(I, -24 + i * 1.5, -52); ctx.addProp('barrel', x, z, i); }
  for (let i = 0; i < 5; i++) { const [x, z] = ctx.rot(I, 20 + i * 1.7, -52); ctx.addProp('crate', x, z, i * 0.7); }
  ctx.fenceRun([ctx.rot(I, -90, -56), ctx.rot(I, 90, -56), ctx.rot(I, 90, 58), ctx.rot(I, -90, 58), ctx.rot(I, -90, -56)] as Vec2[], 'fence_seg', 4, ctx.rot(I, -90, -30), 12);
  // Utility tower on its own hill, fenced compound.
  const U = A_.utilityTower;
  ctx.addForced('lattice_tower', U.x, U.z, 0, 1); ctx.addProp('hut', U.x + 12, U.z - 8, 0, 1);
  ctx.fenceRun([[U.x - 16, U.z - 14], [U.x + 16, U.z - 14], [U.x + 16, U.z + 14], [U.x - 16, U.z + 14], [U.x - 16, U.z - 14]], 'fence_seg', 4);
  ctx.plain('utility-pad', [U.x, U.z], 34, 30, 0, '#7d7a70', 0.17);
  // Eastern hills windmill.
  const W = A_.easternWindmill;
  ctx.addForced('windmill_landmark', W.x, W.z, 0.3, 5.5);

  // ---- V2: the country beyond the basin (fieldCountryside.ts) ----------------------------------
  authoredCountryside(ctx);

  // ---- utility poles along the industrial and airfield roads -------------------------------
  for (const id of ['ROAD_INDUSTRIAL', 'ROAD_AIRFIELD', 'ROAD_VILLAGE'] as const) {
    const road = ctx.roadById(id);
    for (let s = 40; s < road.lengthM - 20; s += 55) {
      const p = road.points.reduce((best, q) => (Math.abs(q.s - s) < Math.abs(best.s - s) ? q : best));
      const off = road.def.widthM / 2 + 4.5;
      const x = p.x - p.tz * off, z = p.z + p.tx * off;
      if (ctx.okGround(x, z, 12) && !ctx.nearPad(x, z, 20)) ctx.addProp('pole', x, z, Math.atan2(p.tx, p.tz), 1);
    }
  }
  // Road signs at the junctions and pass.
  for (const [x, z, r] of [[262, 312, 0.6], [1010, 342, 0.3], [2090, 350, -0.4], [250, 470, -1.2]] as const) ctx.addProp('sign', x, z, r);
}

function fieldRocks(ctx: CompositionContext): void {
  const { rng, grid, terrain } = ctx;
  // Mountain shoulders / steep and high ground: existing scatter rule, grown into groups.
  for (const r of scatterFieldRocks(terrain)) ctx.rockCluster(r.x, r.z, r.scale, 1 + Math.floor(rng.next() * 3), 6 + r.scale * 2);
  // River cuts: rocky banks where the valley walls steepen.
  FIELD_RIVER_POINTS.forEach(([rx, rz], i) => {
    const q = FIELD_RIVER_POINTS[Math.min(FIELD_RIVER_POINTS.length - 1, i + 1)], len = Math.hypot(q[0] - rx, q[1] - rz) || 1;
    const nx = -(q[1] - rz) / len, nz = (q[0] - rx) / len;
    for (let k = 0; k < 6; k++) {
      const off = (rng.next() < 0.5 ? -1 : 1) * (70 + rng.next() * 190), x = rx + nx * off, z = rz + nz * off;
      if (grid.slopeDeg(x, z) < 4 || grid.height(x, z) > 200) continue;
      ctx.rockCluster(x, z, 1.8 + rng.next() * 2.2, 2 + Math.floor(rng.next() * 3), 7);
    }
  });
  // Lake shore: small groups just above the waterline.
  for (let i = 0; i < 46; i++) {
    const a = rng.next() * PI * 2, rr = lakeShoreRadius(a) + 14 + rng.next() * 60;
    ctx.rockCluster(FIELD_LAKE.x + Math.cos(a) * rr, FIELD_LAKE.z + Math.sin(a) * rr, 1.6 + rng.next() * 2.4, 2 + Math.floor(rng.next() * 3), 6);
  }
  // Mountain pass: outcrops flanking the road, more where the corridor narrows.
  const pass = ctx.roadById('ROAD_PASS');
  for (const p of pass.points) {
    if (p.z < 2150 || rng.next() > 0.16) continue;
    const side = rng.next() < 0.5 ? -1 : 1, off = 22 + rng.next() * 70;
    ctx.rockCluster(p.x - p.tz * off * side, p.z + p.tx * off * side, 2.5 + rng.next() * 4, 2 + Math.floor(rng.next() * 3), 9);
  }
  // Pass gate: two tall outcrops either side of the road, the region's distinctive formation.
  const g = WORLD_ANCHORS.passGate;
  const kinds = ['rock1', 'rock2', 'rock3'] as const;
  for (const [ox, oz, s0] of [[-58, 0, 13], [-70, 22, 9], [-52, -24, 8], [62, 6, 14], [78, -16, 9.5], [56, 30, 8]] as const) {
    const x = g.x + ox * 1.4, z = g.z + oz * 1.4;
    ctx.addRock(kinds[ctx.rocks.length % 3], x, z, s0 * 2.3, rng.next() * 6.28, 0.05, true);
    ctx.addRock(kinds[(ctx.rocks.length + 1) % 3], x + 8, z + 10, s0 * 1.4, rng.next() * 6.28, -0.1, true);
  }
  // Saddle cairn field at the top of the pass.
  const n = WORLD_ANCHORS.northPass;
  for (let i = 0; i < 9; i++) { const a = rng.next() * PI * 2, r = 25 + rng.next() * 90; ctx.rockCluster(n.x + Math.cos(a) * r, n.z - 60 + Math.sin(a) * r, 3 + rng.next() * 4, 3, 10); }
}

export const FIELD_COMPOSITION: RegionCompositionSpec = {
  regionId: 'the_field',
  terrain: 'meadow',
  seed: FIELD_COMPOSITION_SEED,
  anchors: WORLD_ANCHORS,
  roads: ROADS,
  parcels: [...FIELD_PARCELS, ...COUNTRY_PARCELS],
  parcelColors: CROP_COLORS,
  seaLevelM: SEA_LEVEL_M,
  maxTreeInstances: MAX_TREE_MASS_INSTANCES,
  densityAnchors: [
    { x: 0, z: 0, coreRadiusM: 170, falloffM: 380, level: 5 },
    { x: WORLD_ANCHORS.villageCore.x, z: WORLD_ANCHORS.villageCore.z, coreRadiusM: 180, falloffM: 520, level: 4 },
    { x: WORLD_ANCHORS.industrialArea.x, z: WORLD_ANCHORS.industrialArea.z, coreRadiusM: 190, falloffM: 420, level: 4 },
    { x: WORLD_ANCHORS.lakeVillage.x, z: WORLD_ANCHORS.lakeVillage.z, coreRadiusM: 170, falloffM: 460, level: 3 },
    { x: WORLD_ANCHORS.secondAirfield.x, z: WORLD_ANCHORS.secondAirfield.z, coreRadiusM: 130, falloffM: 300, level: 3 },
    { x: WORLD_ANCHORS.southTown.x, z: WORLD_ANCHORS.southTown.z, coreRadiusM: 300, falloffM: 600, level: 4 },
    { x: WORLD_ANCHORS.estuaryVillage.x, z: WORLD_ANCHORS.estuaryVillage.z, coreRadiusM: 160, falloffM: 400, level: 3 },
    { x: WORLD_ANCHORS.eastHamlet.x, z: WORLD_ANCHORS.eastHamlet.z, coreRadiusM: 140, falloffM: 360, level: 3 },
    { x: WORLD_ANCHORS.westHamlet.x, z: WORLD_ANCHORS.westHamlet.z, coreRadiusM: 140, falloffM: 360, level: 3 },
  ],
  treeDensity,
  treeMass: {
    cellM: 84, extentM: 6300, core: [700, 900], coreFalloff: [1800, 6500],
    priority: (x, z) => (distanceToRiver(x, z) < 260 || lakeEdgeDistance(x, z) < 260 ? 0.35 : 0),
  },
  buildingKeepOut: (x, z) => distanceToRiver(x, z) < 90,
  roadsideAvenue: (def) => ((def.surface === 'dirt' && def.id !== 'ROAD_FARM_A') || def.id.startsWith('ROAD_TOWN') ? null : { wide: def.id === 'ROAD_PASS' }),
  authored: authoredField,
  rocks: fieldRocks,
};

export function buildFieldLayout(input: LayoutInput): RegionLayout {
  return buildRegionLayout(FIELD_COMPOSITION, input);
}
