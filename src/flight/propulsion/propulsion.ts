// Engine + propeller as one system (spec sections 16-17). Produces, per tick:
//   thrust (body force at the prop hub, shifted by P-factor), reaction torque, propeller angular
//   momentum (gyroscopic), the slipstream felt by the aero elements, and fuel flow.
// Nothing here is a constant yaw/roll torque: each effect comes from a physical quantity
// (shaft torque, rpm, disc angle of attack, momentum-theory slipstream).

import * as THREE from 'three';
import type { EngineDefinition, PropellerDefinition } from '../aircraft/aircraftDefinition';
import { EngineModel } from './engine';
import { PropellerModel, type PropellerOutput } from './propeller';
import type { Slipstream } from '../core/aircraftPhysics';
import type { Vec3 } from '../core/coordinates';
import { DEG, SEA_LEVEL_DENSITY } from '../core/constants';

export interface PropulsionInput {
  throttle: number;
  engineOn: boolean;
  fuelL: number;
  rho: number;
  /** Air velocity of the hub (velocity through the air), body axes. */
  airAtHub: THREE.Vector3;
}

export class Propulsion {
  readonly engine: EngineModel;
  readonly prop: PropellerModel;
  readonly engineDef: EngineDefinition;
  readonly propDef: PropellerDefinition;
  readonly thrust = new THREE.Vector3();
  readonly thrustPoint: Vec3 = [0, 0, 0];
  readonly reactionTorque = new THREE.Vector3();
  readonly angularMomentum = new THREE.Vector3();
  readonly slipstream: Slipstream = { axialMs: 0, swirl: 0, discRadiusM: 0.6, discCentreY: 0 };
  thrustN = 0;
  propRpm = 0;
  fuelFlowLps = 0;
  private readonly out: PropellerOutput = { thrustN: 0, torqueNm: 0, advanceRatio: 0, inducedMs: 0 };
  private lastOmegaProp = 0;
  private readonly thrustDir = new THREE.Vector3(0, 0, 1);

  constructor(engine: EngineDefinition, prop: PropellerDefinition) {
    this.engineDef = engine;
    this.propDef = prop;
    this.engine = new EngineModel(engine);
    this.prop = new PropellerModel(prop);
    this.thrustPoint = [engine.position[0], engine.position[1], engine.position[2]];
    const t = engine.thrustLineDeg * DEG;
    this.thrustDir.set(0, Math.sin(t), Math.cos(t));
    this.slipstream.swirl = prop.swirlGain;
    this.slipstream.discRadiusM = (prop.diameterM / 2) * 0.9;
    this.slipstream.discCentreY = engine.position[1];
  }

  reset(): void {
    this.engine.reset();
    this.lastOmegaProp = 0;
    this.thrustN = 0;
    this.propRpm = 0;
    this.fuelFlowLps = 0;
  }

  step(dt: number, inp: PropulsionInput): void {
    const e = this.engineDef;
    const p = this.propDef;
    const eng = this.engine;
    const rps = eng.rpm / e.gearRatio / 60;
    const axial = inp.airAtHub.dot(this.thrustDir);
    this.prop.evaluate(rps, axial, inp.rho, this.out);
    const loadAtCrank = this.out.torqueNm / e.gearRatio;
    eng.step(dt, inp.throttle, inp.rho / SEA_LEVEL_DENSITY, loadAtCrank, inp.engineOn, inp.fuelL > 0);

    const rpsNew = eng.rpm / e.gearRatio / 60;
    const omegaProp = rpsNew * 2 * Math.PI;
    const omegaDot = (omegaProp - this.lastOmegaProp) / dt;
    this.lastOmegaProp = omegaProp;
    this.propRpm = rpsNew * 60;

    // Thrust (never negative from a stopped prop; windmilling gives negative = drag).
    this.thrustN = this.out.thrustN;
    this.thrust.copy(this.thrustDir).multiplyScalar(this.thrustN);

    // P-factor: descending blade produces more thrust -> the thrust centre moves toward it.
    const v = inp.airAtHub.length();
    const alphaDisc = v > 1 ? Math.atan2(-inp.airAtHub.y, inp.airAtHub.z) : 0;
    const dx = -p.rotation * p.pFactor * (p.diameterM / 2) * Math.sin(alphaDisc);
    this.thrustPoint[0] = e.position[0] + dx;
    this.thrustPoint[1] = e.position[1];
    this.thrustPoint[2] = e.position[2];

    // Reaction torque on the airframe = -(torque delivered to the prop shaft + spin-up torque).
    const shaftTorque = this.out.torqueNm + p.inertiaKgM2 * omegaDot;
    this.reactionTorque.set(0, 0, -p.rotation * shaftTorque);
    // Angular momentum of the spinning prop (drives the gyroscopic term in AircraftPhysics).
    this.angularMomentum.set(0, 0, p.rotation * p.inertiaKgM2 * omegaProp);

    // Slipstream (momentum theory) felt by immersed aero elements.
    const s = this.slipstream;
    s.axialMs = this.thrustN > 0 ? 2 * this.out.inducedMs * p.wakeFactor : 0;

    // Fuel: idle burn + power-proportional burn.
    const running = eng.state === 'running';
    const frac = running ? Math.min(1, eng.powerW / (e.maxPowerKw * 1000)) : 0;
    this.fuelFlowLps = running ? ((e.fuelBurnLph / 3600) * (0.12 + 0.88 * frac)) : 0;
  }
}
