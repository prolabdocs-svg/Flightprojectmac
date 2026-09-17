import { describe, expect, it } from 'vitest';
import { BIOME_COLORS, computeBiomeWeights, type BiomeInputs } from './biomeWeights';

const BASE_BIOMES = [
  'temperate_grassland',
  'rocky_mountain',
  'badlands',
  'temperate_woodland',
  'coastal_dune',
  'urban_periurban',
  'xeric_plain',
  'highland_scrub',
];

function inputs(overrides: Partial<BiomeInputs> = {}): BiomeInputs {
  return {
    regionBiomeId: 'temperate_grassland',
    elevationM: 200,
    slopeDeg: 5,
    aspectDeg: 90,
    moisture01: 0.5,
    surfaceId: 'grass',
    disturbance01: 0,
    ...overrides,
  };
}

describe('computeBiomeWeights', () => {
  it('sums to ~1 and has no negative weights, across all base biomes and varied conditions', () => {
    const variants: Partial<BiomeInputs>[] = [
      {},
      { moisture01: 0.95, aspectDeg: 0 },
      { moisture01: 0.05, aspectDeg: 180, surfaceId: 'sand' },
      { slopeDeg: 40, elevationM: 2500, surfaceId: 'rock' },
      { disturbance01: 1, surfaceId: 'tarmac' },
      { moisture01: 0.95, slopeDeg: 40, disturbance01: 1 },
    ];
    for (const regionBiomeId of BASE_BIOMES) {
      for (const variant of variants) {
        const weights = computeBiomeWeights(inputs({ regionBiomeId, ...variant }));
        const sum = Object.values(weights).reduce((a, b) => a + b, 0);
        expect(sum).toBeCloseTo(1, 6);
        for (const w of Object.values(weights)) {
          expect(w).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('produces at most 4 nonzero entries', () => {
    const weights = computeBiomeWeights(
      inputs({ moisture01: 0.95, slopeDeg: 40, elevationM: 2500, disturbance01: 1, surfaceId: 'rock' }),
    );
    const nonzero = Object.values(weights).filter((w) => w > 1e-9);
    expect(nonzero.length).toBeLessThanOrEqual(4);
  });

  it('is continuous: a small input perturbation only produces a small weight change', () => {
    const base = computeBiomeWeights(inputs({ moisture01: 0.6, slopeDeg: 12 }));
    const perturbed = computeBiomeWeights(inputs({ moisture01: 0.601, slopeDeg: 12.1 }));
    const keys = new Set([...Object.keys(base), ...Object.keys(perturbed)]);
    for (const key of keys) {
      const delta = Math.abs((base[key] ?? 0) - (perturbed[key] ?? 0));
      expect(delta).toBeLessThan(0.01);
    }
  });

  it('never jumps at the slope/moisture smoothstep edges (no hard cliff)', () => {
    const edgePairs: [number, number][] = [
      [9.9, 10],
      [10, 10.1],
      [34.9, 35],
      [35, 35.1],
    ];
    for (const [a, b] of edgePairs) {
      const wa = computeBiomeWeights(inputs({ slopeDeg: a })).rocky_mountain ?? 0;
      const wb = computeBiomeWeights(inputs({ slopeDeg: b })).rocky_mountain ?? 0;
      expect(Math.abs(wa - wb)).toBeLessThan(0.01);
    }
  });

  it('has a BIOME_COLORS entry for every biome id computeBiomeWeights can produce', () => {
    const variants: Partial<BiomeInputs>[] = [
      { moisture01: 0.95, aspectDeg: 0 },
      { moisture01: 0.05, aspectDeg: 180, surfaceId: 'sand' },
      { slopeDeg: 40, elevationM: 2500, surfaceId: 'rock' },
      { disturbance01: 1, surfaceId: 'tarmac' },
      { moisture01: 0.95, slopeDeg: 40, disturbance01: 1 },
    ];
    for (const regionBiomeId of BASE_BIOMES) {
      expect(BIOME_COLORS[regionBiomeId]).toBeDefined();
      for (const variant of variants) {
        const weights = computeBiomeWeights(inputs({ regionBiomeId, ...variant }));
        for (const id of Object.keys(weights)) {
          expect(BIOME_COLORS[id]).toBeDefined();
        }
      }
    }
  });
});
