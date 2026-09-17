/** Deterministic, presentation-only traffic routes. They are deliberately separate
 * from physics: distant aircraft make free flight feel inhabited without creating
 * unpredictable collision hazards or consuming the player's simulation budget. */
export interface AmbientTrafficPose {
  x: number;
  y: number;
  z: number;
  headingRad: number;
}

function regionPhase(regionId: string): number {
  let hash = 2166136261;
  for (let i = 0; i < regionId.length; i++) {
    hash ^= regionId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 628) / 100;
}

export function getAmbientTrafficPose(regionId: string, routeIndex: number, elapsedS: number): AmbientTrafficPose {
  const radius = 360 + routeIndex * 170;
  const angle = regionPhase(regionId) + routeIndex * 1.9 + elapsedS * (0.035 + routeIndex * 0.006);
  const x = Math.cos(angle) * radius;
  const z = 260 + Math.sin(angle) * radius * 0.58;
  // Tangent heading: Three's local +Z faces the direction of travel.
  const headingRad = Math.atan2(-Math.sin(angle), Math.cos(angle) * 0.58);
  return { x, y: 72 + routeIndex * 36 + Math.sin(angle * 2.3) * 12, z, headingRad };
}
