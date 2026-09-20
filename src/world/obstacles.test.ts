import { describe, expect, it } from 'vitest';
import { ACTIVE_REGION_ASSETS } from '../render/assetManifest';
import { REGIONS } from '../content/regions';
import { buildAirportOverrides } from './airfieldTerrain';
import { getRegionObstacles, pointInObstacle } from './obstacles';

const flatTerrain = { getElevation: () => 17 };

describe('authored world obstacles', () => {
  it('is derived only from rendered, explicitly collidable placements', () => {
    for (const region of REGIONS) {
      const obstacles = getRegionObstacles(region.id, flatTerrain);
      expect(obstacles.length, `${region.id} needs readable solid hazards`).toBeGreaterThan(0);
      const placements = ACTIVE_REGION_ASSETS[region.id];
      for (const obstacle of obstacles) {
        const placement = placements.find(({ id, position }) => id === obstacle.id && position[0] === obstacle.x && position[1] === obstacle.z);
        expect(placement?.collision, `${obstacle.id} must have a rendered collision source`).toBeDefined();
        expect(obstacle.baseY).toBe(17);
      }
    }
  });

  it('keeps every solid prop outside every graded airfield pad', () => {
    for (const region of REGIONS) {
      for (const obstacle of getRegionObstacles(region.id, flatTerrain)) {
        const footprint = obstacle.kind === 'cylinder' ? obstacle.radiusM : Math.hypot(obstacle.halfX, obstacle.halfZ);
        for (const pad of buildAirportOverrides(region.id)) {
          expect(Math.hypot(obstacle.x - pad.center[0], obstacle.z - pad.center[1]), `${obstacle.id} intrudes ${pad.airfieldId}`).toBeGreaterThan(pad.radiusM + footprint);
        }
      }
    }
  });

  it('uses the authored vertical volumes for impacts', () => {
    const tower = getRegionObstacles('the_field', flatTerrain).find((o): o is Extract<typeof o, { kind: 'cylinder' }> => o.id === 'water_tower' && o.kind === 'cylinder');
    expect(tower).toBeDefined();
    if (!tower) return;
    expect(pointInObstacle(tower, tower.x, tower.baseY + 5, tower.z)).toBe(true);
    expect(pointInObstacle(tower, tower.x + tower.radiusM + 0.1, tower.baseY + 5, tower.z)).toBe(false);
    expect(pointInObstacle(tower, tower.x, tower.baseY + tower.heightM + 0.1, tower.z)).toBe(false);
  });
});
