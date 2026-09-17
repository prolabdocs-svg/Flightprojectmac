import type { TerrainQueryService } from './terrainQuery';

/**
 * WLD-06 human land use (spec §252, §228 QA). Scope: causality only supports "the_field"
 * and "backcountry" getting settlement — the_field's own description is "Granja y taller
 * rural" (farm and rural workshop), and backcountry's lake strip ("pistas cortas entre
 * montañas") gives a road a reason to cross water, exercising the bridge QA item; no other
 * region's flavor text promises human land use yet (spec §2.1 causality). Roads are
 * straight node-to-node segments, not a full graph solver — the simplest shape that
 * satisfies §228 QA (town connected to road, plausible farm slope, bridge at crossing)
 * without a pathfinding layer nothing here needs (spec §266 non-goals).
 */

export interface RoadNode {
  id: string;
  regionId: string;
  position: [number, number]; // world x/z
}

export interface RoadSegment {
  regionId: string;
  fromId: string;
  toId: string;
}

export interface FarmParcel {
  id: string;
  regionId: string;
  center: [number, number];
  radiusM: number;
}

export interface Town {
  id: string;
  regionId: string;
  position: [number, number];
  radiusM: number;
}

// Nodes double as the road's endpoints and, for 'the_field_home'/'the_field_north', sit at
// the matching airfield's position (spec §228 QA: airport access possible visually).
const ROAD_NODES: RoadNode[] = [
  { id: 'the_field_home', regionId: 'the_field', position: [0, 0] },
  { id: 'the_field_town', regionId: 'the_field', position: [-140, 260] },
  { id: 'the_field_north', regionId: 'the_field', position: [0, 620] },
  { id: 'backcountry_lake_strip', regionId: 'backcountry', position: [35, 260] },
  // Straight line from the airfield through the lake's center (world spec §228 QA: bridge
  // at crossing) — picked to intersect backcountry's lake footprint (waterBodies.ts:
  // center [300, 75], radius 90m), not just placed nearby.
  { id: 'backcountry_town', regionId: 'backcountry', position: [445, -25] },
];

const ROAD_SEGMENTS: RoadSegment[] = [
  { regionId: 'the_field', fromId: 'the_field_home', toId: 'the_field_town' },
  { regionId: 'the_field', fromId: 'the_field_town', toId: 'the_field_north' },
  { regionId: 'backcountry', fromId: 'backcountry_lake_strip', toId: 'backcountry_town' },
];

// Centers picked on gently-sloped ground near the road (spec §228 QA: farm parcel plausible
// slope) — verified in landUse.test.ts against the real terrain query, not just eyeballed.
const FARM_PARCELS: FarmParcel[] = [
  { id: 'the_field_farm_west', regionId: 'the_field', center: [-90, 150], radiusM: 55 },
  { id: 'the_field_farm_east', regionId: 'the_field', center: [80, 380], radiusM: 60 },
  { id: 'backcountry_farm', regionId: 'backcountry', center: [150, 150], radiusM: 45 },
];

const TOWNS: Town[] = [
  { id: 'the_field_town', regionId: 'the_field', position: [-140, 260], radiusM: 70 },
  { id: 'backcountry_town', regionId: 'backcountry', position: [445, -25], radiusM: 60 },
];

export function getRegionRoadNodes(regionId: string): RoadNode[] {
  return ROAD_NODES.filter((n) => n.regionId === regionId);
}
export function getRegionRoadSegments(regionId: string): RoadSegment[] {
  return ROAD_SEGMENTS.filter((s) => s.regionId === regionId);
}
export function getRegionFarmParcels(regionId: string): FarmParcel[] {
  return FARM_PARCELS.filter((p) => p.regionId === regionId);
}
export function getRegionTowns(regionId: string): Town[] {
  return TOWNS.filter((t) => t.regionId === regionId);
}

const ROAD_HALF_WIDTH_M = 4;

function distanceToSegment(px: number, pz: number, [ax, az]: [number, number], [bx, bz]: [number, number]): number {
  const dx = bx - ax;
  const dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lenSq));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

/** True within a road segment's paved width at this point — spec §227 QA: no tree on road
 * center. Straight-line distance to each segment; a handful of segments per region, no
 * spatial index needed (same scale reasoning as waterBodies.ts). */
export function isOnRoad(regionId: string, x: number, z: number): boolean {
  const nodes = getRegionRoadNodes(regionId);
  return getRegionRoadSegments(regionId).some((seg) => {
    const from = nodes.find((n) => n.id === seg.fromId);
    const to = nodes.find((n) => n.id === seg.toId);
    return from && to && distanceToSegment(x, z, from.position, to.position) <= ROAD_HALF_WIDTH_M;
  });
}

export interface Bridge {
  segment: RoadSegment;
  position: [number, number]; // midpoint of the water crossing
}

const CROSSING_STEP_M = 5;

/** Finds where each road segment crosses water, from the real terrain query rather than
 * hardcoded circle geometry — this stays correct for any water body shape (spec §228 QA:
 * bridge at crossing). Walks the segment in short steps and reports the midpoint of any
 * stretch that sits over water; fine at this scale (a handful of segments per region). */
export function getRoadWaterCrossings(regionId: string, terrain: TerrainQueryService): Bridge[] {
  const nodes = getRegionRoadNodes(regionId);
  const bridges: Bridge[] = [];

  for (const seg of getRegionRoadSegments(regionId)) {
    const from = nodes.find((n) => n.id === seg.fromId);
    const to = nodes.find((n) => n.id === seg.toId);
    if (!from || !to) continue;

    const lengthM = Math.hypot(to.position[0] - from.position[0], to.position[1] - from.position[1]);
    const steps = Math.max(1, Math.ceil(lengthM / CROSSING_STEP_M));
    let wetStartT: number | undefined;

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = from.position[0] + (to.position[0] - from.position[0]) * t;
      const z = from.position[1] + (to.position[1] - from.position[1]) * t;
      const isWet = terrain.getWaterDepth(x, z) > 0;

      if (isWet && wetStartT === undefined) wetStartT = t;
      if ((!isWet || i === steps) && wetStartT !== undefined) {
        const midT = (wetStartT + t) / 2;
        bridges.push({
          segment: seg,
          position: [
            from.position[0] + (to.position[0] - from.position[0]) * midT,
            from.position[1] + (to.position[1] - from.position[1]) * midT,
          ],
        });
        wetStartT = undefined;
      }
    }
  }

  return bridges;
}
