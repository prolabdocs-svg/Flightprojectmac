// Static (frozen-state) trim analysis for calibration and tests. Aerodynamic loads scale with
// V^2, so for a given AoA the pitching moment is zero at one alpha independent of speed, and the
// trimmed speed follows from |F_aero| = W (power-off glide). No integration is involved.
import * as THREE from 'three';
import { initPhysics, createWorld } from '../../sim/physics';
import { AircraftPhysics, type SurfaceDeflections } from '../core/aircraftPhysics';
import type { AircraftDefinition } from '../aircraft/aircraftDefinition';

export interface GlideTrim {
  alphaDeg: number;
  speedMs: number;
  sinkMs: number;
  glideRatio: number;
  wingCl: number;
  /** d(nose-up moment)/d(alpha) in N m per rad at trim, per unit q S c (stability slope, < 0 = stable). */
  staticStability: number;
}

export async function glideTrim(def: AircraftDefinition, surf: Partial<SurfaceDeflections> = {}): Promise<GlideTrim> {
  await initPhysics();
  const world = createWorld();
  const phys = new AircraftPhysics(world, def);
  const deflections: SurfaceDeflections = { elevator: 0, aileronLeft: 0, aileronRight: 0, rudder: 0, ...surf };
  const vRef = 25;
  const eval_ = (alpha: number) => {
    phys.place(new THREE.Vector3(0, 500, 0), new THREE.Quaternion(), new THREE.Vector3(0, -vRef * Math.sin(alpha), vRef * Math.cos(alpha)));
    phys.readState(new THREE.Vector3());
    phys.computeAero(deflections, null, () => 1);
    return { m: -phys.momentBody.x, fx: phys.forceBody.x, fy: phys.forceBody.y, fz: phys.forceBody.z, cl: phys.wingCl };
  };
  let lo = (-4 * Math.PI) / 180;
  let hi = (16 * Math.PI) / 180;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (eval_(mid).m > 0) lo = mid; else hi = mid;
  }
  const alpha = (lo + hi) / 2;
  const e = eval_(alpha);
  const fmag = Math.hypot(e.fx, e.fy, e.fz);
  const weight = phys.mass.massKg * 9.80665;
  const speed = vRef * Math.sqrt(weight / fmag);
  // Aero force must balance weight: its direction gives the glide angle. Lift ~ perpendicular to V.
  const vdir = new THREE.Vector3(0, -Math.sin(alpha), Math.cos(alpha));
  const f = new THREE.Vector3(e.fx, e.fy, e.fz);
  const dragComp = -f.dot(vdir);
  const liftComp = Math.sqrt(Math.max(1e-9, fmag * fmag - dragComp * dragComp));
  const glide = liftComp / Math.max(1e-6, dragComp);
  const dAlpha = 0.01;
  const stab = (eval_(alpha + dAlpha).m - eval_(alpha - dAlpha).m) / (2 * dAlpha);
  world.free();
  return { alphaDeg: (alpha * 180) / Math.PI, speedMs: speed, sinkMs: speed / glide, glideRatio: glide, wingCl: e.cl, staticStability: stab };
}
