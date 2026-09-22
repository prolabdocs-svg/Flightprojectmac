// Route geometry + wind decomposition for a contract. World axes follow world/compass.ts
// (heading 0 = +Z, clockwise, so +X is to the LEFT of a north-facing aircraft).

import { getAirfield, type AirfieldDefinition } from '../world/airfields';
import { compassBearingDeg, headingToWorldDir as bearingToDir } from '../world/compass';
import { distanceM } from '../map/mapProjection';
import { regionTerrain } from '../map/mapPlan';
import type { MissionWeather } from './types';

export interface RouteContext {
  origin: AirfieldDefinition;
  destination: AirfieldDefinition;
  distanceM: number;
  bearingDeg: number;
  originElevM: number;
  destElevM: number;
}

export function routeContext(originId: string, destinationId: string): RouteContext {
  const origin = getAirfield(originId);
  const destination = getAirfield(destinationId);
  if (!origin || !destination) throw new Error(`unknown airfield in route ${originId} -> ${destinationId}`);
  const [ox, , oz] = origin.position;
  const [dx, , dz] = destination.position;
  const t = regionTerrain(origin.regionId);
  return {
    origin, destination,
    distanceM: distanceM(ox, oz, dx, dz),
    bearingDeg: compassBearingDeg(dx - ox, dz - oz),
    originElevM: t.getElevation(ox, oz),
    destElevM: regionTerrain(destination.regionId).getElevation(dx, dz),
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
