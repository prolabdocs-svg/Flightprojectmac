import { HALF_M } from './master/masterGeography';
import { getMasterTerrain } from './master/masterRuntime';
import { REGIONS } from '../content/regions';

/**
 * Fog of Discovery. The master world (±24 km) is a 96×96 bitset of 500 m cells, 1152 bytes, stored
 * base64 in the save. Flying reveals a disc around the aircraft whose radius grows with height
 * above ground; airfields go UNKNOWN → SIGHTED (inside sight radius) → DISCOVERED (close + low) →
 * VISITED (landed). Discovered airfields join `knownAirfieldIds`, which is what the contract
 * generator already offers destinations from — exploration feeds missions/economy directly.
 * All coordinates are master-WORLD metres (+Z north, east = -X).
 */

export const FOG_CELL_M = 500;
export const FOG_N = (2 * HALF_M) / FOG_CELL_M;
const BYTES = Math.ceil((FOG_N * FOG_N) / 8);
/** Close enough (and low enough) to read the windsock: the field becomes DISCOVERED. */
export const DISCOVER_RADIUS_M = 1500;
export const DISCOVER_MAX_AGL_M = 700;
/** Landed within this of the field centre counts as VISITED. */
export const VISIT_RADIUS_M = 400;
/** Around every known airfield the chart is already drawn (you were told where it is). */
export const KNOWN_AIRFIELD_CHART_M = 2500;

export type AirfieldKnowledge = 'UNKNOWN' | 'SIGHTED' | 'DISCOVERED' | 'VISITED';

export interface ExplorationState {
  /** base64 bitset, FOG_N² cells, row = z index. */
  fog: string;
  sightedAirfieldIds: string[];
  landmarkIds: string[];
  /** Regions whose name/info the player has identified by flying over them. */
  regionIds: string[];
}

export const createExploration = (): ExplorationState => ({ fog: '', sightedAirfieldIds: [], landmarkIds: [], regionIds: ['the_field'] });

export function decodeFog(fog: string): Uint8Array {
  const out = new Uint8Array(BYTES);
  if (!fog) return out;
  const bin = atob(fog);
  for (let i = 0; i < Math.min(BYTES, bin.length); i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function encodeFog(bits: Uint8Array): string {
  let s = '';
  for (const b of bits) s += String.fromCharCode(b);
  return btoa(s);
}

const cellOf = (x: number, z: number): [number, number] => [Math.floor((x + HALF_M) / FOG_CELL_M), Math.floor((z + HALF_M) / FOG_CELL_M)];
const getBit = (bits: Uint8Array, i: number, j: number): boolean => i >= 0 && j >= 0 && i < FOG_N && j < FOG_N && ((bits[(j * FOG_N + i) >> 3] >> ((j * FOG_N + i) & 7)) & 1) === 1;

export const isCellRevealed = getBit;
export function isRevealed(bits: Uint8Array, x: number, z: number): boolean { return getBit(bits, ...cellOf(x, z)); }

/** Sets every cell whose centre is within r of (x,z). Returns how many were newly revealed. */
export function revealDisc(bits: Uint8Array, x: number, z: number, r: number): number {
  const [i0, j0] = cellOf(x - r, z - r), [i1, j1] = cellOf(x + r, z + r);
  let n = 0;
  for (let j = Math.max(0, j0); j <= Math.min(FOG_N - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(FOG_N - 1, i1); i++) {
    const cx = -HALF_M + (i + 0.5) * FOG_CELL_M, cz = -HALF_M + (j + 0.5) * FOG_CELL_M;
    if (Math.hypot(cx - x, cz - z) > r) continue;
    const k = j * FOG_N + i;
    if (!((bits[k >> 3] >> (k & 7)) & 1)) { bits[k >> 3] |= 1 << (k & 7); n++; }
  }
  return n;
}

/** Visual range from the cockpit: 1.2 km on the ground, ~4 km at 470 m AGL and above. */
export const sightRadiusM = (aglM: number): number => Math.min(4000, 1200 + Math.max(0, aglM) * 6);

export interface Site { id: string; x: number; z: number }
export interface WorldSites { airfields: Site[]; landmarks: Site[]; regions: Site[] }

let sitesCache: WorldSites | null = null;
/** Everything discoverable, in world metres, from the master authority (lazy: it builds the master map). */
export function worldSites(): WorldSites {
  if (sitesCache) return sitesCache;
  const w = getMasterTerrain();
  return (sitesCache = {
    airfields: w.airfields().map((a) => ({ id: a.id, x: a.worldPosition[0], z: a.worldPosition[1] })),
    landmarks: w.landmarks().map((l) => ({ id: l.id, x: l.worldPosition[0], z: l.worldPosition[1] })),
    regions: REGIONS.filter((r) => w.hasFrame(r.id)).map((r) => { const [x, z] = w.localToWorld(r.id, 0, 0); return { id: r.id, x, z }; }),
  });
}

export type ExplorationEvent = { kind: 'airfield_sighted' | 'airfield_discovered' | 'airfield_visited' | 'landmark' | 'region'; id: string };

export interface ExploreInput { x: number; z: number; aglM: number; onGround: boolean }
export interface KnownSets { knownAirfieldIds: string[]; visitedAirfieldIds: string[] }

/** One observation of the aircraft's real position. Pure: returns new state (same objects when nothing changed). */
export function explore(state: ExplorationState, known: KnownSets, p: ExploreInput, sites: WorldSites = worldSites()) {
  const bits = decodeFog(state.fog);
  const sight = sightRadiusM(p.onGround ? 0 : p.aglM);
  const newCells = revealDisc(bits, p.x, p.z, sight);
  const events: ExplorationEvent[] = [];
  const sighted = new Set(state.sightedAirfieldIds), knownIds = new Set(known.knownAirfieldIds), visited = new Set(known.visitedAirfieldIds);
  for (const a of sites.airfields) {
    const d = Math.hypot(a.x - p.x, a.z - p.z);
    if (d <= sight && !sighted.has(a.id) && !knownIds.has(a.id)) { sighted.add(a.id); events.push({ kind: 'airfield_sighted', id: a.id }); }
    if (d <= DISCOVER_RADIUS_M && (p.onGround || p.aglM <= DISCOVER_MAX_AGL_M) && !knownIds.has(a.id)) { knownIds.add(a.id); events.push({ kind: 'airfield_discovered', id: a.id }); }
    if (p.onGround && d <= VISIT_RADIUS_M && !visited.has(a.id)) { visited.add(a.id); knownIds.add(a.id); events.push({ kind: 'airfield_visited', id: a.id }); }
  }
  const landmarkIds = [...state.landmarkIds], regionIds = [...state.regionIds];
  for (const l of sites.landmarks) if (!landmarkIds.includes(l.id) && isRevealed(bits, l.x, l.z)) { landmarkIds.push(l.id); events.push({ kind: 'landmark', id: l.id }); }
  for (const r of sites.regions) if (!regionIds.includes(r.id) && isRevealed(bits, r.x, r.z)) { regionIds.push(r.id); events.push({ kind: 'region', id: r.id }); }
  if (!newCells && !events.length) return { state, known, events, newCells };
  return {
    state: { fog: newCells ? encodeFog(bits) : state.fog, sightedAirfieldIds: [...sighted], landmarkIds, regionIds },
    known: { knownAirfieldIds: [...knownIds], visitedAirfieldIds: [...visited] },
    events, newCells,
  };
}

export function airfieldKnowledge(id: string, state: ExplorationState, known: KnownSets): AirfieldKnowledge {
  if (known.visitedAirfieldIds.includes(id)) return 'VISITED';
  if (known.knownAirfieldIds.includes(id)) return 'DISCOVERED';
  return state.sightedAirfieldIds.includes(id) ? 'SIGHTED' : 'UNKNOWN';
}

/** Fog as the map sees it: flown cells plus the charted surroundings of every known airfield. */
export function chartedFog(state: ExplorationState, known: KnownSets, sites: WorldSites = worldSites()): Uint8Array {
  const bits = decodeFog(state.fog);
  for (const a of sites.airfields) if (known.knownAirfieldIds.includes(a.id)) revealDisc(bits, a.x, a.z, KNOWN_AIRFIELD_CHART_M);
  return bits;
}

/** What each find pays: new destinations, reputation and R&D (which unlocks new aircraft). */
export const DISCOVERY_REWARD = {
  airfield_discovered: { cash: 25, reputation: 1, researchPoints: 1 },
  landmark: { cash: 0, reputation: 0.5, researchPoints: 0 },
  region: { cash: 0, reputation: 1, researchPoints: 2 },
} as const;

/** Folds one observation into the profile (fog, knowledge, rewards, log). Same reference when nothing changed. */
export function applyExploration(profile: import('../core/types').PlayerProfile, p: ExploreInput, sites?: WorldSites) {
  const ops = profile.operations;
  const r = explore(ops.exploration, ops, p, sites);
  if (r.state === ops.exploration) return { profile, events: r.events };
  let { cash, reputation, researchPoints } = profile;
  let log = ops.log;
  for (const e of r.events) {
    const reward = DISCOVERY_REWARD[e.kind as keyof typeof DISCOVERY_REWARD];
    if (reward) { cash += reward.cash; reputation += reward.reputation; researchPoints += reward.researchPoints; }
    if (e.kind === 'airfield_discovered') log = [...log, { kind: 'destination_discovered' as const, note: e.id }].slice(-200);
  }
  return {
    profile: { ...profile, cash, reputation, researchPoints, operations: { ...ops, ...r.known, exploration: r.state, log } },
    events: r.events,
  };
}
