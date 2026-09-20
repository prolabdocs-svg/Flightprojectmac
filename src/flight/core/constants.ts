// Shared physical constants and the fixed simulation rate. One place so world.timestep,
// FixedStepClock and every integration-dependent term can never disagree.

export const GRAVITY = 9.80665; // m/s^2, standard gravity
export const SEA_LEVEL_DENSITY = 1.225; // kg/m^3 (ISA)
export const SEA_LEVEL_PRESSURE = 101325; // Pa
export const SEA_LEVEL_TEMPERATURE = 288.15; // K
export const GAS_CONSTANT_AIR = 287.05287; // J/(kg K)

/** Fixed physics rate (spec section 26: 50-100 Hz). Rapier's world.timestep must equal PHYSICS_DT. */
export const PHYSICS_HZ = 100;
export const PHYSICS_DT = 1 / PHYSICS_HZ;

/** Below this in-plane airspeed (m/s) an aero element produces no force (avoids atan2 noise). */
export const MIN_AIRFLOW_MS = 0.3;

export const DEG = Math.PI / 180;
