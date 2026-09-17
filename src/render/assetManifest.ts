/**
 * Runtime contract for the Blender exports under public/assets/models.
 * Keep paths derived from stable production IDs: assets can be streamed individually
 * instead of adding the full 360-model library to a mobile player's first download.
 */
export type AssetDomain = 'airframe' | 'upgrade' | 'world' | 'micro';

const ROOT = '/assets/models';

export function assetUrl(domain: AssetDomain, id: string): string {
  const filename = id.toLowerCase().replaceAll('-', '_');
  switch (domain) {
    case 'airframe': return id === 'hero_ultralight' ? `${ROOT}/pf_aircraft_ultralight.glb` : `${ROOT}/airframes/${filename}.glb`;
    case 'upgrade': return `${ROOT}/upgrades/${filename}.glb`;
    case 'world': return `${ROOT}/world/${filename}.glb`;
    case 'micro': return `${ROOT}/micro/${filename}.glb`;
  }
}

/** Current playable starter frame. New FrameDefinitions can supply their matching
 * canonical ID without changing rendering code. */
export const FRAME_ASSET_IDS: Record<string, string> = {
  frame_zero: 'hero_ultralight',
};

export interface WorldAssetPlacement {
  id: string;
  position: readonly [number, number];
  scale?: number;
  rotationY?: number;
}

/** Sparse authored anchors: assets are placed for navigation/composition rather than
 * distributed uniformly. The procedural scatter remains only as low-cost background. */
export const ACTIVE_REGION_ASSETS: Record<string, readonly WorldAssetPlacement[]> = {
  the_field: [
    { id: 'farmhouse_a', position: [-74, 40], rotationY: 0.4 },
    { id: 'barn_a', position: [-40, 20], rotationY: -0.2 },
    { id: 'water_tower', position: [120, 290] },
    { id: 'airfield_windsock', position: [13, 105] },
    { id: 'runway_modular_segment', position: [0, 150], scale: 0.2 },
  ],
  scrap_valley: [
    { id: 'stepped_quarry', position: [-145, 265], scale: 1.35 },
    { id: 'powerline_tower', position: [80, 220] },
    { id: 'utility_pole', position: [80, 140] },
    { id: 'checkpoint_beacon', position: [-25, 300] },
  ],
  red_canyon: [
    { id: 'volcanic_cone_landmark', position: [-220, 510], scale: 1.25 },
    { id: 'emergency_strip_marker', position: [45, 310] },
    { id: 'checkpoint_beacon', position: [70, 480] },
  ],
  backcountry: [
    { id: 'reservoir_dam', position: [-190, 420], rotationY: 0.35 },
    { id: 'conifer_tree', position: [85, 180], scale: 1.2 },
    { id: 'riparian_tree', position: [-90, 260], scale: 1.15 },
    { id: 'emergency_strip_marker', position: [20, 360] },
  ],
  coast_run: [
    { id: 'coastal_port', position: [-120, 330], rotationY: 0.2 },
    { id: 'coastal_cliff_landmark', position: [-240, 430], scale: 1.2 },
    { id: 'coastal_palm', position: [-60, 170] },
    { id: 'runway_modular_segment', position: [0, 150], scale: 0.2 },
  ],
  industrial_belt: [
    { id: 'river_truss_bridge', position: [-130, 350], rotationY: Math.PI / 2 },
    { id: 'road_bridge_small', position: [95, 270], rotationY: Math.PI / 2 },
    { id: 'radio_tower', position: [160, 420] },
    { id: 'small_workshop', position: [-60, 180], rotationY: -0.25 },
  ],
  high_desert_test_range: [
    { id: 'small_workshop', position: [-80, 250], rotationY: 0.15 },
    { id: 'windmill_landmark', position: [150, 430] },
    { id: 'dry_scrub_tree', position: [70, 190], scale: 1.3 },
    { id: 'emergency_strip_marker', position: [0, 300] },
  ],
  the_range: [
    { id: 'radio_tower', position: [180, 480] },
    { id: 'conifer_tree', position: [-120, 250], scale: 1.35 },
    { id: 'windmill_landmark', position: [40, 350] },
    { id: 'checkpoint_beacon', position: [0, 500] },
  ],
} as const;
