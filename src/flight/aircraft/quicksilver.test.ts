import { describe, expect, it } from 'vitest';
import { defaultBuild } from '../../content/assembly';
import { buildAircraftDefinition } from './quicksilver';
import { missingProvenance } from './aircraftDefinition';
import { computeMassProperties } from './massModel';

describe('reference aircraft definition', () => {
  const def = buildAircraftDefinition(defaultBuild());
  it('every numeric parameter has a provenance tag (no undocumented magic numbers)', () => {
    expect(missingProvenance(def)).toEqual([]);
  });
  it('is symmetric: left/right wing elements mirror each other except for the declared rigging asymmetry', () => {
    const L = def.aero.elements.filter((e) => e.id.startsWith('wing_L'));
    const R = def.aero.elements.filter((e) => e.id.startsWith('wing_R'));
    expect(L.length).toBe(4);
    expect(R.length).toBe(4);
    L.forEach((l, i) => {
      expect(R[i].position[0]).toBeCloseTo(-l.position[0]);
      expect(R[i].areaM2).toBeCloseTo(l.areaM2);
      expect(Math.abs(R[i].incidenceDeg - l.incidenceDeg)).toBeLessThan(0.2);
    });
  });
  it('element areas add up to the catalogue wing and tail areas', () => {
    const wingArea = def.aero.elements.filter((e) => e.group === 'wing').reduce((s, e) => s + e.areaM2, 0);
    expect(wingArea).toBeCloseTo(def.geometry.wingAreaM2, 6);
  });
  it('mass, CG and inertia are derived (not constants) and CG sits near the wing AC', () => {
    const m = computeMassProperties(def.mass.items);
    expect(m.massKg).toBeGreaterThan(200);
    expect(m.massKg).toBeLessThan(330);
    expect(Math.abs(m.cg[2] - def.geometry.wingAcPosition[2])).toBeLessThan(0.4);
    // roll inertia is dominated by the 9 m wing, pitch by the long boom
    expect(m.inertia[8]).toBeGreaterThan(100);
    expect(m.inertia[0]).toBeGreaterThan(m.inertia[8] * 0.5);
  });

  it('models the Kestrel 2 factory wing, Rotax 582, six-gallon tank and propeller', () => {
    const factory = buildAircraftDefinition({ ...defaultBuild(), installed: { ...defaultBuild().installed, engine: 'rotax_582', wingSet: 'wing_quicksilver_mxii', fuelTank: 'tank_quicksilver_22_7' } });
    expect(def.id).toBe('frame_zero');
    expect(def.name).toContain('Aerofox Kestrel 2');
    expect(factory.geometry.wingspanM).toBeCloseTo(32.583 * 0.3048, 3);
    expect(factory.geometry.wingAreaM2).toBeCloseTo(180 * 0.09290304, 3);
    expect(factory.mass.fuelCapacityL).toBeCloseTo(6 * 3.785411784, 1);
    expect(factory.engine?.maxPowerKw).toBeCloseTo(65 * 0.7457, 2);
    expect(factory.propeller?.diameterM).toBeCloseTo(68 * 0.0254, 3);
    expect(missingProvenance(factory)).toEqual([]);
  });
});

describe('Nightjar definition (AirframeSpec)', () => {
  const build = (engine = 'rotax_503', fuelTank = 'tank_nightjar_20') => buildAircraftDefinition({ frameId: 'frame_nightjar', installed: { engine, fuelTank, landingGear: 'gear_light' } });
  it('is fully documented, sits on its tyres and keeps the CG ahead of the mains', () => {
    const def = build();
    expect(missingProvenance(def)).toEqual([]);
    for (const w of def.gear.wheels) expect(w.position[1]).toBeCloseTo(-def.gear.staticCompressionM, 6);
    const items = [...def.mass.items, { massKg: def.mass.fuelCapacityL * def.mass.fuelDensityKgL, position: def.mass.fuelPosition }];
    const m = items.reduce((s, i) => s + i.massKg, 0);
    const cgZ = items.reduce((s, i) => s + i.massKg * i.position[2], 0) / m;
    const [nose, main] = [def.gear.wheels[0].position[2], def.gear.wheels[1].position[2]];
    const noseShare = (cgZ - main) / (nose - main);
    expect(noseShare).toBeGreaterThan(0.08);
    expect(noseShare).toBeLessThan(0.2);
  });
  it('upgrades flow through: 582 is heavier and stronger, the long-range tank carries more fuel', () => {
    const base = build(), big = build('rotax_582'), tank = build('rotax_503', 'tank_nightjar_32');
    expect(big.engine!.maxPowerKw).toBeGreaterThan(base.engine!.maxPowerKw);
    expect(big.mass.items.reduce((s, i) => s + i.massKg, 0)).toBeGreaterThan(base.mass.items.reduce((s, i) => s + i.massKg, 0));
    expect(tank.mass.fuelCapacityL).toBeGreaterThan(base.mass.fuelCapacityL);
    expect(base.propeller!.diameterM).toBeCloseTo(1.37, 3);
  });
});

describe('Zenith STOL CH 701 definition', () => {
  const def = buildAircraftDefinition({ frameId: 'frame_zenith_ch701', installed: { engine: 'rotax_912', wingSet: 'wing_ch701', fuelTank: 'tank_ch701_75', landingGear: 'gear_field' } });

  it('uses CH 701 wing, fuel, tractor engine and tricycle gear geometry', () => {
    expect(def.geometry.wingspanM).toBeCloseTo(8.23, 2);
    expect(def.geometry.wingAreaM2).toBeCloseTo(11.3, 2);
    expect(def.mass.fuelCapacityL).toBe(75);
    expect(def.engine?.maxPowerKw).toBeCloseTo(80 * 0.7457, 2);
    expect(def.engine?.position[2]).toBeGreaterThan(2);
    expect(def.gear.wheels.map((wheel) => wheel.id)).toEqual(['nose', 'mainL', 'mainR']);
    expect(def.gear.wheels[1].radiusM).toBeGreaterThan(0.3);
    expect(missingProvenance(def)).toEqual([]);
  });
});
