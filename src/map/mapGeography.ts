import { getRegion } from '../content/regions';
import { getRegionAirfields } from '../world/airfields';
import { FIELD_LAKE, FIELD_RIVER_POINTS, EDGE_END_M, SEA_LEVEL_M, PASS_X, ridgeZ } from '../world/fieldGeography';
import { FIELD_PARCELS, ROADS, WORLD_ANCHORS, type CropKind, type RoadSurface } from '../world/fieldComposition';
import { catmullRom } from '../world/fieldRoads';
import { getRegionRoadNodes, getRegionRoadSegments, getRegionTowns } from '../world/landUse';
import { createTerrainQueryService } from '../world/terrainQuery';
import type { WorldRect } from './mapProjection';

/**
 * Cartographic model of a region, built ONLY from world data: terrain elevation/water come from
 * terrainQuery (the same function the renderer and physics sample), roads/river/parcels/anchors
 * from fieldComposition + fieldGeography. No 3D assets. Built once per region and cached.
 */

export type PoiKind = 'settlement' | 'farm' | 'industry' | 'bridge' | 'tower' | 'pass' | 'windmill';
export interface MapPoi { id: string; name: string; kind: PoiKind; x: number; z: number; /** 1 = most important */ priority: 1 | 2 | 3 }
export interface MapRoad { id: string; surface: RoadSurface; widthM: number; priority: number; pts: Array<[number, number]> }
export interface MapParcel { center: [number, number]; widthM: number; depthM: number; headingRad: number; crop: CropKind }
export interface MapLabel { id: string; name: string; x: number; z: number; kind: 'water' | 'mountain' }

export interface RegionMap {
  regionId: string;
  /** Square world extent shown by the map. */
  rect: WorldRect;
  raster: { size: number; rgba: Uint8ClampedArray; elevation: Float32Array };
  rivers: Array<Array<[number, number]>>;
  roads: MapRoad[];
  bridges: Array<{ x: number; z: number }>;
  parcels: MapParcel[];
  pois: MapPoi[];
  labels: MapLabel[];
}

export const RASTER_SIZE = 256;

export function getRegionRect(regionId: string): WorldRect {
  // The whole playable world, out to where the terrain has sunk into the sea.
  if (regionId === 'the_field') return { minX: -EDGE_END_M, maxX: EDGE_END_M, minZ: -EDGE_END_M, maxZ: EDGE_END_M };
  const fields = getRegionAirfields(regionId);
  const xs = fields.map((a) => a.position[0]), zs = fields.map((a) => a.position[2]);
  const cx = (Math.min(...xs, 0) + Math.max(...xs, 0)) / 2, cz = (Math.min(...zs, 0) + Math.max(...zs, 0)) / 2;
  const half = Math.max(1500, (Math.max(...xs, 0) - Math.min(...xs, 0)) / 2 + 900, (Math.max(...zs, 0) - Math.min(...zs, 0)) / 2 + 900);
  return { minX: cx - half, maxX: cx + half, minZ: cz - half, maxZ: cz + half };
}

// --- Elevation colour ramp (muted, aviation-chart): [elevation m, r, g, b] ---------------------
const RAMP: ReadonlyArray<readonly [number, number, number, number]> = [
  [-20, 96, 140, 84], [20, 110, 146, 86], [45, 134, 152, 82], [85, 158, 154, 88], [140, 170, 148, 92],
  [220, 150, 140, 102], [330, 134, 128, 110], [470, 146, 141, 128], [640, 168, 164, 148], [820, 192, 188, 172],
];
export const SEA = [52, 100, 132] as const;
const LAKE_SHALLOW = [86, 146, 178] as const;
const LAKE_DEEP = [58, 110, 148] as const;

function ramp(e: number): [number, number, number] {
  if (e <= RAMP[0][0]) return [RAMP[0][1], RAMP[0][2], RAMP[0][3]];
  for (let i = 1; i < RAMP.length; i++) {
    if (e <= RAMP[i][0]) {
      const a = RAMP[i - 1], b = RAMP[i], t = (e - a[0]) / (b[0] - a[0]);
      return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
    }
  }
  const l = RAMP[RAMP.length - 1];
  return [l[1], l[2], l[3]];
}

/** Hillshade + contour bands over the sampled elevation. Light from the north-west. */
function buildRaster(regionId: string, rect: WorldRect): RegionMap['raster'] {
  const N = RASTER_SIZE;
  const terrain = createTerrainQueryService(getRegion(regionId));
  // Only the drowned map edge is sea; the river valley floor (-14..-24 m) must stay land.
  const seaM = regionId === 'the_field' ? SEA_LEVEL_M - 6 : -Infinity;
  const cellM = (rect.maxX - rect.minX) / N;
  const elevation = new Float32Array(N * N), lake = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    // Pixel (i, j): east grows with i, north falls with j; world x = -east.
    const east = -rect.maxX + (i + 0.5) * cellM, north = rect.maxZ - (j + 0.5) * cellM;
    elevation[j * N + i] = terrain.getElevation(-east, north);
    lake[j * N + i] = terrain.getWaterDepth(-east, north);
  }
  // Non-Field regions have unrelated absolute heights: stretch them onto the same ramp.
  let shift = 0, gain = 1;
  if (regionId !== 'the_field') {
    const sorted = Float32Array.from(elevation).sort();
    const lo = sorted[Math.floor(N * N * 0.02)], hi = sorted[Math.floor(N * N * 0.98)];
    gain = 320 / Math.max(20, hi - lo); shift = lo;
  }
  const at = (i: number, j: number) => elevation[Math.min(N - 1, Math.max(0, j)) * N + Math.min(N - 1, Math.max(0, i))];
  const rgba = new Uint8ClampedArray(N * N * 4);
  const L = [-0.55, 0.55, 0.63];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i, e = elevation[k];
    let c: readonly number[];
    if (lake[k] > 0) c = mix(LAKE_SHALLOW, LAKE_DEEP, Math.min(1, lake[k] / 24));
    else if (e <= seaM) c = SEA;
    else {
      c = ramp((e - shift) * gain);
      // Slope from central differences (m/m); east = +i, north = -j.
      const sE = (at(i + 2, j) - at(i - 2, j)) / (4 * cellM), sN = (at(i, j - 2) - at(i, j + 2)) / (4 * cellM);
      const ex = 1.7, nl = Math.hypot(sE * ex, sN * ex, 1);
      const shade = (-sE * ex * L[0] - sN * ex * L[1] + L[2]) / nl;
      let f = Math.min(1.3, Math.max(0.62, 1.04 + (shade - 0.63) * 1.35));
      // Faint contour every 60 m where the band changes.
      const band = Math.floor(e / 60);
      if (Math.floor(at(i + 1, j) / 60) !== band || Math.floor(at(i, j + 1) / 60) !== band) f *= 0.95;
      c = [c[0] * f, c[1] * f, c[2] * f];
    }
    rgba[k * 4] = c[0]; rgba[k * 4 + 1] = c[1]; rgba[k * 4 + 2] = c[2]; rgba[k * 4 + 3] = 255;
  }
  return { size: N, rgba, elevation };
}
const mix = (a: readonly number[], b: readonly number[], t: number): number[] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// --- Vector layers ------------------------------------------------------------------------------

const anchorPoi = (key: keyof typeof WORLD_ANCHORS, name: string, kind: PoiKind, priority: MapPoi['priority']): MapPoi =>
  ({ id: `poi_${key}`, name, kind, x: WORLD_ANCHORS[key].x, z: WORLD_ANCHORS[key].z, priority });

function fieldLayers(): Pick<RegionMap, 'rivers' | 'roads' | 'bridges' | 'parcels' | 'pois' | 'labels'> {
  return {
    rivers: [FIELD_RIVER_POINTS.map((p): [number, number] => [p[0], p[1]])],
    roads: ROADS.map((r) => ({ id: r.id, surface: r.surface, widthM: r.widthM, priority: r.priority, pts: catmullRom(r.points, 60) })),
    bridges: ROADS.filter((r) => r.bridge).map((r) => ({ x: WORLD_ANCHORS[r.bridge!.anchor].x, z: WORLD_ANCHORS[r.bridge!.anchor].z })),
    parcels: FIELD_PARCELS.map((p) => ({ center: [p.center[0], p.center[1]], widthM: p.widthM, depthM: p.depthM, headingRad: p.headingRad, crop: p.crop })),
    pois: [
      anchorPoi('village', 'Aldea', 'settlement', 1),
      anchorPoi('lakeVillage', 'Pueblo del lago', 'settlement', 1),
      anchorPoi('northPass', 'Paso del norte', 'pass', 1),
      anchorPoi('industrialArea', 'Zona industrial', 'industry', 2),
      anchorPoi('bridge', 'Puente', 'bridge', 2),
      anchorPoi('farmClusterA', 'Granja del llano', 'farm', 3),
      anchorPoi('farmClusterB', 'Granja alta', 'farm', 3),
      anchorPoi('remoteFarm', 'Granja remota', 'farm', 3),
      anchorPoi('utilityTower', 'Torre de servicio', 'tower', 3),
      anchorPoi('easternWindmill', 'Molino', 'windmill', 3),
    ],
    labels: [
      { id: 'lbl_lake', name: 'Lago', x: FIELD_LAKE.x, z: FIELD_LAKE.z, kind: 'water' },
      { id: 'lbl_river', name: 'Río', x: 1990, z: -300, kind: 'water' },
      { id: 'lbl_range', name: 'Cordillera norte', x: 1800, z: ridgeZ(1800), kind: 'mountain' },
      { id: 'lbl_massif', name: 'Macizo', x: PASS_X + 2600, z: ridgeZ(PASS_X + 2600) + 300, kind: 'mountain' },
    ],
  };
}

function genericLayers(regionId: string): Pick<RegionMap, 'rivers' | 'roads' | 'bridges' | 'parcels' | 'pois' | 'labels'> {
  const nodes = new Map(getRegionRoadNodes(regionId).map((n) => [n.id, n.position]));
  const roads: MapRoad[] = [];
  for (const seg of getRegionRoadSegments(regionId)) {
    const a = nodes.get(seg.fromId), b = nodes.get(seg.toId);
    if (a && b) roads.push({ id: `${seg.fromId}>${seg.toId}`, surface: 'dirt', widthM: 5, priority: 2, pts: [[a[0], a[1]], [b[0], b[1]]] });
  }
  const pois = getRegionTowns(regionId).map((t): MapPoi => ({ id: `poi_${t.id}`, name: 'Pueblo', kind: 'settlement', x: t.position[0], z: t.position[1], priority: 2 }));
  return { rivers: [], roads, bridges: [], parcels: [], pois, labels: [] };
}

const cache = new Map<string, RegionMap>();

export function getRegionMap(regionId: string): RegionMap {
  let m = cache.get(regionId);
  if (!m) {
    const rect = getRegionRect(regionId);
    m = { regionId, rect, raster: buildRaster(regionId, rect), ...(regionId === 'the_field' ? fieldLayers() : genericLayers(regionId)) };
    cache.set(regionId, m);
  }
  return m;
}
