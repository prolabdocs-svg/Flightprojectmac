// Steady-state performance analysis on the SAME force model the simulation flies (no separate
// analytic aerodynamics): at speed V, find the AoA whose net vertical force balances weight in
// level flight, then read thrust - drag. Used for calibration, tests and (later) Builder readouts.
import * as THREE from 'three';
import { initPhysics, createWorld } from '../../sim/physics';
import { AircraftPhysics } from '../core/aircraftPhysics';
import { Propulsion } from '../propulsion/propulsion';
import type { AircraftDefinition } from '../aircraft/aircraftDefinition';

export interface LevelPoint {
  speedMs: number;
  alphaDeg: number;
  thrustN: number;
  dragN: number;
  /** Excess power / weight = climb rate (m/s) available at this speed (can be < 0). */
  climbMs: number;
  rpm: number;
  stalled: boolean;
}

export async function levelPerformance(def: AircraftDefinition, speeds: number[], throttle = 1, altM = 0): Promise<LevelPoint[]> {
  await initPhysics();
  const world = createWorld();
  const phys = new AircraftPhysics(world, def);
  const pr = def.engine && def.propeller ? new Propulsion(def.engine, def.propeller) : null;
  const weight = phys.mass.massKg * 9.80665;
  const out: LevelPoint[] = [];
  for (const V of speeds) {
    // For a trial alpha, orient the aircraft pitched by alpha with horizontal velocity V.
    const evalAlpha = (alpha: number) => {
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(-1, 0, 0), alpha);
      phys.place(new THREE.Vector3(0, altM + 100, 0), q, new THREE.Vector3(0, 0, V));
      phys.readState(new THREE.Vector3());
      let slip = null;
      let thrust = new THREE.Vector3();
      if (pr) {
        pr.reset();
        pr.engine.rpm = def.engine!.idleRpm;
        const air = phys.airBody.clone();
        for (let i = 0; i < 400; i++) pr.step(0.01, { throttle, engineOn: true, fuelL: 5, rho: phys.atmosphere.densityKgM3, airAtHub: air });
        slip = pr.slipstream;
        thrust = pr.thrust.clone();
      }
      phys.computeAero({ elevator: 0, aileronLeft: 0, aileronRight: 0, rudder: 0 }, slip, () => 1);
      const f = phys.forceBody.clone().add(thrust);
      const fw = f.applyQuaternion(q); // world axes (body pitched by alpha)
      return { fUp: fw.y, fFwd: fw.z, thrustN: thrust.length(), rpm: pr?.engine.rpm ?? 0 };
    };
    let lo = (-4 * Math.PI) / 180;
    let hi = (24 * Math.PI) / 180;
    // vertical force rises with alpha up to stall; bisect on the rising branch
    let found = false;
    for (let i = 0; i < 50; i++) {
      const mid = (lo + hi) / 2;
      if (evalAlpha(mid).fUp < weight) lo = mid; else { hi = mid; found = true; }
    }
    const alpha = (lo + hi) / 2;
    const e = evalAlpha(alpha);
    const stalled = !found || e.fUp < weight * 0.97;
    out.push({ speedMs: V, alphaDeg: (alpha * 180) / Math.PI, thrustN: e.thrustN, dragN: e.thrustN - e.fFwd, climbMs: (e.fFwd * V) / weight, rpm: e.rpm, stalled });
  }
  world.free();
  return out;
}

export function summarize(points: LevelPoint[]) {
  const ok = points.filter((p) => !p.stalled);
  const best = ok.reduce((b, p) => (p.climbMs > b.climbMs ? p : b), ok[0]);
  const top = [...ok].reverse().find((p) => p.climbMs > 0);
  return { bestClimbMs: best.climbMs, bestClimbSpeedKmh: best.speedMs * 3.6, topSpeedKmh: (top?.speedMs ?? 0) * 3.6, minSpeedKmh: ok[0].speedMs * 3.6 };
}
