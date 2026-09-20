import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createHarness } from '../../sim/flightHarness';
import { FlightModel } from '../flightModel';
import { readExtendedTelemetry, newExtendedTelemetry } from './flightTelemetry';
import { FlightRecorder, RECORDER_COLUMNS } from './flightRecorder';
import { NEUTRAL } from '../../sim/flightHarness';

vi.setConfig({ testTimeout: 60_000 });

describe('extended telemetry + recorder', () => {
  it('exposes every spec-29 quantity, consistent with the physics', async () => {
    const h = await createHarness({ model: 'new' });
    const fc = h.fc as FlightModel;
    h.run(6, { throttle: 1, engineOn: true, pitch: 0 });
    const t = readExtendedTelemetry(fc);
    expect(t.massKg).toBeGreaterThan(200);
    expect(t.cg).toHaveLength(3);
    expect(t.rpm).toBeGreaterThan(3000);
    expect(t.thrustN).toBeGreaterThan(300);
    expect(t.iasMs).toBeGreaterThan(5);
    expect(t.tasMs).toBeGreaterThanOrEqual(t.iasMs * 0.99);
    expect(t.aglM).toBeCloseTo(fc.sim.physics.heightAglM);
    expect(t.elements.length).toBe(fc.sim.physics.elements.length);
    expect(t.elements.find((e) => e.id === 'wing_L0')).toBeDefined();
    for (const k of ['iasMs', 'alphaDeg', 'betaDeg', 'pitchDeg', 'rollDeg', 'headingDeg', 'gLoad', 'cl', 'cd', 'liftN', 'dragN', 'elevatorDeg', 'rudderDeg'] as const) expect(Number.isFinite(t[k])).toBe(true);
    // CL/CD are wind-axis coefficients: a rolling aircraft on the ground still has small CL, positive CD
    expect(t.cd).toBeGreaterThan(0);
  });

  it('reads without allocating a new object each call and reuses the element array', async () => {
    const h = await createHarness({ model: 'new' });
    const out = newExtendedTelemetry();
    h.run(0.2, NEUTRAL);
    const r1 = readExtendedTelemetry(h.fc as FlightModel, out);
    const arr = r1.elements;
    const r2 = readExtendedTelemetry(h.fc as FlightModel, out);
    expect(r2).toBe(out);
    expect(r2.elements).toBe(arr);
  });

  it('records at a decimated rate into a ring buffer and exports CSV/JSON', async () => {
    const h = await createHarness({ model: 'new' });
    const fc = h.fc as FlightModel;
    const rec = new FlightRecorder(20, 50);
    for (let i = 0; i < 300; i++) {
      h.run(fc.dtS, { throttle: 1, engineOn: true });
      rec.tick(fc, { ...NEUTRAL, throttle: 1, engineOn: true }, fc.dtS);
    }
    expect(rec.length).toBe(50); // 3 s at 20 Hz = 60 samples, ring keeps the last 50
    const csv = rec.toCSV().split('\n');
    expect(csv[0].split(',')).toEqual([...RECORDER_COLUMNS]);
    expect(csv.length).toBe(51);
    const rows = rec.rows();
    expect(rows[0][0]).toBeLessThan(rows.at(-1)![0]);
    expect(rows.at(-1)![RECORDER_COLUMNS.indexOf('rpm')]).toBeGreaterThan(3000);
    expect(rec.toJSON().rows.length).toBe(50);
    void THREE;
  });
});
