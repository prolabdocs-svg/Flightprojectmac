import type { MissionDefinition } from '../core/types';
import { MISSIONS } from '../content/missions';
import { getRegion } from '../content/regions';
import { AIRFIELDS, getFreeFlightAirfield, getRegionAirfields, type AirfieldDefinition } from '../world/airfields';
import { RouteGraph } from '../world/routePlanner';
import { createTerrainQueryService, type TerrainQueryService } from '../world/terrainQuery';
import { distanceM } from './mapProjection';
import { getRegionMap, type MapPoi } from './mapGeography';
import { getMasterTerrain } from '../world/master/masterRuntime';

/** Flight-planning logic behind the map: origin, targets, range, route profile, contracts.
 * Pure (no DOM/canvas) so it is unit-tested without a browser. */

export type RangeStatus = 'comfortable' | 'marginal' | 'insufficient';

/** Fraction of the full-tank still-air range treated as usable (wind, climb, landing reserve). */
export const RANGE_RESERVE = 0.8;
/** Within this fraction of usable range a hop is "comfortable"; up to 1 it is "marginal". */
export const COMFORTABLE_FRACTION = 0.8;

export const usableRangeKm = (rangeKm: number): number => rangeKm * RANGE_RESERVE;

export function classifyRange(distanceKm: number, usableKm: number): RangeStatus {
  if (usableKm <= 0) return 'insufficient';
  const ratio = distanceKm / usableKm;
  return ratio <= COMFORTABLE_FRACTION ? 'comfortable' : ratio <= 1 ? 'marginal' : 'insufficient';
}

export const flightTimeS = (distanceM_: number, cruiseKmh: number): number => (cruiseKmh > 0 ? distanceM_ / (cruiseKmh / 3.6) : Infinity);

export function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`;
}
export function formatDuration(s: number): string {
  if (!Number.isFinite(s)) return '—';
  const t = Math.round(s);
  return t < 60 ? `${t} s` : `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')} min`;
}

// --- Targets ---------------------------------------------------------------------------------------

export interface MapTarget {
  id: string;
  kind: 'airfield' | 'poi';
  name: string;
  x: number;
  z: number;
  airfield?: AirfieldDefinition;
  poi?: MapPoi;
  /** Airfields hidden/rumored in the save stay '?' until a contract points at them. */
  revealed: boolean;
}

/** The airfield a contract is "about": explicit destination, else the field its target point
 * sits on, else where it departs from. Nothing here is invented — all from mission data. */
export function missionAirfieldId(m: MissionDefinition & { originAirfieldId?: string; destinationAirfieldId?: string }): string | undefined {
  if (m.destinationAirfieldId) return m.destinationAirfieldId;
  const fields = getRegionAirfields(m.regionId);
  const nearest = (p: readonly number[], maxM: number) =>
    fields.map((a) => ({ a, d: distanceM(p[0], p[2], a.position[0], a.position[2]) })).filter((f) => f.d <= maxM).sort((p1, p2) => p1.d - p2.d)[0]?.a.id;
  return (m.targetPoint && nearest(m.targetPoint, 250)) || m.originAirfieldId || nearest(m.spawnPoint, 400);
}

export function contractsForAirfield(regionId: string, airfieldId: string): MissionDefinition[] {
  return MISSIONS.filter((m) => m.regionId === regionId && missionAirfieldId(m) === airfieldId);
}

export function getMapTargets(regionId: string): MapTarget[] {
  const airfields = getRegionAirfields(regionId).map((a): MapTarget => ({
    id: a.id, kind: 'airfield', name: a.name, x: a.position[0], z: a.position[2], airfield: a,
    revealed: a.discoveryState === 'known' || contractsForAirfield(regionId, a.id).length > 0,
  }));
  const pois = getRegionMap(regionId).pois.map((p): MapTarget => ({ id: p.id, kind: 'poi', name: p.name, x: p.x, z: p.z, poi: p, revealed: true }));
  return [...airfields, ...pois];
}

/** Airfields translated onto the continuous master-world chart. The returned field keeps
 * its campaign-region id for the action that opens its local mission chart. */
export function getMasterMapTargets(): MapTarget[] {
  const definitions = new Map(AIRFIELDS.map((field) => [field.id, field]));
  return getMasterTerrain().airfields().flatMap((field): MapTarget[] => {
    const definition = definitions.get(field.id);
    if (!definition) return [];
    const worldDefinition: AirfieldDefinition = {
      ...definition,
      position: [field.worldPosition[0], field.elevationM, field.worldPosition[1]],
    };
    return [{
      id: field.id, kind: 'airfield', name: definition.name,
      x: field.worldPosition[0], z: field.worldPosition[1], airfield: worldDefinition,
      // Global chart knowledge is provided by Fog of Discovery in MapScreen. Contracts no longer
      // leak unvisited locations onto the world map.
      revealed: definition.discoveryState === 'known',
    }];
  });
}

/** Minimum-hop connected air-route overlay over the master chart. Prim's algorithm adds
 * one real airfield-to-airfield leg at a time until every authored field is connected. */
export function getMasterAirRoutes(): Array<{ fromId: string; toId: string; distanceM: number; difficulty: number }> {
  const fields = getMasterMapTargets().filter((target) => target.airfield);
  if (fields.length < 2) return [];
  const connected = new Set([fields[0].id]);
  const routes: ReturnType<typeof getMasterAirRoutes> = [];
  while (connected.size < fields.length) {
    let best: { fromId: string; toId: string; distanceM: number } | null = null;
    for (const fromId of connected) {
      const from = fields.find((field) => field.id === fromId)!;
      for (const to of fields) {
        if (connected.has(to.id)) continue;
        const distance = distanceM(from.x, from.z, to.x, to.z);
        if (!best || distance < best.distanceM) best = { fromId, toId: to.id, distanceM: distance };
      }
    }
    if (!best) break;
    connected.add(best.toId);
    routes.push({ ...best, difficulty: best.distanceM / 1000 });
  }
  return routes;
}

/** Where the player currently is: the region's free-flight airfield (the home strip). */
export const getOrigin = (regionId: string): AirfieldDefinition | undefined => getFreeFlightAirfield(regionId);

/** Direct airfield-to-airfield links (the old "RUTAS AÉREAS" list), for drawing on the map. */
export function getRegionAirRoutes(regionId: string): Array<{ fromId: string; toId: string; distanceM: number; difficulty: number }> {
  const ids = new Set(getRegionAirfields(regionId).map((a) => a.id));
  const graph = new RouteGraph();
  const seen = new Set<string>();
  const out: ReturnType<typeof getRegionAirRoutes> = [];
  for (const id of ids) for (const e of graph.neighbors(id)) {
    const key = [e.fromId, e.toId].sort().join('|');
    if (ids.has(e.toId) && !seen.has(key)) { seen.add(key); out.push(e); }
  }
  return out;
}

// --- Route profile ---------------------------------------------------------------------------------

export interface RouteProfile {
  distM: number[];
  elevM: number[];
  wet: boolean[];
  minM: number;
  maxM: number;
  climbM: number;
  totalM: number;
}

export function sampleRouteProfile(terrain: TerrainQueryService, from: readonly [number, number], to: readonly [number, number], samples = 56): RouteProfile {
  const totalM = distanceM(from[0], from[1], to[0], to[1]);
  const distM: number[] = [], elevM: number[] = [], wet: boolean[] = [];
  let climbM = 0;
  for (let i = 0; i < samples; i++) {
    const t = i / (samples - 1), x = from[0] + (to[0] - from[0]) * t, z = from[1] + (to[1] - from[1]) * t;
    const e = terrain.getElevation(x, z);
    if (i > 0) climbM += Math.max(0, e - elevM[i - 1]);
    distM.push(totalM * t); elevM.push(e); wet.push(terrain.getWaterDepth(x, z) > 0);
  }
  return { distM, elevM, wet, minM: Math.min(...elevM), maxM: Math.max(...elevM), climbM, totalM };
}

const terrainCache = new Map<string, TerrainQueryService>();
export function regionTerrain(regionId: string): TerrainQueryService {
  let t = terrainCache.get(regionId);
  if (!t) terrainCache.set(regionId, (t = createTerrainQueryService(getRegion(regionId))));
  return t;
}

/** Short player-facing tags derived from the real geography under the route and the destination. */
export function routeTags(profile: RouteProfile, dest: MapTarget, terrain: TerrainQueryService): string[] {
  const tags: string[] = [];
  const relief = profile.maxM - profile.minM;
  if (profile.maxM - Math.max(profile.elevM[0], profile.elevM[profile.elevM.length - 1]) > 150 || profile.climbM > 220) tags.push('RUTA DE MONTAÑA');
  else if (relief < 40) tags.push('LLANURA');
  else tags.push('COLINAS');
  if (profile.wet.some(Boolean)) tags.push('SOBRE EL LAGO');
  else if ([[400, 0], [-400, 0], [0, 400], [0, -400]].some(([dx, dz]) => terrain.getWaterDepth(dest.x + dx, dest.z + dz) > 0)) tags.push('LAGO CERCA');
  if (dest.poi?.kind === 'pass') tags.unshift('PASO DE MONTAÑA');
  if (dest.airfield) {
    const a = dest.airfield;
    if (a.runwayLengthM < 200) tags.push('PISTA CORTA');
    tags.push(({ grass: 'CÉSPED', dirt: 'TIERRA', gravel: 'GRAVA', tarmac: 'ASFALTO', salt: 'SAL' } as const)[a.surface]);
  }
  return tags;
}

export const SURFACE_LABEL = { grass: 'césped', dirt: 'tierra', gravel: 'grava', tarmac: 'asfalto', salt: 'sal' } as const;
