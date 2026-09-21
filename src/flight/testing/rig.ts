// Headless rig for the bare airframe (no gear/engine yet in early phases): Rapier world +
// AircraftPhysics + a callback that supplies surface deflections. Used by unit/flight tests.
import * as THREE from 'three';
import { initPhysics, createWorld } from '../../sim/physics';
import { AircraftSimulation, type SimCommand } from '../core/aircraftSimulation';
import type { GroundQuery } from '../ground/landingGear';
import { PHYSICS_DT } from '../core/constants';
import type { AircraftDefinition } from '../aircraft/aircraftDefinition';
import { attitude } from '../core/coordinates';
import { compassBearingDeg } from '../../world/compass';
import { NEUTRAL_COMMAND } from '../controls/flightControls';

export interface RigSample {
  t: number;
  speedMs: number;
  airspeedMs: number;
  alphaDeg: number;
  betaDeg: number;
  pitchDeg: number;
  rollDeg: number;
  /** Compass heading, 0 = +Z (north), clockwise. */
  headingDeg: number;
  pDegS: number;
  qDegS: number;
  rDegS: number;
  vsMs: number;
  altM: number;
  x: number;
  z: number;
  gLoad: number;
  wingCl: number;
  rpm: number;
  thrustN: number;
  fuelL: number;
  wheels: number;
  gearLoadN: number;
  agl: number;
}

export async function createAirframeRig(def: AircraftDefinition, opts: { altM?: number; speedMs?: number; pitchDeg?: number; wind?: THREE.Vector3; ground?: GroundQuery; onGround?: boolean; dt?: number } = {}) {
  const dt = opts.dt ?? PHYSICS_DT;
  await initPhysics();
  const world = createWorld();
  const sim = new AircraftSimulation(world, def, opts.ground, dt);
  const phys = sim.physics;
  const pitch = ((opts.pitchDeg ?? 0) * Math.PI) / 180;
  // Nose +Z pitched up by rotating about -X (nose up = rotation about -X).
  const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(-1, 0, 0), pitch);
  const vel = new THREE.Vector3(0, Math.sin(pitch) * 0, 1).multiplyScalar(opts.speedMs ?? 22);
  if (opts.onGround) sim.placeOnGround(0, 0, 0);
  else phys.place(new THREE.Vector3(0, opts.altM ?? 500, 0), quat, vel);
  const wind = opts.wind ?? new THREE.Vector3();
  const log: RigSample[] = [];
  let t = 0;
  const fwd = new THREE.Vector3();
  const left = new THREE.Vector3();
  const up = new THREE.Vector3();

  const step = (cmd: SimCommand) => {
    sim.step(cmd, wind);
    const g = phys.forceBody.y / (phys.mass.massKg * 9.80665);
    const att = attitude(phys.frame, fwd, left, up);
    log.push({
      t,
      speedMs: phys.velWorld.length(),
      airspeedMs: phys.airspeedMs,
      alphaDeg: (phys.alphaRad * 180) / Math.PI,
      betaDeg: (phys.betaRad * 180) / Math.PI,
      pitchDeg: (att.pitchRad * 180) / Math.PI,
      rollDeg: (att.rollRad * 180) / Math.PI,
      headingDeg: compassBearingDeg(fwd.x, fwd.z),
      pDegS: (phys.wBody.z * 180) / Math.PI,
      qDegS: (-phys.wBody.x * 180) / Math.PI,
      rDegS: (-phys.wBody.y * 180) / Math.PI,
      vsMs: phys.velWorld.y,
      altM: phys.cgWorld.y,
      x: phys.pos.x,
      z: phys.pos.z,
      gLoad: g,
      wingCl: phys.wingCl,
      rpm: sim.propulsion?.engine.rpm ?? 0,
      thrustN: sim.propulsion?.thrustN ?? 0,
      fuelL: phys.fuelL,
      wheels: sim.gear.summary.wheelsOnGround,
      gearLoadN: sim.gear.summary.peakLoadN,
      agl: phys.heightAglM,
    });
    t += dt;
  };

  /** Runs `seconds`; `cmd` may be constant or a function of the latest sample. */
  const run = (seconds: number, cmd: Partial<SimCommand> | ((s: RigSample | undefined) => Partial<SimCommand>) = {}) => {
    const n = Math.round(seconds / dt);
    for (let i = 0; i < n; i++) step({ ...NEUTRAL_COMMAND, engineOn: false, ...(typeof cmd === 'function' ? cmd(log[log.length - 1]) : cmd) });
    return log[log.length - 1];
  };
  const controls = sim.controls;
  return { sim, phys, world, run, log, controls, wind };
}

/** Simple attitude-hold pilot used by flight tests: pitch/roll targets in degrees (nose up +, right wing down +). */
export function holdAttitude(s: RigSample | undefined, pitchDeg: number, rollDeg = 0) {
  if (!s) return {};
  const clamp = (v: number) => Math.max(-1, Math.min(1, v));
  return {
    pitch: clamp((pitchDeg - s.pitchDeg) * 0.08 - s.qDegS * 0.03),
    roll: clamp((rollDeg - s.rollDeg) * 0.06 - s.pDegS * 0.02),
    yaw: clamp(s.betaDeg * 0.3),
  };
}

/** Signed heading error target - current in (-180, 180]; positive = turn right. */
export const headingError = (target: number, current: number) => ((target - current + 540) % 360) - 180;

/** Runway-keeping pilot: heading hold (rudder / nose wheel) plus a gentle pull back to the centreline (x = 0). */
export function keepRunway(s: RigSample | undefined, headingDeg = 0) {
  if (!s) return {};
  return { yaw: Math.max(-1, Math.min(1, headingError(headingDeg, s.headingDeg) * 0.1 + s.x * 0.03 - s.rDegS * 0.03)) };
}
