import {
  CANYON_HALF_W, CANYON_MIN_M, CANYON_WASH_POINTS,
  distanceToWash, smoothstep,
} from '../canyonGeography';
import type { Anchor, CropKind, RoadDef, Vec2 } from '../fieldComposition';
import type { CompositionContext, PropKind, RegionCompositionSpec } from '../regionPlacement';
import type { TerrainGridSampler } from '../terrainHeightfield';

/**
 * Red Canyon's DATA for the shared composer (`regionPlacement.ts`). Same *shape* as
 * `fieldPlacement.ts`'s FIELD_COMPOSITION, entirely different *content* — that is the whole
 * point: no second placement pipeline exists.
 *
 * Identity (REGION_ART_BIBLE.canyon): dirt-trail roads, settlementDensityBias 0.2, geology
 * red_sandstone/eroded_mesa/dry_wash_gravel, vegetation desert_scrub/canyon_cottonwood/cactus.
 * The D4 core here is a salvage/mining camp (huts, ore hoppers, tanks, scrap), never a village.
 */

const PI = Math.PI;
const anchor = (id: string, x: number, z: number, radiusM: number, headingRad = 0): Anchor =>
  ({ id, district: 'A', x, z, headingRad, radiusM });

export const CANYON_ANCHORS = {
  /** red_canyon_mesa (airfields.ts) sits here; the graded pad is r=140. */
  mesaAirfield: anchor('mesaAirfield', 60, 320, 140),
  // Inside the flat graded pad (r=140) but clear of the 22 m runway strip at x=49..71.
  opsApron: anchor('opsApron', 152, 262, 60, -0.35),
  /** D4 core: the salvage/mining camp the whole region's economy hangs off. */
  miningCamp: anchor('miningCamp', 430, 700, 120, 0.25),
  scrapYard: anchor('scrapYard', 590, 545, 80, -0.5),
  /** Rim trailhead where the dirt track stops above the dry wash. */
  washTrailhead: anchor('washTrailhead', -470, 560, 45, 1.1),
  /** The region's VFR landmark (landmarks.ts: red_canyon_pinnacle). */
  pinnacle: anchor('pinnacle', 700, 1050, 90),
} as const satisfies Record<string, Anchor>;

export const CANYON_ROADS: ReadonlyArray<RoadDef> = [
  // Apron -> mining camp: the one real road-to-settlement chain. Dirt, per roadCharacter.
  { id: 'ROAD_CANYON_CAMP', surface: 'dirt', widthM: 5.5, priority: 3, points: [[178, 280], [240, 340], [300, 450], [360, 560], [420, 672]] },
  // Camp -> scrap yard spur.
  { id: 'ROAD_CANYON_YARD', surface: 'dirt', widthM: 4, priority: 2, points: [[430, 690], [500, 640], [560, 585], [588, 552]] },
  // Camp -> rim overlook below the pinnacle.
  { id: 'ROAD_CANYON_RIM', surface: 'dirt', widthM: 3.5, priority: 1, points: [[440, 716], [520, 830], [600, 940], [668, 1010]] },
  // Apron -> wash trailhead: loops SOUTH of the runway (crosses its axis ~210 m past the
  // threshold) so nothing sits in the approach, then west to the rim above the dry wash.
  { id: 'ROAD_CANYON_WASH', surface: 'dirt', widthM: 4, priority: 2, points: [[150, 232], [150, 120], [60, 10], [-100, 90], [-280, 300], [-440, 540]] },
];

/** No agriculture in the badlands — the composer's parcel passes simply have nothing to do. */
const NO_PARCEL_COLORS: Record<CropKind, string[]> = {
  green: ['#6b6f45'], dry: ['#b08a54'], bare: ['#8a4f30'], grass: ['#8a8a5a'], harvested: ['#b99a6a'],
};

/** Dry-wash cottonwood ribbon + sparse bench scrub. Never uniform, never a forest. */
function canyonTreeDensity(grid: TerrainGridSampler, patchN: (x: number, y: number) => number, x: number, z: number): number {
  const slope = grid.slopeDeg(x, z);
  if (slope > 28) return 0;
  const patch = smoothstep(-0.1, 0.45, patchN(x / 700, z / 700));
  const wash = distanceToWash(x, z);
  // Cottonwoods hug the wash floor; they stop dead at the wall.
  const riparian = wash < CANYON_HALF_W + 40 ? 0.62 * (0.45 + 0.55 * patch) : 0;
  // Side-canyon mouths keep a little shade.
  const feeder = (1 - smoothstep(CANYON_HALF_W + 40, 900, wash)) * patch * 0.2;
  // Open mesa: only the occasional clump, and only where the strata aren't steep.
  const bench = patch * 0.1 * (1 - smoothstep(14, 26, slope));
  return 1 - (1 - riparian) * (1 - feeder) * (1 - bench);
}

/** Salvage-camp kit. Deliberately shares zero entries with The Field's villageKinds. */
const CAMP_KINDS: Array<[PropKind, number]> = [['hut', 5], ['af_crew_building', 2], ['tank', 1.6], ['silo', 1.2]];
const CAMP_SCALE = { hut: [1.6, 2.4], af_crew_building: [0.8, 1.0], tank: [0.8, 1.1], silo: [0.9, 1.2] } as Record<string, [number, number]>;

function authoredCanyon(ctx: CompositionContext): void {
  const { rng } = ctx;
  const A = CANYON_ANCHORS;

  ctx.ex(A.opsApron, 70);
  ctx.ex(A.miningCamp, 95);
  ctx.ex(A.scrapYard, 70);
  ctx.ex(A.washTrailhead, 40);
  ctx.ex(A.pinnacle, 130);

  // ---- mining camp frontage: the road -> settlement chain -------------------------------
  const camp = ctx.roadById('ROAD_CANYON_CAMP');
  ctx.frontage({ road: camp, fromS: camp.lengthM - 260, toS: camp.lengthM - 20, spacing: 26, offsets: [9, 20], sides: [-1, 1], kinds: CAMP_KINDS, chance: 0.82, scale: CAMP_SCALE });
  const yard = ctx.roadById('ROAD_CANYON_YARD');
  ctx.frontage({ road: yard, fromS: 20, toS: yard.lengthM - 15, spacing: 30, offsets: [8, 18], sides: [-1], kinds: [['hut', 3], ['tank', 2]], chance: 0.7, scale: CAMP_SCALE });

  // ---- airfield ops: apron, fence, windsock, fuel --------------------------------------
  const apron = A.opsApron;
  ctx.plain('canyon-apron', [apron.x, apron.z], 56, 46, apron.headingRad, '#9a6a4a', 0.18);
  ctx.plain('canyon-fuel-pad', ctx.rot(apron, 18, -12), 14, 16, apron.headingRad, '#7b4c33', 0.2);
  ctx.plain('canyon-parking', ctx.rot(apron, -20, 14), 22, 24, apron.headingRad, '#8a5c40', 0.19);
  ctx.fenceRun([ctx.rot(apron, -32, -26), ctx.rot(apron, 32, -26), ctx.rot(apron, 32, 24)] as Vec2[], 'af_fence', 8.3);
  ctx.addProp('af_gate', ...ctx.rot(apron, 32, -2), apron.headingRad + PI / 2, 1);
  ctx.addForced('af_gse_store', ...ctx.rot(apron, -16, -18), apron.headingRad, 1);
  ctx.addProp('af_fuel_bowser', ...ctx.rot(apron, 18, -12), apron.headingRad, 1);
  ctx.addProp('af_windsock', 60, 190, 0, 1.6);
  ctx.addProp('af_tug', ...ctx.rot(apron, 4, 6), 1.2, 1);
  ctx.addProp('af_floodlight', ...ctx.rot(apron, -28, 20), 0, 0.9);
  ctx.addProp('af_cone_row', 60, 200, PI / 2); ctx.addProp('af_cone_row', 60, 440, PI / 2);
  for (let i = 0; i < 6; i++) ctx.addProp('barrel', ...ctx.rot(apron, 22 + (i % 3) * 1.4, -4 + Math.floor(i / 3) * 1.4), i, 1);

  // ---- mining camp core: ore hoppers, tanks, scrap, a water tower ------------------------
  const M = A.miningCamp;
  ctx.yard(M, 86, 66, '#7d5238');
  ctx.at(M, 'silo', -20, 14, 0, 1.4); ctx.at(M, 'silo', -20, 0, 0, 1.4);
  ctx.at(M, 'warehouse', 6, 24, 0, 0.7);
  ctx.at(M, 'tank', 26, -14, 0, 1.1); ctx.at(M, 'tank', 26, 4, 0, 0.9);
  ctx.at(M, 'hut', -30, -22, 0.2, 2.0); ctx.at(M, 'hut', -18, -26, -0.3, 1.8);
  ctx.at(M, 'af_crew_building', 34, 20, -PI / 2, 1);
  ctx.at(M, 'lattice_tower', -40, 26, 0, 0.8);
  ctx.at(M, 'water_tower', 40, -28, 0, 2.2);
  for (let i = 0; i < 10; i++) { const [x, z] = ctx.rot(M, -6 + (i % 5) * 2.0, -8 + Math.floor(i / 5) * 2.2); ctx.addProp('barrel', x, z, i); }
  for (let i = 0; i < 8; i++) { const [x, z] = ctx.rot(M, 10 + (i % 4) * 2.2, 8 + Math.floor(i / 4) * 2.4); ctx.addProp('crate', x, z, i * 0.6); }
  ctx.fenceRun([ctx.rot(M, -46, -34), ctx.rot(M, 46, -34), ctx.rot(M, 46, 34), ctx.rot(M, -46, 34), ctx.rot(M, -46, -34)] as Vec2[], 'fence_seg', 4, ctx.rot(M, -46, 0), 10);

  // ---- scrap yard: the salvage the region's contracts run on ------------------------------
  const S = A.scrapYard;
  ctx.yard(S, 60, 48, '#6f4a34');
  ctx.at(S, 'stack', -14, 12, 0, 0.8);
  ctx.at(S, 'warehouse', 8, -6, 0, 0.55);
  ctx.at(S, 'hut', -22, -16, 0.4, 1.7);
  for (let i = 0; i < 14; i++) { const [x, z] = ctx.rot(S, -18 + (i % 7) * 2.4, -4 + Math.floor(i / 7) * 3.0); ctx.addProp('crate', x, z, i * 0.5); }
  for (let i = 0; i < 9; i++) { const [x, z] = ctx.rot(S, 14 + (i % 3) * 1.8, 10 + Math.floor(i / 3) * 1.8); ctx.addProp('barrel', x, z, i); }
  ctx.fenceRun([ctx.rot(S, -32, -26), ctx.rot(S, 32, -26), ctx.rot(S, 32, 26), ctx.rot(S, -32, 26), ctx.rot(S, -32, -26)] as Vec2[], 'fence_seg', 4);

  // ---- rim trailhead above the dry wash ---------------------------------------------------
  const T = A.washTrailhead;
  ctx.addProp('sign', T.x, T.z, T.headingRad);
  ctx.addProp('hut', T.x + 14, T.z - 10, 0.5, 1.5);
  ctx.plain('wash-trailhead', [T.x, T.z], 26, 22, T.headingRad, '#8a5c40', 0.17);

  // ---- utility poles along the camp road ---------------------------------------------------
  for (const id of ['ROAD_CANYON_CAMP', 'ROAD_CANYON_YARD'] as const) {
    const road = ctx.roadById(id);
    for (let s = 30; s < road.lengthM - 20; s += 62) {
      const p = road.points.reduce((best, q) => (Math.abs(q.s - s) < Math.abs(best.s - s) ? q : best));
      const off = road.def.widthM / 2 + 4;
      const x = p.x - p.tz * off, z = p.z + p.tx * off;
      if (ctx.okGround(x, z, 14) && !ctx.nearPad(x, z, 20)) ctx.addProp('pole', x, z, Math.atan2(p.tx, p.tz), 1);
    }
  }
  void rng;
}

function canyonRocks(ctx: CompositionContext): void {
  const { rng, grid } = ctx;
  // Talus: boulder aprons at the foot of the canyon walls, both banks, along the whole wash.
  CANYON_WASH_POINTS.forEach(([wx, wz], i) => {
    const q = CANYON_WASH_POINTS[Math.min(CANYON_WASH_POINTS.length - 1, i + 1)];
    const len = Math.hypot(q[0] - wx, q[1] - wz) || 1;
    const nx = -(q[1] - wz) / len, nz = (q[0] - wx) / len;
    const steps = Math.max(2, Math.round(len / 160));
    for (let k = 0; k < steps; k++) {
      const t = k / steps, bx = wx + (q[0] - wx) * t, bz = wz + (q[1] - wz) * t;
      for (const side of [-1, 1] as const) {
        const off = side * (CANYON_HALF_W * (0.6 + rng.next() * 0.55));
        ctx.rockCluster(bx + nx * off, bz + nz * off, 2.4 + rng.next() * 4.5, 2 + Math.floor(rng.next() * 4), 11);
      }
    }
  });
  // Wash-floor boulder fields: the debris the flash floods left behind.
  for (let i = 0; i < 90; i++) {
    const seg = Math.floor(rng.next() * (CANYON_WASH_POINTS.length - 1));
    const [ax, az] = CANYON_WASH_POINTS[seg], [bx, bz] = CANYON_WASH_POINTS[seg + 1];
    const t = rng.next();
    const x = ax + (bx - ax) * t + (rng.next() - 0.5) * CANYON_HALF_W * 1.4;
    const z = az + (bz - az) * t + (rng.next() - 0.5) * CANYON_HALF_W * 1.4;
    ctx.rockCluster(x, z, 1.2 + rng.next() * 2.6, 2 + Math.floor(rng.next() * 3), 7);
  }
  // Rim outcrops: eroded sandstone teeth on the steep strata edges of the mesa.
  for (let i = 0; i < 420; i++) {
    const x = (rng.next() - 0.5) * 7000, z = (rng.next() - 0.5) * 7000;
    if (grid.slopeDeg(x, z) < 16) continue;
    ctx.rockCluster(x, z, 2.2 + rng.next() * 5.5, 2 + Math.floor(rng.next() * 3), 9);
  }
}

export const RED_CANYON_COMPOSITION: RegionCompositionSpec = {
  regionId: 'red_canyon',
  terrain: 'canyon',
  seed: 'red-canyon-composition-v1',
  anchors: CANYON_ANCHORS,
  roads: CANYON_ROADS,
  parcels: [],
  parcelColors: NO_PARCEL_COLORS,
  // Red Canyon has no water at all; keep the "wet" guard from ever firing on dry ground.
  seaLevelM: CANYON_MIN_M - 50,
  maxTreeInstances: 2600,
  densityAnchors: [
    // D5: the graded apron/runway complex.
    { x: CANYON_ANCHORS.mesaAirfield.x, z: CANYON_ANCHORS.mesaAirfield.z, coreRadiusM: 190, falloffM: 260, level: 5 },
    // D4: the mining/salvage camp core.
    { x: CANYON_ANCHORS.miningCamp.x, z: CANYON_ANCHORS.miningCamp.z, coreRadiusM: 120, falloffM: 420, level: 4 },
    // D3: the scrap yard.
    { x: CANYON_ANCHORS.scrapYard.x, z: CANYON_ANCHORS.scrapYard.z, coreRadiusM: 80, falloffM: 320, level: 3 },
    // D2: the lonely rim trailhead.
    { x: CANYON_ANCHORS.washTrailhead.x, z: CANYON_ANCHORS.washTrailhead.z, coreRadiusM: 50, falloffM: 260, level: 2 },
  ],
  treeDensity: canyonTreeDensity,
  treeMass: {
    cellM: 96, extentM: 5200, core: [250, 550], coreFalloff: [1500, 5000],
    // Wash cottonwoods are the region's only real vegetation mass; protect them from the budget.
    priority: (x, z) => (distanceToWash(x, z) < CANYON_HALF_W + 60 ? 0.4 : 0),
  },
  // Nothing gets built on the wash floor (flash-flood channel) or on the rim lip.
  buildingKeepOut: (x, z) => distanceToWash(x, z) < CANYON_HALF_W + 120,
  // Badlands have no tree avenues — a dirt trail through scrub is the point.
  roadsideAvenue: () => null,
  densityScatter: {
    minX: -2600, maxX: 2600, minZ: -1600, maxZ: 3400,
    propKinds: [['barrel', 3], ['crate', 3], ['pole', 1], ['sign', 0.5]],
    maxSlopeDeg: 20,
    vegetationScale: [0.7, 1.5],
    // Arid: a small fraction of the nominal budget, but the D0->D5 gradient is intact.
    vegetationFactor: 0.14,
    propFactor: 0.3,
  },
  authored: authoredCanyon,
  rocks: canyonRocks,
};
