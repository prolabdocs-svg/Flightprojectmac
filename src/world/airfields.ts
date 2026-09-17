import type { Vec3 } from '../core/types';
import { REGIONS } from '../content/regions';

export type RunwaySurface = 'grass' | 'dirt' | 'gravel' | 'tarmac' | 'salt';

export type AirfieldService = 'fuel' | 'repair' | 'paint' | 'market' | 'storage';

export type AirfieldDiscoveryState = 'known' | 'hidden' | 'rumored';

/** A persistent, data-only airfield node in the world graph (GDD world-graph
 * foundation). Positions are world meters in the same local space each region's
 * missions/chunks already use — they do not need to be globally unique across
 * regions since each region streams its own local space. */
export interface AirfieldDefinition {
  id: string;
  name: string;
  /** Must match an id in src/content/regions.ts. */
  regionId: string;
  position: Vec3;
  runwayLengthM: number;
  runwayWidthM: number;
  surface: RunwaySurface;
  services: AirfieldService[];
  /** Whether the player has found this airfield yet. 'known' airfields are always
   * visible on the map (e.g. the home field); 'hidden' ones must be discovered by
   * flying nearby or completing a mission; 'rumored' ones are teased but not located. */
  discoveryState: AirfieldDiscoveryState;
}

export const AIRFIELDS: AirfieldDefinition[] = [
  {
    id: 'field_home',
    name: 'Taller de campo',
    regionId: 'the_field',
    position: [0, 0, 0],
    runwayLengthM: 220,
    runwayWidthM: 24,
    surface: 'grass',
    services: ['fuel', 'repair', 'paint', 'market', 'storage'],
    discoveryState: 'known',
  },
  {
    id: 'field_north_strip',
    name: 'Franja Norte',
    regionId: 'the_field',
    position: [0, 0, 620],
    runwayLengthM: 180,
    runwayWidthM: 20,
    surface: 'grass',
    services: ['fuel'],
    discoveryState: 'hidden',
  },
  {
    id: 'scrap_yard_strip',
    name: 'Pista del deshuesadero',
    regionId: 'scrap_valley',
    position: [0, 0, 160],
    runwayLengthM: 160,
    runwayWidthM: 18,
    surface: 'dirt',
    services: ['fuel', 'repair', 'market'],
    discoveryState: 'hidden',
  },
  {
    id: 'scrap_quarry_strip',
    name: 'Cantera Alta',
    regionId: 'scrap_valley',
    position: [0, 0, 680],
    runwayLengthM: 140,
    runwayWidthM: 16,
    surface: 'gravel',
    services: ['fuel'],
    discoveryState: 'hidden',
  },
  {
    id: 'red_canyon_mesa',
    name: 'Mesa Roja',
    regionId: 'red_canyon',
    position: [60, 0, 320],
    runwayLengthM: 200,
    runwayWidthM: 22,
    surface: 'dirt',
    services: ['fuel', 'repair'],
    discoveryState: 'hidden',
  },
  {
    id: 'backcountry_lake_strip',
    name: 'Orilla del Lago',
    regionId: 'backcountry',
    position: [35, 0, 260],
    runwayLengthM: 150,
    runwayWidthM: 16,
    surface: 'grass',
    services: ['fuel', 'repair'],
    discoveryState: 'known',
  },
  {
    id: 'coast_run_pier',
    name: 'Muelle de Coast Run',
    regionId: 'coast_run',
    position: [0, 0, 400],
    runwayLengthM: 190,
    runwayWidthM: 20,
    surface: 'tarmac',
    services: ['fuel', 'repair', 'market'],
    discoveryState: 'rumored',
  },
  {
    id: 'industrial_cargo_yard',
    name: 'Patio de Carga',
    regionId: 'industrial_belt',
    position: [70, 0, 420],
    runwayLengthM: 170,
    runwayWidthM: 18,
    surface: 'tarmac',
    services: ['fuel', 'repair', 'market'],
    discoveryState: 'known',
  },
  {
    id: 'desert_salt_strip',
    name: 'Pista de Sal',
    regionId: 'high_desert_test_range',
    position: [0, 0, 500],
    runwayLengthM: 500,
    runwayWidthM: 30,
    surface: 'salt',
    services: ['fuel', 'repair', 'storage'],
    discoveryState: 'known',
  },
  {
    id: 'range_summit_pad',
    name: 'Plataforma Cumbre',
    regionId: 'the_range',
    position: [90, 0, 540],
    runwayLengthM: 180,
    runwayWidthM: 16,
    surface: 'gravel',
    services: ['fuel', 'repair'],
    discoveryState: 'known',
  },
];

export function getAirfield(id: string): AirfieldDefinition | undefined {
  return AIRFIELDS.find((a) => a.id === id);
}

/** Airfields belonging to a single region. */
export function getRegionAirfields(regionId: string): AirfieldDefinition[] {
  return AIRFIELDS.filter((a) => a.regionId === regionId);
}

/** Starting point for sandbox flying. Prefer an airfield the player can already see;
 * older regions with only hidden strips still get a deterministic first strip rather
 * than silently falling back to the world's origin. */
export function getFreeFlightAirfield(regionId: string): AirfieldDefinition | undefined {
  const airfields = getRegionAirfields(regionId);
  return airfields.find((airfield) => airfield.discoveryState === 'known') ?? airfields[0];
}

/** Data-integrity guard: every airfield must reference a region that actually exists. */
export function airfieldsHaveValidRegions(): boolean {
  const regionIds = new Set(REGIONS.map((r) => r.id));
  return AIRFIELDS.every((a) => regionIds.has(a.regionId));
}
