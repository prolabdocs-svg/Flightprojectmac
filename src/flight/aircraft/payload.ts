// Payload (cargo / passengers) as a real mass item, so it moves mass, CG and inertia through the
// same massModel the simulation and the performance analysis both use.

import type { MassItem } from './aircraftDefinition';

/** Cargo bay just behind the pilot seat (body axes: x left, y up, z nose). PLACEHOLDER station. */
const PAYLOAD_POSITION: MassItem['position'] = [0, 0.05, -0.85];
const PAYLOAD_SIZE: MassItem['size'] = [0.5, 0.4, 0.5];

export function payloadMassItem(massKg: number): MassItem {
  return { id: 'payload', massKg, position: PAYLOAD_POSITION, size: PAYLOAD_SIZE };
}
