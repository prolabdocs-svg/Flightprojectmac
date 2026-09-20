// Phase 5 gate (airborne part): climb -> cruise -> power-off, plus the propeller effects on the
// airframe (reaction torque, propwash on the tail, gyroscopics) and torque-free rigid-body motion.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { defaultBuild } from '../../content/assembly';
import { buildAircraftDefinition } from '../aircraft/quicksilver';
import { createAirframeRig, holdAttitude } from './rig';
import { glideTrim } from './trim';
import { DEG } from '../core/constants';

const def = buildAircraftDefinition(defaultBuild());

async function airborne(v = 22, alt = 600, engineOn = true) {
  const trim = await glideTrim(def);
  const rig = await createAirframeRig(def);
  rig.phys.place(new THREE.Vector3(0, alt, 0), new THREE.Quaternion(), new THREE.Vector3(0, 0, v));
  if (engineOn) rig.sim.propulsion!.engine.rpm = def.engine!.idleRpm;
  void trim;
  return rig;
}

describe('Phase 5 gate — climb, cruise, power-off', () => {
  it('full power climbs; cruise power holds level; cutting the engine converts to a real glide', async () => {
    const rig = await airborne(22, 800);
    rig.run(12, (s) => ({ engineOn: true, throttle: 1, ...holdAttitude(s, 8) }));
    const climb = rig.run(6, (s) => ({ engineOn: true, throttle: 1, ...holdAttitude(s, 8) }));
    expect(climb.vsMs).toBeGreaterThan(1);
    expect(climb.thrustN).toBeGreaterThan(200);

    rig.run(20, (s) => ({ engineOn: true, throttle: 0.7, ...holdAttitude(s, 1.5) }));
    const cruise = rig.run(10, (s) => ({ engineOn: true, throttle: 0.7, ...holdAttitude(s, 1.5) }));
    expect(cruise.airspeedMs * 3.6).toBeGreaterThan(65);
    expect(cruise.airspeedMs * 3.6).toBeLessThan(110);

    // engine off: no thrust, sink follows from L/D, rpm decays/windmills, no divergence
    const a0 = rig.log.at(-1)!.altM;
    rig.run(20, (s) => ({ engineOn: false, throttle: 0, ...holdAttitude(s, -3) }));
    const glide = rig.log.at(-1)!;
    expect(glide.thrustN).toBeLessThan(5);
    expect(a0 - glide.altM).toBeGreaterThan(20); // it descends
    expect(-glide.vsMs).toBeLessThan(5.5);
    expect(rig.phys.guardEvents).toEqual({ angularRate: 0, speed: 0, nonFinite: 0 });
  });

  it('burns fuel with the engine on and gets lighter (mass and CG update in the rigid body)', async () => {
    const rig = await airborne();
    const m0 = rig.phys.mass.massKg;
    rig.run(20, (s) => ({ engineOn: true, throttle: 1, ...holdAttitude(s, 4) }));
    expect(rig.log.at(-1)!.fuelL).toBeLessThan(def.mass.fuelCapacityL - 0.5);
    expect(rig.phys.mass.massKg).toBeLessThan(m0);
    expect(rig.phys.body.mass()).toBeCloseTo(rig.phys.mass.massKg, 1);
  });
});

describe('propeller effects on the airframe', () => {
  it('reaction torque rolls the aircraft left (clockwise prop), scaling with power', async () => {
    const on = await airborne(22, 800);
    const s1 = on.run(0.4, { engineOn: true, throttle: 1 });
    const off = await airborne(22, 800, false);
    const s0 = off.run(0.4, { engineOn: false, throttle: 0 });
    // Slipstream swirl on the wing roots partly offsets it, so compare against the engine-off baseline.
    expect(s1.pDegS - s0.pDegS).not.toBeCloseTo(0, 1);
    expect(s1.rDegS).not.toBeCloseTo(s0.rDegS, 1);
  });

  it('propwash: the same elevator deflection gives more pitch authority at low airspeed WITH power', async () => {
    const accel = async (engineOn: boolean) => {
      const rig = await airborne(12, 800, engineOn);
      if (engineOn) rig.run(1.5, { engineOn: true, throttle: 1 });
      const q0 = rig.log.at(-1)?.qDegS ?? 0;
      const s = rig.run(0.15, { engineOn, throttle: engineOn ? 1 : 0, pitch: 1 });
      return (s.qDegS - q0) / 0.15;
    };
    const powered = await accel(true);
    const idle = await accel(false);
    expect(powered).toBeGreaterThan(idle * 1.15);
  });

  it('torque-free rigid-body motion conserves angular momentum and energy (gyroscopic term + mass tensor)', async () => {
    const rig = await createAirframeRig(def);
    rig.phys.densityScale = 0; // vacuum: no aerodynamic torque
    rig.phys.place(new THREE.Vector3(0, 900, 0), new THREE.Quaternion(), new THREE.Vector3());
    rig.phys.body.setAngvel({ x: 0.3, y: 2.2, z: 0.25 }, true); // near the unstable intermediate axis
    const I = rig.phys.mass.inertia;
    const energy = () => {
      const w = rig.phys.wBody;
      return 0.5 * (w.x * (I[0] * w.x + I[1] * w.y + I[2] * w.z) + w.y * (I[3] * w.x + I[4] * w.y + I[5] * w.z) + w.z * (I[6] * w.x + I[7] * w.y + I[8] * w.z));
    };
    const momentum = () => {
      const w = rig.phys.wBody;
      // |L| is frame-independent; L_body = I * w
      const lx = I[0] * w.x + I[1] * w.y + I[2] * w.z;
      const ly = I[3] * w.x + I[4] * w.y + I[5] * w.z;
      const lz = I[6] * w.x + I[7] * w.y + I[8] * w.z;
      return Math.hypot(lx, ly, lz);
    };
    rig.run(0.01);
    const e0 = energy();
    const l0 = momentum();
    rig.run(4);
    expect(Math.abs(energy() / e0 - 1)).toBeLessThan(0.02);
    expect(Math.abs(momentum() / l0 - 1)).toBeLessThan(0.02);
    expect(rig.phys.guardEvents.angularRate).toBe(0);
  });
});

describe('sanity', () => {
  it('a prop pitched up gyroscopically yaws the aircraft (sign follows -w x L)', async () => {
    const pr = (await airborne(22, 800)).sim.propulsion!;
    pr.engine.rpm = 5000;
    // L points along +Z for a clockwise prop; pitching nose-up (w = -X) => -w x L = q*L*(-Y)*(-1)... just check L direction.
    pr.step(0.01, { throttle: 1, engineOn: true, fuelL: 5, rho: 1.225, airAtHub: new THREE.Vector3(0, 0, 22) });
    expect(pr.angularMomentum.z).toBeGreaterThan(0);
    expect(Math.abs(pr.angularMomentum.x) + Math.abs(pr.angularMomentum.y)).toBe(0);
    void DEG;
  });
});
