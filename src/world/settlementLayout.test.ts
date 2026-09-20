import { describe, expect, it } from 'vitest';
import { REGIONS, getRegion } from '../content/regions';
import { AIRFIELDS } from './airfields';
import { KENNEY_ASSET_IDS, SETTLEMENT_LAYOUT, getSettlementPlacements } from './settlementLayout';
import { createTerrainQueryService } from './terrainQuery';

describe('settlementLayout', () => {
  it('covers every region', () => {
    for (const region of REGIONS) {
      expect(getSettlementPlacements(region.id).length).toBeGreaterThan(0);
    }
  });

  it('is deterministic (pure data, no RNG)', () => {
    for (const region of REGIONS) {
      expect(getSettlementPlacements(region.id)).toEqual(getSettlementPlacements(region.id));
    }
  });

  it('only references imported Kenney CC0 model ids', () => {
    for (const pieces of Object.values(SETTLEMENT_LAYOUT)) {
      for (const piece of pieces) {
        expect(KENNEY_ASSET_IDS).toContain(piece.id);
      }
    }
  });

  it('has no duplicate placements within a region', () => {
    for (const [regionId, pieces] of Object.entries(SETTLEMENT_LAYOUT)) {
      const seen = new Set<string>();
      for (const piece of pieces) {
        const key = `${piece.id}@${piece.position[0]},${piece.position[1]}`;
        expect(seen.has(key), `duplicate placement ${key} in ${regionId}`).toBe(false);
        seen.add(key);
      }
    }
  });

  it('never places a piece on a graded runway pad', () => {
    for (const [regionId, pieces] of Object.entries(SETTLEMENT_LAYOUT)) {
      const region = getRegion(regionId);
      const terrain = createTerrainQueryService(region);
      const regionAirfields = AIRFIELDS.filter((a) => a.regionId === regionId);
      expect(regionAirfields.length).toBeGreaterThan(0);
      for (const piece of pieces) {
        const [x, z] = piece.position;
        expect(terrain.isOnGradedRunway(x, z), `${regionId} ${piece.id}@${x},${z} is on a graded runway`).toBe(false);
      }
    }
  });
});
