/** Pure, per-region road-network data: which points an access road connects (airfield
 * → hero landmark → a branch/second connection), and what a region's road should look
 * like (biome-appropriate color/width). No Three.js here so the topology and safe-zone
 * avoidance are unit-testable without a WebGL context; FlightScene.ts turns the
 * waypoint links into InstancedMesh road tiles via fieldAirfieldLayout#layoutRoadTiles. */
import type { RegionDefinition } from '../core/types';
import { getFreeFlightAirfield } from '../world/airfields';
import { getRegion } from '../content/regions';
import { ACTIVE_REGION_ASSETS } from './assetManifest';
import { getRunwaySafeZone, routeAroundSafeZone, type AxisAlignedZone } from './fieldAirfieldLayout';

export interface RoadStyle {
  colorHex: string;
  widthM: number;
  tileLengthM: number;
}

/** Material/width per biome (spec: asfalto industrial/costa, tierra/desierto, grava
 * cantera/range, rutas rurales field/forest). */
const BIOME_ROAD_STYLES: Record<RegionDefinition['environment']['terrain'], RoadStyle> = {
  meadow: { colorHex: '#7c6f57', widthM: 8, tileLengthM: 12 },
  quarry: { colorHex: '#7a7468', widthM: 7, tileLengthM: 11 },
  canyon: { colorHex: '#9c6b4a', widthM: 7, tileLengthM: 11 },
  forest: { colorHex: '#6b5a3f', widthM: 6, tileLengthM: 10 },
  coast: { colorHex: '#54585c', widthM: 8, tileLengthM: 12 },
  industrial: { colorHex: '#3f4247', widthM: 9, tileLengthM: 12 },
  desert: { colorHex: '#b79868', widthM: 7, tileLengthM: 11 },
  range: { colorHex: '#847d70', widthM: 7, tileLengthM: 11 },
};

/** Which streamed ACTIVE_REGION_ASSETS anchor is the road's primary destination (the
 * region's hero settlement/outpost) and which is the branch/second connection. */
const REGION_ROAD_TARGETS: Record<string, { primaryId: string; secondaryId: string }> = {
  the_field: { primaryId: 'field_village_cluster', secondaryId: 'field_hangar_hero' },
  scrap_valley: { primaryId: 'pf_scrap_valley_yard', secondaryId: 'checkpoint_beacon' },
  red_canyon: { primaryId: 'pf_red_canyon_outpost', secondaryId: 'checkpoint_beacon' },
  backcountry: { primaryId: 'pf_backcountry_lakeside', secondaryId: 'emergency_strip_marker' },
  coast_run: { primaryId: 'pf_coast_run_port_town', secondaryId: 'coastal_palm' },
  industrial_belt: { primaryId: 'pf_industrial_belt_district', secondaryId: 'road_bridge_small' },
  high_desert_test_range: { primaryId: 'pf_high_desert_station', secondaryId: 'emergency_strip_marker' },
  the_range: { primaryId: 'pf_range_mountain_refuge', secondaryId: 'checkpoint_beacon' },
};

export interface RegionRoadNetwork {
  regionId: string;
  style: RoadStyle;
  /** Each link is a waypoint polyline in world x/z; consumers tile it into road segments. */
  links: Array<Array<[number, number]>>;
}

/** A point just outside the runway safe zone, on the side facing `target` — the road's
 * true starting point. The airfield's own position sits at the zone's center, so routing
 * straight from there would start the road inside the very zone it must avoid. */
function safeZoneEdgeTowards(center: readonly [number, number], target: readonly [number, number], zone: AxisAlignedZone): [number, number] {
  const dx = target[0] - center[0], dz = target[1] - center[1];
  if (Math.abs(dx) >= Math.abs(dz)) {
    return [dx >= 0 ? zone.maxX + 4 : zone.minX - 4, center[1]];
  }
  return [center[0], dz >= 0 ? zone.maxZ + 4 : zone.minZ - 4];
}

/** Builds the access-road topology for one region: airfield edge → hero landmark, then a
 * branch from the hero landmark to a second anchor. Returns null if the region has no
 * known airfield or its authored road targets aren't in ACTIVE_REGION_ASSETS. */
export function getRegionRoadNetwork(regionId: string): RegionRoadNetwork | null {
  const region = getRegion(regionId);
  const airfield = getFreeFlightAirfield(regionId);
  const targets = REGION_ROAD_TARGETS[regionId];
  const assets = ACTIVE_REGION_ASSETS[regionId];
  if (!airfield || !targets || !assets) return null;
  const primary = assets.find((a) => a.id === targets.primaryId);
  const secondary = assets.find((a) => a.id === targets.secondaryId);
  if (!primary || !secondary) return null;

  const safeZone = getRunwaySafeZone(airfield);
  const airfieldXZ: [number, number] = [airfield.position[0], airfield.position[2]];
  const primaryPos = primary.position as [number, number];
  const secondaryPos = secondary.position as [number, number];
  const edge = safeZoneEdgeTowards(airfieldXZ, primaryPos, safeZone);

  return {
    regionId,
    style: BIOME_ROAD_STYLES[region.environment.terrain],
    links: [
      routeAroundSafeZone(edge, primaryPos, safeZone),
      routeAroundSafeZone(primaryPos, secondaryPos, safeZone),
    ],
  };
}
