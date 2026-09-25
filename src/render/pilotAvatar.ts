// The player's physical avatar: a low-poly stylised human built from primitives (no skinning, no
// texture) so every appearance slot is a colour or a swap of a few meshes. Faces +Z, +Y up, body +X is
// the LEFT side (same axes as the airframes). Origin = pelvis / seat point, metres at scale 1.
//
// Limbs are two-bone IK chains solved each frame toward hand/foot targets (stick, throttle, pedals or
// resting at the sides), so the pose adapts to whatever cockpit it is seated in. A second, single-draw-call
// silhouette takes over past LOD_FAR_M.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AvatarAppearance } from '../avatar/appearance';

/** Head, hair, headwear and face live on this layer so the cockpit camera can drop them (camera sits inside the head) while shadows keep them. */
export const PILOT_HEAD_LAYER = 5;
export const LOD_FAR_M = 30;

export type AvatarPose = 'standing' | 'seated'; // ponytail: add 'walking' (leg phase driver) when on-foot gameplay exists

export interface PilotDrive {
  pitch: number; roll: number; yaw: number; throttle: number;
  /** Normal load factor (1 = level flight): its fluctuation is the turbulence/bump input. */
  gForce: number;
  /** Extra head yaw (e.g. camera free-look), radians. */
  lookYaw?: number;
}

const UPPER_ARM = 0.28, FOREARM = 0.26, THIGH = 0.44, SHIN = 0.43;
const SHOULDER = new THREE.Vector3(0.2, 0.46, 0); // spine-local, mirrored in x
const HIP_X = 0.1;
const SPINE_Y = 0.08, NECK_Y = 0.52;
/** Slightly oversized head: reads at distance and keeps the face away from realistic proportions (no uncanny valley). */
const HEAD_SCALE = 1.18;
/** Eye point in avatar space (seated, neutral) — the cockpit camera position. */
export const EYE_LOCAL = new THREE.Vector3(0, SPINE_Y + NECK_Y + 0.155 * HEAD_SCALE, 0.12);

const DOWN = new THREE.Vector3(0, -1, 0), UP = new THREE.Vector3(0, 1, 0), RIGHT = new THREE.Vector3(1, 0, 0);
const SPINE_BASE = new THREE.Vector3(0, SPINE_Y, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();

/** Two-bone IK: joint position for a chain root->target with bone lengths l1,l2, bending toward `pole`. Returns the (reach-clamped) end point in `end`. */
export function solveTwoBone(root: THREE.Vector3, target: THREE.Vector3, l1: number, l2: number, pole: THREE.Vector3, joint: THREE.Vector3, end: THREE.Vector3) {
  const dir = _a.subVectors(target, root);
  const len = dir.length() || 1e-6;
  dir.divideScalar(len);
  const d = THREE.MathUtils.clamp(len, Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3);
  end.copy(root).addScaledVector(dir, d);
  const x = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  const bend = _b.copy(pole).addScaledVector(dir, -pole.dot(dir));
  if (bend.lengthSq() < 1e-8) bend.set(0, 1, 0).addScaledVector(dir, -dir.y);
  bend.normalize();
  return joint.copy(root).addScaledVector(dir, x).addScaledVector(bend, h);
}

type Limb = { upper: THREE.Object3D; lower: THREE.Object3D; end: THREE.Object3D; alignEnd: boolean };

export class PilotAvatar {
  readonly root = new THREE.Group();
  private readonly lod = new THREE.LOD();
  private readonly full = new THREE.Group();
  private readonly spine = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly eyes: THREE.Object3D[] = [];
  private readonly arms: [Limb, Limb];
  private readonly legs: [Limb, Limb];
  private readonly mats = new Map<string, THREE.MeshStandardMaterial>();
  private readonly geos: THREE.BufferGeometry[] = [];
  private pose: AvatarPose = 'seated';
  // Hand/foot anchors in avatar space; the cockpit can override the stick grip.
  readonly stickGrip = new THREE.Vector3(-0.05, 0.3, 0.38);
  readonly throttleGrip = new THREE.Vector3(0.3, 0.22, 0.2);
  /** Forward torso lean (rad) so a far stick stays in reach; set by seatAvatar. */
  reachLean = 0;
  // Body dynamics: spring-damped torso offset driven by load-factor changes and impacts.
  private readonly bob = new THREE.Vector3();
  private readonly bobVel = new THREE.Vector3();
  private gAvg = 1;
  private t = Math.random() * 10;
  private nextBlink = 2;
  private smooth = { pitch: 0, roll: 0, yaw: 0, throttle: 0, look: 0 };

  readonly appearance: AvatarAppearance;

  constructor(appearance: AvatarAppearance) {
    this.appearance = appearance;
    const a = appearance;
    const skin = this.mat(a.skinTone, false);
    const top = this.mat(a.topColor), bottoms = this.mat(a.bottomsColor), hair = this.mat(a.hairColor);
    const shoe = this.mat(a.shoes === 'boots' || a.shoes === 'work_boots' ? '#3a2a1e' : a.shoes === 'aviation' ? '#5c5142' : '#e8e6e0');
    const dark = this.mat('#1c1f22');
    const sleeveLong = !['tshirt', 'polo'].includes(a.top);

    // Pelvis + torso
    this.add(this.full, this.box(0.34, 0.16, 0.22, bottoms), 0, 0.04, 0);
    this.spine.position.y = SPINE_Y;
    this.full.add(this.spine);
    this.add(this.spine, this.box(0.36, 0.3, 0.21, top), 0, 0.3, 0);   // chest
    this.add(this.spine, this.box(0.32, 0.18, 0.19, top), 0, 0.08, 0);  // belly
    if (['jacket', 'bomber', 'shirt', 'overalls'].includes(a.top)) {
      this.add(this.spine, this.box(0.02, 0.4, 0.01, this.mat('#c9c3b4')), 0, 0.22, 0.108); // zip
      this.add(this.spine, this.box(0.3, 0.07, 0.24, this.mat(shade(a.topColor, 0.75))), 0, 0.47, -0.01); // collar
    }
    if (a.top === 'bomber') {
      this.add(this.spine, this.box(0.38, 0.035, 0.23, this.mat(shade(a.topColor, 0.72))), 0, 0.08, 0);
      this.add(this.spine, this.box(0.38, 0.035, 0.23, this.mat(shade(a.topColor, 0.72))), 0, 0.49, 0);
    } else if (a.top === 'overalls') {
      for (const side of [-1, 1]) this.add(this.spine, this.box(0.045, 0.29, 0.035, this.mat(shade(a.topColor, 0.78))), side * 0.1, 0.32, 0.105);
    } else if (a.top === 'hoodie') {
      this.add(this.spine, this.box(0.28, 0.12, 0.1, this.mat(shade(a.topColor, 0.8))), 0, 0.5, -0.12); // hood
      this.add(this.spine, this.box(0.22, 0.09, 0.02, this.mat(shade(a.topColor, 0.85))), 0, 0.1, 0.105); // pocket
    } else if (a.top === 'polo') {
      this.add(this.spine, this.box(0.035, 0.11, 0.015, this.mat('#e9e4d8')), 0, 0.43, 0.11);
    }
    this.add(this.spine, this.cyl(0.05, 0.08, skin), 0, NECK_Y - 0.02, 0);
    if (a.accessory === 'scarf') this.add(this.spine, this.torus(0.075, 0.03, this.mat(a.headwearColor)), 0, NECK_Y - 0.02, 0, Math.PI / 2);

    // Head
    this.head.position.y = NECK_Y;
    this.head.scale.setScalar(HEAD_SCALE);
    this.spine.add(this.head);
    this.buildHead(skin, hair, dark);

    // Limbs: upper segment spans its own -Y from the joint; `end` is the hand/foot.
    const mkArm = (): Limb => {
      const upper = this.seg(0.052, UPPER_ARM, top);
      this.add(upper, this.sphere(0.068, top, 1, 1, 1, 8, 6), 0, -0.01, 0); // shoulder cap
      const lower = this.seg(0.044, FOREARM, sleeveLong ? top : skin);
      const end = new THREE.Group();
      this.full.add(end);
      this.add(end, this.box(0.075, 0.09, 0.04, skin), 0, -0.035, 0);
      return { upper, lower, end, alignEnd: true };
    };
    const mkLeg = (): Limb => {
      const shorts = a.bottoms === 'shorts';
      const upper = this.seg(0.078, THIGH, bottoms);
      const lower = this.seg(0.062, SHIN, shorts ? skin : bottoms);
      if (a.bottoms === 'cargo' || a.bottoms === 'work' || a.bottoms === 'flight') this.add(upper, this.box(0.05, 0.1, 0.1, this.mat(shade(a.bottomsColor, 0.8))), 0.07, -THIGH * 0.55, 0);
      const end = new THREE.Group();
      this.full.add(end);
      this.add(end, this.box(0.11, ['boots', 'work_boots', 'aviation'].includes(a.shoes) ? 0.12 : 0.08, 0.26, shoe), 0, -0.02, 0.07);
      if (a.shoes === 'sneakers') this.add(end, this.box(0.115, 0.025, 0.27, this.mat(a.topColor)), 0, -0.055, 0.07);
      return { upper, lower, end, alignEnd: false };
    };
    this.arms = [mkArm(), mkArm()];
    this.legs = [mkLeg(), mkLeg()];

    this.full.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = false; } });
    this.head.traverse((o) => o.layers.set(PILOT_HEAD_LAYER));
    this.lod.addLevel(this.full, 0);
    this.lod.addLevel(this.buildLowLod(), LOD_FAR_M);
    this.root.add(this.lod);
    this.root.name = 'pilot_avatar';
    this.setPose('seated');
  }

  setPose(pose: AvatarPose) { this.pose = pose; this.update(null, 0); }

  /** A short shove (impact, hard landing). magnitude ~ 0..0.6 like the camera shake. */
  jolt(magnitude: number) {
    const m = Math.min(1, Math.max(0, magnitude)) * 1.6;
    this.bobVel.x += (Math.random() - 0.5) * m;
    this.bobVel.y -= m;
    this.bobVel.z += m * 0.6;
  }

  update(drive: PilotDrive | null, dtS: number) {
    const dt = Math.min(0.1, Math.max(0, dtS));
    this.t += dt;
    const s = this.smooth, k = 1 - Math.exp(-12 * dt);
    if (drive) {
      s.pitch += (drive.pitch - s.pitch) * k; s.roll += (drive.roll - s.roll) * k;
      s.yaw += (drive.yaw - s.yaw) * k; s.throttle += (drive.throttle - s.throttle) * k;
      s.look += ((drive.lookYaw ?? 0) - s.look) * (1 - Math.exp(-4 * dt));
      // Turbulence: the fast part of the load factor pushes the torso; sustained g slumps it.
      const g = Number.isFinite(drive.gForce) ? drive.gForce : 1;
      this.gAvg += (g - this.gAvg) * (1 - Math.exp(-3 * dt));
      this.bobVel.y -= (g - this.gAvg) * 9.81 * dt * 0.6;
    }
    // Spring back to rest (critically-ish damped), clamped so the body never leaves the seat.
    this.bobVel.addScaledVector(this.bob, -160 * dt).multiplyScalar(Math.exp(-14 * dt));
    this.bob.addScaledVector(this.bobVel, dt).clampScalar(-0.045, 0.045);

    const seated = this.pose === 'seated';
    const breathe = Math.sin(this.t * 1.7) * 0.006;
    const slump = seated ? THREE.MathUtils.clamp((this.gAvg - 1) * -0.02, -0.03, 0.01) : 0;
    this.spine.position.set(this.bob.x, SPINE_Y + breathe + this.bob.y + slump, this.bob.z);
    this.spine.rotation.set(seated ? -0.08 + this.reachLean + this.bob.z * 2 : 0.02, s.roll * 0.08, -s.roll * 0.06 + this.bob.x * 2);

    // Head: leans into the turn, glances around when idle, lags body jolts.
    const glance = Math.sin(this.t * 0.37) * Math.sin(this.t * 0.13) * (seated ? 0.35 : 0.5);
    this.head.rotation.set(-s.pitch * 0.12 - this.bobVel.y * 0.08 + (seated ? 0.05 : 0), THREE.MathUtils.clamp(s.roll * 0.45 + s.yaw * 0.25 + s.look + glance * (1 - Math.min(1, Math.abs(s.roll) * 3)), -1.3, 1.3), s.roll * 0.12);
    if (this.t > this.nextBlink) this.nextBlink = this.t + 2.5 + Math.random() * 3;
    const blink = this.nextBlink - this.t > 0.12 ? 1 : 0.15;
    for (const e of this.eyes) e.scale.y = blink;

    this.spine.updateMatrix();
    const pole = _c;
    for (const [i, arm] of this.arms.entries()) {
      const side = i === 0 ? 1 : -1; // 0 = left (+X)
      const shoulder = _d.set(SHOULDER.x * side, SHOULDER.y, SHOULDER.z).applyMatrix4(this.spine.matrix);
      const target = new THREE.Vector3();
      if (seated && side < 0) target.copy(this.stickGrip).add(_b.set(-s.roll * 0.07, -s.pitch * 0.03, -s.pitch * 0.07));
      else if (seated) target.copy(this.throttleGrip).add(_b.set(0, 0, s.throttle * 0.1 - 0.05));
      else target.set(0.27 * side, 0.05 + Math.sin(this.t * 1.7) * 0.004, 0.03);
      this.solveLimb(arm, shoulder, target, UPPER_ARM, FOREARM, pole.set(side * 0.8, -0.6, -0.8));
    }
    for (const [i, leg] of this.legs.entries()) {
      const side = i === 0 ? 1 : -1;
      const hip = _d.set(HIP_X * side, 0, 0.03);
      // Rudder: positive yaw pushes the right pedal (-X) forward.
      const target = seated ? new THREE.Vector3(0.13 * side, -0.42, 0.66 + s.yaw * 0.06 * -side) : new THREE.Vector3(0.1 * side, -0.85, 0.02);
      this.solveLimb(leg, hip, target, THIGH, SHIN, pole.set(0, seated ? 1 : 0, 1));
      leg.end.rotation.set(seated ? -0.25 : 0, 0, 0);
    }
  }

  /** Avatar-space eye point for the current seat (not animated, so the cockpit view stays steady). */
  eyePosition(out = new THREE.Vector3()) { return out.copy(EYE_LOCAL); }

  dispose() {
    this.root.removeFromParent();
    for (const g of this.geos) g.dispose();
    for (const m of this.mats.values()) m.dispose();
  }

  // ---- construction helpers ----

  private solveLimb(limb: Limb, root: THREE.Vector3, target: THREE.Vector3, l1: number, l2: number, pole: THREE.Vector3) {
    const joint = new THREE.Vector3(), end = new THREE.Vector3();
    solveTwoBone(root, target, l1, l2, pole, joint, end);
    limb.upper.position.copy(root);
    limb.upper.quaternion.setFromUnitVectors(DOWN, _a.subVectors(joint, root).normalize());
    limb.lower.position.copy(joint);
    limb.lower.quaternion.setFromUnitVectors(DOWN, _a.subVectors(end, joint).normalize());
    limb.end.position.copy(end);
    if (limb.alignEnd) limb.end.quaternion.copy(limb.lower.quaternion); // hands follow the forearm
  }

  private buildHead(skin: THREE.Material, hair: THREE.Material, dark: THREE.Material) {
    const a = this.appearance, h = this.head;
    this.add(h, this.sphere(0.12, skin, 1, 1.1, 1.02, 14, 10), 0, 0.14, 0.01);
    this.add(h, this.box(0.03, 0.045, 0.04, skin), 0, 0.125, 0.13); // nose
    for (const side of [1, -1]) {
      this.eyes.push(this.add(h, this.sphere(0.017, dark, 1, 1, 0.6, 6, 4), 0.045 * side, 0.155, 0.112));
      this.add(h, this.sphere(0.025, skin, 0.6, 1, 1, 6, 4), 0.122 * side, 0.14, 0.01); // ears
      const brow = this.add(h, this.box(0.045, 0.01, 0.012, hair), 0.045 * side, 0.188, 0.113);
      brow.rotation.z = a.face === 'focused' ? 0.28 * side : a.face === 'smile' ? -0.12 * side : 0;
    }
    const lips = this.mat(shade(a.skinTone, 0.7));
    if (a.face === 'smile') this.add(h, this.torus(0.03, 0.007, lips, Math.PI), 0, 0.1, 0.112, 0, 0, Math.PI);
    else this.add(h, this.box(a.face === 'focused' ? 0.04 : 0.05, 0.008, 0.01, lips), 0, 0.085, 0.118);
    if (a.face === 'beard') this.add(h, this.sphere(0.124, hair, 0.98, 0.9, 1, 10, 6, Math.PI * 0.58, Math.PI * 0.42), 0, 0.13, 0.02);

    const cap = (r: number, m: THREE.Material, phi = Math.PI * 0.55, y = 0.15) => this.add(h, this.sphere(r, m, 1, 1.08, 1.04, 14, 8, 0, phi), 0, y, 0.0);
    switch (a.hair) {
      case 'short': cap(0.128, hair).rotation.x = -0.25; break;
      case 'buzz': cap(0.124, hair, Math.PI * 0.45).rotation.x = -0.2; break;
      case 'long': cap(0.13, hair).rotation.x = -0.25; this.add(h, this.box(0.24, 0.26, 0.08, hair), 0, 0.05, -0.08); break;
      case 'ponytail': cap(0.128, hair).rotation.x = -0.3; this.add(h, this.sphere(0.04, hair), 0, 0.17, -0.13); this.add(h, this.cyl(0.03, 0.18, hair), 0, 0.07, -0.16).rotation.x = 0.3; break;
      case 'curly': for (let i = 0; i < 9; i++) { const t = (i / 9) * Math.PI * 2; this.add(h, this.sphere(0.055, hair, 1, 1, 1, 7, 5), Math.cos(t) * 0.08, 0.23 + Math.sin(t * 2) * 0.01, Math.sin(t) * 0.07 - 0.02); } break;
      case 'bald': break;
    }

    const hw = this.mat(a.headwearColor);
    switch (a.headwear) {
      case 'cap': cap(0.134, hw, Math.PI * 0.5, 0.18); this.add(h, this.box(0.2, 0.012, 0.11, hw), 0, 0.2, 0.15).rotation.x = -0.1; break;
      case 'beanie': cap(0.136, hw, Math.PI * 0.5, 0.185); this.add(h, this.torus(0.128, 0.018, this.mat(shade(a.headwearColor, 0.8))), 0, 0.195, 0, Math.PI / 2); break;
      case 'leather_helmet': {
        const leather = this.mat('#6b4428');
        cap(0.136, leather, Math.PI * 0.62).rotation.x = -0.15;
        for (const side of [1, -1]) this.add(h, this.box(0.03, 0.09, 0.07, leather), 0.125 * side, 0.1, 0.0);
        this.add(h, this.torus(0.13, 0.012, dark), 0, 0.2, 0.0, Math.PI / 2 - 0.35);
        for (const side of [1, -1]) this.add(h, this.cyl(0.03, 0.025, this.mat('#7fa6b5')), 0.045 * side, 0.225, 0.11, Math.PI / 2 - 0.3);
        break;
      }
      case 'none': break;
    }

    switch (a.accessory) {
      case 'glasses': case 'sunglasses': {
        const lens = a.accessory === 'sunglasses' ? this.mat('#15191c') : dark;
        for (const side of [1, -1]) {
          if (a.accessory === 'sunglasses') this.add(h, this.box(0.05, 0.03, 0.01, lens), 0.045 * side, 0.155, 0.128);
          else this.add(h, this.torus(0.022, 0.004, lens), 0.045 * side, 0.155, 0.126);
        }
        this.add(h, this.box(0.03, 0.006, 0.006, lens), 0, 0.16, 0.128);
        break;
      }
      case 'headset': {
        const band = this.mat('#2a2d30');
        this.add(h, this.torus(0.135, 0.012, band, Math.PI), 0, 0.14, 0); // arch ear to ear
        for (const side of [1, -1]) this.add(h, this.cyl(0.045, 0.04, band), 0.13 * side, 0.14, 0.0, 0, 0, Math.PI / 2);
        this.add(h, this.cyl(0.006, 0.12, band), 0.1, 0.09, 0.08, Math.PI / 2 - 0.5, 0.6);
        break;
      }
      case 'scarf': case 'none': break;
    }
  }

  /** One merged, vertex-coloured seated silhouette for distance views. */
  private buildLowLod(): THREE.Mesh {
    const a = this.appearance;
    const parts: THREE.BufferGeometry[] = [];
    const put = (g: THREE.BufferGeometry, color: string, x: number, y: number, z: number, rx = 0) => {
      g.rotateX(rx); g.translate(x, y, z);
      const c = new THREE.Color(color), n = g.getAttribute('position').count, arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) c.toArray(arr, i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      parts.push(g.index ? g.toNonIndexed() : g);
    };
    put(new THREE.BoxGeometry(0.36, 0.56, 0.22), a.topColor, 0, 0.36, -0.02);
    put(new THREE.IcosahedronGeometry(0.13 * HEAD_SCALE, 0), a.headwear !== 'none' ? a.headwearColor : a.hair === 'bald' ? a.skinTone : a.hairColor, 0, 0.78, 0);
    put(new THREE.BoxGeometry(0.32, 0.14, 0.5), a.bottomsColor, 0, 0.02, 0.22);
    put(new THREE.BoxGeometry(0.28, 0.42, 0.12), a.bottomsColor, 0, -0.2, 0.55);
    put(new THREE.BoxGeometry(0.46, 0.1, 0.34), a.topColor, 0, 0.44, 0.18, 0.4);
    const merged = mergeGeometries(parts, false)!;
    for (const p of parts) p.dispose();
    this.geos.push(merged);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true });
    this.mats.set('lod', mat);
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = true;
    return mesh;
  }

  private mat(color: string, flat = true) {
    const key = color + flat;
    let m = this.mats.get(key);
    if (!m) { m = new THREE.MeshStandardMaterial({ color, roughness: 0.82, flatShading: flat }); this.mats.set(key, m); }
    return m;
  }
  private g<T extends THREE.BufferGeometry>(geo: T): T { this.geos.push(geo); return geo; }
  private box(w: number, h: number, d: number, m: THREE.Material) { return new THREE.Mesh(this.g(new THREE.BoxGeometry(w, h, d)), m); }
  private cyl(r: number, h: number, m: THREE.Material) { return new THREE.Mesh(this.g(new THREE.CylinderGeometry(r, r, h, 8)), m); }
  private torus(r: number, tube: number, m: THREE.Material, arc = Math.PI * 2) { return new THREE.Mesh(this.g(new THREE.TorusGeometry(r, tube, 5, 14, arc)), m); }
  private sphere(r: number, m: THREE.Material, sx = 1, sy = 1, sz = 1, ws = 8, hs = 6, phiStart = 0, phiLen = Math.PI) {
    // phiStart/phiLen here slice by polar angle (theta in three's terms): 0..PI = full sphere, 0..PI/2 = top cap.
    const mesh = new THREE.Mesh(this.g(new THREE.SphereGeometry(r, ws, hs, 0, Math.PI * 2, phiStart, phiLen)), m);
    mesh.scale.set(sx, sy, sz);
    return mesh;
  }
  /** Limb segment: cylinder hanging along the pivot's -Y, placed/oriented by solveLimb. */
  private seg(r: number, len: number, m: THREE.Material) {
    const pivot = new THREE.Group();
    const geo = this.g(new THREE.CylinderGeometry(r, r * 0.85, len, 7));
    geo.translate(0, -len / 2, 0);
    pivot.add(new THREE.Mesh(geo, m));
    this.full.add(pivot);
    return pivot;
  }
  private add<T extends THREE.Object3D>(parent: THREE.Object3D, o: T, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): T {
    o.position.set(x, y, z);
    o.rotation.set(rx, ry, rz);
    parent.add(o);
    return o;
  }
}

function shade(hex: string, f: number) { return '#' + new THREE.Color(hex).multiplyScalar(f).getHexString(); }

// ---------------------------------------------------------------------------------------------
// Seating: where the avatar sits in each airframe, in `container` space. Resolution order:
// the A0's authored placeholder pilot -> a named seat cushion (+ control stick) -> per-asset table.

/** Per-asset seat (hip point, aircraft-group metres, +X = left) for airframes without seat nodes. */
const SEATS: Record<string, { hip: [number, number, number]; scale?: number }> = {
};
/** A0 authored pilot in model units: hip centre and head top (tools/a0/pilot.mjs). */
const A0_HIP = new THREE.Vector3(0.04, 0.14, 0.15), A0_HEAD_TOP = new THREE.Vector3(0.04, 0.2555, 0.133);
const AVATAR_HIP_TO_HEAD_TOP = SPINE_Y + NECK_Y + 0.27 * HEAD_SCALE;

/** `yaw` = PI when the airframe's cabin faces -Z (e.g. the Zenith GLB); avatar space is rotated to match. */
export interface Seat { hip: THREE.Vector3; scale: number; yaw: number; stick?: THREE.Vector3; lean?: number }

/** Finds the seat for an airframe that has been added under `container` (matrices must be current). */
export function findSeat(container: THREE.Object3D, aircraft: THREE.Object3D, assetId: string, fallbackEye: THREE.Vector3): Seat {
  container.updateMatrixWorld(true);
  const toLocal = (o: THREE.Object3D, p: THREE.Vector3) => container.worldToLocal(o.localToWorld(p.clone()));
  const baked = aircraft.getObjectByName('pilot');
  if (baked) {
    const hip = toLocal(baked, A0_HIP), top = toLocal(baked, A0_HEAD_TOP);
    // The authored stand-in's proportions are the fit envelope for the cage; never shrink below a small adult.
    return { hip, scale: THREE.MathUtils.clamp(hip.distanceTo(top) / AVATAR_HIP_TO_HEAD_TOP, 0.72, 1.1), yaw: 0 };
  }
  const cushions: THREE.Object3D[] = [], sticks: THREE.Object3D[] = [];
  aircraft.traverse((o) => { if (/seat[ _]?cushion/i.test(o.name)) cushions.push(o); else if (/control[ _]?stick/i.test(o.name)) sticks.push(o); });
  if (cushions.length) {
    const inv = container.matrixWorld.clone().invert();
    const boxOf = (o: THREE.Object3D) => new THREE.Box3().setFromObject(o).applyMatrix4(inv);
    const seats = cushions.map(boxOf), stickBoxes = sticks.map(boxOf);
    // Facing: the sticks are ahead of the seats. Without sticks assume the game's +Z forward.
    const f = stickBoxes.length && stickBoxes[0].getCenter(_a).z < seats[0].getCenter(_b).z ? -1 : 1;
    const left = seats.sort((p, q) => (q.getCenter(_a).x - p.getCenter(_b).x) * f)[0]; // pilot's left seat
    const c = left.getCenter(new THREE.Vector3());
    const hip = new THREE.Vector3(c.x, left.max.y + 0.06, c.z - (left.max.z - left.min.z) * 0.2 * f);
    const stickBox = stickBoxes.sort((p, q) => p.getCenter(_a).distanceTo(c) - q.getCenter(_b).distanceTo(c))[0];
    return { hip, scale: 1, yaw: f < 0 ? Math.PI : 0, stick: stickBox ? new THREE.Vector3(stickBox.getCenter(_c).x, stickBox.max.y, stickBox.getCenter(_d).z) : undefined };
  }
  const known = SEATS[assetId];
  if (known) return { hip: new THREE.Vector3(...known.hip), scale: known.scale ?? 1, yaw: 0 };
  return { hip: fallbackEye.clone().sub(EYE_LOCAL), scale: 1, yaw: 0 };
}

/** Seats `avatar` in the airframe: positions it, hides any authored stand-in pilot, aims the right hand at a real stick. */
export function seatAvatar(avatar: PilotAvatar, container: THREE.Object3D, aircraft: THREE.Object3D, assetId: string, fallbackEye: THREE.Vector3): Seat {
  const seat = findSeat(container, aircraft, assetId, fallbackEye);
  const baked = aircraft.getObjectByName('pilot');
  if (baked) baked.visible = false;
  avatar.root.position.copy(seat.hip);
  avatar.root.scale.setScalar(seat.scale);
  avatar.root.rotation.set(0, seat.yaw, 0);
  if (seat.stick) {
    const grip = seat.stick.clone().sub(seat.hip).divideScalar(seat.scale).applyAxisAngle(UP, -seat.yaw);
    if (grip.length() < 1.2) {
      avatar.stickGrip.copy(grip); // IK clamps reach: a far stick straightens the arm and leans the torso
      avatar.reachLean = seat.lean = THREE.MathUtils.clamp((grip.z - 0.42) * 0.9, 0, 0.3);
    }
  }
  container.add(avatar.root);
  avatar.setPose('seated');
  return seat;
}

/** Cockpit eye in container space for a seated avatar. */
export function seatEye(seat: Seat, out = new THREE.Vector3()) {
  // Follow the seated spine (base tilt + reach lean) so the torso never ends up in front of the camera.
  out.copy(EYE_LOCAL).sub(SPINE_BASE).applyAxisAngle(RIGHT, -0.08 + (seat.lean ?? 0)).add(SPINE_BASE);
  return out.multiplyScalar(seat.scale).applyAxisAngle(UP, seat.yaw).add(seat.hip);
}
