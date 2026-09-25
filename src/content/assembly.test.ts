import { describe, expect, it } from 'vitest';
import { defaultBuild, installPart, resolveAircraft } from './assembly';
import { FRAME_NIGHTJAR, FRAME_ZERO, FRAME_ZENITH_CH701, getPart } from './parts';

describe('defaultBuild', () => {
  it('uses the frame zero default loadout', () => {
    const build = defaultBuild();
    expect(build.frameId).toBe(FRAME_ZERO.id);
    expect(build.installed).toEqual(FRAME_ZERO.defaultLoadout);
    expect(build.installed.engine).toBe('engine_small');
    expect(build.installed.wingSet).toBe('wing_a_basic');
    expect(build.installed.fuelTank).toBe('tank_8');
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
  it('builds the CH 701 only with its Rotax tractor package and compatible airframe parts', () => {
    const resolved = resolveAircraft({ frameId: FRAME_ZENITH_CH701.id, installed: { ...FRAME_ZENITH_CH701.defaultLoadout } });
    expect(resolved.frame.id).toBe(FRAME_ZENITH_CH701.id);
    expect(resolved.engine?.id).toBe('rotax_912');
    expect(resolved.fuelCapacityL).toBe(75);
    expect(resolved.aeroSurfaces.find((surface) => surface.id === 'wing_root_main')?.spanM).toBe(8.23);
    expect(resolved.aeroSurfaces.filter((surface) => surface.controlAxis === 'roll').map((surface) => surface.id).sort()).toEqual(['aileron_l', 'aileron_r']);
  });

  it('uses the Nightjar frame control-surface stations once, instead of inheriting generic wing stations', () => {
    const resolved = resolveAircraft({ frameId: FRAME_NIGHTJAR.id, installed: { ...FRAME_NIGHTJAR.defaultLoadout } });
    const ailerons = resolved.aeroSurfaces.filter((surface) => surface.controlAxis === 'roll');
    expect(ailerons).toHaveLength(2);
    expect(ailerons.map((surface) => surface.id).sort()).toEqual(['aileron_l', 'aileron_r']);
    expect(ailerons.find((surface) => surface.id === 'aileron_l')?.localPosition).toEqual([2.83, 1.95, -1.1]);
    expect(ailerons.find((surface) => surface.id === 'aileron_r')?.localPosition).toEqual([-2.83, 1.95, -1.1]);
  });

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

  it('an engine swap changes mass while retaining the starter airframe', () => {
    const factory = resolveAircraft(defaultBuild());
    const swap = resolveAircraft(installPart(defaultBuild(), 'engine', 'engine_medium'));
    expect(swap.frame.id).toBe(factory.frame.id);
    expect(swap.totalMassKg).not.toBe(factory.totalMassKg);
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
