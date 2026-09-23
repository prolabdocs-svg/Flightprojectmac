import * as THREE from 'three';

/** Keeps rendered (local) coordinates near zero during long flights by rebasing
 * the origin once the aircraft strays too far, shifting every registered object
 * by the same delta so their relative positions don't change (WLD-10 spec §256). */
export class FloatingOrigin {
  private origin = new THREE.Vector3();
  private readonly registered = new Set<THREE.Object3D>();

  private readonly rebaseThresholdM: number;
  private readonly gridSnapM: number;

  /** `gridSnapM` > 0 quantises every rebase to a multiple of that size (the master world uses its 512 m chunk lattice), so the
   * origin always sits on a chunk corner and chunk-local vertex data never has to be recomputed after a rebase. 0 = exact (legacy). */
  constructor(rebaseThresholdM = 5000, gridSnapM = 0) { this.rebaseThresholdM = rebaseThresholdM; this.gridSnapM = gridSnapM; }

  register(object: THREE.Object3D) { this.registered.add(object); }
  unregister(object: THREE.Object3D) { this.registered.delete(object); }

  /** True global position -> current local (renderable) position. */
  toLocal(global: THREE.Vector3): THREE.Vector3 { return global.clone().sub(this.origin); }
  /** Current local position -> true global position. */
  toGlobal(local: THREE.Vector3): THREE.Vector3 { return local.clone().add(this.origin); }

  get originOffset(): THREE.Vector3 { return this.origin.clone(); }

  /** Call each frame with the aircraft's true global position. Rebases (and shifts
   * every registered object) if the local offset exceeds the threshold. Returns the
   * rebase delta, or null if no rebase happened. */
  update(globalAircraftPos: THREE.Vector3): THREE.Vector3 | null {
    const local = this.toLocal(globalAircraftPos);
    if (local.length() < this.rebaseThresholdM) return null;

    if (this.gridSnapM > 0) {
      const g = this.gridSnapM;
      local.set(Math.round((this.origin.x + local.x) / g) * g - this.origin.x, local.y, Math.round((this.origin.z + local.z) / g) * g - this.origin.z);
    }
    this.origin.add(local);
    for (const object of this.registered) object.position.sub(local);
    return local;
  }
}
