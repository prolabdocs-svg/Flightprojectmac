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
    case 'airframe': return `${ROOT}/airframes/${filename}.glb`;
    case 'upgrade': return `${ROOT}/upgrades/${filename}.glb`;
    case 'world': return `${ROOT}/world/${filename}.glb`;
    case 'micro': return `${ROOT}/micro/${filename}.glb`;
  }
}

/** Current playable starter frame. New FrameDefinitions can supply their matching
 * canonical ID without changing rendering code. */
export const FRAME_ASSET_IDS: Record<string, string> = {
  frame_zero: 'U0-01',
};

export const ACTIVE_REGION_ASSETS = {
  the_field: ['farmhouse_a', 'barn_a', 'water_tower', 'airfield_windsock', 'runway_modular_segment'],
  scrap_valley: ['stepped_quarry', 'powerline_tower', 'utility_pole', 'checkpoint_beacon'],
  coast_run: ['coastal_port', 'coastal_cliff_landmark', 'coastal_palm', 'runway_modular_segment'],
} as const;
