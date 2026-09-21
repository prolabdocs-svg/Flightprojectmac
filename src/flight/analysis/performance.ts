// Steady-state performance analysis on the SAME aerodynamic + propulsion model the simulation
// flies (AeroModel + Propulsion, no rigid body, no Rapier, synchronous). Used by the Builder /
// mission-readiness estimates and by calibration tests, so what the workshop promises is what the
// air delivers. Level flight: find the AoA whose net vertical force balances weight, then read
// thrust - drag (excess power / weight = climb rate).

import * as THREE from 'three';
import type { AircraftBuild } from '../../core/types';
import { GROUND_SURFACES } from '../../world/surfaces';
import { buildAircraftDefinition } from '../aircraft/quicksilver';
import type { AircraftDefinition } from '../aircraft/aircraftDefinition';
import { computeMassProperties } from '../aircraft/massModel';
import { AeroModel } from '../aero/aeroModel';
import { GRAVITY, DEG, SEA_LEVEL_DENSITY } from '../core/constants';
import { sampleAtmosphere } from '../atmosphere/atmosphere';
import { Propulsion } from '../propulsion/propulsion';

export interface LevelPoint {
  speedMs: number;
  alphaDeg: number;
  thrustN: number;
  dragN: number;
  /** Excess power / weight = climb rate (m/s) available at this speed (can be < 0). */
  climbMs: number;
  rpm: number;
  powerFraction: number;
  stalled: boolean;
}

const NO_SURFACES = { elevator: 0, aileronLeft: 0, aileronRight: 0, rudder: 0 };

/** Everything the analysis needs about one aircraft, built once. */
class Analyzer {
  readonly def: AircraftDefinition;
  readonly aero: AeroModel;
  readonly prop: Propulsion | null;
  readonly massKg: number;
  readonly cg: [number, number, number];
  private readonly vel = new THREE.Vector3();
  private readonly w = new THREE.Vector3();
  private readonly wind = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly air = new THREE.Vector3();
  private readonly atm = { temperatureK: 0, pressurePa: 0, densityKgM3: 1.225 };

  constructor(def: AircraftDefinition, fuelFraction = 1) {
    this.def = def;
    const d = def.mass;
    const mp = computeMassProperties([...d.items, { id: 'fuel', massKg: d.fuelCapacityL * fuelFraction * d.fuelDensityKgL, position: d.fuelPosition, size: d.fuelSize }]);
    this.massKg = mp.massKg;
    this.cg = mp.cg;
    this.aero = new AeroModel(def);
    this.aero.setCg(mp.cg);
    this.prop = def.engine && def.propeller ? new Propulsion(def.engine, def.propeller) : null;
  }

  /** Engine/propeller in equilibrium at airspeed V (axial) and throttle; returns thrust N, rpm, power fraction. */
  thrustAt(V: number, throttle: number, rho: number): { thrustN: number; rpm: number; powerFraction: number } {
    const p = this.prop;
    if (!p) return { thrustN: 0, rpm: 0, powerFraction: 0 };
    p.reset();
    p.engine.rpm = p.engineDef.idleRpm;
    this.air.set(0, 0, V);
    for (let i = 0; i < 200; i++) p.step(0.02, { throttle, engineOn: true, fuelL: 5, rho, airAtHub: this.air });
    return { thrustN: p.thrustN, rpm: p.engine.rpm, powerFraction: Math.min(1, p.engine.powerW / (p.engineDef.maxPowerKw * 1000)) };
  }

  /** Aerodynamic force (body axes) at body AoA `alpha` flying at V, height above ground `h`. */
  aeroAt(V: number, alpha: number, rho: number, h: number, slip: Propulsion['slipstream'] | null): THREE.Vector3 {
    this.vel.set(0, -V * Math.sin(alpha), V * Math.cos(alpha));
    this.up.set(0, Math.cos(alpha), -Math.sin(alpha));
    this.aero.compute({ rho, velBody: this.vel, wBody: this.w, windBody: this.wind, upBody: this.up, heightAglM: h, cg: this.cg }, NO_SURFACES, slip, () => 1);
    return this.aero.force;
  }

  level(V: number, throttle: number, altM: number): LevelPoint {
    const rho = sampleAtmosphere(altM, this.atm).densityKgM3;
    const weight = this.massKg * GRAVITY;
    const th = this.thrustAt(V, throttle, rho);
    const tl = (this.def.engine?.thrustLineDeg ?? 0) * DEG;
    const slip = this.prop && th.thrustN > 0 ? this.prop.slipstream : null;
    const eval_ = (alpha: number) => {
      const f = this.aeroAt(V, alpha, rho, 100, slip);
      const fy = f.y + th.thrustN * Math.sin(tl);
      const fz = f.z + th.thrustN * Math.cos(tl);
      const c = Math.cos(alpha);
      const s = Math.sin(alpha);
      return { up: fz * s + fy * c, fwd: fz * c - fy * s };
    };
    let lo = -4 * DEG;
    let hi = 24 * DEG;
    let found = false;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (eval_(mid).up < weight) lo = mid; else { hi = mid; found = true; }
    }
    const alpha = (lo + hi) / 2;
    const e = eval_(alpha);
    const stalled = !found || e.up < weight * 0.97;
    return { speedMs: V, alphaDeg: alpha / DEG, thrustN: th.thrustN, dragN: th.thrustN - e.fwd, climbMs: (e.fwd * V) / weight, rpm: th.rpm, powerFraction: th.powerFraction, stalled };
  }
}

export function levelPerformance(def: AircraftDefinition, speeds: number[], throttle = 1, altM = 0): LevelPoint[] {
  const a = new Analyzer(def);
  return speeds.map((V) => a.level(V, throttle, altM));
}

export function summarize(points: LevelPoint[]) {
  const ok = points.filter((p) => !p.stalled);
  const best = ok.reduce((b, p) => (p.climbMs > b.climbMs ? p : b), ok[0]);
  const top = [...ok].reverse().find((p) => p.climbMs > 0);
  return { bestClimbMs: best.climbMs, bestClimbSpeedKmh: best.speedMs * 3.6, topSpeedKmh: (top?.speedMs ?? 0) * 3.6, minSpeedKmh: ok[0].speedMs * 3.6 };
}

export interface AircraftPerformance {
  stallSpeedKmh: number;
  cruiseSpeedKmh: number;
  topSpeedKmh: number;
  /** Ground roll to liftoff on grass at full throttle, metres. */
  takeoffRollM: number;
  /** Best climb rate at full throttle, m/s. */
  climbRateMs: number;
  /** Still-air range at cruise throttle with a full tank, km. */
  rangeKm: number;
  /** Endurance at cruise throttle with a full tank, minutes. */
  enduranceMin: number;
  /** Max survivable touchdown sink rate, m/s. */
  gearToleranceMs: number;
}

export const CRUISE_THROTTLE = 0.65;
const SPEEDS = Array.from({ length: 46 }, (_, i) => 10 + i);

function estimate(def: AircraftDefinition): AircraftPerformance {
  const a = new Analyzer(def);
  const full = SPEEDS.map((V) => a.level(V, 1, 0));
  const s = summarize(full);
  const vs = s.minSpeedKmh / 3.6;

  // Cruise: fastest level speed the cruise throttle can hold.
  let cruise = vs * 1.3;
  let cruisePoint: LevelPoint | null = null;
  for (const V of SPEEDS) {
    if (V < vs) continue;
    const p = a.level(V, CRUISE_THROTTLE, 0);
    if (!p.stalled && p.climbMs > 0) { cruise = V; cruisePoint = p; }
  }

  // Takeoff roll: accelerate on the ground attitude to the liftoff speed, thrust and aero from the same model.
  const weight = a.massKg * GRAVITY;
  const grass = GROUND_SURFACES.grass;
  const mu = def.gear.rollingResistance * grass.rollingResistance;
  const alphaGround = 1.5 * DEG;
  const rho0 = SEA_LEVEL_DENSITY;
  // Liftoff: the speed where lift at the rotation attitude (9 deg) carries the weight.
  let vLof = vs * 1.05;
  for (let V = vs * 0.8; V < vs * 1.6; V += 0.25) {
    const f = a.aeroAt(V, 9 * DEG, rho0, 100, null);
    const c = Math.cos(9 * DEG);
    const sn = Math.sin(9 * DEG);
    if (f.z * sn + f.y * c >= weight) { vLof = V; break; }
  }
  let v = 0;
  let x = 0;
  const dt = 0.1;
  while (v < vLof && x < 2000) {
    const th = a.thrustAt(v, 1, rho0).thrustN;
    const slip = a.prop && th > 0 ? a.prop.slipstream : null;
    const f = a.aeroAt(Math.max(v, 0.5), alphaGround, rho0, 1.1, slip);
    const c = Math.cos(alphaGround);
    const sn = Math.sin(alphaGround);
    const lift = f.z * sn + f.y * c;
    const fwd = f.z * c - f.y * sn + th;
    const acc = (fwd - mu * Math.max(0, weight - lift)) / a.massKg;
    if (acc <= 0.01) { x = Infinity; break; }
    v += acc * dt;
    x += v * dt;
  }

  const eng = def.engine;
  let burnLpm = 0;
  if (eng) {
    const frac = cruisePoint?.powerFraction ?? a.thrustAt(cruise, CRUISE_THROTTLE, rho0).powerFraction;
    burnLpm = (eng.fuelBurnLph / 60) * (0.12 + 0.88 * frac);
  }
  const enduranceMin = burnLpm > 0 ? def.mass.fuelCapacityL / burnLpm : 0;
  return {
    stallSpeedKmh: vs * 3.6,
    cruiseSpeedKmh: cruise * 3.6,
    topSpeedKmh: s.topSpeedKmh,
    takeoffRollM: Number.isFinite(x) && v >= vLof ? x : Infinity,
    climbRateMs: s.bestClimbMs,
    rangeKm: (cruise * enduranceMin * 60) / 1000,
    enduranceMin,
    gearToleranceMs: def.gear.toleranceMs,
  };
}

const cache = new Map<string, AircraftPerformance>();

/** Memoised per build (the analysis costs a few milliseconds). */
export function estimatePerformance(build: AircraftBuild): AircraftPerformance {
  const key = JSON.stringify([build.frameId, Object.entries(build.installed).sort()]);
  let p = cache.get(key);
  if (!p) {
    p = estimate(buildAircraftDefinition(build));
    cache.set(key, p);
  }
  return p;
}
