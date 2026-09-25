/**
 * MASTER GEOGRAPHIC MAP V1 — authored macro-geography (data only, no renderer, no noise).
 *
 * Authority: docs/world/MASTER_GEOGRAPHIC_MAP_V1.md (macro-geography) reconciled with
 * docs/WORLD_TERRAIN_ENVIRONMENT_GEOGRAPHY_MASTER_SPEC_v3.0.md (systems/contracts).
 *
 * Authoring frame is GEOGRAPHIC: E (km east of origin) and N (km north of origin).
 * The game's world frame is +Z north and EAST IS -X (world/compass.ts), so
 *   world x = -E * 1000,  world z = N * 1000.
 * Everything here is km unless a suffix says otherwise; heights are metres.
 *
 * Causal order (spec §66): geology -> relief -> water -> climate -> ecosystem -> people.
 * This file only holds geology (coast, ranges, massifs), the drainage skeleton and the
 * region cores. Noise is applied downstream and only as secondary irregularity.
 */

export const MASTER_SEED = 'project-flight-master-map-v1';
export const HALF_M = 24000;
export const WORLD_HALF_M = 36000;
export const GRID_N = 1000;
export const CELL_M = (HALF_M * 2) / GRID_N; // 48 m

export type Pt = readonly [number, number];
/** [E, N, height m, half-width km] */
export type RidgePt = readonly [number, number, number, number];

export const geoToWorld = (eKm: number, nKm: number): [number, number] => [-eKm * 1000, nKm * 1000];
export const worldToGeo = (x: number, z: number): [number, number] => [-x / 1000, z / 1000];

/* -------------------------------------------------------------------------------------------
 * The Field -> R01 Starter Basin. The Field's terrain, composition, placements and airfields are
 * kept verbatim in Field-local metres; this rigid translation (no rotation, no scale) places
 * them inside the continent. Home strip (0,0) local == geographic (-10.5, -2.0) km.
 * ------------------------------------------------------------------------------------------- */
export const STARTER_BASIN = {
  homeGeoKm: [-10.5, -2.0] as Pt,
  /** master world = Field local + this (x,z metres). */
  worldOffsetM: [10500, -2000] as Pt,
  /** Field elevations are relative to a 6 m home datum; the basin sits at ~236 m (spec R01: 180–320). */
  elevationOffsetM: 230,
  /** Field terrain is used verbatim inside this Chebyshev radius (Field-local m)... */
  coreRadiusM: 4800,
  /** ...and hands over to the continental macro relief by here (before the Field's own edge sink at 6600). */
  fadeEndM: 6450,
} as const;

export const fieldLocalToMaster = (x: number, z: number): [number, number] =>
  [x + STARTER_BASIN.worldOffsetM[0], z + STARTER_BASIN.worldOffsetM[1]];
export const masterToFieldLocal = (x: number, z: number): [number, number] =>
  [x - STARTER_BASIN.worldOffsetM[0], z - STARTER_BASIN.worldOffsetM[1]];

/* -------------------------------------------------------------------------------------------
 * COASTLINES. Hand-placed control points (clockwise). Macro = cape/bay layout below; meso and
 * micro irregularity is added by seeded midpoint displacement whose amplitude is bounded by the
 * segment length, so it can never move a cape or close a bay.
 * ------------------------------------------------------------------------------------------- */
export const MAINLAND_COAST: ReadonlyArray<Pt> = [
  // west coast, north-bound: Golfo Poniente (deep gulf between the badlands mesas), punta, small coves
  [-21.0, -11.2], [-22.6, -9.4], [-21.6, -7.6], [-20.3, -5.9], [-21.4, -4.5], [-22.9, -3.3], [-23.5, -0.6], [-22.4, 1.6],
  [-23.4, 4.2], [-22.2, 6.6], [-23.2, 9.4], [-21.9, 11.6], [-23.3, 14.0], [-22.4, 16.6], [-23.4, 19.0],
  // north coast, east-bound. Deliberately unequal in scale (spec §3 macro/meso/micro): rugged NW corner and Cabo Torre,
  // ONE deep fjord (Fiordo del Risco), a wide shallow bay (Bahía Grande), ONE thin peninsula (Península Norte),
  // a long straight cliff coast (Costa Recta) and one broad headland (Cabo Noreste).
  [-22.0, 21.0], [-20.4, 22.4], [-19.0, 22.9], [-17.6, 22.0], [-16.4, 20.0], [-15.4, 18.4], [-14.6, 17.3], [-13.8, 17.7],
  [-13.4, 19.6], [-13.0, 21.4], [-11.6, 22.2], [-10.2, 21.6], [-8.6, 21.2], [-7.0, 20.9], [-5.7, 21.3],
  [-5.0, 22.2], [-4.7, 23.5], [-3.9, 23.8], [-3.1, 23.0], [-3.0, 21.6],
  [-2.2, 20.6], [-0.5, 20.3], [1.5, 20.0], [3.4, 19.6], [4.8, 18.4],
  [6.6, 18.6], [8.6, 19.0], [10.4, 18.2], [11.9, 16.2], [12.3, 13.8], [11.0, 12.2], [11.4, 10.4],
  // east coast facing the strait, south-bound: Highlands scarp, Golfo del Estrecho (recedes at the island's latitudes), SE peninsula
  [10.4, 8.0], [9.0, 6.4], [8.0, 4.6], [8.6, 2.6], [9.6, 1.4], [9.8, -0.6], [9.6, -2.6], [9.2, -4.6],
  [10.4, -6.8], [11.8, -8.8], [12.0, -10.6], [10.4, -11.4],
  // south coast, west-bound: tourist bay + lagoon barrier, estuary/delta of the main river, capes, gulf, southern peninsula
  [8.8, -13.4], [7.2, -12.4], [5.6, -13.8], [4.6, -15.6], [2.6, -15.9], [1.4, -14.6], [0.4, -16.6], [-1.6, -15.8],
  [-2.8, -13.6], [-4.6, -15.0], [-6.4, -17.6], [-8.8, -16.8], [-10.2, -14.8], [-11.0, -18.6], [-11.8, -21.2],
  [-14.2, -21.6], [-15.4, -19.2], [-14.6, -17.2], [-16.2, -16.0], [-18.4, -14.6], [-19.6, -12.6],
];

export const EASTERN_ISLAND_COAST: ReadonlyArray<Pt> = [
  // Volcanic island, compact (not a strip): NE cape, small east notch, Bahía del Volcán (a caldera flooded and open to the
  // east), rocky south cape, a westward bulge facing the strait, and a north lobe.
  [17.6, 6.4], [19.4, 7.3], [21.2, 6.9], [22.6, 5.8], [23.3, 4.4], [22.6, 3.3], [23.4, 2.0], [23.4, 0.4],
  [22.4, -0.5], [21.0, -0.5], [20.2, -1.5], [21.0, -2.5], [22.4, -2.7], [23.3, -3.0], [23.3, -4.8], [22.2, -6.6],
  [20.8, -7.7], [19.2, -7.4], [18.0, -6.0], [17.0, -4.2], [16.4, -2.0], [16.6, 0.2], [16.4, 2.4], [17.0, 4.3], [16.8, 5.6],
];

/** Per-coast roughness (fraction of segment length used as displacement amplitude). */
export const COAST_ROUGHNESS = { mainland: 0.3, island: 0.34 } as const;

/* -------------------------------------------------------------------------------------------
 * GEOLOGY. Primary range trends NW -> SE (spec §3) and is THE drainage divide.
 * ------------------------------------------------------------------------------------------- */
export interface Ridge { id: string; pts: ReadonlyArray<RidgePt>; sharp: number }
export interface Blob { id: string; e: number; n: number; a: number; b: number; rotDeg: number; h: number; k: number }
/** Flat-topped, steep-flanked landform (mesas, plateaus). */
export interface Mesa { id: string; e: number; n: number; a: number; b: number; rotDeg: number; h: number; edge: number }

export const PRIMARY_RANGE: Ridge = {
  id: 'cordillera_principal',
  sharp: 1.85,
  pts: [
    [-22.9, 20.4, 1050, 3.4], [-20.2, 19.5, 1550, 3.9], [-17.6, 18.3, 2080, 4.2], [-14.8, 17.2, 2320, 4.2],
    [-12.0, 16.2, 2480, 4.0], [-9.4, 15.0, 2720, 3.8], [-6.6, 13.8, 2330, 3.8], [-4.0, 12.9, 2060, 3.6],
    [-1.7, 13.0, 2360, 3.6], [1.2, 12.1, 2500, 3.8], [3.7, 10.9, 2650, 3.8], [6.3, 9.4, 2250, 4.4],
    [8.8, 7.4, 1850, 5.0], [11.0, 5.0, 1450, 4.5],
  ],
};

/** Named summits added to the crest (peaks give the range recognisable silhouettes). */
export const SUMMITS: ReadonlyArray<Blob & { name: string }> = [
  { id: 'gran_pico_w', name: 'Gran Pico (cumbre oeste)', e: -9.65, n: 15.05, a: 1.3, b: 1.0, rotDeg: -25, h: 2850, k: 1.35 },
  { id: 'gran_pico_e', name: 'Gran Pico (cumbre este)', e: -9.05, n: 14.7, a: 1.1, b: 0.9, rotDeg: -25, h: 2790, k: 1.35 },
  { id: 'pico_norte', name: 'Pico Norte', e: -15.2, n: 17.6, a: 1.6, b: 1.1, rotDeg: -20, h: 2560, k: 1.4 },
  { id: 'aguja', name: 'La Aguja', e: 2.4, n: 11.7, a: 1.1, b: 0.8, rotDeg: -30, h: 2770, k: 1.25 },
  { id: 'torre', name: 'Torre Blanca', e: -18.2, n: 18.5, a: 1.3, b: 1.0, rotDeg: -15, h: 2300, k: 1.4 },
];

/** Secondary massifs, foothill belts, uplands, plateaus and hills (geology of each province). */
export const RIDGES: ReadonlyArray<Ridge> = [
  {
    // Foothill sierra closing the Starter Basin to the north (the Field's own 680 m chain lives in it)
    id: 'sierra_del_norte', sharp: 1.6,
    pts: [[-21.6, 3.9, 980, 1.9], [-18.6, 3.3, 990, 1.9], [-16.0, 2.6, 600, 1.8], [-13.4, 2.0, 930, 1.7],
      [-10.6, 2.2, 920, 1.6], [-7.6, 2.9, 900, 1.8], [-4.8, 4.4, 890, 1.8], [-2.8, 6.1, 830, 1.7]],
  },
  {
    // West wall of the Central Valley: two uneven sierra segments with a low pass between them
    id: 'sierra_poniente_norte', sharp: 1.85,
    pts: [[-2.0, 8.6, 560, 1.2], [-2.7, 5.6, 700, 1.4], [-2.2, 2.4, 520, 1.2]],
  },
  {
    id: 'sierra_poniente_sur', sharp: 1.85,
    pts: [[-2.5, -0.8, 460, 1.3], [-1.9, -3.6, 560, 1.2], [-2.9, -6.3, 400, 1.4], [-3.4, -8.8, 330, 1.5]],
  },
  {
    // East wall of the Central Valley: piedmont of the Eastern Highlands, cut by the eastern tributaries
    id: 'piedemonte_oriental', sharp: 1.85,
    pts: [[4.1, 8.4, 720, 1.5], [4.5, 5.2, 660, 1.4], [5.0, 1.6, 740, 1.5], [5.3, -2.0, 700, 1.4], [5.6, -5.4, 610, 1.5], [5.9, -8.2, 520, 1.5]],
  },
  {
    // Eastern Highlands spine, continuing the primary axis south-east
    id: 'espina_oriental', sharp: 1.7,
    pts: [[10.0, 6.4, 1500, 3.0], [8.6, 3.2, 1620, 2.6], [8.4, 0.2, 1400, 2.4], [9.0, -2.6, 1180, 2.2], [9.4, -5.8, 800, 2.0]],
  },
  {
    // Submerged volcanic arc: exposes the Southern Archipelago (heights are absolute; below 0 = seabed)
    id: 'arco_sur', sharp: 1.5,
    pts: [
      [-6.4, -17.2, 60, 1.7], [-4.2, -19.2, 120, 1.3], [-3.0, -19.9, -70, 1.1], [-1.4, -20.6, 210, 1.5], [0.4, -20.9, -60, 1.2],
      [2.6, -21.2, 140, 1.3], [4.2, -21.3, -55, 1.0], [5.8, -21.0, 260, 1.6], [7.2, -20.7, -60, 1.0], [8.7, -20.3, 90, 1.1],
      [10.0, -19.8, -65, 1.0], [11.4, -19.1, 170, 1.4], [12.8, -18.4, -60, 1.0], [14.3, -17.5, 230, 1.5], [15.5, -16.6, -55, 1.0],
      [16.6, -15.6, 120, 1.2], [18.0, -14.4, -20, 1.3],
    ],
  },
  {
    // Radial ridges of the volcano (north, south and west flanks): the island is a cone with ribs, not a strip
    id: 'volcan_costilla_n', sharp: 1.7,
    pts: [[19.3, -0.5, 1200, 1.2], [19.6, 2.0, 900, 1.3], [19.9, 4.4, 700, 1.3], [19.8, 6.0, 420, 1.2]],
  },
  {
    id: 'volcan_costilla_s', sharp: 1.7,
    pts: [[19.3, -0.7, 1150, 1.2], [19.3, -3.2, 900, 1.3], [19.7, -5.4, 660, 1.3], [19.8, -6.8, 380, 1.2]],
  },
  {
    id: 'volcan_costilla_o', sharp: 1.7,
    pts: [[19.0, -0.4, 1150, 1.2], [18.0, 0.2, 820, 1.3], [17.2, 0.8, 520, 1.2]],
  },
];

export const BLOBS: ReadonlyArray<Blob> = [
  // Semi-arid basin shoulder: raises the terrain around the Field to its own level so the hand-over has no cliff
  { id: 'cuenca_semiarida', e: -10.5, n: -2.0, a: 9.5, b: 8.5, rotDeg: 0, h: 170, k: 2.6 },
  // Cerros del Valle: broken low hills between basin and valley (replaces a straight ridge)
  { id: 'cerro_valle_c', e: -2.6, n: 3.6, a: 1.3, b: 1.7, rotDeg: 40, h: 330, k: 1.8 },
  // Broad interior swell: lifts the whole continental interior so the Central Valley floor sits at ~100–350 m
  { id: 'altiplano_interior', e: 0.5, n: 3.0, a: 8.5, b: 15.0, rotDeg: 12, h: 195, k: 2.0 },
  { id: 'altiplano_noroeste', e: -13.5, n: 9.5, a: 9.5, b: 3.8, rotDeg: -22, h: 470, k: 2.0 },
  // Greenbelt rolling hills (50–650 m)
  { id: 'colinas_verdes_w', e: -8.2, n: -11.8, a: 4.2, b: 2.3, rotDeg: 10, h: 330, k: 1.8 },
  { id: 'colinas_verdes_c', e: -2.6, n: -10.9, a: 2.6, b: 1.7, rotDeg: -10, h: 290, k: 1.8 },
  { id: 'colinas_verdes_sw', e: -14.5, n: -13.2, a: 3.4, b: 2.2, rotDeg: 25, h: 420, k: 1.8 },
  { id: 'colinas_verdes_e', e: 7.8, n: -7.0, a: 2.6, b: 2.4, rotDeg: 0, h: 430, k: 1.8 },
  // Coastal headlands
  { id: 'peninsula_sur_hills', e: -12.8, n: -19.4, a: 1.7, b: 2.4, rotDeg: 30, h: 430, k: 1.6 },
  { id: 'cabo_norte_hills', e: -5.4, n: 22.2, a: 2.2, b: 1.2, rotDeg: 0, h: 380, k: 1.7 },
  { id: 'cabo_noreste_hills', e: 9.0, n: 16.6, a: 2.6, b: 1.4, rotDeg: -10, h: 470, k: 1.7 },
  { id: 'peninsula_se_hills', e: 10.6, n: -8.8, a: 1.4, b: 2.4, rotDeg: 30, h: 330, k: 1.7 },
  // Eastern Highlands complexity: secondary summits on the plateaus
  { id: 'highlands_pico_1', e: 7.0, n: 11.2, a: 1.6, b: 1.2, rotDeg: -30, h: 1850, k: 1.5 },
  { id: 'highlands_pico_2', e: 9.4, n: 3.7, a: 1.4, b: 1.4, rotDeg: 0, h: 1720, k: 1.5 },
  { id: 'highlands_pico_3', e: 8.0, n: -1.0, a: 1.3, b: 1.6, rotDeg: 10, h: 1500, k: 1.5 },
  // Eastern Island: main volcano (≈1,400 m) and flank cones
  { id: 'volcan_base', e: 19.9, n: -0.9, a: 3.7, b: 4.2, rotDeg: 5, h: 900, k: 1.7 },
  { id: 'volcan_isla', e: 19.2, n: -0.6, a: 1.3, b: 1.4, rotDeg: 20, h: 1400, k: 1.3 },
  { id: 'cono_isla_n', e: 20.8, n: 4.4, a: 1.3, b: 1.4, rotDeg: 0, h: 800, k: 1.5 },
  { id: 'cono_isla_s', e: 20.4, n: -5.4, a: 1.2, b: 1.3, rotDeg: 0, h: 700, k: 1.5 },
  { id: 'cono_isla_o', e: 17.6, n: 2.6, a: 0.9, b: 1.0, rotDeg: 0, h: 520, k: 1.5 },
  // Central Valley: isolated hills on the floor (landmarks from low flight)
  { id: 'loma_valle_a', e: 2.7, n: -2.6, a: 0.8, b: 0.6, rotDeg: 20, h: 110, k: 1.7 },
  { id: 'loma_valle_b', e: 2.9, n: 3.5, a: 0.9, b: 0.6, rotDeg: -25, h: 130, k: 1.7 },
  { id: 'loma_valle_c', e: -0.3, n: 6.0, a: 0.6, b: 0.5, rotDeg: 0, h: 120, k: 1.7 },
];

export const MESAS: ReadonlyArray<Mesa> = [
  // Western Badlands: stepped mesas and buttes
  { id: 'mesa_grande_n', e: -20.6, n: 6.6, a: 2.6, b: 3.4, rotDeg: 8, h: 760, edge: 0.32 },
  { id: 'mesa_grande_c', e: -20.2, n: -2.6, a: 2.3, b: 3.2, rotDeg: -10, h: 700, edge: 0.3 },
  { id: 'mesa_grande_s', e: -19.6, n: -9.2, a: 2.8, b: 2.3, rotDeg: 15, h: 610, edge: 0.3 },
  { id: 'butte_1', e: -18.3, n: -5.6, a: 0.7, b: 0.55, rotDeg: 0, h: 620, edge: 0.4 },
  { id: 'butte_2', e: -21.6, n: 10.2, a: 0.8, b: 0.5, rotDeg: 30, h: 800, edge: 0.4 },
  { id: 'butte_3', e: -17.9, n: 9.0, a: 0.6, b: 0.6, rotDeg: 0, h: 700, edge: 0.4 },
  { id: 'butte_4', e: -19.4, n: -12.6, a: 0.7, b: 0.5, rotDeg: -40, h: 520, edge: 0.4 },
  { id: 'butte_5', e: -21.4, n: -6.9, a: 0.55, b: 0.55, rotDeg: 0, h: 560, edge: 0.4 },
  // Eastern Highlands mesetas (flat highland benches, 900–1,300 m)
  { id: 'meseta_alta', e: 7.6, n: 8.6, a: 2.6, b: 4.6, rotDeg: -18, h: 1250, edge: 0.34 },
  { id: 'meseta_media', e: 9.0, n: -0.9, a: 2.0, b: 3.2, rotDeg: 12, h: 980, edge: 0.34 },
  // Benches on the Central Valley's east wall: legible steps between the floor and the Highlands
  { id: 'banco_oriental_a', e: 5.9, n: 5.6, a: 1.0, b: 1.7, rotDeg: 15, h: 430, edge: 0.4 },
  { id: 'banco_oriental_b', e: 6.2, n: 0.6, a: 0.9, b: 1.5, rotDeg: -10, h: 410, edge: 0.4 },
  // Foothill bench on the Starter Basin's north-west shoulder
  { id: 'meseta_noroeste', e: -14.8, n: 6.2, a: 3.2, b: 1.6, rotDeg: -5, h: 640, edge: 0.4 },
];

/* -------------------------------------------------------------------------------------------
 * LAKES (excavated depressions with a sill; the hydrology solver fills them to the sill).
 * ------------------------------------------------------------------------------------------- */
export interface LakeDef {
  id: string; name: string; kind: 'mountain' | 'lagoon';
  e: number; n: number; a: number; b: number; rotDeg: number;
  /** Sill/surface elevation (m) and basin depth below the sill (m). */
  levelM: number; depthM: number;
  /** Direction (deg, geographic bearing) of the natural outlet, if any. */
  outletBearingDeg?: number;
}
export const LAKES: ReadonlyArray<LakeDef> = [
  { id: 'lake_a_espejo', name: 'Lago Espejo (montañoso)', kind: 'mountain', e: -1.55, n: 11.25, a: 0.85, b: 0.55, rotDeg: 20, levelM: 1620, depthM: 70, outletBearingDeg: 170 },
  { id: 'lake_c_laguna', name: 'Laguna Costera', kind: 'lagoon', e: 6.3, n: -12.1, a: 1.4, b: 0.55, rotDeg: -32, levelM: 0.4, depthM: 3.2 },
];

/** Reservoir: an excavated basin along a tributary, closed by an embankment only where the terrain is lower than the water
 * level (a dyked reservoir). The generator scans the candidate rivers for the site that needs the least embankment. */
export const DAMS = [
  { id: 'lake_b_presa', name: 'Embalse de la Presa', rivers: ['rio_del_paso', 'rio_alto', 'rio_cumbre', 'rio_canada'], searchFrom: 0.25, searchTo: 0.85, lengthKm: 1.5, widthKm: 0.55, depthM: 28 },
] as const;

/* -------------------------------------------------------------------------------------------
 * RIVERS. Control points are the drainage SKELETON only: valleys, floors, meanders and the
 * resulting hydrology are derived from the relief in masterMap.ts (floors are forced to descend).
 * `valley` = half-width (km) of the carved valley at [source, mid, mouth].
 * ------------------------------------------------------------------------------------------- */
export interface RiverDef {
  id: string; name: string; kind: 'perennial' | 'dry';
  pts: ReadonlyArray<Pt>;
  parent?: string;
  valley: readonly [number, number, number];
  incisionM: number;
  /** 0..1 meander strength where the gradient is low. */
  meander: number;
  /** Floor pins [E, N, max floor m]: ceilings so the network closes onto fixed Field elevations. */
  pins?: ReadonlyArray<readonly [number, number, number]>;
  /** Prepend the Field's own river (Field-local control points translated into the master frame, fixed floors). */
  fieldPrefix?: boolean;
  /** Extra upstream control points before the Field prefix (headwaters in the foothills). */
  headPts?: ReadonlyArray<Pt>;
}

export const RIVERS: ReadonlyArray<RiverDef> = [
  {
    id: 'rio_principal', name: 'Río Principal', kind: 'perennial',
    pts: [[-1.5, 10.75], [-0.7, 9.2], [0.2, 7.6], [0.5, 5.2], [1.1, 3.0], [0.9, 0.6], [1.6, -1.8], [1.0, -4.2], [1.4, -6.7],
      [2.3, -9.0], [2.0, -11.4], [2.9, -13.4], [3.1, -15.0], [3.2, -16.2]],
    valley: [0.55, 3.3, 2.6], incisionM: 8, meander: 1,
    pins: [[1.4, -6.7, 196]],
  },
  {
    id: 'rio_del_paso', name: 'Río del Paso', kind: 'perennial', parent: 'rio_principal',
    pts: [[-8.2, 11.7], [-6.7, 10.0], [-5.0, 8.7], [-3.0, 7.7], [-1.2, 7.3], [0.1, 7.5]],
    valley: [0.5, 0.9, 1.4], incisionM: 6, meander: 0.6,
  },
  {
    id: 'rio_alto', name: 'Río Alto', kind: 'perennial', parent: 'rio_principal',
    pts: [[7.6, 9.2], [6.0, 7.0], [4.3, 5.5], [2.7, 4.6], [1.2, 3.9]],
    valley: [0.5, 1.1, 1.5], incisionM: 6, meander: 0.6,
  },
  {
    id: 'rio_cumbre', name: 'Río Cumbre', kind: 'perennial', parent: 'rio_principal',
    pts: [[5.6, 10.4], [4.5, 9.0], [3.2, 7.9], [2.0, 7.0], [0.6, 6.3]],
    valley: [0.5, 0.9, 1.2], incisionM: 5, meander: 0.5,
  },
  {
    id: 'rio_canada', name: 'Río Cañada', kind: 'perennial', parent: 'rio_principal',
    pts: [[8.7, -2.0], [7.0, -3.5], [5.0, -5.4], [3.3, -7.1], [2.4, -8.7]],
    valley: [0.5, 1.0, 1.4], incisionM: 6, meander: 0.7,
  },
  {
    id: 'rio_sur', name: 'Río Sur', kind: 'perennial', parent: 'rio_principal',
    pts: [[-9.2, -11.0], [-6.5, -11.7], [-3.6, -11.2], [-0.8, -11.7], [1.0, -11.4], [2.0, -11.4]],
    valley: [0.6, 1.0, 1.4], incisionM: 5, meander: 1,
  },
  {
    // The Field's own river: the Field's control points (translated) plus the run to the confluence.
    id: 'rio_field', name: 'Río del Campo (Starter Basin)', kind: 'perennial', parent: 'rio_principal', fieldPrefix: true,
    headPts: [[-18.3, 6.5], [-17.2, 5.3], [-16.4, 3.9]],
    pts: [[-1.6, -7.15], [0.2, -6.95], [1.3, -6.75]],
    valley: [0.5, 1.0, 1.4], incisionM: 6, meander: 0.6,
  },
  {
    id: 'rio_norte', name: 'Río Norte', kind: 'perennial',
    pts: [[-3.2, 15.9], [-3.0, 17.9], [-2.6, 19.6], [-2.2, 20.9], [-2.0, 21.6]],
    valley: [0.4, 0.6, 0.9], incisionM: 4, meander: 0.4,
  },
  {
    id: 'rio_bahia_norte', name: 'Río de la Bahía', kind: 'perennial',
    pts: [[-12.3, 15.4], [-12.8, 16.6], [-13.5, 17.5], [-14.1, 18.4]],
    valley: [0.4, 0.5, 0.7], incisionM: 4, meander: 0.3,
  },
  {
    id: 'rio_isla_oeste', name: 'Río de la Isla (oeste)', kind: 'perennial',
    pts: [[18.6, -0.2], [17.7, 0.0], [16.9, 0.2], [16.2, 0.3]],
    valley: [0.35, 0.5, 0.7], incisionM: 4, meander: 0.3,
  },
  {
    id: 'rio_isla_este', name: 'Río de la Isla (este)', kind: 'perennial',
    pts: [[20.6, 4.2], [21.6, 4.7], [22.6, 4.9], [23.6, 4.7]],
    valley: [0.35, 0.5, 0.7], incisionM: 4, meander: 0.3,
  },
  // Dry arroyos of the Western Badlands (canyons, no permanent water)
  {
    id: 'arroyo_norte', name: 'Arroyo Seco Norte', kind: 'dry',
    pts: [[-20.4, 7.7], [-21.5, 7.2], [-22.4, 7.9], [-23.5, 7.5]],
    valley: [0.35, 0.55, 0.7], incisionM: 90, meander: 0.55,
  },
  {
    id: 'arroyo_centro', name: 'Arroyo Seco Central', kind: 'dry',
    pts: [[-18.5, -0.9], [-20.4, -0.5], [-22.0, -0.4], [-23.5, -0.3]],
    valley: [0.35, 0.55, 0.7], incisionM: 90, meander: 0.55,
  },
  {
    id: 'arroyo_sur', name: 'Arroyo Seco Sur', kind: 'dry',
    pts: [[-17.6, -9.0], [-19.7, -9.6], [-21.3, -9.9], [-22.9, -10.2]],
    valley: [0.35, 0.55, 0.7], incisionM: 80, meander: 0.55,
  },
];

/* -------------------------------------------------------------------------------------------
 * REGIONS. Cores are seeds only; boundaries are derived from relief (least-cost propagation
 * across slopes/ridges), never drawn.
 * ------------------------------------------------------------------------------------------- */
export type RegionId =
  | 'R01_starter_basin' | 'R02_central_valley' | 'R03_northern_mountains' | 'R04_western_badlands' | 'R05_southern_greenbelt'
  | 'R06_south_coast' | 'R07_eastern_island' | 'R08_southern_archipelago' | 'R09_eastern_highlands';

export const REGION_IDS: ReadonlyArray<RegionId> = [
  'R01_starter_basin', 'R02_central_valley', 'R03_northern_mountains', 'R04_western_badlands', 'R05_southern_greenbelt',
  'R06_south_coast', 'R07_eastern_island', 'R08_southern_archipelago', 'R09_eastern_highlands',
];

export const REGION_NAMES: Record<RegionId, string> = {
  R01_starter_basin: 'Starter Basin', R02_central_valley: 'Central Valley', R03_northern_mountains: 'Northern Mountains',
  R04_western_badlands: 'Western Badlands', R05_southern_greenbelt: 'Southern Greenbelt', R06_south_coast: 'South Coast',
  R07_eastern_island: 'Eastern Island', R08_southern_archipelago: 'Southern Archipelago', R09_eastern_highlands: 'Eastern Highlands',
};

/** [E, N, radius km] seed discs (cost 0). Region geometry emerges from relief around them. */
export const REGION_SEEDS: Record<RegionId, ReadonlyArray<readonly [number, number, number]>> = {
  R01_starter_basin: [[-10.5, -2.0, 3.2], [-13.0, -4.5, 2.0], [-8.0, 0.0, 1.6]],
  R02_central_valley: [[-0.6, 9.0, 0.9], [0.6, 4.5, 1.6], [1.0, 0.0, 1.8], [1.4, -4.6, 1.6]],
  R03_northern_mountains: [[-9.5, 15.0, 3.0], [-16.0, 17.6, 3.0], [-3.0, 13.0, 3.0], [3.0, 11.6, 2.5], [-12.0, 18.6, 1.2], [-2.5, 18.2, 1.2]],
  R04_western_badlands: [[-20.5, 3.0, 3.2], [-19.6, -6.5, 3.0], [-21.0, 9.5, 1.8]],
  R05_southern_greenbelt: [[-7.0, -12.0, 2.5], [-2.6, -10.8, 1.6], [-14.5, -13.0, 2.0]],
  R06_south_coast: [[3.4, -13.6, 1.0], [7.0, -12.5, 1.0], [-3.2, -14.4, 0.8]],
  R07_eastern_island: [[19.6, -1.0, 2.0], [20.8, 4.6, 1.5], [20.2, -5.4, 1.4], [17.6, 2.6, 0.8]],
  R08_southern_archipelago: [[-1.4, -20.6, 0.9], [5.8, -21.0, 0.9], [11.4, -19.1, 0.8], [14.3, -17.5, 0.8], [-4.2, -19.2, 0.5]],
  R09_eastern_highlands: [[7.6, 8.4, 2.2], [9.2, 1.0, 1.8], [8.4, -1.0, 1.0]],
};

/** Named natural landmarks that are part of the geology/hydrology (built ones come in later phases). */
export const NATURAL_LANDMARKS: ReadonlyArray<{ id: string; name: string; e: number; n: number; kind: 'peak' | 'lake' | 'volcano' }> = [
  { id: 'gran_pico', name: 'Gran Pico (cumbre dividida)', e: -9.35, n: 14.9, kind: 'peak' },
  { id: 'volcan_isla', name: 'Volcán de la Isla', e: 19.2, n: -0.6, kind: 'volcano' },
  { id: 'lago_espejo', name: 'Lago Espejo', e: -1.55, n: 11.25, kind: 'lake' },
];

/* -------------------------------------------------------------------------------------------
 * NAMED AREAS (temporary content adapter). These are authored POI anchors within the continuous
 * world. Their legacy ids only locate old mission/asset packs; the world itself has one coordinate
 * system, one terrain surface and one streaming instance.
 * ------------------------------------------------------------------------------------------- */
export interface NamedAreaAnchor {
  /** Stable named-area id retained for content/save compatibility. */
  id: string;
  /** Macro-region the site lives in. */
  macro: RegionId;
  /** Geographic anchor (E, N km) of the region-local origin (0,0). */
  anchorGeoKm: Pt;
  /** Local-frame bounding box (metres) of everything gameplay uses there: spawn, airfields (with runway ends), targets. */
  footprintLocalM: { x: readonly [number, number]; z: readonly [number, number] };
  /** Pressure-altitude base (m) added to local y for the atmosphere/ISA model. 0 = keep the mission tuning done in local frames. */
  pressureAltitudeBaseM: number;
}

export const NAMED_AREA_ANCHORS: ReadonlyArray<NamedAreaAnchor> = [
  { id: 'scrap_valley', macro: 'R02_central_valley', anchorGeoKm: [2.8, -0.6], footprintLocalM: { x: [-60, 60], z: [-40, 770] }, pressureAltitudeBaseM: 0 },
  { id: 'red_canyon', macro: 'R04_western_badlands', anchorGeoKm: [-20.3, -2.8], footprintLocalM: { x: [-40, 100], z: [-40, 460] }, pressureAltitudeBaseM: 0 },
  { id: 'backcountry', macro: 'R03_northern_mountains', anchorGeoKm: [-6.72, 9.24], footprintLocalM: { x: [-80, 45], z: [-40, 390] }, pressureAltitudeBaseM: 0 },
  { id: 'coast_run', macro: 'R06_south_coast', anchorGeoKm: [4.4, -12.7], footprintLocalM: { x: [-60, 60], z: [-40, 520] }, pressureAltitudeBaseM: 0 },
  { id: 'industrial_belt', macro: 'R02_central_valley', anchorGeoKm: [1.2, -7.6], footprintLocalM: { x: [-95, 115], z: [-40, 530] }, pressureAltitudeBaseM: 0 },
  { id: 'high_desert_test_range', macro: 'R04_western_badlands', anchorGeoKm: [-17.7, 6.5], footprintLocalM: { x: [-70, 70], z: [-40, 790] }, pressureAltitudeBaseM: 0 },
  { id: 'the_range', macro: 'R09_eastern_highlands', anchorGeoKm: [7.3, 8.3], footprintLocalM: { x: [-50, 135], z: [-40, 660] }, pressureAltitudeBaseM: 0 },
];

/** @deprecated Legacy campaign content bridge; ids now identify places in the world. */
export type CampaignSite = NamedAreaAnchor;

/** Rigid campaign-frame transforms for planners and map code that need geographic positions
 * without constructing the expensive elevation grid. The master terrain runtime uses the
 * same translations in CampaignFrame. */
export function namedAreaToWorld(regionId: string, x: number, z: number): [number, number] {
  if (regionId === 'the_field') return fieldLocalToMaster(x, z);
  const site = NAMED_AREA_ANCHORS.find((entry) => entry.id === regionId);
  if (!site) throw new Error(`unknown campaign region ${regionId}`);
  return [x - site.anchorGeoKm[0] * 1000, z + site.anchorGeoKm[1] * 1000];
}

export function worldToNamedArea(regionId: string, x: number, z: number): [number, number] {
  if (regionId === 'the_field') return masterToFieldLocal(x, z);
  const site = NAMED_AREA_ANCHORS.find((entry) => entry.id === regionId);
  if (!site) throw new Error(`unknown campaign region ${regionId}`);
  return [x + site.anchorGeoKm[0] * 1000, z - site.anchorGeoKm[1] * 1000];
}

/** Grading margin (m) added around a footprint and the width of the blend back into natural terrain. */
export const SITE_GRADING = { marginM: 60, blendM: 450 } as const;

/** @deprecated Compatibility alias; use namedAreaToWorld. */
export const campaignLocalToMaster = namedAreaToWorld;
/** @deprecated Compatibility alias; use worldToNamedArea. */
export const masterToCampaignLocal = worldToNamedArea;
export const CAMPAIGN_SITES = NAMED_AREA_ANCHORS;
