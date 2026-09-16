// Core domain types shared across the simulation, content and UI layers.
// Mirrors the data model described in the PROJECT FLIGHT spec (secciones 6, 35, 43).

import type { Vector3 } from 'three';

export type Vec3 = [number, number, number];

/** Minimum physical properties every functional part must define (spec 6.2). */
export interface PartPhysics {
  massKg: number;
  localCenterOfMass: Vec3;
  dragArea: number;
  dragCoefficient: number;
  structuralStrength: number;
  impactTolerance: number;
  mountStrength: number;
}

export type ControlAxis = 'pitch' | 'roll' | 'yaw' | 'flap';

/** Aerodynamic surface spec (spec 6.2). */
export interface AeroSurfaceSpec {
  id: string;
  /** Attachment offset relative to aircraft origin, meters. */
  localPosition: Vec3;
  areaM2: number;
  spanM: number;
  chordM: number;
  zeroLiftAoADeg: number;
  stallPositiveDeg: number;
  stallNegativeDeg: number;
  inducedDragFactor: number;
  parasiticCd: number;
  controlAuthority?: number;
  controlAxis?: ControlAxis;
  /** Max deflection in degrees for control surfaces. */
  maxDeflectionDeg?: number;
}

export type EngineType = 'twoStroke' | 'fourStroke' | 'electric' | 'turbine' | 'experimental';

export interface EngineSpec {
  id: string;
  name: string;
  type: EngineType;
  maxPowerKw: number;
  idleRpm: number;
  redlineRpm: number;
  responseTime: number;
  thermalLimit: number;
  reliabilityClass: number;
  propEfficiency: number;
  propDiameterM: number;
}

export type PartCategory =
  | 'frame'
  | 'wingSet'
  | 'tailAssembly'
  | 'engine'
  | 'propeller'
  | 'fuelTank'
  | 'landingGear'
  | 'wheels';

export interface PartDefinition {
  id: string;
  category: PartCategory;
  name: string;
  description: string;
  tier: number;
  priceCash: number;
  physics: PartPhysics;
  aeroSurfaces?: AeroSurfaceSpec[];
  engine?: EngineSpec;
  /** Rolling resistance / friction multiplier for gear parts. */
  groundFrictionMul?: number;
  /** If set, this part is hidden/locked in the Builder until this tech node is unlocked (spec 15, 82.9). */
  requiresTechId?: string;
}

/** Tech tree node (spec section 15 "Árbol tecnológico" + 153.4 "Tech graph"). */
export type TechCategory =
  | 'airframe'
  | 'aerodynamics'
  | 'control'
  | 'power'
  | 'ground'
  | 'instruments'
  | 'safety';

export interface TechNodeDef {
  id: string;
  category: TechCategory;
  name: string;
  description: string;
  costRp: number;
  /** Prerequisite tech node ids that must already be unlocked. */
  requires: string[];
  /** Part ids this node unlocks for purchase/installation in the Builder. */
  unlocksPartIds: string[];
}

/** Paint/customization preset (spec 82.11 "Paint/Customization"). */
export interface PaintPreset {
  id: string;
  name: string;
  fabricColor: string;
  tubeColor: string;
  priceCash: number;
  tier: number;
}

export interface Hardpoint {
  id: string;
  category: PartCategory;
  accepts: string[]; // part ids
}

export interface FrameDefinition {
  id: string;
  name: string;
  tier: number;
  hardpoints: Hardpoint[];
  basePhysics: PartPhysics;
  baseAeroSurfaces: AeroSurfaceSpec[];
  defaultLoadout: Partial<Record<PartCategory, string>>;
}

export interface AircraftBuild {
  frameId: string;
  installed: Partial<Record<PartCategory, string>>;
}

export interface MissionObjectiveBonus {
  id: string;
  label: string;
  check: 'noDamage' | 'timeUnder' | 'fuelRemaining' | 'landingQuality';
  value?: number;
  rewardCash: number;
  rewardRp: number;
}

export type MissionFamily =
  | 'distanceRun'
  | 'precisionLanding'
  | 'stolChallenge'
  | 'timeTrial';

export interface MissionDefinition {
  id: string;
  regionId: string;
  family: MissionFamily;
  name: string;
  description: string;
  spawnPoint: Vec3;
  spawnHeadingDeg: number;
  targetPoint?: Vec3;
  targetRadiusM?: number;
  minDistanceM?: number;
  rewardBaseCash: number;
  rewardBaseRp: number;
  bonuses: MissionObjectiveBonus[];
}

export interface RegionDefinition {
  id: string;
  name: string;
  description: string;
  windBaseMs: Vec3;
  groundColor: string;
  skyColor: string;
}

export interface PlayerProfile {
  schemaVersion: number;
  createdAt: number;
  cash: number;
  researchPoints: number;
  salvage: number;
  reputation: number;
  ownedParts: string[];
  unlockedMissions: string[];
  unlockedTech: string[];
  ownedPaintIds: string[];
  selectedPaintId: string;
  completedMissions: Record<string, { bestScore: number; attempts: number }>;
  currentBuild: AircraftBuild;
  settings: {
    controlPreset: 'beginner' | 'normal' | 'sport' | 'custom';
    assistMode: 'assisted' | 'standard' | 'acro';
    invertPitch: boolean;
    stickSize: number;
    musicVolume: number;
    sfxVolume: number;
  };
}

export interface FlightResult {
  missionId: string | null;
  distanceM: number;
  maxAltitudeM: number;
  maxSpeedMs: number;
  crashed: boolean;
  landed: boolean;
  landingQuality: number; // 0..1
  timeS: number;
  fuelRemaining: number; // 0..1
  rewardCash: number;
  rewardRp: number;
  bonusesAchieved: string[];
}

export type ThreeVec3 = Vector3;
