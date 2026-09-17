// Rapier physics bootstrap (spec section 8.1 / 31.1). Rigid body dynamics, gravity and
// ground contact are delegated to Rapier; aerodynamic forces are computed by our own layer
// and applied as forces/torques on the aircraft's single dynamic rigid body.

import RAPIER from '@dimforge/rapier3d-compat';

let initialized = false;
let initialization: Promise<typeof RAPIER> | undefined;

export async function initPhysics(): Promise<typeof RAPIER> {
  if (initialized) return RAPIER;
  initialization ??= RAPIER.init().then(() => {
    initialized = true;
    return RAPIER;
  });
  return initialization;
}

export function createWorld(): RAPIER.World {
  const gravity = { x: 0.0, y: -9.81, z: 0.0 };
  return new RAPIER.World(gravity);
}
