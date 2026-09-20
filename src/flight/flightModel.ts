// Game-facing flight model (replaces sim/flightController.ts once validated). It composes the
// physical AircraftSimulation with the rules the rest of the game depends on: flight state
// machine, crash detection, landing scoring, structural damage, obstacles/water and the
// FlightTelemetry contract used by HUD, economy, missions, audio and camera.

import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { AircraftBuild } from '../core/types';
import type { ResolvedAircraft } from '../content/assembly';
import { buildAircraftDefinition } from './aircraft/quicksilver';
import { AircraftSimulation } from './core/aircraftSimulation';
import { PHYSICS_DT, SEA_LEVEL_DENSITY, GRAVITY } from './core/constants';
import { attitude } from './core/coordinates';
import { assistLevelFromMode } from './controls/flightAssistance';
import { classifyTouchdown, type TouchdownClass } from './ground/touchdown';
import { WindField, DEFAULT_WIND_CONFIG, type WindFieldConfig } from './atmosphere/windField';
import { getAirfoilTable } from './aero/airfoil';
import type { GroundQuery } from './ground/landingGear';
import {
  DEFAULT_RUNWAY_CONDITIONS,
  type CrashReason, type FlightSim, type FlightState, type FlightTelemetry, type ResolvedControls,
} from './flightTypes';
import {
  applyGroundImpact, createDamageState, getAeroEffectivenessMultiplier, getGroundHandlingPenalty,
  listDamagedPartIds, listDetachedPartIds, gearPartId, type DamageState,
} from '../sim/damageSystem';
import { validateLanding, type LandingTelemetry, type RunwayConditions } from '../world/landingValidator';
import type { TerrainQueryService } from '../world/terrainQuery';
import { GROUND_SURFACES } from '../world/surfaces';
import { compassBearingDeg } from '../world/compass';
import { pointInObstacle, type Obstacle } from '../world/obstacles';

const FLOWN_MIN_AIRBORNE_S = 1.2;
const FLOWN_MIN_HEIGHT_M = 2.5;
const STOPPED_SPEED_MS = 1.2;
const STOPPED_HOLD_S = 0.6;
const RAD = 180 / Math.PI;

export function groundFromTerrain(t: TerrainQueryService): GroundQuery {
  return { getElevation: (x, z) => t.getElevation(x, z), getSurface: (x, z) => GROUND_SURFACES[t.getSurfaceId(x, z)], getWaterDepth: (x, z) => t.getWaterDepth(x, z) };
}

export interface FlightModelOptions {
  runwayConditions?: RunwayConditions;
  obstacles?: Obstacle[];
  wind?: Partial<WindFieldConfig>;
}

export class FlightModel implements FlightSim {
  readonly world: RAPIER.World;
  readonly aircraft: ResolvedAircraft;
  readonly sim: AircraftSimulation;
  readonly dtS = PHYSICS_DT;
  readonly touchdownClass: { value: TouchdownClass | null } = { value: null };

  private readonly spawnXZ: [number, number];
  private readonly spawnHeadingDeg: number;
  private readonly terrain: TerrainQueryService;
  private readonly runway: RunwayConditions;
  private readonly obstacles: Obstacle[];
  private readonly windField: WindField;
  private readonly clMax: number;

  private state: FlightState = 'prestart';
  private crashed = false;
  private crashReason: CrashReason | null = null;
  private landed = false;
  private landingQuality = 0;
  private landingFailures: string[] = [];
  private elapsedS = 0;
  private distanceM = 0;
  private maxAltitudeM = 0;
  private maxSpeedMs = 0;
  private damage: DamageState;
  private hasFlown = false;
  private airborneS = 0;
  private stoppedS = 0;
  private touchdown: LandingTelemetry | null = null;
  private lastTouchdownVsMs: number | null = null;
  private gForce = 1;
  private stalled = false;
  private stallWarning = false;
  private windEffective = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly left = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly specific = new THREE.Vector3();
  private readonly hp = new THREE.Vector3();
  /** Wall-clock cost of the last physics step, for the debug overlay / profiling. */
  lastStepMs = 0;

  constructor(world: RAPIER.World, aircraft: ResolvedAircraft, build: AircraftBuild, spawnPos: THREE.Vector3, spawnHeadingDeg: number, terrain: TerrainQueryService, opts: FlightModelOptions = {}) {
    this.world = world;
    this.aircraft = aircraft;
    this.terrain = terrain;
    this.runway = opts.runwayConditions ?? DEFAULT_RUNWAY_CONDITIONS;
    this.obstacles = opts.obstacles ?? [];
    this.spawnXZ = [spawnPos.x, spawnPos.z];
    this.spawnHeadingDeg = spawnHeadingDeg;
    this.windField = new WindField({ ...DEFAULT_WIND_CONFIG, ...opts.wind });
    const def = buildAircraftDefinition(build);
    this.sim = new AircraftSimulation(world, def, groundFromTerrain(terrain));
    this.clMax = getAirfoilTable(def.aero.airfoils.wing).clMax * 0.96;
    this.damage = createDamageState(aircraft.aeroSurfaces.map((s) => s.id));
    this.sim.effectiveness = (id) => getAeroEffectivenessMultiplier(this.damage, id);
    this.sim.placeOnGround(this.spawnXZ[0], this.spawnXZ[1], this.spawnHeadingDeg);
  }

  get body(): RAPIER.RigidBody {
    return this.sim.physics.body;
  }

  getState(): FlightState {
    return this.state;
  }

  reset(): void {
    this.sim.placeOnGround(this.spawnXZ[0], this.spawnXZ[1], this.spawnHeadingDeg);
    this.body.setLinearDamping(0);
    this.body.setAngularDamping(0);
    this.sim.physics.fuelL = this.sim.def.mass.fuelCapacityL;
    this.sim.physics.refreshMass(true);
    this.sim.propulsion?.reset();
    this.sim.controls.reset();
    this.sim.assistance.reset();
    this.sim.timeS = 0;
    this.state = 'prestart';
    this.crashed = false;
    this.crashReason = null;
    this.landed = false;
    this.landingQuality = 0;
    this.landingFailures = [];
    this.elapsedS = 0;
    this.distanceM = this.maxAltitudeM = this.maxSpeedMs = 0;
    this.hasFlown = false;
    this.airborneS = this.stoppedS = 0;
    this.touchdown = null;
    this.lastTouchdownVsMs = null;
    this.touchdownClass.value = null;
    this.damage = createDamageState(this.aircraft.aeroSurfaces.map((s) => s.id));
  }

  /** Advances one fixed physics tick. `meanWind` is the region's mean+gust wind (world, m/s). */
  step(controls: ResolvedControls, meanWind: THREE.Vector3): FlightTelemetry {
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    const sim = this.sim;
    const phys = sim.physics;
    this.elapsedS += PHYSICS_DT;
    const active = !this.crashed;

    const gearGone = listDetachedPartIds(this.damage).includes(gearPartId());
    const engineOn = controls.engineOn && active && !this.landed;
    const p = phys.body.translation();
    const groundY = this.terrain.getElevation(p.x, p.z);
    this.windField.sample(meanWind, this.tmp.set(p.x, p.y, p.z), this.elapsedS, p.y - groundY, this.windEffective);

    sim.step(
      {
        pitch: active ? controls.pitch : 0,
        roll: active ? controls.roll : 0,
        yaw: active ? controls.rudder : 0,
        throttle: active ? controls.throttle : 0,
        brake: controls.brake ? 1 : 0,
        engineOn,
        assist: assistLevelFromMode(controls.assistMode),
        gearAttached: !gearGone,
        gearPenalty: getGroundHandlingPenalty(this.damage),
      },
      this.windEffective,
    );

    const attitudeNow = attitude(phys.frame, this.fwd, this.left, this.up);
    this.applyContactRules(gearGone);
    this.updateStallFlags(active);
    // Specific force along the aircraft's up axis (aero + thrust + ground) over weight.
    this.specific.copy(phys.forceBody).applyQuaternion(phys.frame.q).add(phys.forceWorld);
    this.gForce = this.specific.dot(this.up) / (phys.mass.massKg * GRAVITY);
    void attitudeNow;

    if (this.crashed && (sim.gear.summary.wheelsOnGround > 0 || sim.structure.contacts.some((c) => c.active))) {
      this.body.setLinearDamping(1.5);
      this.body.setAngularDamping(3);
    }
    const tel = this.postStep();
    this.lastStepMs = typeof performance !== 'undefined' ? performance.now() - t0 : 0;
    return tel;
  }

  private applyContactRules(gearGone: boolean): void {
    const sim = this.sim;
    const phys = sim.physics;
    const gear = sim.gear.summary;
    const hard = sim.def.hardPoints;
    // Obstacles: any hard point inside a solid ends the flight.
    if (!this.crashed && this.obstacles.length > 0) {
      for (const h of hard) {
        phys.pointWorld(h.position, this.hp);
        for (const o of this.obstacles) {
          const reach = o.kind === 'cylinder' ? o.radiusM : Math.hypot(o.halfX, o.halfZ);
          if (Math.abs(this.hp.x - o.x) > reach + 1 || Math.abs(this.hp.z - o.z) > reach + 1) continue;
          if (pointInObstacle(o, this.hp.x, this.hp.y, this.hp.z)) { this.crash('obstacle'); break; }
        }
        if (this.crashed) break;
      }
    }
    const structural = sim.structure.contacts.filter((c) => c.active);
    if (!this.crashed) {
      for (const c of structural) {
        if (c.id === 'canopy') this.crash('flipped');
        else if ((c.id === 'wingtipL' || c.id === 'wingtipR') && (c.sinkMs > 2.5 || c.speedMs > 9)) this.crash('wingStrike');
        else if (c.id === 'nose' && (c.sinkMs > 2.5 || c.speedMs > 6)) this.crash('terrain');
        else if ((c.id === 'bellyFront' || c.id === 'bellyRear') && c.sinkMs > (gearGone ? 3.5 : 2.5)) this.crash('terrain');
        else if (c.id === 'tail' && c.sinkMs > 4) this.crash('terrain');
        if (this.crashed) break;
      }
    }
    const onGround = gear.wheelsOnGround > 0 || structural.length > 0;
    if (gear.touchedDown && this.airborneS > 0.25 && !this.crashed) this.registerTouchdown(gear.maxSinkMs, structural.length > 0);
    if (!this.crashed && onGround && this.terrain.getWaterDepth(phys.pos.x, phys.pos.z) > 0.3) this.crash('water');
    if (!this.crashed && onGround && this.up.y < 0.1) this.crash('flipped');
  }

  private registerTouchdown(sinkMs: number, structuralStrike: boolean): void {
    const tol = this.sim.def.gear.toleranceMs;
    this.lastTouchdownVsMs = -sinkMs;
    this.damage = applyGroundImpact(this.damage, sinkMs * (8 / (tol * 1.8)));
    const phys = this.sim.physics;
    const pitchDeg = Math.asin(Math.max(-1, Math.min(1, this.fwd.y))) * RAD;
    const rollDeg = Math.atan2(this.left.y, this.up.y) * RAD;
    const gs = Math.hypot(phys.velWorld.x, phys.velWorld.z);
    this.touchdownClass.value = classifyTouchdown({ sinkMs, toleranceMs: tol, structuralStrike, bankDeg: rollDeg, pitchDeg, groundSpeedMs: gs });
    if (sinkMs > tol * 1.8) {
      this.crash('hardLanding');
      return;
    }
    const right = this.tmp.copy(this.left).multiplyScalar(-1);
    const sample: LandingTelemetry = { verticalSpeedMs: -sinkMs, groundSpeedMs: gs, rollDeg, pitchDeg, crosswindMs: this.windEffective.dot(right) };
    if (!this.touchdown || Math.abs(sample.verticalSpeedMs) > Math.abs(this.touchdown.verticalSpeedMs)) this.touchdown = sample;
  }

  private updateStallFlags(active: boolean): void {
    const phys = this.sim.physics;
    const airborne = this.sim.gear.summary.wheelsOnGround === 0;
    this.stalled = active && airborne && phys.airspeedMs > 3 && phys.stallMarginRad < -0.01;
    this.stallWarning = active && airborne && phys.airspeedMs > 3 && (this.sim.assistance.stallWarning || phys.stallMarginRad < 0.07 || phys.airspeedMs < this.stallSpeedMs() * 1.08);
  }

  /** 1 g stall speed of the current mass at sea-level density, m/s. */
  stallSpeedMs(): number {
    const phys = this.sim.physics;
    return Math.sqrt((2 * phys.mass.massKg * GRAVITY) / (SEA_LEVEL_DENSITY * this.sim.def.geometry.wingAreaM2 * this.clMax));
  }

  private crash(reason: CrashReason): void {
    if (this.crashed) return;
    this.crashed = true;
    this.crashReason = reason;
    this.state = 'crashed';
    this.damage = applyGroundImpact(this.damage, 99);
  }

  private postStep(): FlightTelemetry {
    const sim = this.sim;
    const phys = sim.physics;
    const dt = PHYSICS_DT;
    const t = phys.body.translation();
    const lv = phys.body.linvel();
    const speed = Math.hypot(lv.x, lv.y, lv.z);
    const groundSpeed = Math.hypot(lv.x, lv.z);
    const wheels = sim.gear.summary.wheelsOnGround;
    const agl = Math.max(0, t.y - this.terrain.getElevation(t.x, t.z) - sim.gear.restHeightM);
    const onGround = wheels > 0 || agl < 0.15;
    const rpm = sim.propulsion?.engine.rpm ?? 0;

    this.distanceM = Math.hypot(t.x - this.spawnXZ[0], t.z - this.spawnXZ[1]);
    this.maxAltitudeM = Math.max(this.maxAltitudeM, agl);
    this.maxSpeedMs = Math.max(this.maxSpeedMs, speed);

    if (wheels === 0) {
      this.airborneS += dt;
      if (this.airborneS > FLOWN_MIN_AIRBORNE_S && agl > FLOWN_MIN_HEIGHT_M) this.hasFlown = true;
      if (this.airborneS > 3) this.touchdown = null;
    } else {
      this.airborneS = 0;
    }

    if (!this.crashed && !this.landed) {
      if (wheels === 0 && agl > 0.3) {
        this.state = this.hasFlown ? 'airborne' : 'taxi';
      } else if (this.hasFlown) {
        this.state = 'groundRoll';
        if (groundSpeed < STOPPED_SPEED_MS && wheels >= 2) {
          this.stoppedS += dt;
          if (this.stoppedS >= STOPPED_HOLD_S) this.completeLanding(groundSpeed);
        } else {
          this.stoppedS = 0;
        }
      } else {
        this.state = rpm > 0 || groundSpeed > 0.5 ? 'taxi' : 'prestart';
      }
    }

    const cap = sim.def.mass.fuelCapacityL;
    const eng = sim.propulsion?.engine;
    return {
      state: this.state,
      speedMs: speed,
      altitudeM: agl,
      aoaDeg: phys.alphaRad * RAD,
      distanceM: this.distanceM,
      maxAltitudeM: this.maxAltitudeM,
      maxSpeedMs: this.maxSpeedMs,
      fuelFraction: cap > 0 ? phys.fuelL / cap : 0,
      crashed: this.crashed,
      landed: this.landed,
      landingQuality: this.landingQuality,
      rpm,
      onGround,
      crashOutcome: this.damage.outcome,
      damagedPartIds: listDamagedPartIds(this.damage),
      detachedPartIds: listDetachedPartIds(this.damage),
      landingFailures: this.landingFailures,
      elapsedS: this.elapsedS,
      position: [t.x, t.y, t.z],
      headingDeg: compassBearingDeg(this.fwd.x, this.fwd.z),
      airspeedMs: phys.airspeedMs,
      groundSpeedMs: groundSpeed,
      verticalSpeedMs: lv.y,
      pitchDeg: Math.asin(Math.max(-1, Math.min(1, this.fwd.y))) * RAD,
      rollDeg: Math.atan2(this.left.y, this.up.y) * RAD,
      throttle: eng?.state === 'running' ? sim.assisted.throttle : 0,
      engineOn: rpm > 0,
      outOfFuel: sim.propulsion !== null && phys.fuelL <= 0,
      stallWarning: this.stallWarning,
      stalled: this.stalled,
      stallSpeedMs: this.stallSpeedMs(),
      wheelsOnGround: wheels,
      gForce: this.gForce,
      lastTouchdownVsMs: this.lastTouchdownVsMs,
      crashReason: this.crashReason,
    };
  }

  private completeLanding(groundSpeed: number): void {
    this.landed = true;
    this.state = 'stopped';
    const sample = this.touchdown ?? { verticalSpeedMs: this.lastTouchdownVsMs ?? 0, groundSpeedMs: groundSpeed, rollDeg: 0, pitchDeg: 0, crosswindMs: 0 };
    const result = validateLanding(sample, this.runway);
    this.landingQuality = result.qualityScore;
    this.landingFailures = result.failures;
  }
}
