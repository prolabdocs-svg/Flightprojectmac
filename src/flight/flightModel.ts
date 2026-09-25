// Game-facing flight model (the only flight model since the legacy controller was retired). It composes the
// physical AircraftSimulation with the rules the rest of the game depends on: flight state
// machine, crash detection, landing scoring, structural damage, obstacles/water and the
// FlightTelemetry contract used by HUD, economy, missions, audio and camera.

import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { AircraftBuild } from '../core/types';
import type { ResolvedAircraft } from '../content/assembly';
import { buildAircraftDefinition } from './aircraft/quicksilver';
import { payloadMassItem } from './aircraft/payload';
import { hasFlaps } from './aircraft/aircraftDefinition';
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
  type CrashReason, type FlightState, type FlightTelemetry, type ResolvedControls,
} from './flightTypes';
import {
  applyImpact, impactEnergyJ, isAirframeLost, getPowerMultiplier, getVibration,
  createDamageState, getAeroEffectivenessMultiplier, getGroundHandlingPenalty, listDamagedPartIds, listDetachedPartIds, gearPartId, type DamageState,
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
  /** Fuel on board at takeoff (L, default = full tank) and payload mass (kg, default none). */
  load?: { fuelL?: number; payloadKg?: number };
  /** Persistent condition carried in from the previous flight (mission/aircraftCondition.ts),
   * so a wing that came back damaged stays damaged instead of resetting to nominal. Undefined
   * = fresh/nominal (free flight, or a profile with no persistent condition yet). */
  initialPartIntegrity?: Record<string, number>;
  /** Combined engine+propeller output multiplier from persistent condition (1 = nominal). */
  powerMultiplier?: number;
}

export class FlightModel {
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
  private readonly initialFuelL: number;
  private readonly initialPartIntegrity?: Record<string, number>;
  private readonly basePower: number;
  private readonly hasFlaps: boolean;
  /** Hard points in contact last tick (ground or obstacle): impacts are edge-triggered. */
  private readonly touching = new Set<string>();
  /** An obstacle strike started this chain of damage; it stays the crash reason. */
  private obstacleStruck = false;

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
  private impactZone: string | null = null;
  private impactSpeedMs = 0;
  private gForce = 1;
  private stalled = false;
  private stallWarning = false;
  private windEffective = new THREE.Vector3();
  /** Ground elevation under the CG from the previous tick's physics sample (one terrain query per tick). */
  private groundY = 0;
  private cachedDamage: DamageState | null = null;
  private damagedIds: string[] = [];
  private detachedIds: string[] = [];
  private readonly fwd = new THREE.Vector3();
  private readonly left = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly specific = new THREE.Vector3();
  private readonly hp = new THREE.Vector3();
  get gLoad(): number {
    return this.gForce;
  }

  /** Wind actually applied to the airflow last tick (mean + gust + shear + turbulence), world axes. */
  get appliedWind(): THREE.Vector3 {
    return this.windEffective;
  }

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
    const payloadKg = Math.max(0, opts.load?.payloadKg ?? 0);
    if (payloadKg > 0) def.mass.items.push(payloadMassItem(payloadKg, def.mass.payloadPosition));
    this.hasFlaps = hasFlaps(def);
    this.initialFuelL = Math.min(def.mass.fuelCapacityL, Math.max(0, opts.load?.fuelL ?? def.mass.fuelCapacityL));
    this.sim = new AircraftSimulation(world, def, groundFromTerrain(terrain));
    this.sim.physics.fuelL = this.initialFuelL;
    this.sim.physics.refreshMass(true);
    this.clMax = getAirfoilTable(def.aero.airfoils.wing).clMax * 0.96;
    this.initialPartIntegrity = opts.initialPartIntegrity;
    this.damage = this.seededDamageState();
    this.sim.effectiveness = (id) => getAeroEffectivenessMultiplier(this.damage, id);
    this.basePower = Math.max(0, opts.powerMultiplier ?? 1);
    this.sim.powerMultiplier = this.basePower;
    this.sim.placeOnGround(this.spawnXZ[0], this.spawnXZ[1], this.spawnHeadingDeg);
    this.groundY = terrain.getElevation(spawnPos.x, spawnPos.z);
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
    this.sim.physics.fuelL = this.initialFuelL;
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
    this.impactZone = null;
    this.impactSpeedMs = 0;
    this.touchdownClass.value = null;
    this.damage = this.seededDamageState();
    this.touching.clear();
    this.obstacleStruck = false;
  }

  /** Fresh nominal damage state, with any part the caller carried in from a persistent
   * AircraftCondition (mission/aircraftCondition.ts) starting at its prior integrity instead
   * of 1 — this is what makes damage survive between flights (task item 3). */
  private seededDamageState(): DamageState {
    const fresh = createDamageState(this.aircraft.aeroSurfaces.map((s) => s.id), this.sim.def.damage);
    const carried = this.initialPartIntegrity;
    if (!carried) return fresh;
    const parts: DamageState['parts'] = {};
    for (const [id, part] of Object.entries(fresh.parts)) {
      const integrity = carried[id] ?? part.integrity;
      parts[id] = { ...part, integrity, detached: integrity <= 0 };
    }
    return { ...fresh, parts };
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
    this.sim.powerMultiplier = this.basePower * getPowerMultiplier(this.damage, this.elapsedS);
    const p = phys.pos;
    this.windField.sample(meanWind, p, this.elapsedS, p.y - this.groundY, this.windEffective);

    sim.step(
      {
        pitch: active ? controls.pitch : 0,
        roll: active ? controls.roll : 0,
        yaw: active ? controls.rudder : 0,
        throttle: active ? controls.throttle : 0,
        brake: controls.brake ? 1 : 0,
        flaps: controls.flapsDown && this.hasFlaps,
        engineOn,
        assist: assistLevelFromMode(controls.assistMode),
        gearAttached: !gearGone,
        gearPenalty: getGroundHandlingPenalty(this.damage),
      },
      this.windEffective,
    );

    attitude(phys.frame, this.fwd, this.left, this.up);
    this.groundY = phys.cgWorld.y - phys.heightAglM;
    this.applyContactRules(gearGone);
    this.updateStallFlags(active);
    // Specific force along the aircraft's up axis (aero + thrust + ground) over weight.
    this.specific.copy(phys.forceBody).applyQuaternion(phys.frame.q).add(phys.forceWorld);
    this.gForce = this.specific.dot(this.up) / (phys.mass.massKg * GRAVITY);

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
    const massKg = phys.mass.massKg;
    const wasTouching = new Set(this.touching);
    this.touching.clear();
    // Obstacles (trees, buildings): resolve an impulse at the struck hard point so an
    // off-centre hit yaws/rolls the airframe, and damage the local components once per entry.
    if (!this.crashed && this.obstacles.length > 0) {
      for (const h of sim.def.hardPoints) {
        phys.pointWorld(h.position, this.hp);
        for (const o of this.obstacles) {
          const reach = o.kind === 'cylinder' ? o.radiusM : Math.hypot(o.halfX, o.halfZ);
          if (Math.abs(this.hp.x - o.x) > reach + 1 || Math.abs(this.hp.z - o.z) > reach + 1) continue;
          if (!pointInObstacle(o, this.hp.x, this.hp.y, this.hp.z)) continue;
          const key = `obs:${h.id}`;
          this.touching.add(key);
          if (wasTouching.has(key)) break;
          const v = phys.body.linvel();
          const impactSpeed = Math.hypot(v.x, v.y, v.z);
          const impulseScale = -Math.min(0.72, 0.22 + impactSpeed * 0.018) * massKg;
          phys.body.applyImpulseAtPoint({ x: v.x * impulseScale, y: v.y * impulseScale, z: v.z * impulseScale }, { x: this.hp.x, y: this.hp.y, z: this.hp.z }, true);
          this.noteImpact(h.id, impactSpeed);
          this.obstacleStruck = true;
          // Obstacles are treated as head-on: most of the velocity is normal to the surface.
          this.damage = applyImpact(this.damage, h.id, impactEnergyJ(massKg, impactSpeed * 0.8, impactSpeed * 0.6));
          break;
        }
      }
    }
    let structuralCount = 0;
    for (const c of sim.structure.contacts) {
      if (!c.active) continue;
      structuralCount++;
      this.touching.add(c.id);
      const tangent = Math.sqrt(Math.max(0, c.speedMs * c.speedMs - c.sinkMs * c.sinkMs));
      if (!wasTouching.has(c.id)) {
        // New strike: full normal energy at this point.
        if (c.sinkMs > 0.5 || c.speedMs > 3) this.noteImpact(c.id, Math.max(c.sinkMs, c.speedMs));
        this.damage = applyImpact(this.damage, c.id, impactEnergyJ(massKg, c.sinkMs, tangent));
      } else if (tangent > 1) {
        // Sustained scrape: friction work this tick, no elastic threshold.
        this.damage = applyImpact(this.damage, c.id, 0.35 * c.loadN * tangent * PHYSICS_DT, false);
      }
    }
    const onGround = gear.wheelsOnGround > 0 || structuralCount > 0;
    if (gear.touchedDown && this.airborneS > 0.25 && !this.crashed) this.registerTouchdown(gear.maxSinkMs, structuralCount > 0, massKg);
    if (this.crashed) return;
    if (isAirframeLost(this.damage) && this.obstacleStruck) this.crash('obstacle');
    else if (isAirframeLost(this.damage)) this.crash(this.impactZone === 'wingtipL' || this.impactZone === 'wingtipR' ? 'wingStrike' : 'terrain');
    else if (onGround && this.terrain.getWaterDepth(phys.pos.x, phys.pos.z) > 0.3) this.crash('water');
    else if (onGround && (this.up.y < 0.1 || sim.structure.contacts.some((c) => c.active && c.id === 'canopy'))) this.crash('flipped');
    else if (gearGone && onGround && this.hasFlown && !this.landed && Math.hypot(phys.velWorld.x, phys.velWorld.z) < STOPPED_SPEED_MS) this.completeLanding(0); // belly landing still ends the flight
  }

  private noteImpact(zone: string, speedMs: number): void {
    this.impactZone = zone;
    this.impactSpeedMs = Math.max(this.impactSpeedMs, speedMs);
  }

  private registerTouchdown(sinkMs: number, structuralStrike: boolean, massKg: number): void {
    const tol = this.sim.def.gear.toleranceMs;
    this.lastTouchdownVsMs = -sinkMs;
    if (sinkMs > 1.1 && !this.impactZone) {
      this.impactZone = 'gear';
      this.impactSpeedMs = sinkMs;
    }
    const gs0 = Math.hypot(this.sim.physics.velWorld.x, this.sim.physics.velWorld.z);
    this.damage = applyImpact(this.damage, 'gear', impactEnergyJ(massKg, sinkMs, gs0 * 0.15));
    const phys = this.sim.physics;
    const pitchDeg = Math.asin(Math.max(-1, Math.min(1, this.fwd.y))) * RAD;
    const rollDeg = Math.atan2(this.left.y, this.up.y) * RAD;
    const gs = Math.hypot(phys.velWorld.x, phys.velWorld.z);
    this.touchdownClass.value = classifyTouchdown({ sinkMs, toleranceMs: tol, structuralStrike, bankDeg: rollDeg, pitchDeg, groundSpeedMs: gs });
    if (isAirframeLost(this.damage)) {
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
    // Preserve the localized damage accumulated at contact. A fatal event still
    // represents a total loss, but does not magically detach every component before impact.
    this.damage = { ...this.damage, outcome: 'totalLoss' };
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
    const agl = Math.max(0, t.y - this.groundY - sim.gear.restHeightM);
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

    this.refreshDamageLists();
    const cap = sim.def.mass.fuelCapacityL;
    const eng = sim.propulsion?.engine;
    return {
      state: this.state,
      speedMs: speed,
      altitudeM: agl,
      aoaDeg: phys.alphaRad * RAD,
      sideslipDeg: phys.betaRad * RAD,
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
      damagedPartIds: this.damagedIds,
      detachedPartIds: this.detachedIds,
      partIntegrity: this.partIntegritySnapshot(),
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
      engineTempFrac: sim.propulsion?.tempFrac ?? 0,
      engineDerate: sim.propulsion?.thermalDerate ?? 1,
      stallWarning: this.stallWarning,
      stalled: this.stalled,
      stallSpeedMs: this.stallSpeedMs(),
      wheelsOnGround: wheels,
      gForce: this.gForce,
      lastTouchdownVsMs: this.lastTouchdownVsMs,
      crashReason: this.crashReason,
      impactZone: this.impactZone,
      impactSpeedMs: this.impactSpeedMs,
      vibration: getVibration(this.damage),
    };
  }

  /** Part-id lists only change when the damage state does; rebuild them then, not every tick. */
  private refreshDamageLists(): void {
    if (this.cachedDamage === this.damage) return;
    this.cachedDamage = this.damage;
    this.damagedIds = listDamagedPartIds(this.damage);
    this.detachedIds = listDetachedPartIds(this.damage);
  }

  private partIntegritySnapshot(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [id, part] of Object.entries(this.damage.parts)) out[id] = part.detached ? 0 : part.integrity;
    return out;
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
