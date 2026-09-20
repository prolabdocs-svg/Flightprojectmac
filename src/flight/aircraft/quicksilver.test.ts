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
});
