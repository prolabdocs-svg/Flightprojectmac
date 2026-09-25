// Distributed aerodynamics (spec sections 6-8). Every element is a strip of lifting surface at a
// body-fixed position. It sees its OWN local airflow: v_point = v_cg + w x r, minus wind and
// propeller slipstream. From that flow it derives alpha, dynamic pressure, CL/CD/CM (with
// stall), control-surface effect and ground effect, and returns a force plus a moment about the CG.
//
// Element frame (body coords): c = chord, n = normal (lift side), s = c x n = span/pitch axis.
// Positive CM rotates c toward n about s. Deflection delta > 0 increases lift along +n.

import type { AirfoilSample, AirfoilTable } from './airfoil';
import { flapEffectiveness } from './airfoil';
import { MIN_AIRFLOW_MS } from '../core/constants';
import type { Vec3 } from '../core/coordinates';

export type ElementGroup = 'wing' | 'htail' | 'vtail';
export type ControlKind = 'aileron' | 'elevator' | 'rudder' | 'flap';

export interface ElementControlSpec {
  kind: ControlKind;
  /** Control chord / element chord. */
  chordFraction: number;
  /** Fraction of the element's span the control covers (0..1). */
  spanFraction: number;
}

export interface AeroElementSpec {
  id: string;
  group: ElementGroup;
  /** Aerodynamic-centre position in BODY axes relative to the model datum, metres. */
  position: Vec3;
  areaM2: number;
  chordM: number;
  spanM: number;
  /** 'up': normal +Y (wings, tailplane). 'side': normal +X (fin). */
  orientation: 'up' | 'side';
  /** Rotation of the chord about the span axis, deg. > 0 = leading edge toward +n. Includes twist. */
  incidenceDeg: number;
  /** Tip-up dihedral, deg (wings). Outboard direction is set by `outboard`. */
  dihedralDeg: number;
  /** +1 = element lies toward +X (left), -1 = toward -X (right), 0 = centreline. */
  outboard: -1 | 0 | 1;
  /** Lift-curve slope of the whole lifting surface this element belongs to (1/rad). */
  clAlpha: number;
  /** Effective aspect ratio of the whole surface (drives induced drag). */
  effectiveAr: number;
  oswald: number;
  /** 0..1 share of the wing downwash angle this element sees (tailplane only). */
  downwashFactor: number;
  /** 0..1 fraction of the element immersed in the propeller slipstream. */
  propwashImmersion: number;
  control?: ElementControlSpec;
  /** Damage-system surface id whose effectiveness scales this element ('wing_root_main', 'elevator'...). */
  damageId: string;
}

export interface ElementResult {
  fx: number; fy: number; fz: number;
  mx: number; my: number; mz: number;
  alphaRad: number;
  airspeedMs: number;
  qPa: number;
  cl: number;
  cd: number;
  sep: number;
  liftN: number;
  dragN: number;
  /** Unit lift and drag directions (body axes) for debug gizmos. */
  lx: number; ly: number; lz: number;
  dx: number; dy: number; dz: number;
}

export const newElementResult = (): ElementResult => ({
  fx: 0, fy: 0, fz: 0, mx: 0, my: 0, mz: 0, alphaRad: 0, airspeedMs: 0, qPa: 0,
  cl: 0, cd: 0, sep: 0, liftN: 0, dragN: 0, lx: 0, ly: 0, lz: 0, dx: 0, dy: 0, dz: 0,
});

/** Per-tick environment handed to every element. Filled by AircraftPhysics; body axes throughout. */
export class AeroContext {
  rho = 1.225;
  vx = 0; vy = 0; vz = 0; // CG velocity
  wx = 0; wy = 0; wz = 0; // angular velocity
  windX = 0; windY = 0; windZ = 0;
  /** World up expressed in body axes, to get an element's height above ground. */
  upX = 0; upY = 1; upZ = 0;
  cgHeightAglM = 100;
  /** Propeller slipstream: extra axial speed, swirl gain and axis/disc geometry. */
  slipAxialMs = 0;
  slipSwirl = 0;
  discRadiusM = 0.6;
  discCentreY = 0;
  /** Wing downwash angle (rad), refreshed after the wing group has been evaluated. */
  downwashRad = 0;
  /** Ground-effect strength (see groundEffect.ts). */
  groundInducedFactor = 1;
  groundLiftGain = 0;
}

const CD_FLAP_PER_RAD2 = 0.12; // profile-drag rise of a deflected plain flap (ESTIMATED)
const CM_PER_FLAP_CL = 0.25; // nose-down moment per unit of flap-generated CL (ESTIMATED)
const FLAP_VISCOUS_LOSS = 0.85; // real flaps deliver ~85% of the inviscid tau

export class AeroElement {
  readonly spec: AeroElementSpec;
  readonly table: AirfoilTable;
  /** Element frame in body axes. */
  readonly cx: number; readonly cy: number; readonly cz: number;
  readonly nx: number; readonly ny: number; readonly nz: number;
  readonly sx: number; readonly sy: number; readonly sz: number;
  readonly inducedK: number;
  private readonly controlTau: number;
  /** Position relative to the CG, refreshed by setCg(). */
  rx = 0; ry = 0; rz = 0;
  /** Commanded deflection (rad, +lift sense). Written by the control system each tick. */
  deflectionRad = 0;
  /** 0..1 force multiplier from the damage system. */
  effectiveness = 1;
  private readonly tmp: AirfoilSample = { cl: 0, cd: 0, cm: 0, sep: 0 };

  constructor(spec: AeroElementSpec, table: AirfoilTable) {
    this.spec = spec;
    this.table = table;
    // Base frame.
    let c: Vec3 = [0, 0, 1];
    let n: Vec3 = spec.orientation === 'up' ? [0, 1, 0] : [1, 0, 0];
    // Incidence: rotate c toward n about s = c x n.
    const i = (spec.incidenceDeg * Math.PI) / 180;
    const ci = Math.cos(i);
    const si = Math.sin(i);
    const c2: Vec3 = [c[0] * ci + n[0] * si, c[1] * ci + n[1] * si, c[2] * ci + n[2] * si];
    const n2: Vec3 = [n[0] * ci - c[0] * si, n[1] * ci - c[1] * si, n[2] * ci - c[2] * si];
    c = c2;
    n = n2;
    // Dihedral: tilt the normal toward the root (tip goes up). Outboard direction is body X.
    if (spec.dihedralDeg !== 0 && spec.outboard !== 0 && spec.orientation === 'up') {
      const g = (spec.dihedralDeg * Math.PI) / 180;
      const out: Vec3 = [spec.outboard, 0, 0];
      n = [n[0] * Math.cos(g) - out[0] * Math.sin(g), n[1] * Math.cos(g) - out[1] * Math.sin(g), n[2] * Math.cos(g) - out[2] * Math.sin(g)];
    }
    [this.cx, this.cy, this.cz] = c;
    [this.nx, this.ny, this.nz] = n;
    this.sx = this.cy * this.nz - this.cz * this.ny;
    this.sy = this.cz * this.nx - this.cx * this.nz;
    this.sz = this.cx * this.ny - this.cy * this.nx;
    this.inducedK = 1 / (Math.PI * spec.oswald * spec.effectiveAr);
    this.controlTau = spec.control ? flapEffectiveness(spec.control.chordFraction) * FLAP_VISCOUS_LOSS * spec.control.spanFraction : 0;
  }

  setCg(cg: Vec3): void {
    this.rx = this.spec.position[0] - cg[0];
    this.ry = this.spec.position[1] - cg[1];
    this.rz = this.spec.position[2] - cg[2];
  }

  /** Evaluates the element in the given environment. `out` is overwritten. */
  compute(ctx: AeroContext, out: ElementResult): ElementResult {
    const { rx, ry, rz } = this;
    // Velocity of the element's point through the air (body axes).
    let ux = ctx.vx + (ctx.wy * rz - ctx.wz * ry) - ctx.windX;
    let uy = ctx.vy + (ctx.wz * rx - ctx.wx * rz) - ctx.windY;
    let uz = ctx.vz + (ctx.wx * ry - ctx.wy * rx) - ctx.windZ;

    const imm = this.spec.propwashImmersion;
    if (imm > 0 && ctx.slipAxialMs > 0) {
      // Slipstream = air moving aft (-Z) plus clockwise-from-cockpit swirl, felt by the immersed part.
      const px = this.spec.position[0];
      const py = this.spec.position[1] - ctx.discCentreY;
      const kx = Math.max(-1, Math.min(1, px / ctx.discRadiusM));
      const ky = Math.max(-1, Math.min(1, py / ctx.discRadiusM));
      const vs = ctx.slipAxialMs * imm;
      uz += vs;
      uy -= ctx.slipSwirl * vs * kx; // air on the left goes up, on the right down -> relative flow opposite
      ux += ctx.slipSwirl * vs * ky; // air above the axis goes right (-X) -> element sees +X relative motion
    }

    const uc = ux * this.cx + uy * this.cy + uz * this.cz;
    const un = ux * this.nx + uy * this.ny + uz * this.nz;
    const vp = Math.hypot(uc, un);
    out.airspeedMs = vp;
    if (vp < MIN_AIRFLOW_MS) {
      out.fx = out.fy = out.fz = out.mx = out.my = out.mz = 0;
      out.alphaRad = out.cl = out.cd = out.sep = out.liftN = out.dragN = out.qPa = 0;
      return out;
    }

    const spec = this.spec;
    let alpha = Math.atan2(-un, uc);
    if (spec.downwashFactor > 0) alpha -= ctx.downwashRad * spec.downwashFactor;
    const t = this.table.sample(alpha, this.tmp);
    let cl = t.cl;
    let cd = t.cd;
    let cm = t.cm;

    if (spec.control) {
      // Flap-like control: lift proportional to deflection, faded as the section separates.
      const dcl = spec.clAlpha * this.controlTau * this.deflectionRad * (1 - 0.7 * t.sep) * (spec.control.kind === 'flap' ? 0.45 : 1);
      cl += dcl;
      cm -= CM_PER_FLAP_CL * dcl * (spec.control.kind === 'flap' ? 1.8 : 1);
      cd += CD_FLAP_PER_RAD2 * this.deflectionRad * this.deflectionRad * spec.control.spanFraction * (spec.control.kind === 'flap' ? 1.8 : 1);
    }
    if (spec.group === 'wing') cl *= 1 + ctx.groundLiftGain;
    cd += this.inducedK * (spec.group === 'wing' ? ctx.groundInducedFactor : 1) * cl * cl;

    const eff = this.effectiveness;
    const q = 0.5 * ctx.rho * vp * vp;
    const lift = q * spec.areaM2 * cl * eff;
    // A damaged/torn surface loses lift but keeps a ragged-edge drag floor.
    const drag = q * spec.areaM2 * (cd * eff + (1 - eff) * 0.1);

    // Lift is perpendicular to the in-plane flow on the +n side; drag opposes the element's motion.
    const inv = 1 / vp;
    const lx = (-un * this.cx + uc * this.nx) * inv;
    const ly = (-un * this.cy + uc * this.ny) * inv;
    const lz = (-un * this.cz + uc * this.nz) * inv;
    const dx = -(uc * this.cx + un * this.nx) * inv;
    const dy = -(uc * this.cy + un * this.ny) * inv;
    const dz = -(uc * this.cz + un * this.nz) * inv;
    const fx = lift * lx + drag * dx;
    const fy = lift * ly + drag * dy;
    const fz = lift * lz + drag * dz;

    const mAero = q * spec.areaM2 * spec.chordM * cm * eff;
    out.fx = fx; out.fy = fy; out.fz = fz;
    out.mx = ry * fz - rz * fy + mAero * this.sx;
    out.my = rz * fx - rx * fz + mAero * this.sy;
    out.mz = rx * fy - ry * fx + mAero * this.sz;
    out.alphaRad = alpha; out.qPa = q; out.cl = cl; out.cd = cd; out.sep = t.sep;
    out.liftN = lift; out.dragN = drag;
    out.lx = lx; out.ly = ly; out.lz = lz; out.dx = dx; out.dy = dy; out.dz = dz;
    return out;
  }
}

/** Bluff-body drag (fuselage/pod, struts, wires, pilot, gear): CdA per body axis, at a point. */
export interface BluffBodySpec {
  id: string;
  position: Vec3;
  /** Drag area (Cd*A, m^2) for flow along each body axis: [X lateral, Y vertical, Z frontal]. */
  cdA: Vec3;
}

export class BluffBody {
  rx = 0; ry = 0; rz = 0;
  readonly spec: BluffBodySpec;
  constructor(spec: BluffBodySpec) {
    this.spec = spec;
  }

  setCg(cg: Vec3): void {
    this.rx = this.spec.position[0] - cg[0];
    this.ry = this.spec.position[1] - cg[1];
    this.rz = this.spec.position[2] - cg[2];
  }

  compute(ctx: AeroContext, out: ElementResult): ElementResult {
    const { rx, ry, rz } = this;
    const ux = ctx.vx + (ctx.wy * rz - ctx.wz * ry) - ctx.windX;
    const uy = ctx.vy + (ctx.wz * rx - ctx.wx * rz) - ctx.windY;
    const uz = ctx.vz + (ctx.wx * ry - ctx.wy * rx) - ctx.windZ;
    const v = Math.hypot(ux, uy, uz);
    const k = -0.5 * ctx.rho * v;
    const fx = k * this.spec.cdA[0] * ux;
    const fy = k * this.spec.cdA[1] * uy;
    const fz = k * this.spec.cdA[2] * uz;
    out.fx = fx; out.fy = fy; out.fz = fz;
    out.mx = ry * fz - rz * fy;
    out.my = rz * fx - rx * fz;
    out.mz = rx * fy - ry * fx;
    out.airspeedMs = v;
    out.qPa = 0.5 * ctx.rho * v * v;
    out.dragN = Math.hypot(fx, fy, fz);
    out.liftN = out.cl = out.cd = out.sep = out.alphaRad = 0;
    return out;
  }
}
