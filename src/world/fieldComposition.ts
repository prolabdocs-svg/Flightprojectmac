import { FIELD_LAKE, FIELD_LAKE_ISLAND, lakeShoreRadius } from './fieldGeography';

/**
 * Authored composition of The Field: semantic anchors, road polylines and field parcels.
 * Everything generated later (settlement lots, tree masses, rocks, props, airfield detail)
 * references these anchors instead of listing coordinates. Terrain is frozen; this module
 * only decides what people built on it.
 *
 * World handedness (world/compass.ts): +Z north, EAST IS -X. Districts blend by distance
 * weights, there are no biome boundaries.
 */

export type Vec2 = readonly [number, number];
export type DistrictId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K' | 'L' | 'M' | 'N';

export interface Anchor {
  id: string;
  district: DistrictId;
  x: number;
  z: number;
  /** Yaw (rad) that local +Z of anything built on the anchor is rotated by. */
  headingRad: number;
  /** Rough footprint of the place; used for exclusion discs and vegetation weights. */
  radiusM: number;
}

const anchor = (id: string, district: DistrictId, x: number, z: number, radiusM: number, headingRad = 0): Anchor => ({ id, district, x, z, headingRad, radiusM });

export const DISTRICT_NAMES: Record<DistrictId, string> = {
  A: 'Home airfield', B: 'Home settlement', C: 'Agricultural plain', D: 'River corridor', E: 'Lake district',
  F: 'Northern mountain pass', G: 'Eastern hills', H: 'Second airfield', I: 'Industrial / utility area', J: 'Remote farm',
  K: 'Market town', L: 'Estuary coast', M: 'Eastern uplands', N: 'Western hills',
};

export const WORLD_ANCHORS = {
  homeAirfield: anchor('homeAirfield', 'A', 0, 0, 150),
  /** Existing hangar compound south-west of the strip (assetManifest.ts). */
  homeApron: anchor('homeApron', 'A', 130, -110, 70),
  /** Existing authored village GLB; the generated lots fill in around it. */
  villageCore: anchor('villageCore', 'B', 160, 350, 60, -0.3),
  /** Where the airfield road meets the main road and the village road runs north. */
  village: anchor('village', 'B', 250, 380, 260),
  secondAirfield: anchor('secondAirfield', 'H', 0, 620, 130),
  farmClusterA: anchor('farmClusterA', 'C', 900, 820, 140, 0.15),
  farmClusterB: anchor('farmClusterB', 'C', -650, 1280, 110, -0.4),
  remoteFarm: anchor('remoteFarm', 'J', -1300, -700, 110, 0.6),
  bridge: anchor('bridge', 'D', 2030, 330, 60, Math.PI / 2),
  lake: anchor('lake', 'E', FIELD_LAKE.x, FIELD_LAKE.z, FIELD_LAKE.radiusM),
  lakeVillage: anchor('lakeVillage', 'E', 2500, 900, 170),
  lakeDock: anchor('lakeDock', 'E', 2500, Math.round(FIELD_LAKE.z - lakeShoreRadius(-Math.PI / 2)) - 28, 40),
  industrialArea: anchor('industrialArea', 'I', 700, -900, 190, 0.5),
  utilityTower: anchor('utilityTower', 'C', -560, 1720, 40),
  northPass: anchor('northPass', 'F', -1480, 3950, 200),
  passGate: anchor('passGate', 'F', -1470, 2450, 150),
  easternWindmill: anchor('easternWindmill', 'G', -2250, 400, 60),
  // ---- World Density & Composition V2: places beyond the home basin -----------------------
  /** Market town on the south plain: the region's densest settlement, visible from home. */
  southTown: anchor('southTown', 'K', 50, -1700, 330, 0.32),
  /** Fishing village above the estuary; its harbour sits where the coast road meets the water. */
  estuaryVillage: anchor('estuaryVillage', 'L', -1900, -2800, 170, -0.25),
  /** Lighthouse on the cliff over the estuary mouth: the far south-east landmark. */
  lighthouse: anchor('lighthouse', 'L', -5800, -3750, 40),
  /** Upland hamlet on the eastern road, and a radio mast on the ridge above it. */
  eastHamlet: anchor('eastHamlet', 'M', -3550, -50, 150, 0.15),
  eastMast: anchor('eastMast', 'M', -4400, 1400, 30),
  /** Hill hamlet on the western road beyond the lake. */
  westHamlet: anchor('westHamlet', 'N', 4950, 700, 150, -0.4),
  lakeIsland: anchor('lakeIsland', 'E', FIELD_LAKE_ISLAND.x, FIELD_LAKE_ISLAND.z, FIELD_LAKE_ISLAND.radiusM),
} as const satisfies Record<string, Anchor>;

export const DISTRICTS: ReadonlyArray<{ id: DistrictId; name: string; center: Vec2; radiusM: number }> = [
  { id: 'A', name: DISTRICT_NAMES.A, center: [0, 0], radiusM: 300 },
  { id: 'B', name: DISTRICT_NAMES.B, center: [250, 380], radiusM: 380 },
  { id: 'C', name: DISTRICT_NAMES.C, center: [1000, 350], radiusM: 1300 },
  { id: 'D', name: DISTRICT_NAMES.D, center: [2030, 0], radiusM: 900 },
  { id: 'E', name: DISTRICT_NAMES.E, center: [2500, 1500], radiusM: 1100 },
  { id: 'F', name: DISTRICT_NAMES.F, center: [-1480, 3200], radiusM: 1400 },
  { id: 'G', name: DISTRICT_NAMES.G, center: [-2600, 0], radiusM: 1400 },
  { id: 'H', name: DISTRICT_NAMES.H, center: [0, 620], radiusM: 250 },
  { id: 'I', name: DISTRICT_NAMES.I, center: [700, -900], radiusM: 320 },
  { id: 'J', name: DISTRICT_NAMES.J, center: [-1300, -700], radiusM: 320 },
  { id: 'K', name: DISTRICT_NAMES.K, center: [50, -1700], radiusM: 600 },
  { id: 'L', name: DISTRICT_NAMES.L, center: [-3600, -3300], radiusM: 1800 },
  { id: 'M', name: DISTRICT_NAMES.M, center: [-4200, 400], radiusM: 1800 },
  { id: 'N', name: DISTRICT_NAMES.N, center: [4700, 900], radiusM: 1500 },
];

// ---------------------------------------------------------------------------------------
// Roads: authored control points (no pathfinding); fieldRoads.ts splines and drapes them.
// ---------------------------------------------------------------------------------------

export type RoadSurface = 'asphalt' | 'gravel' | 'dirt';
export type RoadId = 'ROAD_MAIN' | 'ROAD_AIRFIELD' | 'ROAD_VILLAGE' | 'ROAD_PASS' | 'ROAD_SECOND_AIRFIELD' | 'ROAD_LAKE' | 'ROAD_FARM_A' | 'ROAD_FARM_B' | 'ROAD_REMOTE' | 'ROAD_INDUSTRIAL'
  | 'ROAD_SOUTH' | 'ROAD_COAST' | 'ROAD_EAST' | 'ROAD_WEST' | 'ROAD_TOWN_HIGH' | 'ROAD_TOWN_CROSS_A' | 'ROAD_TOWN_CROSS_B' | 'ROAD_TOWN_BACK' | 'ROAD_HARBOUR';

export interface RoadDef {
  /** Region-unique id. Typed `string` (not the Field-only `RoadId` union) since
   * regionPlacement.ts is the shared authority and every region supplies its own ids. */
  id: string;
  surface: RoadSurface;
  widthM: number;
  /** Larger = drawn on top where roads overlap at a junction. */
  priority: number;
  points: ReadonlyArray<Vec2>;
  /** Upland country road that follows the land rather than being graded: allowed steeper
   * side-slopes (17 deg vs 13) in the road rules. Only the V2 roads over the eastern uplands. */
  terrainFollowing?: boolean;
  /** Must stay dry; only the road listed in `bridge` may cross the river. */
  bridge?: { anchor: keyof typeof WORLD_ANCHORS; halfSpanM: number };
}

/** Points on the shore at `offsetM` outside the waterline; angle 0 = due south of the lake,
 * positive angles swing towards the west shore (+X). */
export const lakeShore = (angleDeg: number, offsetM: number): Vec2 => {
  const a = (angleDeg * Math.PI) / 180, r = lakeShoreRadius(Math.atan2(-Math.cos(a), Math.sin(a))) + offsetM;
  return [Math.round(FIELD_LAKE.x + r * Math.sin(a)), Math.round(FIELD_LAKE.z - r * Math.cos(a))];
};

export const ROADS: ReadonlyArray<RoadDef> = [
  // Lake village -> bridge -> plain -> home village: the spine of the region.
  {
    id: 'ROAD_MAIN', surface: 'asphalt', widthM: 9.5, priority: 5,
    bridge: { anchor: 'bridge', halfSpanM: 46 },
    points: [[2500, 900], [2400, 690], [2270, 500], [2140, 375], [2085, 335], [1975, 330], [1850, 325], [1600, 335], [1300, 320], [1000, 330], [750, 310], [500, 300], [330, 300], [250, 300]],
  },
  // Hangar apron -> gate -> village junction.
  { id: 'ROAD_AIRFIELD', surface: 'asphalt', widthM: 7.5, priority: 4, points: [[150, -92], [178, -70], [218, -30], [246, 40], [254, 150], [252, 300]] },
  { id: 'ROAD_VILLAGE', surface: 'asphalt', widthM: 7.5, priority: 4, points: [[250, 300], [256, 400], [250, 500], [238, 600], [226, 700]] },
  // North to the mountain pass; asphalt gives way to gravel in the foothills.
  {
    id: 'ROAD_PASS', surface: 'gravel', widthM: 7, priority: 3,
    points: [[226, 700], [185, 850], [90, 1050], [-100, 1250], [-380, 1450], [-700, 1650], [-1000, 1850], [-1300, 2050], [-1390, 2400], [-1450, 2750], [-1500, 3100], [-1490, 3500], [-1470, 3900], [-1480, 4020]],
  },
  { id: 'ROAD_SECOND_AIRFIELD', surface: 'dirt', widthM: 5, priority: 2, points: [[256, 440], [200, 505], [140, 575], [100, 625], [72, 645]] },
  {
    id: 'ROAD_LAKE', surface: 'gravel', widthM: 5, priority: 2,
    points: [[2500, 900], [...lakeShore(3, 115)], [...lakeShore(20, 120)], [...lakeShore(38, 120)], [...lakeShore(56, 120)]],
  },
  { id: 'ROAD_FARM_A', surface: 'dirt', widthM: 4, priority: 2, points: [[1000, 330], [990, 480], [965, 640], [925, 780]] },
  { id: 'ROAD_FARM_B', surface: 'dirt', widthM: 4, priority: 2, points: [[-560, 1560], [-620, 1430], [-655, 1330]] },
  { id: 'ROAD_REMOTE', surface: 'dirt', widthM: 3.5, priority: 1, points: [[130, -200], [0, -300], [-300, -400], [-700, -500], [-1000, -600], [-1250, -690]] },
  { id: 'ROAD_INDUSTRIAL', surface: 'asphalt', widthM: 7.5, priority: 3, points: [[218, -30], [230, -200], [400, -480], [560, -740], [690, -880]] },
  // ---- V2 regional network: every road leads somewhere and the long ones run off the map edge,
  // so from altitude the network reads as part of a larger country, not a closed diorama.
  // Industrial estate -> market town (the town's high street continues it).
  { id: 'ROAD_SOUTH', surface: 'asphalt', widthM: 7.5, priority: 4, points: [[690, -880], [520, -1100], [300, -1280], [163, -1358]] },
  // Market town -> estuary village -> along the uplands above the estuary -> off the east edge.
  {
    id: 'ROAD_COAST', surface: 'gravel', widthM: 6.5, priority: 3, terrainFollowing: true,
    points: [[-111, -1994], [-700, -2320], [-1150, -2520], [-1600, -2700], [-1900, -2800], [-2350, -2800], [-2900, -2720], [-3519, -2688], [-4000, -2500], [-4531, -2269], [-5017, -2065], [-5698, -1981], [-6450, -2065]],
  },
  // Pass road -> across the eastern plain, past the windmill, through the upland hamlet -> east edge.
  {
    id: 'ROAD_EAST', surface: 'gravel', widthM: 6, priority: 3, terrainFollowing: true,
    points: [[-100, 1250], [-500, 1050], [-1000, 850], [-1500, 650], [-2070, 631], [-2600, 380], [-3053, 63], [-3550, -50], [-4200, -150], [-4600, -240], [-5046, -326], [-5390, -348], [-5737, -306], [-6450, -249]],
  },
  // Lake road -> over the western hills and the hamlet -> west edge.
  {
    id: 'ROAD_WEST', surface: 'gravel', widthM: 5.5, priority: 2,
    points: [[...lakeShore(56, 120)], [3115, 1066], [4125, 1075], [4652, 919], [5049, 789], [5400, 520], [5900, 420], [6450, 380]],
  },
  // Market town streets: high street along the town axis, two cross streets and a back lane.
  ...townStreets(),
  // Estuary village -> harbour.
  { id: 'ROAD_HARBOUR', surface: 'dirt', widthM: 4.5, priority: 2, points: [[-1900, -2800], [-1980, -2900], [-2080, -3000]] },
];

/** Street grid of the market town in its anchor frame (+Z along the high street). */
function townStreets(): RoadDef[] {
  const { x, z, headingRad: h } = { x: 50, z: -1700, headingRad: 0.32 };
  const at = (lx: number, lz: number): Vec2 => [Math.round(x + lx * Math.cos(h) + lz * Math.sin(h)), Math.round(z - lx * Math.sin(h) + lz * Math.cos(h))];
  const street = (id: RoadId, pts: Array<[number, number]>, widthM = 6.5): RoadDef => ({ id, surface: 'asphalt', widthM, priority: 3, points: pts.map(([a, b]) => at(a, b)) });
  return [
    street('ROAD_TOWN_HIGH', [[0, 360], [0, 180], [0, 0], [0, -180], [-60, -330]], 7.5),
    street('ROAD_TOWN_CROSS_A', [[-260, 110], [-120, 110], [0, 110], [140, 110], [270, 110]]),
    street('ROAD_TOWN_CROSS_B', [[-230, -90], [-110, -90], [0, -90], [120, -90], [240, -90]]),
    street('ROAD_TOWN_BACK', [[150, 280], [150, 110], [150, -90], [150, -240]], 5.5),
  ];
}

// ---------------------------------------------------------------------------------------
// Agricultural parcels: rotated rectangles; large enough to read from 300-600 m AGL.
// ---------------------------------------------------------------------------------------

export type CropKind = 'green' | 'dry' | 'bare' | 'grass' | 'harvested';
export type FieldEdge = 'trees' | 'hedge' | 'fence';

export interface FieldParcel {
  id: string;
  center: Vec2;
  /** Extent along local X (widthM) and local Z (depthM), before rotation by headingRad. */
  widthM: number;
  depthM: number;
  headingRad: number;
  crop: CropKind;
  /** Crop-row direction relative to the parcel (0 = along local Z). */
  rowAngleRad: number;
  edges?: Partial<Record<'n' | 's' | 'e' | 'w', FieldEdge>>;
}

const f = (id: string, x: number, z: number, widthM: number, depthM: number, crop: CropKind, headingRad = 0, rowAngleRad = 0, edges?: FieldParcel['edges']): FieldParcel => ({ id, center: [x, z], widthM, depthM, headingRad, crop, rowAngleRad, edges });

export const FIELD_PARCELS: ReadonlyArray<FieldParcel> = [
  // Along the main road, plain east of the river.
  f('f01', 610, 170, 300, 190, 'green', 0.03, 0, { n: 'trees' }),
  f('f02', 960, 180, 330, 200, 'dry', -0.02, Math.PI / 2, { s: 'hedge' }),
  f('f03', 1320, 170, 360, 210, 'bare', 0.04, 0, { n: 'trees', w: 'fence' }),
  f('f04', 1690, 150, 250, 190, 'grass', 0),
  f('f05', 720, 520, 290, 250, 'green', 0.02, Math.PI / 2, { w: 'trees' }),
  f('f06', 1215, 480, 330, 190, 'harvested', -0.03, 0, { s: 'hedge', e: 'trees' }),
  f('f07', 1620, 500, 320, 240, 'green', 0.02, 0, { n: 'trees' }),
  f('f08', 690, 880, 250, 170, 'dry', 0.05, 0),
  f('f09', 1160, 900, 290, 190, 'green', -0.04, Math.PI / 2, { s: 'trees' }),
  // South plain (below the strips) and the flat east side.
  f('f10', 520, -240, 300, 230, 'green', 0.03, 0, { n: 'hedge' }),
  f('f11', 900, -300, 320, 250, 'dry', -0.03, Math.PI / 2, { e: 'trees' }),
  f('f12', 1300, -340, 300, 230, 'bare', 0.02, 0),
  f('f13', -500, -350, 300, 230, 'green', 0.02, Math.PI / 2, { s: 'trees' }),
  f('f14', -900, -110, 250, 250, 'harvested', -0.05, 0),
  f('f15', -560, 250, 250, 210, 'grass', 0.03, 0, { w: 'hedge' }),
  f('f16', -920, 700, 270, 210, 'dry', 0.04, Math.PI / 2, { n: 'trees' }),
  // West bank, lake district.
  f('f17', 2650, 640, 300, 200, 'green', 0, 0, { s: 'trees' }),
  f('f18', 2960, 520, 250, 210, 'dry', 0.05, Math.PI / 2),
];

// ---------------------------------------------------------------------------------------
// Vegetation intent (referenced by fieldPlacement.ts).
// ---------------------------------------------------------------------------------------

export const FIELD_COMPOSITION_SEED = 'field-composition-v1';

/** Trees are budgeted globally (mobile WebGL2): the placement pass never exceeds this. */
export const MAX_TREE_MASS_INSTANCES = 7800;

/**
 * Measurable world budgets (World Density & Composition V2). Layout counts are asserted by
 * fieldComposition.test.ts; render numbers are what scripts/regions/viewer.html reports for the
 * standard shot set (see docs/world/WORLD_DENSITY_V2.md) and are the ceilings to hold on desktop.
 */
export const FIELD_BUDGETS = {
  trees: 17000,
  lots: 900,
  props: 9000,
  rocks: 2600,
  parcels: 700,
  /** InstancedMesh/Mesh chunks managed by FieldWorld's distance LOD. */
  lodChunks: 1400,
  /** Visible draw calls from any standard shot (all passes, post included). */
  drawCalls: 1600,
  /** Visible triangles from any standard shot. */
  trianglesM: 4.5,
} as const;

/** Overhead power lines (world x/z vertices), pylons every ~260 m: the industrial estate's
 * substation feeds the market town and runs east across the plain and uplands off the map. */
export const POWER_LINES: ReadonlyArray<ReadonlyArray<Vec2>> = [
  [[760, -960], [600, -1250], [420, -1450], [230, -1560]],
  [[760, -960], [-300, -1150], [-1500, -1330], [-2700, -1450], [-3900, -1400], [-5200, -1350], [-6450, -1300]],
];
export const PYLON_SPACING_M = 260;
/** Pylon positions along a power line: vertices always get one, long legs are subdivided. */
export function pylonPositions(line: ReadonlyArray<Vec2>): Array<{ x: number; z: number; yaw: number }> {
  const out: Array<{ x: number; z: number; yaw: number }> = [];
  for (let i = 0; i < line.length - 1; i++) {
    const [x0, z0] = line[i], [x1, z1] = line[i + 1];
    const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(len / PYLON_SPACING_M)), yaw = Math.atan2(x1 - x0, z1 - z0);
    for (let k = 0; k < n; k++) out.push({ x: x0 + ((x1 - x0) * k) / n, z: z0 + ((z1 - z0) * k) / n, yaw });
  }
  const [a, b] = [line[line.length - 2], line[line.length - 1]];
  out.push({ x: b[0], z: b[1], yaw: Math.atan2(b[0] - a[0], b[1] - a[1]) });
  return out;
}
