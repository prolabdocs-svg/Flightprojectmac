import type { Vec3 } from '../core/types';
import type { TerrainQueryService } from './terrainQuery';
import { getRegionFarmParcels, getRegionTowns } from './landUse';

/**
 * WLD-07 navigation landmarks (spec §253, §89, §120, §242). Scope: causality only supports
 * landmarks the world already places — the_field's farm gives a plausible water tank, and
 * backcountry's lake (waterBodies.ts: center [300, 75]) and both regions' towns (landUse.ts)
 * are the only distinctive, already-built features either region's flavor text promises
 * (spec §2.1 causality). No quarry/reservoir/ridge here: neither MVP region has terrain that
 * causally supports one yet.
 */

export type LandmarkType = 'natural' | 'built';
export type LandmarkDiscoveryState = 'known' | 'hidden' | 'rumored';

export interface LandmarkDefinition {
  id: string;
  regionId: string;
  type: LandmarkType;
  worldPosition: Vec3;
  recognitionRadiusM: number;
  silhouetteScore: number;
  contrastScore: number;
  uniquenessScore: number;
  navigationPriority: number;
  discoveryState: LandmarkDiscoveryState;
}

// Water tank sits at the west farm parcel (landUse.ts) — a farm plausibly has one.
const LANDMARKS: LandmarkDefinition[] = [
  {
    id: 'the_field_water_tank',
    regionId: 'the_field',
    type: 'built',
    worldPosition: [-90, 8, 150],
    recognitionRadiusM: 220,
    silhouetteScore: 0.6,
    contrastScore: 0.7,
    uniquenessScore: 0.5,
    navigationPriority: 0.6,
    discoveryState: 'known',
  },
  {
    id: 'the_field_town',
    regionId: 'the_field',
    type: 'built',
    worldPosition: [-140, 0, 260],
    recognitionRadiusM: 300,
    silhouetteScore: 0.5,
    contrastScore: 0.6,
    uniquenessScore: 0.7,
    navigationPriority: 0.8,
    discoveryState: 'hidden',
  },
  {
    id: 'backcountry_lake',
    regionId: 'backcountry',
    type: 'natural',
    worldPosition: [300, 0, 75],
    recognitionRadiusM: 400,
    silhouetteScore: 0.4,
    contrastScore: 0.8,
    uniquenessScore: 0.6,
    navigationPriority: 0.7,
    discoveryState: 'known',
  },
  {
    id: 'backcountry_town',
    regionId: 'backcountry',
    type: 'built',
    worldPosition: [445, 0, -25],
    recognitionRadiusM: 300,
    silhouetteScore: 0.5,
    contrastScore: 0.6,
    uniquenessScore: 0.7,
    navigationPriority: 0.8,
    discoveryState: 'hidden',
  },
];

export function getLandmark(id: string): LandmarkDefinition | undefined {
  return LANDMARKS.find((l) => l.id === id);
}

export function getRegionLandmarks(regionId: string): LandmarkDefinition[] {
  return LANDMARKS.filter((l) => l.regionId === regionId);
}

const LOS_STEP_M = 20;

/** True if the straight line from the observer to the landmark stays above the ground
 * profile between them (spec §120: line of sight). Samples elevation in fixed steps, same
 * approach as landUse.ts's road/water-crossing walk — fine at this scale, no BVH needed. */
function hasLineOfSight(
  terrain: TerrainQueryService,
  observer: { x: number; z: number; elevationM: number },
  landmark: LandmarkDefinition,
): boolean {
  const [lx, ly, lz] = landmark.worldPosition;
  const dx = lx - observer.x;
  const dz = lz - observer.z;
  const distanceM = Math.hypot(dx, dz);
  const steps = Math.max(1, Math.ceil(distanceM / LOS_STEP_M));

  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const groundM = terrain.getElevation(observer.x + dx * t, observer.z + dz * t);
    const sightlineM = observer.elevationM + (ly - observer.elevationM) * t;
    if (groundM > sightlineM) return false;
  }
  return true;
}

/** Spec §120 recognition rule: within recognition radius, and not blocked by terrain
 * between observer and landmark. */
export function isLandmarkRecognized(
  landmark: LandmarkDefinition,
  terrain: TerrainQueryService,
  observer: { x: number; z: number; elevationM: number },
): boolean {
  const [lx, , lz] = landmark.worldPosition;
  const distanceM = Math.hypot(lx - observer.x, lz - observer.z);
  return distanceM <= landmark.recognitionRadiusM && hasLineOfSight(terrain, observer, landmark);
}

/** Spec §120: a recognized landmark becomes discovered and stays that way. Session-only
 * discovery state, kept out of the static registry (same split as AirfieldDiscoveryState
 * vs. runtime unlocks) — callers own persistence. */
export function discoverLandmarks(
  regionId: string,
  terrain: TerrainQueryService,
  observer: { x: number; z: number; elevationM: number },
  alreadyDiscovered: ReadonlySet<string>,
): Set<string> {
  const discovered = new Set(alreadyDiscovered);
  for (const landmark of getRegionLandmarks(regionId)) {
    if (isLandmarkRecognized(landmark, terrain, observer)) discovered.add(landmark.id);
  }
  return discovered;
}

/** Spec §120: "a discovered landmark becomes available on map" — 'known' landmarks are
 * always on the map, everything else needs to have been discovered first. */
export function getMapLandmarks(regionId: string, discovered: ReadonlySet<string>): LandmarkDefinition[] {
  return getRegionLandmarks(regionId).filter((l) => l.discoveryState === 'known' || discovered.has(l.id));
}

/** Data-integrity guard: every landmark must reference a real farm parcel or town it's
 * modeling, not a floating id (spec §2.1 causality) — mirrors landUse.ts's own scope note. */
export function landmarksHaveCausalAnchor(): boolean {
  return LANDMARKS.every((l) => {
    if (l.id.endsWith('_water_tank')) {
      return getRegionFarmParcels(l.regionId).length > 0;
    }
    if (l.id.endsWith('_town')) {
      return getRegionTowns(l.regionId).some((t) => t.id === l.id);
    }
    return true; // natural landmarks (e.g. the lake) are checked against their own registry elsewhere
  });
}
