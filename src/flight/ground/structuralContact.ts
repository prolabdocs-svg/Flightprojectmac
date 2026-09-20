// Structural hard points (wingtips, nose, tail, canopy, belly): stiff penalty contacts with
// friction, used when the airframe itself touches the ground. Whether a contact is survivable
// is a rules decision made by the caller from the reported contact data (speed, sink, point id).

import * as THREE from 'three';
import type { AircraftDefinition } from '../aircraft/aircraftDefinition';
import type { AircraftPhysics } from '../core/aircraftPhysics';
import type { GroundQuery } from './landingGear';

export type HardPointId = AircraftDefinition['hardPoints'][number]['id'];

export interface StructuralContact {
  id: HardPointId;
  active: boolean;
  depthM: number;
  /** Normal approach speed, m/s (> 0 = closing). */
  sinkMs: number;
  speedMs: number;
  loadN: number;
}

export class StructuralContacts {
  readonly contacts: StructuralContact[];
  private readonly def: AircraftDefinition;
  private readonly ground: GroundQuery;
  private readonly p = new THREE.Vector3();
  private readonly pv = new THREE.Vector3();
  private readonly n = new THREE.Vector3();
  private readonly f = new THREE.Vector3();
  private readonly slide = new THREE.Vector3();

  constructor(def: AircraftDefinition, ground: GroundQuery) {
    this.def = def;
    this.ground = ground;
    this.contacts = def.hardPoints.map((h) => ({ id: h.id, active: false, depthM: 0, sinkMs: 0, speedMs: 0, loadN: 0 }));
  }

  /** Applies contact forces; returns the number of active contacts. */
  step(phys: AircraftPhysics): number {
    let count = 0;
    const inReach = phys.heightAglM < 8;
    const m = phys.mass.massKg;
    for (let i = 0; i < this.contacts.length; i++) {
      const c = this.contacts[i];
      c.active = false;
      c.loadN = 0;
      if (!inReach) continue;
      phys.pointWorld(this.def.hardPoints[i].position, this.p);
      const depth = this.ground.getElevation(this.p.x, this.p.z) - this.p.y;
      if (depth <= 0) continue;
      const e = 0.75;
      const hx = this.ground.getElevation(this.p.x + e, this.p.z) - this.ground.getElevation(this.p.x - e, this.p.z);
      const hz = this.ground.getElevation(this.p.x, this.p.z + e) - this.ground.getElevation(this.p.x, this.p.z - e);
      this.n.set(-hx / (2 * e), 1, -hz / (2 * e)).normalize();
      phys.pointVelocityWorld(this.p, this.pv);
      const vn = this.pv.dot(this.n);
      const fn = Math.max(0, m * 60 * depth - m * 4 * vn);
      this.f.copy(this.n).multiplyScalar(fn);
      this.slide.copy(this.pv).addScaledVector(this.n, -vn);
      const slide = this.slide.length();
      if (slide > 0.01) this.f.addScaledVector(this.slide, (-0.6 * fn * Math.tanh(slide / 0.5)) / slide);
      phys.addWorldForceAtPoint(this.f, this.p);
      c.active = true;
      c.depthM = depth;
      c.sinkMs = -vn;
      c.speedMs = this.pv.length();
      c.loadN = fn;
      count++;
    }
    return count;
  }
}
