// Presentation rig for the Aerofox Kestrel 2 starter (A0): hinged control surfaces, propeller and
// landing gear. The pivots are baked into aerofox_kestrel2.glb at the modeled hinge lines and axles
// (tools/a0/split_a0.mjs); this file only moves them. Input is the flight model's resolved surface targets, so keyboard, touch and gamepad
// all animate through the same control path the physics uses.

import * as THREE from 'three';
import type { SurfaceDeflections } from '../flight/core/aircraftPhysics';
import { DEG } from '../flight/core/constants';

export const A0_NODES = {
  aileronL: 'aileron_L_pivot', aileronR: 'aileron_R_pivot', elevator: 'elevator_pivot', rudder: 'rudder_pivot', propeller: 'propeller_pivot',
  wheelNose: 'wheel_nose_pivot', noseSteer: 'nose_steer', wheelLeft: 'wheel_L_pivot', wheelRight: 'wheel_R_pivot', strutLeft: 'wheel_L_strut', strutRight: 'wheel_R_strut',
  flapL: 'flap_L_pivot', flapR: 'flap_R_pivot',
  engineMount: 'engine_mount', cablesLeft: 'cables_L_mount', cablesRight: 'cables_R_mount',
} as const;

/** Model -> body-frame placement of the A0 GLB. The GLB is authored in model units with its origin on
 * the ground under the wing; the offset puts the drawn tyres exactly on the physics contact points of
 * the starter's gear (flight/aircraft/quicksilver.ts) at zero compression. */
export const A0_PLACEMENT = { scale: 5.24, offset: new THREE.Vector3(0, -1.273, -1.054) } as const;
/** Drawn tyre radii in metres (the physics contact is the tyre's bottom point). */
export const A0_WHEEL_RADIUS_M = { nose: 0.18, main: 0.2 } as const;

/** Per-tick gear pose from the simulation: compression per wheel in definition order (nose, mainL, mainR). */
export interface GearPose { compressionM: readonly number[]; steerRad: number }

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
const AXIS_Y = new THREE.Vector3(0, 1, 0);

export interface PivotAngles { aileronL: number; aileronR: number; elevator: number; rudder: number; flapL: number; flapR: number }

/**
 * Flight-model deflections (lift-positive: trailing edge down / nose-right rudder) -> pivot rotation.x.
 * The pivots' local +X is the hinge axis and rotating +X lifts the trailing edge, hence the negation on the
 * horizontal surfaces; the rudder pivot's +X axis is world-up, so its sign is direct. Body +X is the LEFT wing.
 */
export function pivotAngles(d: SurfaceDeflections, out: PivotAngles = { aileronL: 0, aileronR: 0, elevator: 0, rudder: 0, flapL: 0, flapR: 0 }): PivotAngles {
  const c = (v: number) => Math.max(-VISUAL_LIMIT_RAD, Math.min(VISUAL_LIMIT_RAD, v));
  out.aileronL = -c(d.aileronLeft) || 0;
  out.aileronR = -c(d.aileronRight) || 0;
  out.elevator = -c(d.elevator) || 0;
  out.rudder = c(d.rudder) || 0;
  out.flapL = out.flapR = -c(d.flaps ?? 0) || 0;
  return out;
}

export const damp = (current: number, target: number, response: number, dtS: number) =>
  (Number.isFinite(target) ? target : 0) + ((Number.isFinite(current) ? current : 0) - (Number.isFinite(target) ? target : 0)) * Math.exp(-Math.max(0, Number.isFinite(response) ? response : 0) * Math.min(0.1, Math.max(0, Number.isFinite(dtS) ? dtS : 0)));

const smoothstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export interface PropellerVisual { omegaRadS: number; bladeOpacity: number; discOpacity: number }
/** Stopped: still blades. Low rpm: turning, fully drawn blades. High rpm: blades fade into a translucent disc. */
export function propellerVisual(rpm: number, out: PropellerVisual = { omegaRadS: 0, bladeOpacity: 1, discOpacity: 0 }): PropellerVisual {
  return propellerVisualWithRatio(rpm, 2.3, out);
}

export function propellerVisualWithRatio(rpm: number, gearRatio: number, out: PropellerVisual = { omegaRadS: 0, bladeOpacity: 1, discOpacity: 0 }): PropellerVisual {
  const propRpm = Math.max(0, Number.isFinite(rpm) ? rpm : 0) / Math.max(1, Number.isFinite(gearRatio) ? gearRatio : 2.3);
  // Cap visible blade travel to avoid frame-to-frame aliasing; at high shaft speed
  // the translucent disc carries the motion cue and the blades fade out.
  out.omegaRadS = propRpm < 40 ? 0 : Math.min(55, propRpm * Math.PI * 2 / 60);
  const blur = smoothstep(1100, 1750, propRpm);
  out.bladeOpacity = 1 - 0.85 * blur;
  out.discOpacity = 0.3 * blur;
  return out;
}

const PROP_RADIUS = 0.145; // model units, matches the blade tips

export class AircraftRig {
  private readonly angles: PivotAngles = { aileronL: 0, aileronR: 0, elevator: 0, rudder: 0, flapL: 0, flapR: 0 };
  private readonly target: PivotAngles = { aileronL: 0, aileronR: 0, elevator: 0, rudder: 0, flapL: 0, flapR: 0 };
  private readonly prop: PropellerVisual = { omegaRadS: 0, bladeOpacity: 1, discOpacity: 0 };
  private rpm = 0;
  private spin = 0;
  private wheelSpin = 0;
  private vibrationPhase = 0;
  private readonly base: Record<keyof typeof A0_NODES, THREE.Quaternion>;
  private readonly basePositions: Record<'engineMount' | 'cablesLeft' | 'cablesRight' | 'noseSteer' | 'strutLeft' | 'strutRight', THREE.Vector3>;
  private readonly modelScale: number;
  private wheelRadiusM: number = A0_WHEEL_RADIUS_M.main;
  /** White tail strobe (Nightjar): double flash every 1.2 s. */
  private strobe: THREE.Object3D | null = null;
  private strobeT = 0;
  private readonly bladeMaterials: THREE.Material[] = [];

  private readonly pivots: Record<keyof typeof A0_NODES, THREE.Object3D>;
  private readonly optional: boolean;
  private readonly disc: THREE.Mesh;

  private constructor(pivots: Record<keyof typeof A0_NODES, THREE.Object3D>, disc: THREE.Mesh, optional = false) {
    this.pivots = pivots;
    this.optional = optional;
    this.disc = disc;
    this.base = Object.fromEntries(Object.entries(pivots).map(([k, n]) => [k, n.quaternion.clone()])) as typeof this.base;
    this.basePositions = {
      engineMount: pivots.engineMount.position.clone(), cablesLeft: pivots.cablesLeft.position.clone(), cablesRight: pivots.cablesRight.position.clone(),
      noseSteer: pivots.noseSteer.position.clone(), strutLeft: pivots.strutLeft.position.clone(), strutRight: pivots.strutRight.position.clone(),
    };
    this.modelScale = optional ? 1 : A0_PLACEMENT.scale;
  }

  /** Throws when a required node is missing: a silently frozen control surface is a bug, not a fallback. */
  static attach(root: THREE.Object3D, mode: 'a0' | 'nightjar' | 'zenith' = 'a0'): AircraftRig {
    const pivots = {} as Record<keyof typeof A0_NODES, THREE.Object3D>;
    const resolveName: Record<keyof typeof A0_NODES, string> = mode === 'nightjar' ? {
      ...A0_NODES, noseSteer: 'nose_steer_pivot', cablesLeft: 'nightjar_cable_L', cablesRight: 'nightjar_cable_R',
    } : mode === 'zenith' ? { ...A0_NODES, flapL: 'flap_L_pivot', flapR: 'flap_R_pivot' } : A0_NODES;
    for (const key of Object.keys(A0_NODES) as Array<keyof typeof A0_NODES>) {
      const actual = resolveName[key];
      const node = root.getObjectByName(actual);
      if (!node && (key === 'flapL' || key === 'flapR')) {
        const anchor = new THREE.Group(); anchor.name = actual; root.add(anchor); pivots[key] = anchor;
        continue;
      }
      if (!node && mode !== 'a0' && (key === 'noseSteer' || key === 'strutLeft' || key === 'strutRight' || key === 'engineMount' || key === 'cablesLeft' || key === 'cablesRight')) {
        const anchor = new THREE.Group(); anchor.name = actual; root.add(anchor); pivots[key] = anchor;
        continue;
      }
      if (!node) throw new Error(`Aircraft asset is missing required node "${actual}"`);
      pivots[key] = node;
    }
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(mode === 'nightjar' ? 0.685 : mode === 'zenith' ? 0.88 : PROP_RADIUS, 28),
      new THREE.MeshBasicMaterial({ color: '#e9e3d5', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
    );
    disc.visible = false;
    disc.name = 'propeller_disc';
    pivots.propeller.add(disc);
    const rig = new AircraftRig(pivots, disc, mode !== 'a0');
    rig.wheelRadiusM = mode === 'nightjar' ? 0.238 : mode === 'zenith' ? 0.35 : A0_WHEEL_RADIUS_M.main;
    rig.strobe = root.getObjectByName('strobe_tail') ?? null;
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
  update(target: SurfaceDeflections, rpm: number, dtS: number, groundSpeedMs = 0, onGround = false, gearRatio = 2.3, gear?: GearPose): void {
    dtS = Math.max(0, Math.min(0.1, Number.isFinite(dtS) ? dtS : 0));
    rpm = Math.max(0, Number.isFinite(rpm) ? rpm : 0);
    groundSpeedMs = Number.isFinite(groundSpeedMs) ? groundSpeedMs : 0;
    pivotAngles(target, this.target);
    const a = this.angles, t = this.target;
    a.aileronL = damp(a.aileronL, t.aileronL, SURFACE_RESPONSE, dtS);
    a.aileronR = damp(a.aileronR, t.aileronR, SURFACE_RESPONSE, dtS);
    a.elevator = damp(a.elevator, t.elevator, SURFACE_RESPONSE, dtS);
    a.rudder = damp(a.rudder, t.rudder, SURFACE_RESPONSE, dtS);
    a.flapL = damp(a.flapL, t.flapL, SURFACE_RESPONSE, dtS);
    a.flapR = damp(a.flapR, t.flapR, SURFACE_RESPONSE, dtS);
    const p = this.pivots;
    const b = this.base;
    hingeQuaternion(b.aileronL, a.aileronL, AXIS_X, p.aileronL.quaternion);
    hingeQuaternion(b.aileronR, a.aileronR, AXIS_X, p.aileronR.quaternion);
    hingeQuaternion(b.elevator, a.elevator, AXIS_X, p.elevator.quaternion);
    hingeQuaternion(b.rudder, a.rudder, this.optional ? AXIS_Y : AXIS_X, p.rudder.quaternion);
    hingeQuaternion(b.flapL, a.flapL, AXIS_X, p.flapL.quaternion);
    hingeQuaternion(b.flapR, a.flapR, AXIS_X, p.flapR.quaternion);

    this.rpm = damp(this.rpm, rpm, 8, dtS);
    const v = propellerVisualWithRatio(this.rpm, gearRatio, this.prop);
    this.spin = (this.spin + v.omegaRadS * dtS) % (Math.PI * 2);
    hingeQuaternion(b.propeller, this.spin, AXIS_Z, p.propeller.quaternion);
    for (const m of this.bladeMaterials) { m.opacity = v.bladeOpacity; m.depthWrite = v.bladeOpacity > 0.5; }
    (this.disc.material as THREE.MeshBasicMaterial).opacity = v.discOpacity;
    this.disc.visible = v.discOpacity > 0.01;

    // The three wheel meshes are independent, and roll only while the tyres carry load.
    // Rolling is ground speed over the drawn main-tyre radius, so the tread does not slip visually.
    const wheelOmega = onGround ? groundSpeedMs / this.wheelRadiusM : 0;
    this.wheelSpin = (this.wheelSpin + wheelOmega * dtS) % (Math.PI * 2);
    for (const key of ['wheelNose', 'wheelLeft', 'wheelRight'] as const) {
      hingeQuaternion(b[key], this.wheelSpin, AXIS_X, p[key].quaternion);
    }
    if (gear) {
      // Struts follow the simulated compression (metres -> model units) so the tyre bottom stays on the
      // ground the physics sees; the nose fork turns with the simulated steering angle.
      const lift = (i: number) => Math.min(0.3, Math.max(0, Number.isFinite(gear.compressionM[i]) ? gear.compressionM[i] : 0)) / this.modelScale;
      p.noseSteer.position.copy(this.basePositions.noseSteer).setY(this.basePositions.noseSteer.y + lift(0));
      p.strutLeft.position.copy(this.basePositions.strutLeft).setY(this.basePositions.strutLeft.y + lift(1));
      p.strutRight.position.copy(this.basePositions.strutRight).setY(this.basePositions.strutRight.y + lift(2));
      hingeQuaternion(b.noseSteer, Number.isFinite(gear.steerRad) ? -gear.steerRad : 0, AXIS_Y, p.noseSteer.quaternion);
    }

    if (this.strobe) {
      this.strobeT = (this.strobeT + dtS) % 1.2;
      this.strobe.visible = this.strobeT < 0.06 || (this.strobeT > 0.16 && this.strobeT < 0.22);
    }

    // Small, filtered engine/cable motion sells the open-frame ultralight structure.
    // Amplitudes stay below a centimetre after the A0's six-times model scale.
    this.vibrationPhase = (this.vibrationPhase + (18 + this.rpm * 0.035) * dtS) % (Math.PI * 2);
    const vib = Math.sin(this.vibrationPhase) * Math.min(0.0014, this.rpm / 5000 * 0.0014);
    if (!this.optional) {
      p.engineMount.position.copy(this.basePositions.engineMount).add(ENGINE_VIBRATION.set(vib * 0.45, vib, 0));
      const cableFlex = Math.sin(this.vibrationPhase * 0.71) * Math.min(0.002, 0.0002 + Math.abs(groundSpeedMs) * 0.000025);
      p.cablesLeft.rotation.z = cableFlex;
      p.cablesRight.rotation.z = -cableFlex;
    }
  }
}

const ENGINE_VIBRATION = new THREE.Vector3();
