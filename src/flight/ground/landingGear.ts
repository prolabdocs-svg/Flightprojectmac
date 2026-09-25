// Independent wheels (spec section 21). Every wheel is a spring-damper strut plus a tyre with
// its own compression, load and slip state, applying forces at ITS OWN contact point, so nose/
// tail tendencies, taxi yaw, crosswind side loads, hard landings and bounce all emerge.
//
// Tyre model: normal force from the strut; rolling resistance and braking along the rolling
// direction; lateral force from side slip (tanh saturation); the total is clipped to the friction
// circle mu*N, and exceeding it is reported as skidding.

import * as THREE from 'three';
import type { GearDefinition } from '../aircraft/aircraftDefinition';
import type { AircraftPhysics } from '../core/aircraftPhysics';
import type { GroundSurfaceDefinition } from '../../world/surfaces';

export interface GroundQuery {
  getElevation(x: number, z: number): number;
  getSurface(x: number, z: number): GroundSurfaceDefinition;
  getWaterDepth(x: number, z: number): number;
}

export type WheelMode = 'air' | 'rolling' | 'braking' | 'skidding';

export class WheelState {
  /** Cached terrain normal/surface, refreshed when the contact point has moved (terrain queries are the costly part). */
  readonly cachedNormal = new THREE.Vector3(0, 1, 0);
  cachedSurface: GroundSurfaceDefinition | null = null;
  cacheX = Infinity;
  cacheZ = Infinity;
  contact = false;
  compressionM = 0;
  /** Steering angle this tick (rad, + = nose right); 0 for fixed wheels. Drives the drawn nose fork. */
  steerRad = 0;
  loadN = 0;
  mode: WheelMode = 'air';
  slipSpeedMs = 0;
  longForceN = 0;
  latForceN = 0;
  readonly point = new THREE.Vector3();
  readonly force = new THREE.Vector3();
}

export interface GearInput {
  /** Nose-wheel steering, -1..1 (+ = nose right). */
  steer: number;
  /** Brake pedal 0..1 and differential yaw input -1..1 (+ = right pedal). */
  brake: number;
  yaw: number;
  /** 1 = healthy gear, > 1 = damaged (more rolling drag, less brake authority). */
  damagePenalty: number;
  gearAttached: boolean;
}

export interface GearSummary {
  wheelsOnGround: number;
  /** Worst sink rate (m/s, > 0 = descending) among wheels that touched this tick. */
  maxSinkMs: number;
  peakLoadN: number;
  touchedDown: boolean;
}

const BUMP_STOP_STIFFNESS = 8;
const NORMAL_REFRESH_M = 0.5;

export class LandingGear {
  readonly def: GearDefinition;
  readonly wheels: WheelState[];
  readonly springK: number[] = [];
  readonly springC: number[] = [];
  readonly restHeightM: number;
  readonly summary: GearSummary = { wheelsOnGround: 0, maxSinkMs: 0, peakLoadN: 0, touchedDown: false };
  private readonly ground: GroundQuery;
  private readonly p = new THREE.Vector3();
  private readonly pv = new THREE.Vector3();
  private readonly n = new THREE.Vector3();
  private readonly roll = new THREE.Vector3();
  private readonly side = new THREE.Vector3();
  private readonly f = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private wasInContact = true;

  constructor(def: GearDefinition, massKg: number, cg: [number, number, number], ground: GroundQuery) {
    this.def = def;
    this.ground = ground;
    this.wheels = def.wheels.map(() => new WheelState());
    const shares = wheelShares(def, cg);
    for (let i = 0; i < def.wheels.length; i++) {
      const load = shares[i] * massKg * 9.80665;
      const k = load / def.staticCompressionM;
      this.springK.push(k);
      this.springC.push(2 * def.dampingRatio * Math.sqrt(k * shares[i] * massKg));
    }
    // Height of the datum above ground when resting on the struts (main wheels set the attitude).
    const lowest = Math.min(...def.wheels.map((w) => w.position[1]));
    this.restHeightM = -lowest - def.staticCompressionM;
  }

  /** Applies wheel forces to the body. Call after readState(). */
  step(phys: AircraftPhysics, input: GearInput): GearSummary {
    const g = this.def;
    const sum = this.summary;
    sum.wheelsOnGround = 0;
    sum.maxSinkMs = 0;
    sum.peakLoadN = 0;
    sum.touchedDown = false;
    const inReach = phys.heightAglM < 3;
    this.fwd.set(0, 0, 1).applyQuaternion(phys.frame.q);
    this.up.set(0, 1, 0).applyQuaternion(phys.frame.q);
    let anyContact = false;

    for (let i = 0; i < g.wheels.length; i++) {
      const w = g.wheels[i];
      const st = this.wheels[i];
      st.contact = false;
      st.loadN = 0;
      st.longForceN = 0;
      st.latForceN = 0;
      st.mode = 'air';
      st.compressionM = 0;
      st.force.set(0, 0, 0);
      const steer = w.steerable ? Math.max(-1, Math.min(1, input.steer)) * g.maxSteerRad * Math.max(0.25, 1 - phys.velWorld.length() / 30) : 0;
      st.steerRad = steer;
      if (!input.gearAttached || !inReach) continue;

      phys.pointWorld(w.position, this.p);
      const groundY = this.ground.getElevation(this.p.x, this.p.z);
      const depth = groundY - this.p.y;
      st.point.copy(this.p);
      if (depth <= 0) continue;

      // Normal + surface change slowly along the ground: resample every ~0.5 m of travel, not every tick.
      if (!st.cachedSurface || Math.hypot(this.p.x - st.cacheX, this.p.z - st.cacheZ) > NORMAL_REFRESH_M) {
        this.terrainNormal(this.p.x, this.p.z, st.cachedNormal, groundY);
        st.cachedSurface = this.ground.getSurface(this.p.x, this.p.z);
        st.cacheX = this.p.x;
        st.cacheZ = this.p.z;
      }
      this.n.copy(st.cachedNormal);
      phys.pointVelocityWorld(this.p, this.pv);
      const vn = this.pv.dot(this.n);
      const compression = depth * this.n.y;
      let fn = this.springK[i] * compression - this.springC[i] * vn;
      if (compression > g.travelM) fn += this.springK[i] * BUMP_STOP_STIFFNESS * (compression - g.travelM) - this.springC[i] * 2 * vn;
      fn = Math.max(0, fn);
      st.contact = true;
      st.compressionM = compression;
      st.loadN = fn;
      sum.wheelsOnGround++;
      anyContact = true;
      sum.maxSinkMs = Math.max(sum.maxSinkMs, -vn);
      sum.peakLoadN = Math.max(sum.peakLoadN, fn);

      // Tyre frame: rolling direction = (steered) heading projected on the ground plane.
      this.roll.copy(this.fwd).applyAxisAngle(this.up, -steer);
      this.roll.addScaledVector(this.n, -this.roll.dot(this.n)).normalize();
      this.side.crossVectors(this.n, this.roll);
      const vRoll = this.pv.dot(this.roll);
      const vSide = this.pv.dot(this.side);
      const surf = st.cachedSurface;
      const mu = g.tyreMu * surf.brakingGripDry;
      const limit = mu * fn;

      let fLong = -g.rollingResistance * surf.rollingResistance * input.damagePenalty * fn * smoothSign(vRoll, 0.4);
      let braking = 0;
      if (w.braked && input.brake > 0) {
        const diff = w.position[0] > 0 ? 1 - 0.7 * input.yaw : 1 + 0.7 * input.yaw; // +X = left wheel
        braking = Math.max(0, Math.min(1, input.brake * diff)) / input.damagePenalty;
        fLong -= braking * limit * smoothSign(vRoll, 0.5);
      }
      let fSide = -limit * Math.tanh(vSide / (0.15 * Math.max(Math.abs(vRoll), 2)));
      // Friction circle.
      const demand = Math.hypot(fLong, fSide);
      let skid = false;
      if (demand > limit && limit > 0) {
        const k = limit / demand;
        fLong *= k;
        fSide *= k;
        skid = true;
      }
      st.longForceN = fLong;
      st.latForceN = fSide;
      st.slipSpeedMs = Math.abs(vSide);
      st.mode = skid ? 'skidding' : braking > 0.05 ? 'braking' : 'rolling';

      this.f.copy(this.n).multiplyScalar(fn).addScaledVector(this.roll, fLong).addScaledVector(this.side, fSide);
      st.force.copy(this.f);
      phys.addWorldForceAtPoint(this.f, this.p);
    }
    sum.touchedDown = anyContact && !this.wasInContact;
    this.wasInContact = anyContact;
    return sum;
  }

  /** Terrain normal from a small finite difference (only evaluated for touching points). */
  terrainNormal(x: number, z: number, out: THREE.Vector3, hHere: number): THREE.Vector3 {
    const e = 0.75;
    const hx = this.ground.getElevation(x + e, z) - hHere;
    const hz = this.ground.getElevation(x, z + e) - hHere;
    return out.set(-hx / e, 1, -hz / e).normalize();
  }
}

const smoothSign = (v: number, width: number) => Math.tanh(v / width);

/** Static load share per wheel from vertical, pitch and roll moment balance about the CG. */
export function wheelShares(def: GearDefinition, cg: [number, number, number]): number[] {
  const w = def.wheels;
  if (w.length !== 3) return w.map(() => 1 / w.length);
  // Solve  sum(s) = 1,  sum(s x) = cg.x,  sum(s z) = cg.z  for shares s (Cramer's rule).
  const a = w.map((wh) => [1, wh.position[0], wh.position[2]]);
  const b = [1, cg[0], cg[2]];
  const det3 = (m: number[][]) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  // Matrix rows = equations, columns = wheels.
  const M = [0, 1, 2].map((r) => [a[0][r], a[1][r], a[2][r]]);
  const d = det3(M);
  if (Math.abs(d) < 1e-9) return w.map(() => 1 / 3);
  return [0, 1, 2].map((c) => {
    const Mc = M.map((row, r) => row.map((v, col) => (col === c ? b[r] : v)));
    return Math.max(0.02, det3(Mc) / d);
  });
}
