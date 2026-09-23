import { describe, expect, it } from 'vitest';
import { REGION_ART_BIBLE, getRegionArtBible, type TerrainType } from './regionArtBible';

const TERRAIN_TYPES: TerrainType[] = ['meadow', 'quarry', 'canyon', 'forest', 'coast', 'industrial', 'desert', 'range'];
const HEX = /^#[0-9a-f]{6}$/i;

describe('regionArtBible', () => {
  it('defines a distinct entry for every region terrain type', () => {
    for (const t of TERRAIN_TYPES) {
      expect(REGION_ART_BIBLE[t]).toBeDefined();
      expect(getRegionArtBible(t).label).toBeTruthy();
    }
  });

  it('gives every region at least one accent color as a valid hex', () => {
    for (const t of TERRAIN_TYPES) {
      const bible = REGION_ART_BIBLE[t];
      expect(bible.accentColors.length).toBeGreaterThan(0);
      for (const c of bible.accentColors) expect(c).toMatch(HEX);
    }
  });

  it('gives every region at least one geology and vegetation archetype', () => {
    for (const t of TERRAIN_TYPES) {
      const bible = REGION_ART_BIBLE[t];
      expect(bible.geologyIds.length).toBeGreaterThan(0);
      expect(bible.vegetationArchetypes.length).toBeGreaterThan(0);
    }
  });

  it('no two regions share the exact same silhouette description', () => {
    const silhouettes = TERRAIN_TYPES.map((t) => REGION_ART_BIBLE[t].silhouette);
    expect(new Set(silhouettes).size).toBe(silhouettes.length);
  });
});
