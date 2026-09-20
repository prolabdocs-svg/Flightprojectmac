/**
 * Deterministic, sparse settlement/route dressing built from the Kenney Nature Kit CC0
 * import (docs/THIRD_PARTY_ASSETS.md). Pure data: no THREE, no assetLibrary, no mission
 * or save state. FlightScene streams these the same way it streams ACTIVE_REGION_ASSETS
 * (src/render/assetManifest.ts) — this module only decides *where*.
 *
 * Placements are authored a handful per region (roads/fences/signage that read as
 * connective tissue between an airfield and a human/geographic anchor), not scattered
 * uniformly — the existing InstancedMesh procedural scatter stays the background layer.
 */
export interface SettlementPiece {
  /** assetLibrary('world', id) key — matches a Kenney model under public/assets/models/world. */
  id: string;
  position: readonly [number, number];
  rotationY?: number;
  scale?: number;
}

/** Kenney Nature Kit CC0 model ids actually present under public/assets/models/world
 * (docs/THIRD_PARTY_ASSETS.md). Kept as a const so a typo here fails a test instead of
 * silently 404ing at runtime. */
export const KENNEY_ASSET_IDS = [
  'kenney_tree_default',
  'kenney_tree_oak',
  'kenney_rock_largeA',
  'kenney_rock_smallA',
  'kenney_fence_simple',
  'kenney_fence_gate',
  'kenney_sign',
] as const;

/** Every placement is authored well clear of its region's graded runway pad(s) — checked
 * against src/world/airfields.ts AIRFIELDS in settlementLayout.test.ts via the real
 * terrainQuery.isOnGradedRunway, not a re-derived radius here. */
export const SETTLEMENT_LAYOUT: Record<string, readonly SettlementPiece[]> = {
  the_field: [
    // Village core + access road/parcel fencing well clear of both field_home (r~150)
    // and field_north_strip (r~130).
    { id: 'kenney_sign', position: [170, -40], rotationY: 0.3 },
    { id: 'kenney_fence_gate', position: [150, -75], rotationY: 0.3 },
    { id: 'kenney_fence_simple', position: [130, -90], rotationY: 0.3 },
    { id: 'kenney_fence_simple', position: [190, -65], rotationY: 0.3 },
    { id: 'kenney_tree_oak', position: [175, -15] },
    { id: 'kenney_tree_default', position: [205, -45] },
  ],
  scrap_valley: [
    // Service road stitching scrap_yard_strip to scrap_quarry_strip.
    { id: 'kenney_sign', position: [30, 300], rotationY: 1.4 },
    { id: 'kenney_fence_gate', position: [30, 450], rotationY: 1.4 },
    { id: 'kenney_rock_smallA', position: [55, 375] },
  ],
  red_canyon: [
    // Trailheads flanking red_canyon_mesa.
    { id: 'kenney_sign', position: [220, 420], rotationY: -0.6 },
    { id: 'kenney_sign', position: [60, 480], rotationY: 2.1 },
    { id: 'kenney_rock_largeA', position: [200, 440] },
  ],
  backcountry: [
    // Reservoir shoreline dressing near backcountry_lake_strip / reservoir_dam.
    { id: 'kenney_tree_default', position: [200, 260] },
    { id: 'kenney_fence_simple', position: [35, 400], rotationY: 0.2 },
  ],
  coast_run: [
    // Coastal access road toward coast_run_pier.
    { id: 'kenney_sign', position: [180, 400], rotationY: 1.57 },
    { id: 'kenney_rock_smallA', position: [200, 420] },
    { id: 'kenney_rock_smallA', position: [160, 420] },
  ],
  industrial_belt: [
    // Workshop-yard perimeter near industrial_cargo_yard.
    { id: 'kenney_fence_simple', position: [70, 570], rotationY: 0 },
    { id: 'kenney_fence_simple', position: [220, 420], rotationY: 1.57 },
    { id: 'kenney_fence_gate', position: [230, 480], rotationY: 0.8 },
    { id: 'kenney_sign', position: [245, 475], rotationY: 0.8 },
  ],
  high_desert_test_range: [
    // Test-station marker well clear of the 500m desert_salt_strip pad.
    { id: 'kenney_sign', position: [0, 850], rotationY: 0 },
    { id: 'kenney_rock_largeA', position: [40, 870] },
    { id: 'kenney_fence_simple', position: [-40, 860], rotationY: 1.57 },
  ],
  the_range: [
    // Mountain refuge above range_summit_pad.
    { id: 'kenney_tree_default', position: [90, 720] },
    { id: 'kenney_fence_gate', position: [70, 700], rotationY: 0.5 },
    { id: 'kenney_sign', position: [110, 705], rotationY: -0.5 },
  ],
};

export function getSettlementPlacements(regionId: string): readonly SettlementPiece[] {
  return SETTLEMENT_LAYOUT[regionId] ?? [];
}
