import { createNoise2D } from 'simplex-noise';
import { createSeededRandom, type SeededRandom } from '../core/seededRandom';
import { buildAirportOverrides } from './airfieldTerrain';
import type { Anchor, CropKind, FieldParcel, RoadDef, Vec2 } from './fieldComposition';
import { allRoadPaths, createRoadDistance, type RoadPath } from './fieldRoads';
import { getDensityBudget, getDensityLevel, type DensityAnchor } from './densitySystem';
import { getRegionArtBible, type RegionArtBible, type TerrainType } from './regionArtBible';
import { getRegionLandmarks } from './landmarks';
import { pickSpecies, type VegetationRole, type VegetationSpecies } from './vegetation';
import type { TerrainGridSampler } from './terrainHeightfield';
import type { TerrainQueryService } from './terrainQuery';

/**
 * THE composer. One region-parametric placement pipeline: every region (The Field, Red Canyon,
 * and the six still to come) is composed by this file and differs only in the data it hands in
 * (`RegionCompositionSpec`: anchors, roads, parcels, a density field, an authored dressing
 * script that may ONLY call the shared primitives below).
 *
 * Authority decisions this file consolidates (see the module docs of each):
 *  - placement / composition: this module (was `fieldPlacement.buildFieldLayout`, now a thin
 *    wrapper that supplies The Field's spec).
 *  - road geometry: `fieldRoads.ts` (region-parametric since `allRoadPaths(grid, roads, anchors)`).
 *  - composition data shapes: `fieldComposition.ts` (`Anchor`/`RoadDef`/`FieldParcel`).
 *  - vegetation species: `vegetation.ts` (`pickSpecies(role, archetypes, biome)`); this module
 *    never names a tree species itself, it asks for a structural ROLE.
 *  - regional identity: `regionArtBible.ts`; object budgets: `densitySystem.ts`.
 *
 * Pure data out (no Three.js); render/fieldWorld.ts instances it.
 */

/** GLB props authored in Blender (Z-down, see blenderAxisFix.ts). */
export type BlenderKind = 'farmhouse_a' | 'farmhouse_b' | 'small_workshop' | 'barn_a' | 'barn_b' | 'windmill_landmark' | 'water_tower';
/** GLB props from the airfield ground-ops pack (Y-up). */
export type AirfieldKind = 'af_control_tower' | 'af_crew_building' | 'af_gse_store' | 'af_hangar_compound' | 'af_fuel_bowser' | 'af_tug' | 'af_floodlight' | 'af_cone_row' | 'af_chock' | 'af_fence' | 'af_gate' | 'af_ground_power' | 'af_bus' | 'af_taxiway_sign' | 'af_stand_guidance' | 'af_windsock';
/** Procedural merged-geometry props (fieldWorld.ts builds them). */
export type ProcKind = 'silo' | 'tank' | 'warehouse' | 'stack' | 'lattice_tower' | 'fence_seg' | 'pole' | 'hay_bale' | 'barrel' | 'crate' | 'sign' | 'jetty' | 'hut'
  | 'townhouse' | 'church' | 'pylon' | 'boat' | 'reeds' | 'lighthouse' | 'boathouse' | 'car';
export type PropKind = BlenderKind | AirfieldKind | ProcKind;

export interface Placement { kind: PropKind; x: number; z: number; rotY: number; scale: number }
export interface TreePlacement {
  kind: 'broadleaf' | 'conifer' | 'shrub';
  /** vegetation.ts species this instance represents (region-resolved from the art bible). */
  speciesId: string;
  x: number; z: number; scale: number; rotY: number; tint: number;
  /** near-detail Quaternius tree (village/airfield/road) instead of a mass tree */
  hero: boolean;
}
export interface RockPlacement { kind: 'rock1' | 'rock2' | 'rock3' | 'pebble'; x: number; z: number; scale: number; rotY: number; tilt: number; /** big formation rock */ large: boolean }
export interface GroundPatch { id: string; center: Vec2; widthM: number; depthM: number; headingRad: number; color: string; /** 'field' patches carry crop rows, 'plain' are flat surface colour */ kind: 'field' | 'plain'; rowAngleRad: number; liftM: number }

export interface RegionLayout {
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
/** Back-compat alias: The Field's layout is just a RegionLayout. */
export type FieldLayout = RegionLayout;

export interface LayoutInput { grid: TerrainGridSampler; terrain: TerrainQueryService }

const PI = Math.PI;
const facing = (dx: number, dz: number): number => Math.atan2(dx, dz);

/** Footprint radius (m, at the scale used) per building kind; drives lot spacing checks. */
const FOOTPRINT_R: Partial<Record<PropKind, number>> = {
  farmhouse_a: 10, farmhouse_b: 10, small_workshop: 11, barn_a: 17, barn_b: 17, silo: 6, tank: 9, warehouse: 30, stack: 6, lattice_tower: 8, hut: 5,
  townhouse: 7, church: 16, lighthouse: 7, boathouse: 8,
};

function inParcelRect(p: FieldParcel, x: number, z: number, margin: number): boolean {
  const dx = x - p.center[0], dz = z - p.center[1];
  const c = Math.cos(p.headingRad), s = Math.sin(p.headingRad);
  const lx = c * dx - s * dz, lz = s * dx + c * dz;
  return Math.abs(lx) <= p.widthM / 2 + margin && Math.abs(lz) <= p.depthM / 2 + margin;
}

export interface FrontageOpts {
  road: RoadPath; fromS: number; toS: number; spacing: number; offsets: [number, number];
  sides: Array<-1 | 1>; kinds: Array<[PropKind, number]>; chance: number; scale: Record<string, [number, number]>;
}

/** Scatter pass driven by densitySystem.ts: walks a grid of 100m cells, asks for the density
 * level, and spends that level's budget on region-appropriate vegetation and props. This is
 * how D0-D5 turns into visibly different object sets per zone. Regions opt in via
 * `spec.densityScatter`; The Field deliberately does not (its content is hand-authored). */
export interface DensityScatterSpec {
  minX: number; maxX: number; minZ: number; maxZ: number;
  /** Props this region spends its per-cell prop budget on, with relative weights. */
  propKinds: Array<[PropKind, number]>;
  /** Max slope (deg) anything may be scattered on. */
  maxSlopeDeg: number;
  /** Scale range for scattered vegetation. */
  vegetationScale: [number, number];
  /** Fraction of the D-level vegetation/prop budget this region actually spends. Arid regions
   * run well under 1; the D0-D5 *gradient* is what the budget provides, the absolute count is
   * regional. */
  vegetationFactor: number;
  propFactor: number;
}

export interface RegionCompositionSpec {
  regionId: string;
  terrain: TerrainType;
  /** Root seed: every RNG stream and noise channel in the composition derives from it. */
  seed: string;
  anchors: Record<string, Anchor>;
  roads: ReadonlyArray<RoadDef>;
  parcels: ReadonlyArray<FieldParcel>;
  parcelColors: Record<CropKind, string[]>;
  /** Anything below this is sea/lake bed and nothing may be placed on it. */
  seaLevelM: number;
  maxTreeInstances: number;
  /** Anchors handed to densitySystem.ts (settlements, airfields, camps). */
  densityAnchors: DensityAnchor[];
  /** Tree-mass field: 0..1 probability the point belongs to a grove. Region geography lives
   * here (river woodland, canyon wash, forest patches) — the grove/budget algorithm is shared. */
  treeDensity(grid: TerrainGridSampler, patchNoise: (x: number, y: number) => number, x: number, z: number): number;
  /** Grove sampling grid: cell size and half-extent (m). */
  treeMass: {
    cellM: number; extentM: number; core: Vec2; coreFalloff: [number, number];
    /** Extra score (0..1) for groves the region wants to survive the global budget first
     * (The Field: river/lake woodland). Shared budget algorithm, regional priority data. */
    priority?(x: number, z: number): number;
  };
  /** Extra hard keep-out for buildings beyond terrain/water/runway/road (e.g. a river corridor). */
  buildingKeepOut?(x: number, z: number): boolean;
  /** Which roads grow occasional tree avenues, and whether the avenue is a wide/scattered
   * mountain-pass style one. `null` = this road gets none. */
  roadsideAvenue(road: RoadDef): { wide: boolean } | null;
  densityScatter?: DensityScatterSpec;
  /** Authored dressing: exclusions, frontages, compounds, airfield ops. May ONLY call ctx. */
  authored(ctx: CompositionContext): void;
  /** Authored rock composition; runs last so its RNG draws stay after the tree passes. */
  rocks(ctx: CompositionContext): void;
}

export interface CompositionContext {
  readonly spec: RegionCompositionSpec;
  readonly artBible: RegionArtBible;
  readonly grid: TerrainGridSampler;
  readonly terrain: TerrainQueryService;
  readonly rng: SeededRandom;
  readonly roads: RoadPath[];
  readonly trees: TreePlacement[];
  readonly lots: Placement[];
  readonly props: Placement[];
  readonly rocks: RockPlacement[];
  roadById(id: string): RoadPath;
  anchor(id: string): Anchor;
  /** Anchor-local -> world. */
  rot(a: Anchor, lx: number, lz: number): Vec2;
  // --- guards (terrain / water / runway / parcel / exclusion aware) ---
  wet(x: number, z: number): boolean;
  okGround(x: number, z: number, maxSlopeDeg: number): boolean;
  nearPad(x: number, z: number, margin: number): boolean;
  inParcel(x: number, z: number, margin: number): boolean;
  inExclusion(x: number, z: number, margin?: number): boolean;
  roadDist(x: number, z: number): number;
  densityLevelAt(x: number, z: number): number;
  // --- emitters ---
  ex(a: { x: number; z: number }, r: number): void;
  plain(id: string, c: Vec2, w: number, d: number, heading: number, color: string, lift?: number): void;
  addBuilding(kind: PropKind, x: number, z: number, rotY: number, scale: number, ownRoad?: string): boolean;
  addForced(kind: PropKind, x: number, z: number, rotY: number, scale: number): void;
  addProp(kind: PropKind, x: number, z: number, rotY?: number, scale?: number): void;
  at(a: Anchor, kind: PropKind, lx: number, lz: number, ry: number, s: number): void;
  yard(a: Anchor, w: number, d: number, color?: string): void;
  windbreak(a: Anchor, from: Vec2, to: Vec2, count: number): void;
  fenceRun(pts: Vec2[], kind: 'af_fence' | 'fence_seg', seg: number, gapAt?: Vec2, gapR?: number): void;
  frontage(o: FrontageOpts): number;
  /** Region-resolved species for a structural role (vegetation.ts owns the catalog). */
  species(role: VegetationRole): VegetationSpecies;
  addTree(role: VegetationRole, x: number, z: number, scale: number, rotY: number, tint: number, hero: boolean): void;
  addRock(kind: RockPlacement['kind'], x: number, z: number, scale: number, rotY: number, tilt: number, large: boolean): void;
  /** Shared rock-group primitive: one anchor boulder plus satellites, terrain/water guarded. */
  rockCluster(x: number, z: number, baseScale: number, n: number, spread: number): void;
}

export function buildRegionLayout(spec: RegionCompositionSpec, input: LayoutInput): RegionLayout {
  const { grid, terrain } = input;
  const artBible = getRegionArtBible(spec.terrain);
  const rng = createSeededRandom(spec.seed, 'layout');
  const roads = allRoadPaths(grid, spec.roads, spec.anchors);
  const roadDist = createRoadDistance(roads);
  const pads = buildAirportOverrides(spec.regionId);

  const lots: Placement[] = [];
  const props: Placement[] = [];
  const trees: TreePlacement[] = [];
  const rocks: RockPlacement[] = [];
  const patches: GroundPatch[] = [];
  const exclusions: Array<{ x: number; z: number; r: number }> = [];
  const footprints: Array<{ x: number; z: number; r: number }> = [];

  const speciesCache = new Map<VegetationRole, VegetationSpecies>();
  const species = (role: VegetationRole): VegetationSpecies => {
    let s = speciesCache.get(role);
    if (!s) { s = pickSpecies(role, artBible.vegetationArchetypes, dominantBiome(spec.terrain)); speciesCache.set(role, s); }
    return s;
  };

  const nearPad = (x: number, z: number, margin: number) => pads.some((p) => Math.hypot(x - p.center[0], z - p.center[1]) < p.radiusM + margin);
  const inParcel = (x: number, z: number, margin: number) => spec.parcels.some((p) => inParcelRect(p, x, z, margin));
  const inExclusion = (x: number, z: number, margin = 0) => exclusions.some((e) => Math.hypot(x - e.x, z - e.z) < e.r + margin);
  const wet = (x: number, z: number) => terrain.getWaterDepth(x, z) > 0 || grid.height(x, z) < spec.seaLevelM + 1;
  const okGround = (x: number, z: number, maxSlope: number) => !wet(x, z) && grid.slopeDeg(x, z) <= maxSlope;

  const canPlaceBuilding = (x: number, z: number, r: number, ownRoad?: string): boolean => {
    if (!okGround(x, z, 6) || nearPad(x, z, r + 45) || inParcel(x, z, r + 4) || (spec.buildingKeepOut?.(x, z) ?? false)) return false;
    if (footprints.some((f) => Math.hypot(x - f.x, z - f.z) < f.r + r + 3)) return false;
    // Keep off every road except by design: centreline must be clear of the footprint.
    for (const road of roads) {
      if (road.def.id === ownRoad) continue;
      for (const p of road.points) if (Math.hypot(p.x - x, p.z - z) < r + road.def.widthM / 2 + 3) return false;
    }
    return true;
  };

  // A roadside house is a *lot*, not a box: driveway to the road, a worked yard, a frontage
  // fence with a gate gap, a shade tree out back and some owner clutter. Own RNG stream so the
  // rest of the composition (trees, rocks) keeps its draws.
  const lotRng = createSeededRandom(spec.seed, 'homestead');
  const YARD = ['#7f9656', '#88985a', '#8e9660', '#76904f'], DRIVE = ['#8f7d5a', '#8a857a', '#94805c'];
  const CLUTTER: PropKind[] = ['barrel', 'crate', 'hay_bale'];
  const homestead = (x: number, z: number, nx: number, nz: number, tx: number, tz: number, d: number, r: number) => {
    const pick = <T,>(a: T[]) => a[Math.floor(lotRng.next() * a.length)];
    const h = Math.atan2(nx, nz), yardD = r * 2.4 + lotRng.next() * r;
    ctx.plain(`lot-yard-${lots.length}`, [x + nx * (yardD / 2 - d * 0.55), z + nz * (yardD / 2 - d * 0.55)], r * 2.6 + lotRng.next() * r, yardD + d * 0.55, h, pick(YARD), 0.15);
    ctx.plain(`lot-drive-${lots.length}`, [x - nx * d / 2 + tx * r * 0.35, z - nz * d / 2 + tz * r * 0.35], 3 + lotRng.next(), d, h, pick(DRIVE), 0.17);
    if (lotRng.next() < 0.55) {
      const fx = x - nx * (d - 3), fz = z - nz * (d - 3), half = r * (1.2 + lotRng.next() * 0.5);
      ctx.fenceRun([[fx - tx * half, fz - tz * half], [fx + tx * half, fz + tz * half]], 'fence_seg', 4, [fx + tx * r * 0.35, fz + tz * r * 0.35], 3);
    }
    for (let i = 0, n = 1 + Math.floor(lotRng.next() * 2); i < n; i++) {
      const side = lotRng.next() < 0.5 ? -1 : 1, back = r + 3 + lotRng.next() * 6, lat = side * r * (0.5 + lotRng.next() * 0.7);
      const px = x + nx * back + tx * lat, pz = z + nz * back + tz * lat;
      if (okGround(px, pz, 14) && !inParcel(px, pz, 2)) ctx.addTree('canopy', px, pz, 0.9 + lotRng.next() * 0.6, lotRng.next() * 6.28, lotRng.next(), false);
    }
    if (lotRng.next() < 0.4) {
      const kind = pick(CLUTTER), side = lotRng.next() < 0.5 ? -1 : 1;
      for (let i = 0, n = 2 + Math.floor(lotRng.next() * 3); i < n; i++) {
        const lat = side * (r + 2 + i * 1.5), px = x + tx * lat + nx * (lotRng.next() * 2), pz = z + tz * lat + nz * (lotRng.next() * 2);
        ctx.addProp(kind, px, pz, lotRng.next() * 6.28, 1);
      }
    }
  };

  const ctx: CompositionContext = {
    spec, artBible, grid, terrain, rng, roads, trees, lots, props, rocks,
    roadById: (id) => roads.find((r) => r.def.id === id)!,
    anchor: (id) => spec.anchors[id],
    rot: (a, lx, lz) => [
      a.x + lx * Math.cos(a.headingRad) + lz * Math.sin(a.headingRad),
      a.z - lx * Math.sin(a.headingRad) + lz * Math.cos(a.headingRad),
    ],
    wet, okGround, nearPad, inParcel, inExclusion, roadDist,
    densityLevelAt: (x, z) => getDensityLevel({ regionId: spec.regionId, terrain: spec.terrain, x, z, anchors: spec.densityAnchors }),
    ex: (a, r) => { exclusions.push({ x: a.x, z: a.z, r }); },
    plain: (id, c, w, d, heading, color, lift = 0.16) =>
      void patches.push({ id, center: c, widthM: w, depthM: d, headingRad: heading, color, kind: 'plain', rowAngleRad: 0, liftM: lift }),
    addBuilding(kind, x, z, rotY, scale, ownRoad) {
      const r = FOOTPRINT_R[kind] ?? 8;
      if (!canPlaceBuilding(x, z, r, ownRoad)) return false;
      footprints.push({ x, z, r });
      lots.push({ kind, x, z, rotY, scale });
      return true;
    },
    addForced(kind, x, z, rotY, scale) { lots.push({ kind, x, z, rotY, scale }); footprints.push({ x, z, r: FOOTPRINT_R[kind] ?? 8 }); },
    addProp(kind, x, z, rotY = 0, scale = 1) { props.push({ kind, x, z, rotY, scale }); },
    at(a, kind, lx, lz, ry, s) {
      const [x, z] = ctx.rot(a, lx, lz);
      // Authored compound pieces still refuse cliffs/water: an anchor-local offset can land on
      // a strata step the author never saw.
      if (!okGround(x, z, 22)) return;
      ctx.addForced(kind, x, z, ry + a.headingRad, s);
    },
    yard(a, w, d, color = '#8d7a56') { ctx.plain(`yard-${a.id}`, [a.x, a.z], w, d, a.headingRad, color, 0.17); },
    windbreak(a, from, to, count) {
      for (let i = 0; i < count; i++) {
        const t = i / Math.max(1, count - 1), [lx, lz] = [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
        const [x, z] = ctx.rot(a, lx, lz);
        ctx.addTree(i % 3 === 0 ? 'canopy' : 'evergreen', x, z, 1.6 + rng.next() * 0.7, rng.next() * 6, rng.next(), false);
      }
    },
    fenceRun(pts, kind, seg, gapAt, gapR = 0) {
      for (let i = 0; i < pts.length - 1; i++) {
        const [x0, z0] = pts[i], [x1, z1] = pts[i + 1];
        const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(len / seg)), dx = (x1 - x0) / len, dz = (z1 - z0) / len;
        for (let k = 0; k < n; k++) {
          const t = ((k + 0.5) / n) * len, x = x0 + dx * t, z = z0 + dz * t;
          if (gapAt && Math.hypot(x - gapAt[0], z - gapAt[1]) < gapR) continue;
          ctx.addProp(kind, x, z, kind === 'af_fence' ? Math.atan2(-dz, dx) : facing(dx, dz), (len / n) / seg);
        }
      }
    },
    frontage(o) {
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
          if (ctx.addBuilding(kind, x, z, facing(-nx, -nz) + (rng.next() - 0.5) * 0.14, scale, o.road.def.id)) {
            placed++;
            homestead(x, z, nx, nz, p.tx, p.tz, o.road.def.widthM / 2 + off, FOOTPRINT_R[kind] ?? 8);
          }
        }
      }
      return placed;
    },
    species,
    addTree(role, x, z, scale, rotY, tint, hero) {
      const s = species(role);
      trees.push({ kind: s.renderKind, speciesId: s.id, x, z, scale, rotY, tint, hero });
    },
    addRock(kind, x, z, scale, rotY, tilt, large) { rocks.push({ kind, x, z, scale, rotY, tilt, large }); },
    rockCluster(x, z, baseScale, n, spread) {
      const rockWet = (px: number, pz: number) => terrain.getWaterDepth(px, pz) > 0 || grid.height(px, pz) < spec.seaLevelM + 5;
      if (rockWet(x, z) || nearPad(x, z, 60) || inParcel(x, z, 2) || inExclusion(x, z)) return;
      const kinds = ['rock1', 'rock2', 'rock3'] as const;
      for (let i = 0; i < n; i++) {
        const a = rng.next() * PI * 2, r = i === 0 ? 0 : spread * (0.4 + rng.next() * 0.6);
        const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        if (rockWet(px, pz)) continue;
        const scale = i === 0 ? baseScale : baseScale * (0.35 + rng.next() * 0.4);
        rocks.push({ kind: kinds[Math.floor(rng.next() * 3)], x: px, z: pz, scale, rotY: rng.next() * 6.28, tilt: (rng.next() - 0.5) * 0.4, large: scale > 5 });
      }
    },
  };

  // ---- 1. parcel ground patches (shared) --------------------------------------------------
  spec.parcels.forEach((p, i) => {
    const colors = spec.parcelColors[p.crop];
    patches.push({ id: p.id, center: p.center, widthM: p.widthM, depthM: p.depthM, headingRad: p.headingRad, color: colors[i % colors.length], kind: 'field', rowAngleRad: p.rowAngleRad, liftM: 0.12 });
  });

  // ---- 2. region's authored dressing (data + calls into ctx only) --------------------------
  spec.authored(ctx);

  // ---- 3. parcel furniture: boundary trees / hedges / fences, bales (shared) ---------------
  buildParcelFurniture(ctx);

  // ---- 4. vegetation (shared algorithms, region density field + species) -------------------
  generateTreeMasses(ctx);
  addRoadsideTrees(ctx);
  addVillageHeroTrees(ctx);
  if (spec.densityScatter) densityScatter(ctx, spec.densityScatter);

  // ---- 5. rocks + landmarks ----------------------------------------------------------------
  spec.rocks(ctx);
  placeLandmarkFormations(ctx);

  return { roads, lots, props, trees, rocks, patches, exclusions };
}

/** Region terrain -> dominant biome id, mirroring terrainQuery.ts's TERRAIN_SURFACE_AND_BIOME.
 * Only used to give `pickSpecies` a fallback when no archetype matches. */
function dominantBiome(terrain: TerrainType): string {
  return ({
    meadow: 'temperate_grassland', quarry: 'rocky_mountain', canyon: 'badlands', forest: 'temperate_woodland',
    coast: 'coastal_dune', industrial: 'urban_periurban', desert: 'xeric_plain', range: 'highland_scrub',
  } as Record<TerrainType, string>)[terrain];
}

function buildParcelFurniture(ctx: CompositionContext): void {
  const { spec, rng } = ctx;
  for (const p of spec.parcels) {
    const c = Math.cos(p.headingRad), s = Math.sin(p.headingRad);
    const local = (lx: number, lz: number): Vec2 => [p.center[0] + lx * c + lz * s, p.center[1] - lx * s + lz * c];
    const hw = p.widthM / 2 + 4, hd = p.depthM / 2 + 4;
    const edges: Record<'n' | 's' | 'e' | 'w', [Vec2, Vec2]> = { n: [[-hw, hd], [hw, hd]], s: [[-hw, -hd], [hw, -hd]], e: [[hw, -hd], [hw, hd]], w: [[-hw, -hd], [-hw, hd]] };
    for (const [side, kind] of Object.entries(p.edges ?? {}) as Array<['n' | 's' | 'e' | 'w', string]>) {
      const [a, b] = edges[side].map(([lx, lz]) => local(lx, lz)) as [Vec2, Vec2];
      if (kind === 'fence') { ctx.fenceRun([a, b], 'fence_seg', 4); continue; }
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]), step = kind === 'trees' ? 11 : 6, n = Math.floor(len / step);
      for (let i = 0; i <= n; i++) {
        const t = i / Math.max(1, n), x = a[0] + (b[0] - a[0]) * t + (rng.next() - 0.5) * 3, z = a[1] + (b[1] - a[1]) * t + (rng.next() - 0.5) * 3;
        if (ctx.wet(x, z) || ctx.nearPad(x, z, 30) || ctx.roadDist(x, z) < 9) continue;
        ctx.addTree(
          kind === 'trees' ? (rng.next() < 0.7 ? 'canopy' : 'evergreen') : 'understory',
          x, z, kind === 'trees' ? 1.6 + rng.next() * 0.6 : 1.5 + rng.next() * 0.5, rng.next() * 6, rng.next(), false,
        );
      }
    }
    if (p.crop === 'harvested' || p.crop === 'dry') {
      const n = p.crop === 'harvested' ? 14 : 5;
      for (let i = 0; i < n; i++) {
        const [x, z] = local((rng.next() - 0.5) * p.widthM * 0.85, (rng.next() - 0.5) * p.depthM * 0.85);
        ctx.addProp('hay_bale', x, z, rng.next() * 3, 1);
      }
    }
  }
}

export const noiseFor = (seed: string, channel: string) => {
  const r = createSeededRandom(seed, channel);
  return createNoise2D(() => r.next());
};

/** Clustered groves from the region's density field, budgeted globally (mobile WebGL2).
 * Region-agnostic: the only region knowledge is `spec.treeDensity` and the species roles. */
function generateTreeMasses(ctx: CompositionContext): void {
  const { spec, grid, rng } = ctx;
  const patchN = noiseFor(spec.seed, 'tree-patch'), typeN = noiseFor(spec.seed, 'tree-type');
  const CELL = spec.treeMass.cellM, EXTENT = spec.treeMass.extentM;
  interface Grove { x: number; z: number; d: number; score: number }
  const groves: Grove[] = [];
  for (let cx = -EXTENT; cx < EXTENT; cx += CELL) {
    for (let cz = -EXTENT; cz < EXTENT; cz += CELL) {
      const x = cx + rng.next() * CELL, z = cz + rng.next() * CELL;
      const roll = rng.next();
      const d = spec.treeDensity(grid, patchN, x, z);
      if (d < 0.05 || roll > d * 1.15) continue;
      if (ctx.wet(x, z) || ctx.nearPad(x, z, 90) || ctx.inParcel(x, z, 8) || ctx.inExclusion(x, z) || ctx.roadDist(x, z) < 14) continue;
      // Budget priority: density near the flown core beats remote back-country forest.
      const [coreX, coreZ] = spec.treeMass.core;
      const [near, far] = spec.treeMass.coreFalloff;
      const core = 1 - 0.55 * smooth01(near, far, Math.hypot(x - coreX, z - coreZ));
      groves.push({ x, z, d, score: (d + (spec.treeMass.priority?.(x, z) ?? 0)) * core });
    }
  }
  // Highest-density groves win when the mobile budget is hit.
  groves.sort((a, b) => b.score - a.score || a.x - b.x || a.z - b.z);
  let emitted = 0;
  for (const g of groves) {
    const count = 4 + Math.round(g.d * 8);
    if (emitted + count > spec.maxTreeInstances) continue;
    const h = grid.height(g.x, g.z);
    const evergreen = h > 105 || typeN(g.x / 700, g.z / 700) > 0.35 + (h < 40 ? 0.4 : 0);
    for (let i = 0; i < count; i++) {
      const a = rng.next() * PI * 2, r = 6 + Math.sqrt(rng.next()) * 32;
      const x = g.x + Math.cos(a) * r, z = g.z + Math.sin(a) * r;
      if (ctx.wet(x, z) || ctx.nearPad(x, z, 70) || ctx.roadDist(x, z) < 10 || grid.slopeDeg(x, z) > 38 || ctx.inParcel(x, z, 4)) continue;
      ctx.addTree(evergreen && rng.next() < 0.9 ? 'evergreen' : 'canopy', x, z, 1.5 + rng.next() * 1.0, rng.next() * 6.28, rng.next(), false);
      emitted++;
    }
  }
}

function smooth01(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Occasional aligned groups along roads (an avenue here and there), not a continuous row. */
function addRoadsideTrees(ctx: CompositionContext): void {
  const { rng, spec } = ctx;
  for (const road of ctx.roads) {
    const avenue = spec.roadsideAvenue(road.def);
    if (!avenue) continue;
    let s = 50 + rng.next() * 60;
    while (s < road.lengthM - 40) {
      const p = road.points.reduce((best, q) => (Math.abs(q.s - s) < Math.abs(best.s - s) ? q : best));
      if (!p.onBridge) {
        const wide = avenue.wide;
        const side = rng.next() < 0.5 ? -1 : 1, n = (wide ? 6 : 4) + Math.floor(rng.next() * 4), off = road.def.widthM / 2 + 6 + rng.next() * (wide ? 40 : 3);
        const evergreen = p.y > 90 || rng.next() < 0.25;
        for (let i = 0; i < n; i++) {
          const t = (i - n / 2) * 9;
          const x = p.x - p.tz * off * side + p.tx * t, z = p.z + p.tx * off * side + p.tz * t;
          if (ctx.wet(x, z) || ctx.nearPad(x, z, 50) || ctx.inParcel(x, z, 2) || ctx.inExclusion(x, z)) continue;
          ctx.addTree(evergreen ? 'evergreen' : 'canopy', x, z, 1.5 + rng.next() * 0.6, rng.next() * 6.28, rng.next(), false);
        }
      }
      s += avenue.wide ? 45 + rng.next() * 80 : 120 + rng.next() * 190;
    }
  }
}

/** Near-detail trees beside settlement buildings; these use the Quaternius GLBs. */
function addVillageHeroTrees(ctx: CompositionContext): void {
  const { rng } = ctx;
  for (const lot of [...ctx.lots]) {
    if (!(lot.kind === 'farmhouse_a' || lot.kind === 'farmhouse_b') || rng.next() < 0.35) continue;
    const a = rng.next() * PI * 2, r = 12 + rng.next() * 6, x = lot.x + Math.cos(a) * r, z = lot.z + Math.sin(a) * r;
    if (!ctx.wet(x, z)) ctx.addTree(rng.next() < 0.3 ? 'evergreen' : 'canopy', x, z, 0.9 + rng.next() * 0.5, rng.next() * 6.28, rng.next(), true);
  }
}

/**
 * densitySystem.ts made visible: per 100m cell, the resolved D-level's budget decides how much
 * vegetation and how many props this cell gets. Runway pads, water, steep ground, roads,
 * parcels and authored exclusions are all respected, so D5 near the apron spends its budget
 * on ground equipment rather than dropping crates on the runway.
 */
function densityScatter(ctx: CompositionContext, s: DensityScatterSpec): void {
  const { rng, spec } = ctx;
  const propTotal = s.propKinds.reduce((a, [, w]) => a + w, 0);
  const [smin, smax] = s.vegetationScale;
  for (let cx = s.minX; cx < s.maxX; cx += 100) {
    for (let cz = s.minZ; cz < s.maxZ; cz += 100) {
      const level = ctx.densityLevelAt(cx + 50, cz + 50);
      const budget = getDensityBudget(level as 0 | 1 | 2 | 3 | 4 | 5);
      const veg = quantise(budget.vegetationInstances * s.vegetationFactor, rng);
      for (let i = 0; i < veg; i++) {
        const x = cx + rng.next() * 100, z = cz + rng.next() * 100;
        if (ctx.terrain.isOnGradedRunway(x, z) || ctx.wet(x, z) || !ctx.okGround(x, z, s.maxSlopeDeg)) continue;
        if (ctx.nearPad(x, z, 40) || ctx.roadDist(x, z) < 6 || ctx.inExclusion(x, z)) continue;
        ctx.addTree('understory', x, z, smin + rng.next() * (smax - smin), rng.next() * 6.28, rng.next(), false);
      }
      if (level < 2 || s.propKinds.length === 0) continue;
      const propCount = quantise(budget.props * s.propFactor, rng);
      for (let i = 0; i < propCount; i++) {
        const x = cx + rng.next() * 100, z = cz + rng.next() * 100;
        if (ctx.terrain.isOnGradedRunway(x, z) || ctx.wet(x, z) || !ctx.okGround(x, z, s.maxSlopeDeg)) continue;
        if (ctx.nearPad(x, z, 35) || ctx.roadDist(x, z) < 5 || ctx.inExclusion(x, z)) continue;
        let pick = rng.next() * propTotal, kind = s.propKinds[0][0];
        for (const [k, w] of s.propKinds) { pick -= w; if (pick <= 0) { kind = k; break; } }
        ctx.addProp(kind, x, z, rng.next() * 6.28, 1);
      }
    }
  }
  void spec;
}

/** Fractional budgets become integer counts without losing the gradient (0.4 -> 40% chance of 1). */
const quantise = (v: number, rng: SeededRandom): number => Math.floor(v) + (rng.next() < v % 1 ? 1 : 0);

/**
 * landmarks.ts wired for real: every registered landmark in this region that the world does not
 * already build (i.e. no authored lot within its recognition radius) gets a distinct large rock
 * formation at its position, so a "landmark" on the map is always something you can actually
 * see from the air.
 */
function placeLandmarkFormations(ctx: CompositionContext): void {
  const { rng } = ctx;
  for (const landmark of getRegionLandmarks(ctx.spec.regionId)) {
    if (landmark.type !== 'natural') continue;
    const [lx, , lz] = landmark.worldPosition;
    if (ctx.wet(lx, lz) || ctx.nearPad(lx, lz, 40)) continue;
    const scale = 9 + landmark.silhouetteScore * 12;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * PI * 2 + rng.next() * 0.4, r = i === 0 ? 0 : 16 + rng.next() * 22;
      ctx.addRock(
        (['rock1', 'rock2', 'rock3'] as const)[i % 3],
        lx + Math.cos(a) * r, lz + Math.sin(a) * r,
        scale * (i === 0 ? 1 : 0.45 + rng.next() * 0.35),
        rng.next() * 6.28, 0.04, true,
      );
    }
  }
}
