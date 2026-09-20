// Aircraft assembly: combines a frame + installed parts into resolved physics data.
// Implements a simplified version of spec sections 35 (Aircraft Entity Model) and 36 (Mass/CoM).

import type { AeroSurfaceSpec, AircraftBuild, EngineSpec, FrameDefinition, PartCategory, Vec3 } from '../core/types';
import { FRAMES, FRAME_ZERO, getFrame, getPart } from './parts';

export interface ResolvedAircraft {
  frame: FrameDefinition;
  totalMassKg: number;
  centerOfMass: Vec3;
  aeroSurfaces: AeroSurfaceSpec[];
  engine: EngineSpec | null;
  fuelCapacityL: number;
  groundFrictionMul: number;
  totalDragArea: number;
  totalDragCoefficient: number;
  gearPartId?: string;
}

export function defaultBuild(): AircraftBuild {
  return {
    frameId: FRAME_ZERO.id,
    installed: { ...FRAME_ZERO.defaultLoadout },
  };
}

/**
 * Build for `frame`, keeping whatever the player already had installed where the new
 * frame's hardpoints accept it and falling back to the frame's own default loadout
 * otherwise. Used by airframe selection (state/profileStore.ts) and by save migration
 * (save/save.ts), so a frame swap can never produce a loadout the frame doesn't accept.
 */
export function buildForFrame(frame: FrameDefinition, previous?: AircraftBuild): AircraftBuild {
  const installed: AircraftBuild['installed'] = {};
  for (const hardpoint of frame.hardpoints) {
    const carried = previous?.installed[hardpoint.category];
    installed[hardpoint.category] = carried && hardpoint.accepts.includes(carried)
      ? carried
      : frame.defaultLoadout[hardpoint.category];
  }
  return { frameId: frame.id, installed };
}

/** Parts a frame comes with, i.e. what buying it puts in the player's inventory. */
export function frameLoadoutPartIds(frame: FrameDefinition): string[] {
  return Object.values(frame.defaultLoadout).filter(Boolean) as string[];
}

/** Resolves a persisted build back to a frame the player actually owns, repairing any
 * loadout the frame no longer accepts. Unknown or unowned frames fall back to the starter. */
export function sanitizeBuild(build: AircraftBuild | undefined, ownedFrameIds: string[]): AircraftBuild {
  const frame = build && ownedFrameIds.includes(build.frameId) ? getFrame(build.frameId) : undefined;
  return buildForFrame(frame ?? FRAME_ZERO, build);
}

function addWeighted(acc: Vec3, mass: number, pos: Vec3, totalMass: number): Vec3 {
  return [
    acc[0] + (pos[0] * mass) / totalMass,
    acc[1] + (pos[1] * mass) / totalMass,
    acc[2] + (pos[2] * mass) / totalMass,
  ];
}

export function resolveAircraft(build: AircraftBuild, frames: FrameDefinition[] = FRAMES): ResolvedAircraft {
  const frame = frames.find((f) => f.id === build.frameId) ?? FRAME_ZERO;

  let totalMass = frame.basePhysics.massKg;
  const installedIds = Object.values(build.installed).filter(Boolean) as string[];
  for (const id of installedIds) {
    const part = getPart(id);
    if (part) totalMass += part.physics.massKg;
  }

  let com: Vec3 = [0, 0, 0];
  com = addWeighted(com, frame.basePhysics.massKg, frame.basePhysics.localCenterOfMass, totalMass);
  let dragArea = frame.basePhysics.dragArea;
  let dragCoefficient = frame.basePhysics.dragCoefficient;

  const aeroSurfaces: AeroSurfaceSpec[] = [...frame.baseAeroSurfaces];
  let engine: EngineSpec | null = null;
  let fuelCapacityL = 0;
  let groundFrictionMul = 1.0;

  for (const id of installedIds) {
    const part = getPart(id);
    if (!part) continue;
    com = addWeighted(com, part.physics.massKg, part.physics.localCenterOfMass, totalMass);
    dragArea += part.physics.dragArea;
    dragCoefficient = Math.max(dragCoefficient, part.physics.dragCoefficient);
    if (part.aeroSurfaces) aeroSurfaces.push(...part.aeroSurfaces);
    if (part.engine) engine = part.engine;
    fuelCapacityL += part.fuelCapacityL ?? 0;
    if (part.groundFrictionMul) groundFrictionMul = part.groundFrictionMul;
  }

  return {
    frame,
    totalMassKg: totalMass,
    centerOfMass: com,
    aeroSurfaces,
    engine,
    fuelCapacityL: fuelCapacityL || 8,
    groundFrictionMul,
    totalDragArea: dragArea,
    totalDragCoefficient: dragCoefficient,
    gearPartId: build.installed.landingGear,
  };
}

export function installPart(build: AircraftBuild, category: PartCategory, partId: string): AircraftBuild {
  return { ...build, installed: { ...build.installed, [category]: partId } };
}
