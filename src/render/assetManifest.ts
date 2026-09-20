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

/** Maps each FrameDefinition id (src/content/parts.ts#FRAMES) to its shipped GLB id.
 * Tier-matched against the canonical roster (public/assets/models/README.md, 70
 * airframes keyed by tier prefix): frame_yardbird/trailblazer/bush_king are tier 1/2/3,
 * so they take the first roster variant from the matching l1, a2, g3 tier family. */
export const FRAME_ASSET_IDS: Record<string, string> = {
  frame_zero: 'hero_ultralight',
  frame_yardbird: 'l1_01',
  frame_trailblazer: 'a2_01',
  frame_bush_king: 'g3_01',
};

export interface WorldAssetPlacement {
  id: string;
  position: readonly [number, number];
  scale?: number;
  rotationY?: number;
  /** Deliberately approximate collision volume for this exact rendered prop. */
  collision?: { kind: 'cylinder'; radiusM: number; heightM: number } | { kind: 'box'; halfX: number; halfZ: number; heightM: number };
}

/** Sparse authored anchors: assets are placed for navigation/composition rather than
 * distributed uniformly. The procedural scatter remains only as low-cost background. */
export const ACTIVE_REGION_ASSETS: Record<string, readonly WorldAssetPlacement[]> = {
  the_field: [
    { id: 'water_tower', position: [120, 290], collision: { kind: 'cylinder', radiusM: 5, heightM: 28 } },
    { id: 'field_hangar_hero', position: [130, -110], collision: { kind: 'box', halfX: 12, halfZ: 9, heightM: 11 } },
    { id: 'field_village_cluster', position: [160, 350], rotationY: -0.3, collision: { kind: 'box', halfX: 45, halfZ: 30, heightM: 8 } },
    { id: 'field_road_segment', position: [145, 120], rotationY: 0.065 },
    { id: 'airfield_windsock', position: [13, 105] },
    // runway_modular_segment intentionally omitted here: the_field's runway is already
    // modeled procedurally by FlightScene (graded plane at the airfield position), and
    // this GLB at [0, 150] sat right off its northern end, reading as a duplicate strip.
  ],
  scrap_valley: [
    { id: 'pf_scrap_valley_yard', position: [-160, 280], rotationY: 0.2, collision: { kind: 'box', halfX: 45, halfZ: 45, heightM: 22 } },
    { id: 'powerline_tower', position: [150, 260], collision: { kind: 'cylinder', radiusM: 4, heightM: 34 } },
    { id: 'utility_pole', position: [130, 280], collision: { kind: 'cylinder', radiusM: 1.2, heightM: 13 } },
    { id: 'checkpoint_beacon', position: [-25, 300] },
  ],
  red_canyon: [
    { id: 'pf_red_canyon_outpost', position: [-220, 510], rotationY: -0.3, collision: { kind: 'box', halfX: 50, halfZ: 50, heightM: 15 } },
    { id: 'emergency_strip_marker', position: [45, 310] },
    { id: 'checkpoint_beacon', position: [70, 480] },
  ],
  backcountry: [
    { id: 'pf_backcountry_lakeside', position: [-190, 420], rotationY: 0.35, collision: { kind: 'box', halfX: 45, halfZ: 45, heightM: 16 } },
    { id: 'conifer_tree', position: [170, 170], scale: 1.2, collision: { kind: 'cylinder', radiusM: 4, heightM: 22 } },
    { id: 'riparian_tree', position: [-150, 300], scale: 1.15, collision: { kind: 'cylinder', radiusM: 4, heightM: 18 } },
    { id: 'emergency_strip_marker', position: [20, 360] },
  ],
  coast_run: [
    { id: 'pf_coast_run_port_town', position: [-260, 250], rotationY: 0.2, collision: { kind: 'box', halfX: 55, halfZ: 55, heightM: 22 } },
    { id: 'coastal_cliff_landmark', position: [-240, 430], scale: 1.2, collision: { kind: 'cylinder', radiusM: 38, heightM: 70 } },
    { id: 'coastal_palm', position: [-60, 170], collision: { kind: 'cylinder', radiusM: 2, heightM: 18 } },
    { id: 'runway_modular_segment', position: [0, 150], scale: 0.2 },
  ],
  industrial_belt: [
    { id: 'pf_industrial_belt_district', position: [-160, 350], rotationY: Math.PI / 2, collision: { kind: 'box', halfX: 50, halfZ: 50, heightM: 25 } },
    { id: 'road_bridge_small', position: [95, 270], rotationY: Math.PI / 2, collision: { kind: 'box', halfX: 24, halfZ: 6, heightM: 11 } },
    { id: 'radio_tower', position: [230, 520], collision: { kind: 'cylinder', radiusM: 4, heightM: 48 } },
  ],
  high_desert_test_range: [
    { id: 'pf_high_desert_station', position: [-260, 220], rotationY: 0.15, collision: { kind: 'box', halfX: 45, halfZ: 50, heightM: 21 } },
    { id: 'windmill_landmark', position: [330, 400], collision: { kind: 'cylinder', radiusM: 5, heightM: 30 } },
    { id: 'dry_scrub_tree', position: [70, 190], scale: 1.3, collision: { kind: 'cylinder', radiusM: 3, heightM: 12 } },
    { id: 'emergency_strip_marker', position: [0, 300] },
  ],
  the_range: [
    { id: 'pf_range_mountain_refuge', position: [280, 350], rotationY: -0.2, collision: { kind: 'box', halfX: 45, halfZ: 45, heightM: 16 } },
    { id: 'conifer_tree', position: [-120, 250], scale: 1.35, collision: { kind: 'cylinder', radiusM: 4, heightM: 22 } },
    { id: 'windmill_landmark', position: [40, 350], collision: { kind: 'cylinder', radiusM: 5, heightM: 30 } },
    { id: 'checkpoint_beacon', position: [0, 500] },
  ],
} as const;
