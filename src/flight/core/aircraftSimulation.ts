// One complete aircraft: rigid body + controls + propulsion (+ landing gear, added in Phase 6),
// stepped at the fixed physics rate. This is the physical layer; game rules (crash, landing
// scoring, missions) live above it in flightModel.ts.

import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { AircraftPhysics } from './aircraftPhysics';
import { PHYSICS_DT } from './constants';
import { FlightControls, type PilotCommand } from '../controls/flightControls';
import { Propulsion } from '../propulsion/propulsion';
import type { AircraftDefinition } from '../aircraft/aircraftDefinition';

export interface SimCommand extends PilotCommand {
  engineOn: boolean;
}

export class AircraftSimulation {
  readonly physics: AircraftPhysics;
  readonly controls: FlightControls;
  readonly propulsion: Propulsion | null;
  readonly def: AircraftDefinition;
  /** Damage-system hook: 0..1 effectiveness per surface id. */
  effectiveness: (damageId: string) => number = () => 1;
  timeS = 0;
  private readonly hubAir = new THREE.Vector3();
  private readonly hubR = new THREE.Vector3();

  constructor(world: RAPIER.World, def: AircraftDefinition, terrainHeight?: (x: number, z: number) => number) {
    this.def = def;
    this.physics = new AircraftPhysics(world, def, terrainHeight);
    this.controls = new FlightControls(def.controls);
    this.propulsion = def.engine && def.propeller ? new Propulsion(def.engine, def.propeller) : null;
  }

  get fuelL(): number {
    return this.physics.fuelL;
  }

  /** Advances one fixed tick. `wind` is the world-space wind at the aircraft (m/s). */
  step(cmd: SimCommand, wind: THREE.Vector3): void {
    const phys = this.physics;
    const surf = this.controls.step(cmd, PHYSICS_DT);
    phys.readState(wind);

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
    phys.integrate(gyro);
    this.timeS += PHYSICS_DT;
  }
}
