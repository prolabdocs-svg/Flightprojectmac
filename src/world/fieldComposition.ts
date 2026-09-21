import { FIELD_LAKE } from './fieldGeography';

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
export type DistrictId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J';

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
  lakeDock: anchor('lakeDock', 'E', 2500, 1150, 40),
  industrialArea: anchor('industrialArea', 'I', 700, -900, 190, 0.5),
  utilityTower: anchor('utilityTower', 'C', -560, 1720, 40),
  northPass: anchor('northPass', 'F', -1480, 3950, 200),
  passGate: anchor('passGate', 'F', -1470, 2450, 150),
  easternWindmill: anchor('easternWindmill', 'G', -2250, 400, 60),
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
];

// ---------------------------------------------------------------------------------------
// Roads: authored control points (no pathfinding); fieldRoads.ts splines and drapes them.
// ---------------------------------------------------------------------------------------

export type RoadSurface = 'asphalt' | 'gravel' | 'dirt';
export type RoadId = 'ROAD_MAIN' | 'ROAD_AIRFIELD' | 'ROAD_VILLAGE' | 'ROAD_PASS' | 'ROAD_SECOND_AIRFIELD' | 'ROAD_LAKE' | 'ROAD_FARM_A' | 'ROAD_FARM_B' | 'ROAD_REMOTE' | 'ROAD_INDUSTRIAL';

export interface RoadDef {
  id: RoadId;
  surface: RoadSurface;
  widthM: number;
  /** Larger = drawn on top where roads overlap at a junction. */
  priority: number;
  points: ReadonlyArray<Vec2>;
  /** Must stay dry; only the road listed in `bridge` may cross the river. */
  bridge?: { anchor: keyof typeof WORLD_ANCHORS; halfSpanM: number };
}

/** Points on the shore at `offsetM` outside the waterline; angle 0 = due south of the lake,
 * positive angles swing towards the west shore (+X). */
const lakeShore = (angleDeg: number, offsetM: number): Vec2 => {
  const a = (angleDeg * Math.PI) / 180, r = FIELD_LAKE.radiusM + offsetM;
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
    points: [[2500, 900], [...lakeShore(3, 105)], [...lakeShore(20, 105)], [...lakeShore(38, 105)], [...lakeShore(56, 110)], [...lakeShore(74, 120)]],
  },
  { id: 'ROAD_FARM_A', surface: 'dirt', widthM: 4, priority: 2, points: [[1000, 330], [990, 480], [965, 640], [925, 780]] },
  { id: 'ROAD_FARM_B', surface: 'dirt', widthM: 4, priority: 2, points: [[-560, 1560], [-620, 1430], [-655, 1330]] },
  { id: 'ROAD_REMOTE', surface: 'dirt', widthM: 3.5, priority: 1, points: [[130, -200], [0, -300], [-300, -400], [-700, -500], [-1000, -600], [-1250, -690]] },
  { id: 'ROAD_INDUSTRIAL', surface: 'asphalt', widthM: 7.5, priority: 3, points: [[218, -30], [230, -200], [400, -480], [560, -740], [690, -880]] },
];

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
export const MAX_TREE_MASS_INSTANCES = 7200;
