import { describe, expect, it } from 'vitest';
import { computeMassProperties, principalAxes } from './massModel';
import type { MassItem } from './aircraftDefinition';

const item = (id: string, massKg: number, position: [number, number, number], size: [number, number, number] = [0, 0, 0]): MassItem => ({ id, massKg, position, size });

describe('mass properties', () => {
  it('finds the CG as the mass-weighted centroid', () => {
    const p = computeMassProperties([item('a', 100, [0, 0, 1]), item('b', 100, [0, 0, -1])]);
    expect(p.massKg).toBe(200);
    expect(p.cg).toEqual([0, 0, 0]);
  });
  it('uses the parallel-axis theorem (point masses on the z axis)', () => {
    const p = computeMassProperties([item('a', 10, [0, 0, 2]), item('b', 10, [0, 0, -2])]);
    expect(p.inertia[0]).toBeCloseTo(2 * 10 * 4); // Ixx
    expect(p.inertia[4]).toBeCloseTo(2 * 10 * 4); // Iyy
    expect(p.inertia[8]).toBeCloseTo(0); // Izz
  });
  it('same mass, different layout => different roll/pitch/yaw inertia', () => {
    const compact = computeMassProperties([item('m', 200, [0, 0, 0], [1, 1, 1])]);
    const wide = computeMassProperties([item('m', 200, [0, 0, 0], [9, 0.3, 1.4])]);
    expect(wide.inertia[8]).toBeGreaterThan(compact.inertia[8] * 5); // roll (Izz) grows with span
    expect(wide.inertia[8]).not.toBeCloseTo(wide.inertia[0]);
  });
  it('principal-axis decomposition preserves the trace and recovers diagonal tensors', () => {
    const p = computeMassProperties([item('a', 50, [0, 0.5, 2]), item('b', 80, [0, -0.3, -1]), item('w', 40, [0, 0.3, 0], [9, 0.2, 1.3])]);
    const { moments } = principalAxes(p.inertia);
    expect(moments[0] + moments[1] + moments[2]).toBeCloseTo(p.inertia[0] + p.inertia[4] + p.inertia[8], 6);
    const q = principalAxes([2, 0, 0, 0, 5, 0, 0, 0, 3]);
    expect(q.moments).toEqual([2, 5, 3]);
    expect(Math.abs(q.quaternion[3])).toBeCloseTo(1, 6);
  });
});
