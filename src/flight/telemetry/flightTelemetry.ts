// Extended, physics-level telemetry (spec section 29) for the debug overlay, the recorder and
// tests. Separate from the game-facing FlightTelemetry contract so HUD/economy stay untouched.
// The reader writes into a caller-owned object: no allocation per call after the first.

import * as THREE from 'three';
import type { FlightModel } from '../flightModel';
import { SEA_LEVEL_DENSITY } from '../core/constants';
import { indicatedAirspeed } from '../atmosphere/atmosphere';
import { attitude } from '../core/coordinates';
import { compassBearingDeg } from '../../world/compass';

const RAD = 180 / Math.PI;

export interface ElementTelemetry {
  id: string;
  alphaDeg: number;
  airspeedMs: number;
  cl: number;
  cd: number;
  liftN: number;
  dragN: number;
  /** 0..100: how much of the section's flow is separated. */
  stallPct: number;
}

export interface FlightTelemetryExt {
  iasMs: number;
  tasMs: number;
  groundSpeedMs: number;
  aglM: number;
  mslM: number;
  vsMs: number;
  alphaDeg: number;
  betaDeg: number;
  pitchDeg: number;
  rollDeg: number;
  headingDeg: number;
  pDegS: number;
  qDegS: number;
  rDegS: number;
  gLoad: number;
  massKg: number;
  cg: [number, number, number];
  rpm: number;
  throttle: number;
  thrustN: number;
  cl: number;
  cd: number;
  liftN: number;
  dragN: number;
  elevatorDeg: number;
  aileronLeftDeg: number;
  aileronRightDeg: number;
  rudderDeg: number;
  wind: [number, number, number];
  stallMarginDeg: number;
  assistLevel: string;
  physicsMsPerStep: number;
  physicsHzCapacity: number;
  guardEvents: number;
  elements: ElementTelemetry[];
}

export function newExtendedTelemetry(): FlightTelemetryExt {
  return {
    iasMs: 0, tasMs: 0, groundSpeedMs: 0, aglM: 0, mslM: 0, vsMs: 0, alphaDeg: 0, betaDeg: 0, pitchDeg: 0, rollDeg: 0, headingDeg: 0,
    pDegS: 0, qDegS: 0, rDegS: 0, gLoad: 1, massKg: 0, cg: [0, 0, 0], rpm: 0, throttle: 0, thrustN: 0, cl: 0, cd: 0, liftN: 0, dragN: 0,
    elevatorDeg: 0, aileronLeftDeg: 0, aileronRightDeg: 0, rudderDeg: 0, wind: [0, 0, 0], stallMarginDeg: 0, assistLevel: 'simulation',
    physicsMsPerStep: 0, physicsHzCapacity: 0, guardEvents: 0, elements: [],
  };
}

const airDir = new THREE.Vector3();
const fwdV = new THREE.Vector3();
const leftV = new THREE.Vector3();
const upV = new THREE.Vector3();
const liftDir = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export function readExtendedTelemetry(model: FlightModel, out: FlightTelemetryExt = newExtendedTelemetry()): FlightTelemetryExt {
  const sim = model.sim;
  const phys = sim.physics;
  const lv = phys.velWorld;
  const rho = phys.atmosphere.densityKgM3;
  out.tasMs = phys.airspeedMs;
  out.iasMs = indicatedAirspeed(phys.airspeedMs, rho, SEA_LEVEL_DENSITY);
  out.groundSpeedMs = Math.hypot(lv.x, lv.z);
  out.aglM = phys.heightAglM;
  out.mslM = phys.cgWorld.y;
  out.vsMs = lv.y;
  out.alphaDeg = phys.alphaRad * RAD;
  out.betaDeg = phys.betaRad * RAD;
  out.pDegS = phys.wBody.z * RAD;
  out.qDegS = -phys.wBody.x * RAD;
  out.rDegS = -phys.wBody.y * RAD;
  const att = attitude(phys.frame, fwdV, leftV, upV);
  out.pitchDeg = att.pitchRad * RAD;
  out.rollDeg = att.rollRad * RAD;
  out.headingDeg = compassBearingDeg(fwdV.x, fwdV.z);
  out.gLoad = model.gLoad;
  const w = model.appliedWind;
  out.wind[0] = w.x; out.wind[1] = w.y; out.wind[2] = w.z;
  out.massKg = phys.mass.massKg;
  out.cg[0] = phys.mass.cg[0]; out.cg[1] = phys.mass.cg[1]; out.cg[2] = phys.mass.cg[2];
  const eng = sim.propulsion;
  out.rpm = eng?.engine.rpm ?? 0;
  out.throttle = sim.assisted.throttle;
  out.thrustN = eng?.thrustN ?? 0;

  // Aircraft-level CL/CD from the aerodynamic force resolved in wind axes.
  const V = phys.airspeedMs;
  if (V > 1) {
    airDir.copy(phys.airBody).multiplyScalar(1 / V);
    const f = phys.aeroForce;
    out.dragN = -f.dot(airDir);
    liftDir.copy(UP).addScaledVector(airDir, -UP.dot(airDir)).normalize();
    out.liftN = f.dot(liftDir);
    const qS = 0.5 * rho * V * V * sim.def.geometry.wingAreaM2;
    out.cl = out.liftN / qS;
    out.cd = out.dragN / qS;
  } else {
    out.liftN = out.dragN = out.cl = out.cd = 0;
  }
  const a = sim.controls.actuators.position;
  out.elevatorDeg = a.elevator * RAD;
  out.aileronLeftDeg = a.aileronLeft * RAD;
  out.aileronRightDeg = a.aileronRight * RAD;
  out.rudderDeg = a.rudder * RAD;
  out.stallMarginDeg = phys.stallMarginRad * RAD;
  out.assistLevel = sim.assistance.level;
  out.physicsMsPerStep = model.lastStepMs;
  out.physicsHzCapacity = model.lastStepMs > 0 ? 1000 / model.lastStepMs : 0;
  out.guardEvents = phys.guardEvents.angularRate + phys.guardEvents.speed + phys.guardEvents.nonFinite;

  const els = phys.elements;
  while (out.elements.length < els.length) out.elements.push({ id: '', alphaDeg: 0, airspeedMs: 0, cl: 0, cd: 0, liftN: 0, dragN: 0, stallPct: 0 });
  for (let i = 0; i < els.length; i++) {
    const r = phys.results[i];
    const e = out.elements[i];
    e.id = els[i].spec.id;
    e.alphaDeg = r.alphaRad * RAD; e.airspeedMs = r.airspeedMs; e.cl = r.cl; e.cd = r.cd; e.liftN = r.liftN; e.dragN = r.dragN; e.stallPct = r.sep * 100;
  }
  return out;
}
