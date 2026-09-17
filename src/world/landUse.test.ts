import { describe, expect, it } from 'vitest';
import { getRegion } from '../content/regions';
import { getAirfield } from './airfields';
import {
  getRegionFarmParcels,
  getRegionRoadNodes,
  getRegionRoadSegments,
  getRegionTowns,
  getRoadWaterCrossings,
  isOnRoad,
} from './landUse';
import { createTerrainQueryService } from './terrainQuery';

const SLOPE_LIMIT_DEG = 15; // "plausible" farm slope — well under vegetation's own shrub limit of 32.

describe('land use QA §228', () => {
  it('every town sits on a road node (town connected to road)', () => {
    const nodeIds = new Set(getRegionRoadNodes('the_field').map((n) => n.id));
    for (const town of getRegionTowns('the_field')) {
      expect(nodeIds.has(town.id)).toBe(true);
    }
  });

  it('farm parcels sit on plausibly flat ground', () => {
    for (const regionId of ['the_field', 'backcountry']) {
      const terrain = createTerrainQueryService(getRegion(regionId));
      for (const parcel of getRegionFarmParcels(regionId)) {
        expect(terrain.getSlopeDeg(parcel.center[0], parcel.center[1])).toBeLessThan(SLOPE_LIMIT_DEG);
      }
    }
  });

  it('road nodes sit at their matching airfield (airport access possible visually)', () => {
    for (const [regionId, nodeId, airfieldId] of [
      ['the_field', 'the_field_home', 'field_home'],
      ['the_field', 'the_field_north', 'field_north_strip'],
      ['backcountry', 'backcountry_lake_strip', 'backcountry_lake_strip'],
    ] as const) {
      const node = getRegionRoadNodes(regionId).find((n) => n.id === nodeId)!;
      const airfield = getAirfield(airfieldId)!;
      expect(node.position).toEqual([airfield.position[0], airfield.position[2]]);
    }
  });

  it('regions with no settlement flavor get no land use at all', () => {
    expect(getRegionRoadSegments('scrap_valley')).toHaveLength(0);
    expect(getRegionFarmParcels('scrap_valley')).toHaveLength(0);
    expect(getRegionTowns('scrap_valley')).toHaveLength(0);
  });

  it('backcountry gets a bridge where its road crosses the lake', () => {
    const terrain = createTerrainQueryService(getRegion('backcountry'));
    const bridges = getRoadWaterCrossings('backcountry', terrain);
    expect(bridges.length).toBeGreaterThan(0);
    for (const bridge of bridges) {
      expect(terrain.getWaterDepth(bridge.position[0], bridge.position[1])).toBeGreaterThan(0);
    }
  });

  it('regions with no water get no bridges', () => {
    const terrain = createTerrainQueryService(getRegion('the_field'));
    expect(getRoadWaterCrossings('the_field', terrain)).toHaveLength(0);
  });
});

describe('isOnRoad', () => {
  it('is true along a segment and false well off it', () => {
    expect(isOnRoad('the_field', 0, 0)).toBe(true); // exactly at the_field_home node
    expect(isOnRoad('the_field', 0, 5000)).toBe(false);
  });
});
