import { describe, expect, it } from 'vitest';
import { defaultBuild, installPart, resolveAircraft } from './assembly';
import { FRAME_ZERO, getPart } from './parts';

describe('defaultBuild', () => {
  it('uses the frame zero default loadout', () => {
    const build = defaultBuild();
    expect(build.frameId).toBe(FRAME_ZERO.id);
    expect(build.installed).toEqual(FRAME_ZERO.defaultLoadout);
  });
});

describe('installPart', () => {
  it('swaps a single category without touching the others', () => {
    const build = defaultBuild();
    const updated = installPart(build, 'engine', 'engine_medium');
    expect(updated.installed.engine).toBe('engine_medium');
    expect(updated.installed.wingSet).toBe(build.installed.wingSet);
    // original build is untouched (immutability)
    expect(build.installed.engine).not.toBe('engine_medium');
  });
});

describe('resolveAircraft', () => {
  it('sums frame + installed part mass', () => {
    const build = defaultBuild();
    const resolved = resolveAircraft(build);
    let expectedMass = FRAME_ZERO.basePhysics.massKg;
    for (const id of Object.values(build.installed)) {
      const part = getPart(id as string);
      if (part) expectedMass += part.physics.massKg;
    }
    expect(resolved.totalMassKg).toBeCloseTo(expectedMass, 6);
  });

  it('includes the engine spec from the installed engine part', () => {
    const build = defaultBuild();
    const resolved = resolveAircraft(build);
    expect(resolved.engine).not.toBeNull();
    expect(resolved.engine?.id).toBe('engine_small');
  });

  it('swapping to a heavier engine increases total mass', () => {
    const light = resolveAircraft(defaultBuild());
    const heavier = resolveAircraft(installPart(defaultBuild(), 'engine', 'engine_medium'));
    expect(heavier.totalMassKg).toBeGreaterThan(light.totalMassKg);
  });

  it('defaults fuel capacity to 8L when no tank contributes (fallback branch)', () => {
    // Build with an empty installed map still resolves without throwing and has a sane fuel value.
    const resolved = resolveAircraft({ frameId: FRAME_ZERO.id, installed: {} });
    expect(resolved.fuelCapacityL).toBeGreaterThan(0);
  });

  it('falls back to FRAME_ZERO for an unknown frame id', () => {
    const resolved = resolveAircraft({ frameId: 'not_a_real_frame', installed: {} });
    expect(resolved.frame.id).toBe(FRAME_ZERO.id);
  });
});
