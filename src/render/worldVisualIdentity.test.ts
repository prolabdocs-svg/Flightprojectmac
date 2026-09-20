import { describe, expect, it } from 'vitest';
import { REGIONS } from '../content/regions';
import {
  getDistantLandmarkKind,
  getTerrainVisualProfile,
  LANDMARK_BY_TERRAIN,
  LANDMARK_PRESENTATION,
  TERRAIN_VISUAL_PROFILE,
} from './worldVisualIdentity';

describe('world visual identity', () => {
  it('assigns every campaign terrain a deliberate landmark kind', () => {
    expect(Object.keys(LANDMARK_BY_TERRAIN)).toHaveLength(8);
    expect(REGIONS.map(getDistantLandmarkKind)).toEqual([
      'silos', 'headframe', 'rock-gateway', 'lookout',
      'lighthouse', 'stacks', 'radio-mast', 'lookout',
    ]);
  });

  it('provides player-facing map presentation for each landmark kind', () => {
    for (const kind of new Set(Object.values(LANDMARK_BY_TERRAIN))) {
      expect(LANDMARK_PRESENTATION[kind]).toMatchObject({ glyph: expect.any(String), label: expect.any(String) });
    }
  });

  it('gives every terrain type a distinct visual profile (palette, density, horizon)', () => {
    const terrains = Object.keys(TERRAIN_VISUAL_PROFILE) as Array<keyof typeof TERRAIN_VISUAL_PROFILE>;
    expect(terrains).toHaveLength(8);

    const paletteKeys = new Set(terrains.map((t) => `${TERRAIN_VISUAL_PROFILE[t].groundAccent}:${TERRAIN_VISUAL_PROFILE[t].groundDetail}`));
    expect(paletteKeys.size).toBe(terrains.length);

    const densities = new Set(terrains.map((t) => TERRAIN_VISUAL_PROFILE[t].vegetationDensity));
    expect(densities.size).toBeGreaterThan(1);

    const jaggedness = new Set(terrains.map((t) => TERRAIN_VISUAL_PROFILE[t].horizonJaggedness));
    expect(jaggedness.size).toBeGreaterThan(1);

    const horizonPalettes = new Set(terrains.map((t) => TERRAIN_VISUAL_PROFILE[t].horizonColors.join(':')));
    expect(horizonPalettes.size).toBe(terrains.length);

    for (const t of terrains) {
      const profile = TERRAIN_VISUAL_PROFILE[t];
      expect(profile.horizonJaggedness).toBeGreaterThan(0);
      expect(profile.horizonJaggedness).toBeLessThanOrEqual(1);
      expect(profile.vegetationDensity).toBeGreaterThan(0);
      expect(profile.parcelScaleM).toBeGreaterThan(0);
      expect(profile.groundAccent).toMatch(/^#[0-9a-f]{6}$/);
      expect(profile.groundDetail).toMatch(/^#[0-9a-f]{6}$/);
      expect(profile.horizonColors).toHaveLength(3);
      for (const colour of profile.horizonColors) expect(colour).toMatch(/^#[0-9a-f]{6}$/);
    }

    // Only farmland-like terrains should show cultivated parcel boundaries; the rest
    // must read as wild/organic ground.
    expect(TERRAIN_VISUAL_PROFILE.meadow.parcels).toBe(true);
    expect(TERRAIN_VISUAL_PROFILE.industrial.parcels).toBe(true);
    expect(TERRAIN_VISUAL_PROFILE.canyon.parcels).toBe(false);
    expect(TERRAIN_VISUAL_PROFILE.desert.parcels).toBe(false);
  });

  it('resolves the visual profile for a region from its terrain type', () => {
    const meadowRegion = REGIONS.find((r) => r.environment.terrain === 'meadow')!;
    expect(getTerrainVisualProfile(meadowRegion)).toBe(TERRAIN_VISUAL_PROFILE.meadow);
  });
});
