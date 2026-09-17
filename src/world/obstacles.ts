// Solid world obstacles the flight sim collides with (barns, towers, cranes, trees near
// airfields, mesas...). Rendered props are presentation; this list is the physics truth.
// Shapes are deliberately primitive: an upright cylinder or a yaw-rotated box, both
// standing on `baseY`. FlightController tests aircraft hard points against them.

export type Obstacle =
  | { kind: 'cylinder'; id: string; x: number; z: number; baseY: number; radiusM: number; heightM: number }
  | { kind: 'box'; id: string; x: number; z: number; baseY: number; halfX: number; halfZ: number; heightM: number; yawRad: number };

/** True if world point (px, py, pz) is inside the obstacle volume. */
export function pointInObstacle(o: Obstacle, px: number, py: number, pz: number): boolean {
  if (py < o.baseY || py > o.baseY + o.heightM) return false;
  const dx = px - o.x;
  const dz = pz - o.z;
  if (o.kind === 'cylinder') return dx * dx + dz * dz <= o.radiusM * o.radiusM;
  const c = Math.cos(o.yawRad);
  const s = Math.sin(o.yawRad);
  const lx = c * dx - s * dz;
  const lz = s * dx + c * dz;
  return Math.abs(lx) <= o.halfX && Math.abs(lz) <= o.halfZ;
}

/** Pure, deterministic obstacle list for a region (same data the renderer draws).
 * The world layer owns the contents; the flight sim only consumes it. */
export function getRegionObstacles(regionId: string): Obstacle[] {
  void regionId;
  return [];
}
