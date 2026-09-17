import * as THREE from 'three';

/** Keeps rendered (local) coordinates near zero during long flights by rebasing
 * the origin once the aircraft strays too far, shifting every registered object
 * by the same delta so their relative positions don't change (WLD-10 spec §256). */
export class FloatingOrigin {
  private origin = new THREE.Vector3();
  private readonly registered = new Set<THREE.Object3D>();

  constructor(private readonly rebaseThresholdM = 5000) {}

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

    this.origin.add(local);
    for (const object of this.registered) object.position.sub(local);
    return local;
  }
}
