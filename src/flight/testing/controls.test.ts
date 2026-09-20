// Phase 3 gate: control in the three axes, with authority that comes from dynamic pressure.
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { defaultBuild } from '../../content/assembly';
import { buildAircraftDefinition } from '../aircraft/quicksilver';
import { createAirframeRig } from './rig';
import { mixSurfaces, NEUTRAL_COMMAND } from '../controls/flightControls';
import { PHYSICS_DT } from '../core/constants';

// Flight simulations are CPU heavy; the default 5 s can be exceeded when the whole suite runs in parallel.
vi.setConfig({ testTimeout: 60_000 });

const def = buildAircraftDefinition(defaultBuild());

/** Level, straight, at a chosen airspeed with the surfaces neutral. */
async function atSpeed(v: number) {
  const rig = await createAirframeRig(def, { speedMs: v });
  rig.phys.place(new THREE.Vector3(0, 800, 0), new THREE.Quaternion(), new THREE.Vector3(0, 0, v));
  return rig;
}

/** Mean angular acceleration (deg/s^2) over the first `w` seconds after a step input. */
async function accel(v: number, cmd: { pitch?: number; roll?: number; yaw?: number }, axis: 'q' | 'p' | 'r', w = 0.12) {
  const rig = await atSpeed(v);
  rig.controls.actuators.reset();
  const s = rig.run(w, cmd);
  const key = ({ q: 'qDegS', p: 'pDegS', r: 'rDegS' } as const)[axis];
  return s[key] / w;
}

describe('control mixer + actuators', () => {
  it('produces lift-sense deflections with differential ailerons and travel limits', () => {
    const out = { elevator: 0, aileronLeft: 0, aileronRight: 0, rudder: 0 };
    mixSurfaces({ ...NEUTRAL_COMMAND, roll: 1 }, def.controls, out);
    expect(out.aileronRight).toBeLessThan(0); // right up (lift-negative), full travel
    expect(out.aileronLeft).toBeGreaterThan(0); // left down, reduced travel
    expect(out.aileronLeft).toBeLessThan(-out.aileronRight);
    mixSurfaces({ ...NEUTRAL_COMMAND, pitch: 1 }, def.controls, out);
    expect(out.elevator).toBeLessThan(0);
    mixSurfaces({ ...NEUTRAL_COMMAND, pitch: 5, roll: -9, yaw: 4 }, def.controls, out);
    expect(Math.abs(out.elevator)).toBeLessThanOrEqual((def.controls.elevatorMaxDeg * Math.PI) / 180 + 1e-9);
  });

  it('surfaces move at a finite rate (no instant deflection)', async () => {
    const rig = await atSpeed(22);
    rig.run(PHYSICS_DT, { pitch: 1 });
    const one = rig.controls.actuators.position.elevator;
    expect(Math.abs(one)).toBeLessThan((def.controls.surfaceRateDegS * Math.PI) / 180 * PHYSICS_DT * 1.001);
  });
});

describe('Phase 3 gate — three-axis control, physical signs', () => {
  it('stick back pitches the nose up, stick right rolls right, right rudder yaws right', async () => {
    expect(await accel(22, { pitch: 1 }, 'q')).toBeGreaterThan(3);
    expect(await accel(22, { roll: 1 }, 'p')).toBeGreaterThan(20);
    expect(await accel(22, { yaw: 1 }, 'r')).toBeGreaterThan(2);
    expect(await accel(22, { pitch: -1 }, 'q')).toBeLessThan(-3);
    expect(await accel(22, { roll: -1 }, 'p')).toBeLessThan(-20);
    expect(await accel(22, { yaw: -1 }, 'r')).toBeLessThan(-2);
  });

  it('each control is (mostly) about its own axis', async () => {
    const rig = await atSpeed(22);
    const s = rig.run(0.3, { roll: 1 });
    expect(Math.abs(s.pDegS)).toBeGreaterThan(3 * Math.abs(s.qDegS));
  });

  it('authority grows with dynamic pressure: angular acceleration ~ V^2 (initial response)', async () => {
    for (const [axis, cmd] of [['q', { pitch: 1 }], ['p', { roll: 1 }], ['r', { yaw: 1 }]] as const) {
      const slow = await accel(14, cmd, axis, 0.1);
      const mid = await accel(22, cmd, axis, 0.1);
      const fast = await accel(34, cmd, axis, 0.1);
      expect(mid).toBeGreaterThan(slow * 1.8);
      expect(fast).toBeGreaterThan(mid * 1.8);
      // Bounded above by the pure V^2 law (damping only reduces the ratio).
      expect(fast / slow).toBeLessThan((34 / 14) ** 2 * 1.15);
    }
  });

  it('control authority is NOT capped at high speed (the legacy min(1.25, q) hack is gone)', async () => {
    const a = await accel(30, { roll: 1 }, 'p', 0.1);
    const b = await accel(45, { roll: 1 }, 'p', 0.1);
    expect(b).toBeGreaterThan(a * 1.6);
  });

  it('adverse yaw emerges from differential drag: rolling right first yaws the nose left', async () => {
    const rig = await atSpeed(18);
    const s = rig.run(0.35, { roll: 1 });
    expect(s.rDegS).toBeLessThan(0); // nose yaws LEFT while rolling right
  });

  it('a sustained aileron input reaches a steady roll rate within ~0.5 s (roll damping emerges from w x r)', async () => {
    const rig = await atSpeed(22);
    rig.run(0.6, { roll: 0.5 });
    const p1 = rig.log.at(-1)!.pDegS;
    rig.run(0.3, { roll: 0.5 });
    const p2 = rig.log.at(-1)!.pDegS;
    expect(p1).toBeGreaterThan(12);
    expect(Math.abs(p2 - p1)).toBeLessThan(0.2 * p1);
  });

  it('low speed = mushy controls: half the trim speed gives far less roll rate', async () => {
    const hi = await atSpeed(28); hi.run(0.6, { roll: 0.6 });
    const lo = await atSpeed(17); lo.run(0.6, { roll: 0.6 });
    expect(lo.log.at(-1)!.pDegS).toBeLessThan(hi.log.at(-1)!.pDegS * 0.8);
  });
});
