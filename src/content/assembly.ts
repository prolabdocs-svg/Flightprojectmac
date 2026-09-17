// Aircraft assembly: combines a frame + installed parts into resolved physics data.
// Implements a simplified version of spec sections 35 (Aircraft Entity Model) and 36 (Mass/CoM).

import type { AeroSurfaceSpec, AircraftBuild, EngineSpec, FrameDefinition, PartCategory, Vec3 } from '../core/types';
import { FRAMES, FRAME_ZERO, getPart } from './parts';

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
