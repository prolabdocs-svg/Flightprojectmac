// Timestep selection (spec section 26: "50-100 Hz, choose by profiling"): a convergence study.
// The same manoeuvre (phugoid excitation + aileron/rudder doublet + power change) is flown at
// 50, 60, 100 and 200 Hz. 100 Hz must agree with the 200 Hz reference much better than 50 Hz does,
// which is why PHYSICS_HZ = 100.
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { defaultBuild } from '../../content/assembly';
import { buildAircraftDefinition } from '../aircraft/quicksilver';
import { createAirframeRig, holdAttitude } from './rig';

vi.setConfig({ testTimeout: 120_000 });
const def = buildAircraftDefinition(defaultBuild());

async function fly(hz: number) {
  const rig = await createAirframeRig(def, { dt: 1 / hz, altM: 900 });
  rig.phys.place(new THREE.Vector3(0, 900, 0), new THREE.Quaternion(), new THREE.Vector3(0, 0, 28));
  rig.run(4, (s) => ({ engineOn: true, throttle: 0.6, ...holdAttitude(s, 0) }));
  rig.run(1.5, { engineOn: true, throttle: 0.8, roll: 0.7, yaw: 0.2 });
  rig.run(1.5, { engineOn: true, throttle: 0.8, roll: -0.7, yaw: -0.2 });
  rig.run(8, { engineOn: true, throttle: 0.5 });
  const s = rig.log.at(-1)!;
  return { speed: s.airspeedMs, alt: s.altM, roll: s.rollDeg, pitch: s.pitchDeg, heading: s.headingDeg, x: s.x, z: s.z };
}

describe('timestep convergence', () => {
  it('100 Hz is close to the 200 Hz reference and better than 50 Hz', async () => {
    const ref = await fly(200);
    const r100 = await fly(100);
    const r60 = await fly(60);
    const r50 = await fly(50);
    const err = (r: typeof ref) => Math.abs(r.speed - ref.speed) / ref.speed + Math.abs(r.alt - ref.alt) / 50 + Math.abs(r.roll - ref.roll) / 30 + Math.abs(r.pitch - ref.pitch) / 20 + Math.hypot(r.x - ref.x, r.z - ref.z) / 300;
    const e100 = err(r100);
    const e60 = err(r60);
    const e50 = err(r50);
    console.log(`[timestep] error vs 200 Hz: 100 Hz ${e100.toFixed(4)}, 60 Hz ${e60.toFixed(4)}, 50 Hz ${e50.toFixed(4)}`);
    expect(e100).toBeLessThan(0.05);
    expect(e100).toBeLessThan(e50);
    expect(e60).toBeLessThan(0.15);
  });
});
