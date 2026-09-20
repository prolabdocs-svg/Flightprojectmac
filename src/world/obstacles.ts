// Solid world obstacles the flight sim collides with. Collision volumes live on the
// rendered placement itself, so the physics cannot silently drift away from the world art.
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

/** Builds colliders from the exact streamed prop anchors. `baseY` is sampled from the
 * shared terrain query, matching FlightScene's placement rather than assuming sea level. */
export function getRegionObstacles(regionId: string, terrain: Pick<TerrainQueryService, 'getElevation'>): Obstacle[] {
  return (ACTIVE_REGION_ASSETS[regionId] ?? []).reduce<Obstacle[]>((obstacles, placement) => {
    const collision = placement.collision;
    if (!collision) return obstacles;
    const [x, z] = placement.position;
    const scale = placement.scale ?? 1;
    const base = { id: placement.id, x, z, baseY: terrain.getElevation(x, z) };
    if (collision.kind === 'cylinder') {
      obstacles.push({ ...base, kind: 'cylinder', radiusM: collision.radiusM * scale, heightM: collision.heightM * scale });
      return obstacles;
    }
    obstacles.push({ ...base, kind: 'box', halfX: collision.halfX * scale, halfZ: collision.halfZ * scale, heightM: collision.heightM * scale, yawRad: placement.rotationY ?? 0 });
    return obstacles;
  }, []);
}
import { ACTIVE_REGION_ASSETS } from '../render/assetManifest';
import type { TerrainQueryService } from './terrainQuery';
