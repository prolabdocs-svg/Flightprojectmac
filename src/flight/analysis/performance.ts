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
import { payloadMassItem } from '../aircraft/payload';
import { AeroModel } from '../aero/aeroModel';
import { getAirfoilTable } from '../aero/airfoil';
import { GRAVITY, DEG, SEA_LEVEL_DENSITY } from '../core/constants';
import { airDensity, sampleAtmosphere } from '../atmosphere/atmosphere';
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

  constructor(def: AircraftDefinition, fuelFraction = 1, payloadKg = 0) {
    this.def = def;
    const d = def.mass;
    const items = [...d.items, { id: 'fuel', massKg: d.fuelCapacityL * fuelFraction * d.fuelDensityKgL, position: d.fuelPosition, size: d.fuelSize }];
    if (payloadKg > 0) items.push(payloadMassItem(payloadKg, def.mass.payloadPosition));
    const mp = computeMassProperties(items);
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
    const jet = p.engineDef.jet;
    if (jet) p.spool = jet.idleFraction + (1 - jet.idleFraction) * throttle; // steady state: skip the spool lag
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

  /** Airspeed at which lift at the 9 deg rotation attitude carries the weight, m/s. */
  liftoffSpeed(stallMs: number, rho: number): number {
    const weight = this.massKg * GRAVITY;
    for (let V = stallMs * 0.8; V < stallMs * 1.6; V += 0.25) {
      const f = this.aeroAt(V, 9 * DEG, rho, 100, null);
      if (f.z * Math.sin(9 * DEG) + f.y * Math.cos(9 * DEG) >= weight) return V;
    }
    return stallMs * 1.05;
  }

  /** Ground roll to liftoff at full throttle. `surfaceRr` is GROUND_SURFACES[..].rollingResistance,
   * `headwindMs` shortens the roll (airspeed = groundspeed + headwind), `rho` is the air density. */
  takeoffRoll(stallMs: number, surfaceRr: number, headwindMs: number, rho: number, rotationS = 0): number {
    const weight = this.massKg * GRAVITY;
    const mu = this.def.gear.rollingResistance * surfaceRr;
    const alphaGround = 1.5 * DEG;
    const vLof = this.liftoffSpeed(stallMs, rho);
    let v = 0;
    let x = 0;
    const dt = 0.1;
    while (v + headwindMs < vLof && x < 2000) {
      const va = Math.max(v + headwindMs, 0);
      const th = this.thrustAt(va, 1, rho).thrustN;
      const slip = this.prop && th > 0 ? this.prop.slipstream : null;
      const f = this.aeroAt(Math.max(va, 0.5), alphaGround, rho, 1.1, slip);
      const c = Math.cos(alphaGround);
      const sn = Math.sin(alphaGround);
      const lift = f.z * sn + f.y * c;
      const acc = (f.z * c - f.y * sn + th - mu * Math.max(0, weight - lift)) / this.massKg;
      if (acc <= 0.01) return Infinity;
      v += acc * dt;
      x += v * dt;
    }
    // Rotation: the aircraft keeps rolling at liftoff speed while the pilot pulls the nose up.
    x += v * rotationS;
    return x < 2000 ? x : Infinity;
  }

  /** Fuel flow (L/h) holding level flight at V: bisect the throttle whose excess power is zero. */
  levelBurnLph(V: number, altM: number): { burnLph: number; throttle: number; canHold: boolean } {
    const eng = this.def.engine;
    if (!eng) return { burnLph: 0, throttle: 0, canHold: false };
    let lo = 0.05;
    let hi = 1;
    const top = this.level(V, hi, altM);
    if (top.stalled || top.climbMs < 0) return { burnLph: eng.fuelBurnLph * (0.12 + 0.88 * top.powerFraction), throttle: 1, canHold: false };
    for (let i = 0; i < 14; i++) {
      const mid = (lo + hi) / 2;
      if (this.level(V, mid, altM).climbMs < 0) lo = mid; else hi = mid;
    }
    const p = this.level(V, hi, altM);
    return { burnLph: eng.fuelBurnLph * (0.12 + 0.88 * p.powerFraction), throttle: hi, canHold: true };
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

  const rho0 = SEA_LEVEL_DENSITY;
  const takeoffRollM = a.takeoffRoll(vs, GROUND_SURFACES.grass.rollingResistance, 0, rho0);

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
    takeoffRollM,
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

// --- Load-aware analysis (mission planning) -----------------------------------------------------
// Same Analyzer, same aero + propulsion model, but with the fuel on board and the payload chosen
// for THIS flight, at the departure/arrival conditions of THIS route. Mass enters through
// massModel (fuel + payload items), so range, takeoff roll, climb and stall all move together.

export interface LoadCondition {
  fuelL: number;
  payloadKg: number;
}

export interface OperatingCondition {
  /** Density altitude of the departure field, m. */
  altM: number;
  /** Wind component along the takeoff/landing direction, m/s (+ = headwind). */
  headwindMs: number;
  /** GROUND_SURFACES rolling resistance at departure. */
  departureRr: number;
  /** GROUND_SURFACES rolling resistance / dry braking grip at arrival. */
  arrivalRr: number;
  arrivalBrakingGrip: number;
}

export interface LoadedPerformance {
  massKg: number;
  stallSpeedMs: number;
  liftoffSpeedMs: number;
  /** Level cruise speed (reference cruise of the unloaded aircraft, raised to 1.25 Vs if heavy), m/s. */
  cruiseSpeedMs: number;
  /** Fuel flow holding level flight at cruise speed for THIS mass, L/h. */
  cruiseBurnLph: number;
  /** False if even full throttle cannot hold level flight at cruise speed (overweight / density). */
  cruiseHoldable: boolean;
  /** Fuel flow at full throttle (takeoff and climb), L/h. */
  fullBurnLph: number;
  bestClimbMs: number;
  takeoffRollM: number;
  landingRollM: number;
}

/** Ground roll includes ~1 s of rotation at liftoff speed. Measured against the real flight model with a rotating
 * pilot: the roll to first wheel-lift is 94 m against 82 m without it (the planner used to under-promise the runway). */
const ROTATION_S = 1;
/** Touchdown at 1.15 Vs, 2 s of flare float, brakes worth half the dry grip (main wheels only). */
const LANDING_SPEED_FACTOR = 1.15;
const FLARE_FLOAT_S = 2;
const BRAKE_EFFICIENCY = 0.5;

const definitionCache = new Map<string, AircraftDefinition>();
const loadedCache = new Map<string, LoadedPerformance>();

const buildKey = (build: AircraftBuild) => JSON.stringify([build.frameId, Object.entries(build.installed).sort()]);

export function definitionFor(build: AircraftBuild): AircraftDefinition {
  const key = buildKey(build);
  let def = definitionCache.get(key);
  if (!def) definitionCache.set(key, (def = buildAircraftDefinition(build)));
  return def;
}

export function analyzeLoaded(build: AircraftBuild, load: LoadCondition, cond: OperatingCondition): LoadedPerformance {
  const r = (v: number, q: number) => Math.round(v / q);
  const key = JSON.stringify([buildKey(build), r(load.fuelL, 0.05), r(load.payloadKg, 0.5), r(cond.altM, 25), r(cond.headwindMs, 0.25), r(cond.departureRr, 0.005), r(cond.arrivalRr, 0.005), r(cond.arrivalBrakingGrip, 0.01)]);
  const hit = loadedCache.get(key);
  if (hit) return hit;

  const def = definitionFor(build);
  const cap = def.mass.fuelCapacityL;
  const a = new Analyzer(def, cap > 0 ? Math.min(1, Math.max(0, load.fuelL / cap)) : 0, Math.max(0, load.payloadKg));
  const rho = airDensity(cond.altM);
  const clMax = getAirfoilTable(def.aero.airfoils.wing).clMax * 0.96;
  const stallMs = Math.sqrt((2 * a.massKg * GRAVITY) / (rho * def.geometry.wingAreaM2 * clMax));
  const cruiseMs = Math.max(estimatePerformance(build).cruiseSpeedKmh / 3.6, stallMs * 1.25);
  const burn = a.levelBurnLph(cruiseMs, cond.altM);

  let bestClimbMs = -Infinity;
  for (let V = Math.ceil(stallMs * 1.1); V <= cruiseMs; V += 2) bestClimbMs = Math.max(bestClimbMs, a.level(V, 1, cond.altM).climbMs);

  const vTouchdown = Math.max(0, LANDING_SPEED_FACTOR * stallMs - cond.headwindMs);
  const decel = GRAVITY * (cond.arrivalBrakingGrip * BRAKE_EFFICIENCY + cond.arrivalRr);
  const out: LoadedPerformance = {
    massKg: a.massKg,
    stallSpeedMs: stallMs,
    liftoffSpeedMs: a.liftoffSpeed(stallMs, rho),
    cruiseSpeedMs: cruiseMs,
    cruiseBurnLph: burn.burnLph,
    cruiseHoldable: burn.canHold,
    fullBurnLph: def.engine?.fuelBurnLph ?? 0,
    bestClimbMs,
    takeoffRollM: a.takeoffRoll(stallMs, cond.departureRr, cond.headwindMs, rho, ROTATION_S),
    landingRollM: FLARE_FLOAT_S * vTouchdown + (vTouchdown * vTouchdown) / (2 * decel),
  };
  loadedCache.set(key, out);
  return out;
}
