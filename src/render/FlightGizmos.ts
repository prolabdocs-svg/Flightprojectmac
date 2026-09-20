// Debug gizmos for the flight model (spec section 30): CG, per-element lift/drag vectors,
// thrust, relative airflow, wind, wheel forces and ground normals, all in one LineSegments so
// it costs a single draw call. Purely visual: reads the simulation, never writes to it.

import * as THREE from 'three';
import type { FlightModel } from '../flight/flightModel';

const MAX_SEGMENTS = 96;

const COLORS = {
  cg: new THREE.Color('#ffffff'),
  lift: new THREE.Color('#37d67a'),
  drag: new THREE.Color('#ff5a4f'),
  thrust: new THREE.Color('#4da3ff'),
  air: new THREE.Color('#33e0e0'),
  wind: new THREE.Color('#ffd23f'),
  wheel: new THREE.Color('#ff59d6'),
  normal: new THREE.Color('#cccccc'),
};

export class FlightGizmos {
  readonly object: THREE.LineSegments;
  /** Metres of arrow per kilonewton of force. */
  scale = 1.2;
  private readonly positions = new Float32Array(MAX_SEGMENTS * 2 * 3);
  private readonly colors = new Float32Array(MAX_SEGMENTS * 2 * 3);
  private n = 0;
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly d = new THREE.Vector3();

  constructor(parent: THREE.Object3D) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    this.object = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true }));
    this.object.frustumCulled = false;
    this.object.renderOrder = 999;
    this.object.visible = false;
    parent.add(this.object);
  }

  setVisible(v: boolean): void {
    this.object.visible = v;
  }

  dispose(): void {
    this.object.removeFromParent();
    this.object.geometry.dispose();
    (this.object.material as THREE.Material).dispose();
  }

  private seg(from: THREE.Vector3, to: THREE.Vector3, c: THREE.Color): void {
    if (this.n >= MAX_SEGMENTS) return;
    const i = this.n * 6;
    this.positions.set([from.x, from.y, from.z, to.x, to.y, to.z], i);
    this.colors.set([c.r, c.g, c.b, c.r, c.g, c.b], i);
    this.n++;
  }

  private arrow(origin: THREE.Vector3, dir: THREE.Vector3, lengthM: number, c: THREE.Color): void {
    if (lengthM < 0.02) return;
    this.b.copy(origin).addScaledVector(dir, lengthM);
    this.seg(origin, this.b, c);
  }

  update(model: FlightModel): void {
    if (!this.object.visible) return;
    const phys = model.sim.physics;
    const f = phys.frame;
    this.n = 0;
    const cgW = phys.cgWorld;
    // CG marker.
    for (const ax of [[0.3, 0, 0], [0, 0.3, 0], [0, 0, 0.3]] as const) {
      this.a.set(ax[0], ax[1], ax[2]);
      this.b.copy(cgW).add(this.a);
      this.d.copy(cgW).sub(this.a);
      this.seg(this.d, this.b, COLORS.cg);
    }
    // Aerodynamic elements: lift + drag at each aerodynamic centre.
    const point = new THREE.Vector3();
    const dir = new THREE.Vector3();
    for (let i = 0; i < phys.elements.length; i++) {
      const el = phys.elements[i];
      const r = phys.results[i];
      phys.pointWorld(el.spec.position, point);
      dir.set(r.lx, r.ly, r.lz).applyQuaternion(f.q);
      this.arrow(point, dir, (r.liftN / 1000) * this.scale, COLORS.lift);
      dir.set(r.dx, r.dy, r.dz).applyQuaternion(f.q);
      this.arrow(point, dir, (r.dragN / 1000) * this.scale * 3, COLORS.drag);
    }
    // Thrust at the hub.
    const pr = model.sim.propulsion;
    if (pr) {
      phys.pointWorld(pr.thrustPoint, point);
      dir.copy(pr.thrust).applyQuaternion(f.q);
      const mag = dir.length();
      if (mag > 1) this.arrow(point, dir.multiplyScalar(1 / mag), (mag / 1000) * this.scale, COLORS.thrust);
    }
    // Relative airflow at the CG (where the air comes FROM) and the wind vector above the aircraft.
    dir.copy(phys.airBody).applyQuaternion(f.q).multiplyScalar(-1);
    const v = dir.length();
    if (v > 0.5) this.arrow(cgW, dir.multiplyScalar(1 / v), Math.min(6, v * 0.25), COLORS.air);
    const w = model.appliedWind;
    const wm = w.length();
    if (wm > 0.1) {
      point.copy(cgW).y += 2.5;
      this.arrow(point, dir.copy(w).multiplyScalar(1 / wm), Math.min(6, wm * 0.6), COLORS.wind);
    }
    // Wheel forces and ground normals.
    for (const wh of model.sim.gear.wheels) {
      if (!wh.contact) continue;
      dir.copy(wh.force);
      const mag = dir.length();
      if (mag > 1) this.arrow(wh.point, dir.multiplyScalar(1 / mag), (mag / 1000) * this.scale, COLORS.wheel);
      this.arrow(wh.point, this.d.set(0, 1, 0), 0.4, COLORS.normal);
    }
    const geom = this.object.geometry;
    geom.setDrawRange(0, this.n * 2);
    geom.attributes.position.needsUpdate = true;
    geom.attributes.color.needsUpdate = true;
  }
}
