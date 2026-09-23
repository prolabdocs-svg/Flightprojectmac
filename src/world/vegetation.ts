import { isOnRoad } from './landUse';
import type { TerrainQueryService } from './terrainQuery';

/**
 * WLD-05 vegetation (spec §59-63, §159, §227, §244, §251). Scope is deliberately the MVP
 * asset list from spec §244 (2 scrub, 2 grass, 2 dry trees, 1 riparian tree, 1 rocky ground
 * plant) rather than the full CANOPY/SECONDARY_TREES/SHRUB/GRASS/GROUND_COVER/MICRO_DEBRIS
 * layer stack from §59 — distribution quality over species count, per §244.
 */

export type VegetationClass = 'grass' | 'shrub' | 'low_tree' | 'medium' | 'tall';

/** Height range (m) and collision behavior per class, spec §62 table. Obstacle analysis for
 * airfields must consume `heightM`, not just presence. */
export const VEGETATION_CLASSES: Record<VegetationClass, { heightM: [number, number]; collision: 'none' | 'soft' | 'hazard' | 'obstacle' }> = {
  grass: { heightM: [0.1, 0.5], collision: 'none' },
  shrub: { heightM: [0.5, 3], collision: 'soft' },
  low_tree: { heightM: [3, 8], collision: 'hazard' },
  medium: { heightM: [8, 18], collision: 'obstacle' },
  tall: { heightM: [18, 30], collision: 'obstacle' },
};

/** What structural job a species does in a composed scene. `regionPlacement.ts` asks for a
 * role ("I need a canopy tree here"); this catalog answers with a region-appropriate species,
 * which is what makes the same shared placement algorithm produce oaks in The Field and
 * mesquite in Red Canyon. */
export type VegetationRole = 'canopy' | 'evergreen' | 'understory';

export interface VegetationSpecies {
  id: string;
  class: VegetationClass;
  /** Biome ids (from biomeWeights.ts) this species appears in — species mix by biome, §61. */
  biomeIds: string[];
  /** Baseline instances per 100m x 100m cell at full density (biome weight 1, no penalties). */
  baseDensityPer100m2: number;
  /** Art-bible vegetation archetype tags (regionArtBible.ts `vegetationArchetypes`) this
   * species satisfies — the join between "what this region looks like" and "what to plant". */
  archetypes: string[];
  /** Structural role(s) the composer can request this species for. */
  roles: VegetationRole[];
  /** Which instanced tree geometry bucket renders it (render/fieldWorld.ts). */
  renderKind: 'broadleaf' | 'conifer' | 'shrub';
}

/** MVP catalog, spec §244. */
export const VEGETATION_SPECIES: VegetationSpecies[] = [
  { id: 'scrub_sage', class: 'shrub', biomeIds: ['xeric_plain', 'highland_scrub', 'badlands'], baseDensityPer100m2: 6, archetypes: ['desert_scrub', 'sagebrush', 'sparse_scrub'], roles: ['understory'], renderKind: 'shrub' },
  { id: 'scrub_creosote', class: 'shrub', biomeIds: ['xeric_plain', 'badlands'], baseDensityPer100m2: 4, archetypes: ['desert_scrub', 'salt_scrub'], roles: ['understory'], renderKind: 'shrub' },
  { id: 'grass_bunch', class: 'grass', biomeIds: ['temperate_grassland', 'highland_scrub', 'xeric_plain'], baseDensityPer100m2: 25, archetypes: ['dune_grass', 'pasture_grass', 'sparse_scrub'], roles: ['understory'], renderKind: 'shrub' },
  { id: 'grass_meadow', class: 'grass', biomeIds: ['temperate_grassland', 'riparian_corridor'], baseDensityPer100m2: 30, archetypes: ['pasture_grass', 'crop_rows'], roles: ['understory'], renderKind: 'shrub' },
  { id: 'tree_dry_mesquite', class: 'low_tree', biomeIds: ['xeric_plain', 'badlands'], baseDensityPer100m2: 1.5, archetypes: ['desert_scrub', 'cactus'], roles: ['evergreen'], renderKind: 'conifer' },
  { id: 'tree_dry_juniper', class: 'medium', biomeIds: ['highland_scrub', 'rocky_mountain', 'badlands'], baseDensityPer100m2: 1.2, archetypes: ['alpine_conifer', 'sagebrush', 'lichen_rock'], roles: ['evergreen'], renderKind: 'conifer' },
  { id: 'tree_riparian_willow', class: 'medium', biomeIds: ['riparian_corridor'], baseDensityPer100m2: 3, archetypes: ['riparian_alder'], roles: ['canopy'], renderKind: 'broadleaf' },
  { id: 'plant_rock_lichenbrush', class: 'grass', biomeIds: ['rocky_mountain', 'badlands'], baseDensityPer100m2: 8, archetypes: ['lichen_rock', 'ruderal_weed'], roles: ['understory'], renderKind: 'shrub' },
  // Added when regionPlacement.ts became the single composer: The Field's hedgerow oak and
  // windbreak spruce, and Red Canyon's wash cottonwood, had no catalog entry before.
  { id: 'tree_broadleaf_oak', class: 'tall', biomeIds: ['temperate_grassland', 'temperate_woodland'], baseDensityPer100m2: 1.4, archetypes: ['deciduous_hedgerow', 'mixed_canopy', 'isolated_oak'], roles: ['canopy'], renderKind: 'broadleaf' },
  { id: 'shrub_hawthorn_hedge', class: 'shrub', biomeIds: ['temperate_grassland'], baseDensityPer100m2: 5, archetypes: ['deciduous_hedgerow', 'pasture_grass'], roles: ['understory'], renderKind: 'shrub' },
  { id: 'tree_conifer_spruce', class: 'tall', biomeIds: ['temperate_grassland', 'temperate_woodland', 'rocky_mountain'], baseDensityPer100m2: 1.6, archetypes: ['dense_conifer', 'alpine_conifer', 'coastal_pine', 'windbreak_poplar'], roles: ['evergreen'], renderKind: 'conifer' },
  { id: 'tree_canyon_cottonwood', class: 'medium', biomeIds: ['badlands', 'riparian_corridor'], baseDensityPer100m2: 1.1, archetypes: ['canyon_cottonwood'], roles: ['canopy'], renderKind: 'broadleaf' },
  { id: 'cactus_saguaro', class: 'low_tree', biomeIds: ['badlands', 'xeric_plain'], baseDensityPer100m2: 0.8, archetypes: ['cactus'], roles: ['evergreen'], renderKind: 'conifer' },
  { id: 'palm_isolated', class: 'medium', biomeIds: ['xeric_plain'], baseDensityPer100m2: 0.4, archetypes: ['isolated_palm'], roles: ['canopy'], renderKind: 'broadleaf' },
  { id: 'fern_understory', class: 'grass', biomeIds: ['temperate_woodland'], baseDensityPer100m2: 18, archetypes: ['fern_understory'], roles: ['understory'], renderKind: 'shrub' },
];

/**
 * The region -> species join: pick the species that fills `role` for a region described by
 * `archetypes` (regionArtBible.ts) sitting on `biomeId`. Archetype match wins; a biome match
 * is the fallback so a region whose art bible has no archetype for that role (The Field has no
 * conifer archetype, but its windbreaks are spruce) still gets something plausible instead of
 * nothing. Deterministic: first catalog match, never random.
 */
export function pickSpecies(role: VegetationRole, archetypes: readonly string[], biomeId: string): VegetationSpecies {
  const byRole = VEGETATION_SPECIES.filter((s) => s.roles.includes(role));
  return (
    byRole.find((s) => s.archetypes.some((a) => archetypes.includes(a)))
    ?? byRole.find((s) => s.biomeIds.includes(biomeId))
    ?? byRole[0]
  );
}

export interface VegetationInstance {
  speciesId: string;
  position: [number, number, number]; // world x/y/z, y = ground elevation at this point
  /** Uniform scale multiplier, ±15-30% around 1 per spec §61 (never identical scale). */
  scale: number;
  /** Yaw in radians, random per spec §61 (never identical rotation). */
  yawRad: number;
}

interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Deterministic 0..1 hash — no RNG/Math.random, so scatter is reproducible from region+cell
 * coords alone (spec §226: lightweight scatter can be deterministic runtime). */
function hash01(a: number, b: number, salt: number): number {
  const x = Math.sin(a * 127.1 + b * 311.7 + salt * 74.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * §60 placement function: density = biomeDensity * moistureResponse * slopeResponse *
 * elevationResponse * disturbanceResponse * randomField, with randomField constrained to a
 * minor jitter so it never dominates causality (§60: "randomField nunca domina la causalidad").
 */
function densityMultiplier(species: VegetationSpecies, terrain: TerrainQueryService, x: number, z: number): number {
  const sample = terrain.sample(x, z);
  const biomeWeight = species.biomeIds.reduce((sum, id) => sum + (sample.biomeWeights[id] ?? 0), 0);
  if (biomeWeight <= 0) return 0;

  // Trees thin out on steep ground; low ground cover tolerates more slope.
  const slopeLimitDeg = species.class === 'grass' ? 40 : species.class === 'shrub' ? 32 : 22;
  const slopeResponse = Math.max(0, 1 - sample.slopeDeg / slopeLimitDeg);

  // Riparian species want wet ground; dry-biome species are already selected by biomeIds,
  // so elevation/moisture here just adds a soft secondary penalty, not a hard gate.
  const elevationResponse = sample.elevationM > 1800 ? Math.max(0, 1 - (sample.elevationM - 1800) / 600) : 1;

  const disturbanceResponse = 1; // graded pads are excluded outright below, not via density.

  const randomField = 0.85 + 0.3 * hash01(x, z, 17.3); // ±15% jitter — never dominant.

  return biomeWeight * slopeResponse * elevationResponse * disturbanceResponse * randomField;
}

/**
 * Scatters vegetation over `bounds` using jittered-grid blue noise (spec §61: clustered
 * blue-noise, never a bare lattice or identical rotation/scale). Excludes graded runway pads
 * and standing water (spec §227 QA: no tree on runway / in water / floating).
 */
export function scatterVegetation(
  terrain: TerrainQueryService,
  regionId: string,
  bounds: Bounds,
  cellSizeM = 20,
): VegetationInstance[] {
  const instances: VegetationInstance[] = [];
  const cellAreaM2 = cellSizeM * cellSizeM;

  for (let cx = bounds.minX; cx < bounds.maxX; cx += cellSizeM) {
    for (let cz = bounds.minZ; cz < bounds.maxZ; cz += cellSizeM) {
      // Jitter the sample point within the cell so the grid itself is invisible (§61).
      const jitterX = cx + hash01(cx, cz, 1.1) * cellSizeM;
      const jitterZ = cz + hash01(cx, cz, 2.2) * cellSizeM;

      for (const species of VEGETATION_SPECIES) {
        const multiplier = densityMultiplier(species, terrain, jitterX, jitterZ);
        if (multiplier <= 0) continue;
        const expectedCount = (species.baseDensityPer100m2 / 100) * cellAreaM2 * multiplier;
        const count = Math.floor(expectedCount) + (hash01(cx, cz, species.baseDensityPer100m2) < expectedCount % 1 ? 1 : 0);

        for (let i = 0; i < count; i++) {
          const px = cx + hash01(cx + i, cz, 3.3 + i) * cellSizeM;
          const pz = cz + hash01(cx, cz + i, 4.4 + i) * cellSizeM;
          if (terrain.isOnGradedRunway(px, pz)) continue; // §227 QA: no tree on runway.
          if (terrain.getWaterDepth(px, pz) > 0) continue; // §227 QA: no tree/floating tree in water.
          if (isOnRoad(regionId, px, pz)) continue; // §227 QA: no tree on road center.

          instances.push({
            speciesId: species.id,
            position: [px, terrain.getElevation(px, pz), pz],
            scale: 0.85 + hash01(px, pz, 5.5) * 0.45, // ±15-30% variation, §61.
            yawRad: hash01(px, pz, 6.6) * Math.PI * 2, // random yaw, §61.
          });
        }
      }
    }
  }

  return instances;
}

/** Groups instances by species so a renderer can build one InstancedMesh per species instead
 * of one mesh/material per tree (spec §159). */
export function groupInstancesBySpecies(instances: VegetationInstance[]): Map<string, VegetationInstance[]> {
  const groups = new Map<string, VegetationInstance[]>();
  for (const instance of instances) {
    const group = groups.get(instance.speciesId);
    if (group) group.push(instance);
    else groups.set(instance.speciesId, [instance]);
  }
  return groups;
}

export type VegetationLodTier = 'full' | 'impostor' | 'culled';

/** Obstacle-height classes (low_tree/medium/tall) stay visible further than cosmetic ground
 * cover, since airfield obstacle analysis depends on them being seen (§62, §148: obstacle
 * culling must leave visual/collision enough to avoid an invisible hazard). */
const LOD_RANGES_M: Record<VegetationClass, { fullM: number; impostorM: number }> = {
  grass: { fullM: 60, impostorM: 150 },
  shrub: { fullM: 90, impostorM: 220 },
  low_tree: { fullM: 150, impostorM: 400 },
  medium: { fullM: 200, impostorM: 600 },
  tall: { fullM: 250, impostorM: 800 },
};

export function getVegetationLodTier(vegClass: VegetationClass, distanceM: number): VegetationLodTier {
  const range = LOD_RANGES_M[vegClass];
  if (distanceM <= range.fullM) return 'full';
  if (distanceM <= range.impostorM) return 'impostor';
  return 'culled';
}
