// One complete aircraft: rigid body + controls + propulsion (+ landing gear, added in Phase 6),
// stepped at the fixed physics rate. This is the physical layer; game rules (crash, landing
// scoring, missions) live above it in flightModel.ts.

import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { AircraftPhysics } from './aircraftPhysics';
import { PHYSICS_DT } from './constants';
import { FlightControls, type PilotCommand } from '../controls/flightControls';
import { FlightAssistance, type AssistLevel } from '../controls/flightAssistance';
import { attitude } from './coordinates';
import { Propulsion } from '../propulsion/propulsion';
import { LandingGear, type GearSummary, type GroundQuery } from '../ground/landingGear';
import { StructuralContacts } from '../ground/structuralContact';
import type { AircraftDefinition } from '../aircraft/aircraftDefinition';
import { GROUND_SURFACES } from '../../world/surfaces';

export const FLAT_GROUND: GroundQuery = {
  getElevation: () => 0,
  getSurface: () => GROUND_SURFACES.grass,
  getWaterDepth: () => 0,
};

export interface SimCommand extends PilotCommand {
  engineOn: boolean;
  /** Landing gear still attached / drag+brake penalty from damage (defaults: attached, 1). */
  /** Assistance level for this tick (default: simulation = raw pilot command). */
  assist?: AssistLevel;
  gearAttached?: boolean;
  gearPenalty?: number;
}

export class AircraftSimulation {
  readonly physics: AircraftPhysics;
  readonly controls: FlightControls;
  readonly assistance = new FlightAssistance();
  /** The command actually sent to the mixer after assistance (for telemetry). */
  readonly assisted: PilotCommand = { pitch: 0, roll: 0, yaw: 0, throttle: 0, brake: 0 };
  readonly propulsion: Propulsion | null;
  readonly gear: LandingGear;
  readonly structure: StructuralContacts;
  readonly ground: GroundQuery;
  readonly def: AircraftDefinition;
  /** Damage-system hook: 0..1 effectiveness per surface id. */
  effectiveness: (damageId: string) => number = () => 1;
  timeS = 0;
  private readonly fwd = new THREE.Vector3();
  private readonly left = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly hubAir = new THREE.Vector3();
  private readonly hubR = new THREE.Vector3();

  constructor(world: RAPIER.World, def: AircraftDefinition, ground: GroundQuery = FLAT_GROUND) {
    this.def = def;
    this.ground = ground;
    this.physics = new AircraftPhysics(world, def, (x, z) => ground.getElevation(x, z));
    this.controls = new FlightControls(def.controls);
    this.propulsion = def.engine && def.propeller ? new Propulsion(def.engine, def.propeller) : null;
    this.gear = new LandingGear(def.gear, this.physics.mass.massKg, this.physics.mass.cg, ground);
    this.structure = new StructuralContacts(def, ground);
  }

  /** Resting pose on the ground at (x, z), heading in compass degrees (0 = +Z, clockwise). */
  placeOnGround(x: number, z: number, headingDeg: number): void {
    const y = this.ground.getElevation(x, z) + this.gear.restHeightM;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (-headingDeg * Math.PI) / 180);
    this.physics.place(new THREE.Vector3(x, y, z), q);
  }

  gearSummary(): GearSummary {
    return this.gear.summary;
  }

  get fuelL(): number {
    return this.physics.fuelL;
  }

  /** Advances one fixed tick. `wind` is the world-space wind at the aircraft (m/s). */
  step(cmd: SimCommand, wind: THREE.Vector3): void {
    const phys = this.physics;
    phys.readState(wind);
    this.assistance.setLevel(cmd.assist ?? 'simulation');
    const att = attitude(phys.frame, this.fwd, this.left, this.up);
    this.assistance.apply(cmd, {
      bankRad: att.rollRad, pitchRad: att.pitchRad, p: phys.wBody.z, q: -phys.wBody.x, r: -phys.wBody.y,
      betaRad: phys.betaRad, airspeedMs: phys.airspeedMs, stallMarginRad: phys.stallMarginRad, onGround: this.gear.summary.wheelsOnGround > 0,
    }, PHYSICS_DT, this.assisted);
    const surf = this.controls.step(this.assisted, PHYSICS_DT);

    let slip = null;
    let gyro: THREE.Vector3 | null = null;
    const pr = this.propulsion;
    if (pr) {
      // Air velocity at the hub: airBody + w x r_hub (r relative to the CG).
      const cg = phys.mass.cg;
      const hp = this.def.engine!.position;
      this.hubR.set(hp[0] - cg[0], hp[1] - cg[1], hp[2] - cg[2]);
      this.hubAir.copy(phys.wBody).cross(this.hubR).add(phys.airBody);
      pr.step(PHYSICS_DT, { throttle: cmd.throttle, engineOn: cmd.engineOn, fuelL: phys.fuelL, rho: phys.atmosphere.densityKgM3, airAtHub: this.hubAir });
      slip = pr.slipstream;
      gyro = pr.angularMomentum;
      phys.fuelL = Math.max(0, phys.fuelL - pr.fuelFlowLps * PHYSICS_DT);
      phys.refreshMass();
    }

    phys.computeAero(surf, slip, this.effectiveness);

    if (pr) {
      phys.addBodyLoad(pr.thrust.x, pr.thrust.y, pr.thrust.z, pr.thrustPoint, pr.reactionTorque.x, pr.reactionTorque.y, pr.reactionTorque.z);
    }
    this.gear.step(phys, { steer: cmd.yaw, brake: cmd.brake, yaw: cmd.yaw, damagePenalty: cmd.gearPenalty ?? 1, gearAttached: cmd.gearAttached ?? true });
    this.structure.step(phys);
    phys.integrate(gyro);
    this.timeS += PHYSICS_DT;
  }
}
