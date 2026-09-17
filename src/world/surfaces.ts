import type { RunwaySurface } from './airfields';

/** Ground surface registry (WLD-00 contracts, world spec section 65/169). Single source of
 * truth so physics, VFX and audio all key off the same surface id instead of drifting apart
 * across three separate tables. Ids extend the existing `RunwaySurface` set (used by
 * authored runways) with the natural off-runway ground surfaces `TerrainQueryService`
 * derives from region terrain type. */
export type GroundSurfaceId = RunwaySurface | 'scrub' | 'rock' | 'forest_floor' | 'sand';

export interface GroundSurfaceDefinition {
  id: GroundSurfaceId;
  /** 0 (rolls freely) to 1 (very draggy) — taxi/roll drag, not yet wired into physics. */
  rollingResistance: number;
  /** 0..1 dry braking grip. */
  brakingGripDry: number;
  /** 0..1 wheel/prop dust emission strength. */
  dustFactor: number;
  /** 0..1 surface roughness, feeds landing-quality/emergency-landing scoring. */
  bumpiness: number;
}

export const GROUND_SURFACES: Record<GroundSurfaceId, GroundSurfaceDefinition> = {
  tarmac: { id: 'tarmac', rollingResistance: 0.02, brakingGripDry: 0.95, dustFactor: 0.02, bumpiness: 0.05 },
  grass: { id: 'grass', rollingResistance: 0.06, brakingGripDry: 0.75, dustFactor: 0.05, bumpiness: 0.25 },
  dirt: { id: 'dirt', rollingResistance: 0.08, brakingGripDry: 0.7, dustFactor: 0.6, bumpiness: 0.35 },
  gravel: { id: 'gravel', rollingResistance: 0.1, brakingGripDry: 0.65, dustFactor: 0.35, bumpiness: 0.45 },
  salt: { id: 'salt', rollingResistance: 0.03, brakingGripDry: 0.85, dustFactor: 0.1, bumpiness: 0.08 },
  scrub: { id: 'scrub', rollingResistance: 0.12, brakingGripDry: 0.6, dustFactor: 0.4, bumpiness: 0.5 },
  rock: { id: 'rock', rollingResistance: 0.15, brakingGripDry: 0.55, dustFactor: 0.1, bumpiness: 0.7 },
  forest_floor: { id: 'forest_floor', rollingResistance: 0.14, brakingGripDry: 0.55, dustFactor: 0.05, bumpiness: 0.55 },
  sand: { id: 'sand', rollingResistance: 0.2, brakingGripDry: 0.5, dustFactor: 0.55, bumpiness: 0.3 },
};

export function getGroundSurface(id: GroundSurfaceId): GroundSurfaceDefinition {
  return GROUND_SURFACES[id];
}
