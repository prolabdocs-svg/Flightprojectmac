// The aerodynamic model of one aircraft, independent of any rigid-body engine: elements,
// bluff bodies, downwash, ground effect and stall margin. AircraftPhysics feeds it the kinematic
// state each tick; the static performance analysis feeds it hand-built states. One implementation,
// so the Builder estimates and the flown physics can never diverge.

import * as THREE from 'three';
import type { AircraftDefinition } from '../aircraft/aircraftDefinition';
import { AeroContext, AeroElement, BluffBody, newElementResult, type ElementResult } from './aeroElement';
import { getAirfoilTable, type AirfoilTable } from './airfoil';
import { groundInducedFactor, groundLiftGain } from './groundEffect';
import type { Vec3 } from '../core/coordinates';

/** Deflections in the lift-positive sense (see coordinates.ts), radians. */
export interface SurfaceDeflections {
  elevator: number;
  aileronLeft: number;
  aileronRight: number;
  rudder: number;
  /** XL plain flaps, positive = trailing edge down; absent for other airframes. */
  flaps?: number;
}

/** Slipstream state handed to the aero elements. */
export interface Slipstream {
  axialMs: number;
  swirl: number;
  discRadiusM: number;
  discCentreY: number;
}

/** Kinematic state the aerodynamics needs (BODY axes unless noted). */
export interface AeroInput {
  rho: number;
  velBody: THREE.Vector3;
  wBody: THREE.Vector3;
  windBody: THREE.Vector3;
  /** World up expressed in body axes. */
  upBody: THREE.Vector3;
  /** Height of the CG above the ground, m. */
  heightAglM: number;
  cg: Vec3;
  densityScale?: number;
}

function deflectionFor(kind: string | undefined, outboard: number, s: SurfaceDeflections): number {
  switch (kind) {
    case 'elevator': return s.elevator;
    case 'rudder': return s.rudder;
    case 'aileron': return outboard > 0 ? s.aileronLeft : s.aileronRight;
    case 'flap': return s.flaps ?? 0;
    default: return 0;
  }
}

export class AeroModel {
  readonly def: AircraftDefinition;
  readonly elements: AeroElement[] = [];
  readonly bluff: BluffBody[] = [];
  readonly results: ElementResult[] = [];
  readonly bluffResults: ElementResult[] = [];
  readonly ctx = new AeroContext();
  /** Aerodynamic-only force / moment about the CG of the last compute(), body axes. */
  readonly force = new THREE.Vector3();
  readonly moment = new THREE.Vector3();
  wingCl = 0;
  liftSumN = 0;
  dragSumN = 0;
  /** Margin (rad) between the most-loaded wing element's AoA and the AoA of CLmax. < 0 = past the peak. */
  stallMarginRad = 1;
  readonly wingClMax: number;
  private readonly wingElementCount: number;
  private readonly wingAlphaClMax: number;

  constructor(def: AircraftDefinition) {
    this.def = def;
    const tables: Record<string, AirfoilTable> = {
      wing: getAirfoilTable(def.aero.airfoils.wing),
      htail: getAirfoilTable(def.aero.airfoils.tail),
      vtail: getAirfoilTable(def.aero.airfoils.fin),
    };
    // Wings first: the tailplane needs the wing's CL for downwash.
    const ordered = [...def.aero.elements].sort((a, b) => (a.group === 'wing' ? 0 : 1) - (b.group === 'wing' ? 0 : 1));
    for (const spec of ordered) {
      this.elements.push(new AeroElement(spec, tables[spec.group]));
      this.results.push(newElementResult());
    }
    for (const b of def.aero.bluffBodies) {
      this.bluff.push(new BluffBody(b));
      this.bluffResults.push(newElementResult());
    }
    this.wingElementCount = this.elements.filter((e) => e.spec.group === 'wing').length;
    this.wingAlphaClMax = tables.wing.alphaClMaxRad;
    this.wingClMax = tables.wing.clMax;
  }

  setCg(cg: Vec3): void {
    for (const e of this.elements) e.setCg(cg);
    for (const b of this.bluff) b.setCg(cg);
  }

  compute(inp: AeroInput, surf: SurfaceDeflections, slip: Slipstream | null, effectiveness: (damageId: string) => number): void {
    const c = this.ctx;
    const def = this.def;
    c.rho = inp.rho * (inp.densityScale ?? 1);
    c.vx = inp.velBody.x; c.vy = inp.velBody.y; c.vz = inp.velBody.z;
    c.wx = inp.wBody.x; c.wy = inp.wBody.y; c.wz = inp.wBody.z;
    c.windX = inp.windBody.x; c.windY = inp.windBody.y; c.windZ = inp.windBody.z;
    c.upX = inp.upBody.x; c.upY = inp.upBody.y; c.upZ = inp.upBody.z;
    c.cgHeightAglM = inp.heightAglM;
    if (slip) {
      c.slipAxialMs = slip.axialMs; c.slipSwirl = slip.swirl; c.discRadiusM = slip.discRadiusM; c.discCentreY = slip.discCentreY;
    } else {
      c.slipAxialMs = 0;
    }
    // Ground effect from the height of the wing (not the CG): height of the wing AC above ground.
    const ac = def.geometry.wingAcPosition;
    const cg = inp.cg;
    const wingRelUp = inp.upBody.x * (ac[0] - cg[0]) + inp.upBody.y * (ac[1] - cg[1]) + inp.upBody.z * (ac[2] - cg[2]);
    const wingHeight = Math.max(0, inp.heightAglM + wingRelUp);
    const phi = groundInducedFactor(wingHeight, def.geometry.wingspanM);
    c.groundInducedFactor = phi;
    c.groundLiftGain = groundLiftGain(wingHeight, def.geometry.wingspanM);

    this.force.set(0, 0, 0);
    this.moment.set(0, 0, 0);
    let clArea = 0;
    let maxWingAlpha = -Math.PI;
    let wingArea = 0;
    let lift = 0;
    let drag = 0;
    for (let i = 0; i < this.elements.length; i++) {
      const el = this.elements[i];
      const s = el.spec;
      if (i === this.wingElementCount) {
        // Wings done: downwash angle at the tail, reduced near the ground (less downwash in ground effect).
        this.wingCl = wingArea > 0 ? clArea / wingArea : 0;
        c.downwashRad = ((2 * this.wingCl) / (Math.PI * (def.geometry.wingspanM * def.geometry.wingspanM) / def.geometry.wingAreaM2)) * phi;
      }
      el.effectiveness = effectiveness(s.damageId);
      el.deflectionRad = deflectionFor(s.control?.kind, s.outboard, surf);
      const r = el.compute(c, this.results[i]);
      this.force.x += r.fx; this.force.y += r.fy; this.force.z += r.fz;
      this.moment.x += r.mx; this.moment.y += r.my; this.moment.z += r.mz;
      if (i < this.wingElementCount) {
        clArea += r.cl * s.areaM2;
        wingArea += s.areaM2;
        if (r.alphaRad > maxWingAlpha) maxWingAlpha = r.alphaRad;
      }
      lift += r.liftN;
      drag += r.dragN;
    }
    for (let i = 0; i < this.bluff.length; i++) {
      const r = this.bluff[i].compute(c, this.bluffResults[i]);
      this.force.x += r.fx; this.force.y += r.fy; this.force.z += r.fz;
      this.moment.x += r.mx; this.moment.y += r.my; this.moment.z += r.mz;
      drag += r.dragN;
    }
    this.stallMarginRad = this.wingAlphaClMax - maxWingAlpha;
    this.liftSumN = lift;
    this.dragSumN = drag;
  }
}
