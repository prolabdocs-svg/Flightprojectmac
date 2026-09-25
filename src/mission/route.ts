// Route geometry + wind decomposition for a contract. World axes follow world/compass.ts
// (heading 0 = +Z, clockwise, so +X is to the LEFT of a north-facing aircraft).

import { getAirfield, type AirfieldDefinition } from '../world/airfields';
import { compassBearingDeg, headingToWorldDir as bearingToDir } from '../world/compass';
import { distanceM } from '../map/mapProjection';
import { regionTerrain } from '../map/mapPlan';
import { campaignLocalToMaster, masterToCampaignLocal } from '../world/master/masterGeography';
import type { MissionWeather } from './types';
import { buildFlightPlan, type FlightPlan } from '../nav/flightPlan';

export interface RouteContext {
  origin: AirfieldDefinition;
  destination: AirfieldDefinition;
  distanceM: number;
  bearingDeg: number;
  originElevM: number;
  destElevM: number;
  /** Destination in the origin campaign frame, which the flight scene streams continuously. */
  destinationPoint: readonly [number, number, number];
}

export function routeContext(originId: string, destinationId: string): RouteContext {
  const origin = getAirfield(originId);
  const destination = getAirfield(destinationId);
  if (!origin || !destination) throw new Error(`unknown airfield in route ${originId} -> ${destinationId}`);
  const [ox, oz] = campaignLocalToMaster(origin.regionId, origin.position[0], origin.position[2]);
  const [dx, dz] = campaignLocalToMaster(destination.regionId, destination.position[0], destination.position[2]);
  const [destLocalX, destLocalZ] = masterToCampaignLocal(origin.regionId, dx, dz);
  const originTerrain = regionTerrain(origin.regionId);
  const destinationTerrain = regionTerrain(destination.regionId);
  const originElevationLocal = originTerrain.getElevation(origin.position[0], origin.position[2]);
  const destElevationLocal = destinationTerrain.getElevation(destination.position[0], destination.position[2]);
  return {
    origin, destination,
    distanceM: distanceM(ox, oz, dx, dz),
    bearingDeg: compassBearingDeg(dx - ox, dz - oz),
    originElevM: originElevationLocal,
    destElevM: destElevationLocal,
    // Origin-frame terrain sampling supplies the real remote runway elevation. Keep target y
    // neutral: destination and origin use distinct vertical datums in the master world.
    destinationPoint: [destLocalX, 0, destLocalZ] as const,
  };
}

export interface WindComponents {
  /** Along the route, + = headwind (cruise ground speed). */
  cruiseHeadwindMs: number;
  /** Runways are used into the wind: |component along the route|. */
  runwayHeadwindMs: number;
  crosswindMs: number;
  gustMs: number;
}

export function windComponents(weather: MissionWeather, bearingDeg: number): WindComponents {
  const f = bearingToDir(bearingDeg);
  const [wx, , wz] = weather.windMs;
  const along = wx * f.x + wz * f.z;
  const across = wx * f.z - wz * f.x;
  return { cruiseHeadwindMs: -along, runwayHeadwindMs: Math.abs(along), crosswindMs: Math.abs(across), gustMs: weather.gustMs };
}

/** A contract's route as a FlightPlan (the same model free flight and the HUD use), in the origin
 * frame the flight streams. `knownIds` = the player's discovered airfields (Fog of Discovery). */
export function routeFlightPlan(route: RouteContext, knownIds: readonly string[]): FlightPlan {
  const terrain = regionTerrain(route.origin.regionId);
  const [dx, , dz] = route.destinationPoint;
  return buildFlightPlan(
    { id: route.origin.id, label: route.origin.name, known: true, x: route.origin.position[0], z: route.origin.position[2] },
    { id: route.destination.id, label: route.destination.name, known: knownIds.includes(route.destination.id), x: dx, z: dz },
    { elevationAt: (x, z) => terrain.getElevation(x, z), runway: {
      id: route.destination.id, label: route.destination.name,
      x: route.destinationPoint[0], z: route.destinationPoint[2], elevationM: route.destElevM,
      lengthM: route.destination.runwayLengthM, widthM: route.destination.runwayWidthM,
      headingDeg: 0,
    } },
  );
}
