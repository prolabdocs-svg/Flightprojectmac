// World handedness: +Y up, +Z = north = aircraft forward at heading 0. Three.js is
// right-handed, so an aircraft facing +Z has its RIGHT wing on -X. East is therefore -X.
// Every heading/bearing/map projection must go through these helpers, otherwise the
// navigation arrow and map end up mirrored relative to what the player sees.

/** Compass bearing (0 = north/+Z, 90 = east/-X, clockwise) of a world-space XZ direction. */
export function compassBearingDeg(dx: number, dz: number): number {
  return ((Math.atan2(-dx, dz) * 180) / Math.PI + 360) % 360;
}

/** Signed smallest difference target - current, in (-180, 180]. Positive = turn right. */
export function bearingDeltaDeg(targetDeg: number, currentDeg: number): number {
  return ((targetDeg - currentDeg + 540) % 360) - 180;
}

/** Map/screen projection of a world XZ point: east (-X) to the right, north (+Z) up. */
export function worldToMapXY(x: number, z: number): { east: number; north: number } {
  return { east: -x, north: z };
}

/** World XZ unit direction for a compass heading (inverse of compassBearingDeg). */
export function headingToWorldDir(headingDeg: number): { x: number; z: number } {
  const r = (headingDeg * Math.PI) / 180;
  return { x: -Math.sin(r), z: Math.cos(r) };
}
