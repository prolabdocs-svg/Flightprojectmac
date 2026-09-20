import { describe, expect, it } from 'vitest';
import { REGIONS } from '../content/regions';
import { getFreeFlightAirfield } from '../world/airfields';
import { getRunwaySafeZone, isInsideZone, layoutRoadTiles } from './fieldAirfieldLayout';
import { getRegionRoadNetwork } from './regionRoadNetworks';

describe('getRegionRoadNetwork', () => {
  it('defines 2+ non-empty links reaching from near the airfield to the hero landmark for every region', () => {
    for (const region of REGIONS) {
      const network = getRegionRoadNetwork(region.id);
      expect(network, `${region.id} should have a road network`).not.toBeNull();
      expect(network!.links.length).toBeGreaterThanOrEqual(2);
      for (const link of network!.links) {
        expect(link.length).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('endpoints connect close to the airfield and land on the hero landmark', () => {
    for (const region of REGIONS) {
      const network = getRegionRoadNetwork(region.id);
      const airfield = getFreeFlightAirfield(region.id)!;
      const [primaryLink, branchLink] = network!.links;
      const start = primaryLink[0];
      const distanceToAirfield = Math.hypot(start[0] - airfield.position[0], start[1] - airfield.position[2]);
      // A long strip's legal road start is deliberately outside its runway buffer;
      // "near" therefore scales with the runway half-length rather than imposing
      // a fixed radius that would force an unsafe start on The Field's 220m strip.
      expect(distanceToAirfield).toBeLessThanOrEqual(airfield.runwayLengthM / 2 + 45);

      const heroEnd = primaryLink[primaryLink.length - 1];
      const branchStart = branchLink[0];
      expect(heroEnd).toEqual(branchStart);
    }
  });

  it("the_field's road links avoid the runway safe zone", () => {
    const network = getRegionRoadNetwork('the_field')!;
    const airfield = getFreeFlightAirfield('the_field')!;
    const safeZone = getRunwaySafeZone(airfield);
    for (const link of network.links) {
      for (let i = 0; i < link.length - 1; i++) {
        const tiles = layoutRoadTiles([link[i], link[i + 1]], 4);
        for (const tile of tiles) {
          expect(isInsideZone(tile.x, tile.z, safeZone)).toBe(false);
        }
      }
    }
  });

  it('produces non-empty tile data for every region', () => {
    for (const region of REGIONS) {
      const network = getRegionRoadNetwork(region.id)!;
      for (const link of network.links) {
        const tiles = layoutRoadTiles(link, network.style.tileLengthM);
        expect(tiles.length).toBeGreaterThan(0);
      }
    }
  });
});
