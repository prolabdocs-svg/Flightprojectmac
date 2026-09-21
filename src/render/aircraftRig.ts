// Presentation rig for the A0 hero aircraft: hinged control surfaces and the propeller. The pivots are
// baked into pf_aircraft_ultralight.glb at the real hinge lines (tools/a0/split_a0.mjs); this file only
// rotates them. Input is the flight model's resolved surface targets, so keyboard, touch and gamepad
// all animate through the same control path the physics uses.

import * as THREE from 'three';
import type { SurfaceDeflections } from '../flight/core/aircraftPhysics';
import { DEG } from '../flight/core/constants';

export const A0_NODES = {
  aileronL: 'aileron_L_pivot', aileronR: 'aileron_R_pivot', elevator: 'elevator_pivot', rudder: 'rudder_pivot', propeller: 'propeller_pivot',
} as const;

/** Mechanical stop for the drawn surfaces (the model's hinge geometry is clean up to this). */
export const VISUAL_LIMIT_RAD = 25 * DEG;
/** 1/s. Fast exponential approach: ~35 ms time constant, no overshoot, frame-rate independent. */
export const SURFACE_RESPONSE = 28;

/** Pivot rotation about its own hinge axis (local +X), composed onto the orientation baked into the asset. */
export function hingeQuaternion(base: THREE.Quaternion, angle: number, axis: THREE.Vector3, out: THREE.Quaternion): THREE.Quaternion {
  return out.copy(base).multiply(HINGE_TMP.setFromAxisAngle(axis, angle));
}
const HINGE_TMP = new THREE.Quaternion();
const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);

export interface PivotAngles { aileronL: number; aileronR: number; elevator: number; rudder: number }

/**
 * Flight-model deflections (lift-positive: trailing edge down / nose-right rudder) -> pivot rotation.x.
 * The pivots' local +X is the hinge axis and rotating +X lifts the trailing edge, hence the negation on the
 * horizontal surfaces; the rudder pivot's +X axis is world-up, so its sign is direct. Body +X is the LEFT wing.
 */
export function pivotAngles(d: SurfaceDeflections, out: PivotAngles = { aileronL: 0, aileronR: 0, elevator: 0, rudder: 0 }): PivotAngles {
  const c = (v: number) => Math.max(-VISUAL_LIMIT_RAD, Math.min(VISUAL_LIMIT_RAD, v));
  out.aileronL = -c(d.aileronLeft) || 0;
  out.aileronR = -c(d.aileronRight) || 0;
  out.elevator = -c(d.elevator) || 0;
  out.rudder = c(d.rudder) || 0;
  return out;
}

export const damp = (current: number, target: number, response: number, dtS: number) =>
  target + (current - target) * Math.exp(-response * Math.max(0, dtS));

const smoothstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export interface PropellerVisual { omegaRadS: number; bladeOpacity: number; discOpacity: number }
/** Stopped: still blades. Low rpm: turning, fully drawn blades. High rpm: blades fade into a translucent disc. */
export function propellerVisual(rpm: number, out: PropellerVisual = { omegaRadS: 0, bladeOpacity: 1, discOpacity: 0 }): PropellerVisual {
  out.omegaRadS = rpm < 40 ? 0 : Math.min(rpm * 0.03, 55); // capped so a 60 Hz frame never turns the blades past ~50 degrees
  const blur = smoothstep(1700, 3000, rpm);
  out.bladeOpacity = 1 - 0.85 * blur;
  out.discOpacity = 0.3 * blur;
  return out;
}

const PROP_RADIUS = 0.145; // model units, matches the blade tips

export class AircraftRig {
  private readonly angles: PivotAngles = { aileronL: 0, aileronR: 0, elevator: 0, rudder: 0 };
  private readonly target: PivotAngles = { aileronL: 0, aileronR: 0, elevator: 0, rudder: 0 };
  private readonly prop: PropellerVisual = { omegaRadS: 0, bladeOpacity: 1, discOpacity: 0 };
  private rpm = 0;
  private spin = 0;
  private readonly base: Record<keyof typeof A0_NODES, THREE.Quaternion>;
  private readonly bladeMaterials: THREE.Material[] = [];

  private readonly pivots: Record<keyof typeof A0_NODES, THREE.Object3D>;
  private readonly disc: THREE.Mesh;

  private constructor(pivots: Record<keyof typeof A0_NODES, THREE.Object3D>, disc: THREE.Mesh) {
    this.pivots = pivots;
    this.disc = disc;
    this.base = Object.fromEntries(Object.entries(pivots).map(([k, n]) => [k, n.quaternion.clone()])) as typeof this.base;
  }

  /** Throws when a required node is missing: a silently frozen control surface is a bug, not a fallback. */
  static attach(root: THREE.Object3D): AircraftRig {
    const pivots = {} as Record<keyof typeof A0_NODES, THREE.Object3D>;
    for (const [key, name] of Object.entries(A0_NODES)) {
      const node = root.getObjectByName(name);
      if (!node) throw new Error(`A0 asset is missing required node "${name}"`);
      pivots[key as keyof typeof A0_NODES] = node;
    }
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(PROP_RADIUS, 28),
      new THREE.MeshBasicMaterial({ color: '#e9e3d5', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
    );
    disc.visible = false;
    disc.name = 'propeller_disc';
    pivots.propeller.add(disc);
    const rig = new AircraftRig(pivots, disc);
    // The loader shares materials between clones; fade a private copy of the blade material.
    pivots.propeller.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && mesh !== disc) {
        const blade = (mesh.material as THREE.Material).clone();
        blade.transparent = true; // fixed for life: flipping it later would need a shader rebuild
        mesh.material = blade;
        rig.bladeMaterials.push(blade);
      }
    });
    return rig;
  }

  /** `target` is the flight model's mixer output for this tick; `rpm` the engine telemetry. */
  update(target: SurfaceDeflections, rpm: number, dtS: number): void {
    pivotAngles(target, this.target);
    const a = this.angles, t = this.target;
    a.aileronL = damp(a.aileronL, t.aileronL, SURFACE_RESPONSE, dtS);
    a.aileronR = damp(a.aileronR, t.aileronR, SURFACE_RESPONSE, dtS);
    a.elevator = damp(a.elevator, t.elevator, SURFACE_RESPONSE, dtS);
    a.rudder = damp(a.rudder, t.rudder, SURFACE_RESPONSE, dtS);
    const p = this.pivots;
    const b = this.base;
    hingeQuaternion(b.aileronL, a.aileronL, AXIS_X, p.aileronL.quaternion);
    hingeQuaternion(b.aileronR, a.aileronR, AXIS_X, p.aileronR.quaternion);
    hingeQuaternion(b.elevator, a.elevator, AXIS_X, p.elevator.quaternion);
    hingeQuaternion(b.rudder, a.rudder, AXIS_X, p.rudder.quaternion);

    this.rpm = damp(this.rpm, rpm, 8, dtS);
    const v = propellerVisual(this.rpm, this.prop);
    this.spin = (this.spin + v.omegaRadS * dtS) % (Math.PI * 2);
    hingeQuaternion(b.propeller, this.spin, AXIS_Z, p.propeller.quaternion);
    for (const m of this.bladeMaterials) { m.opacity = v.bladeOpacity; m.depthWrite = v.bladeOpacity > 0.5; }
    (this.disc.material as THREE.MeshBasicMaterial).opacity = v.discOpacity;
    this.disc.visible = v.discOpacity > 0.01;
  }
}
