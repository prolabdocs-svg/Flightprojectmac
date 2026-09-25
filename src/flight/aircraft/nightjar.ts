// Ridgeway RW-12 "Nightjar": the second playable aircraft. A fictional two-seat, side-by-side, strut-braced
// high-wing pusher ultralight whose construction follows the RANS S-12 Airaile family (enclosed pod on an
// aluminium-tube cage, single tail boom, engine above the wing root with the propeller turning in a
// trailing-edge notch, long fabric wing with conventional ailerons, spring-leg tricycle gear).
// Research + calibration notes: docs/aircraft/NIGHTJAR_RW12.md.
//
// All positions are in the GLB's own axes (public/assets/models/airframes/nightjar_rw12.glb, built by
// tools/nightjar/build_nightjar.mjs): +X left wing, +Y up, +Z nose, metres, tyre bottoms on y = 0.
// Geometry is MEASURED off that asset; masses are ESTIMATED to land on the S-12 class (≈215 kg empty with a
// 50 hp two-stroke); aero coefficients are ESTIMATED/CALIBRATED against the class performance bands in
// src/flight/testing/nightjar.test.ts. None of this is RANS data for any particular airframe.

import type { AircraftBuild } from '../../core/types';
import type { AircraftDefinition } from './aircraftDefinition';
import { buildFromAirframeSpec, type AirframeSpec } from './airframeSpec';
import { gearPartId } from '../../sim/damageSystem';

export const NIGHTJAR_ID = 'frame_nightjar';

const GEAR = gearPartId();
/** Static strut compression; wheel contact points sit this far below the tyre bottoms (full extension). */
const SC = 0.045;

export const NIGHTJAR_AIRFRAME: AirframeSpec = {
  id: NIGHTJAR_ID,
  name: 'Ridgeway RW-12 Nightjar',
  structure: [
    { id: 'wing', massKg: 44, position: [0, 1.97, -0.4], size: [8.6, 0.2, 1.48] },
    { id: 'struts_cabane', massKg: 9, position: [0, 1.35, -0.3], size: [5.2, 1.1, 0.8] },
    { id: 'cabin_pod', massKg: 64, position: [0, 1.15, 0.55], size: [1.1, 1.2, 2.8] },
    { id: 'nose_systems', massKg: 7, position: [0, 0.85, 1.5], size: [0.5, 0.3, 0.4] },
    { id: 'tail_boom', massKg: 9, position: [0, 0.9, -3.0], size: [0.36, 0.25, 4.0] },
    { id: 'empennage', massKg: 8, position: [0, 1.4, -4.7], size: [2.6, 1.35, 0.9] },
    { id: 'nose_gear', massKg: 6, position: [0, 0.4, 1.62], size: [0.3, 0.7, 0.5] },
    { id: 'propeller_redrive', massKg: 5, position: [0, 2.09, -0.8], size: [1.37, 0.2, 0.3] },
  ],
  stations: {
    // Pilot flies from the LEFT seat; the right seat is the passenger / payload station.
    pilot: { position: [0.255, 1.12, -0.02], size: [0.45, 0.9, 0.6], massKg: 70 },
    engine: { position: [0, 2.07, -0.44], size: [0.7, 0.3, 0.5] },
    fuel: { position: [0, 0.95, -0.55], size: [0.6, 0.25, 0.35] },
    mainGear: { position: [0, 0.35, -0.5], size: [1.7, 0.6, 0.7] },
    payload: [-0.255, 1.12, -0.02],
  },
  wing: {
    spanM: 8.6,
    chordM: 1.48,
    leadingEdgeZ: 0.2,
    heightY: 1.97,
    dihedralDeg: 1,
    incidenceDeg: 2.2,
    washoutDeg: 1.5,
    stations: [0, 0.74, 1.45, 2.37, 3.29, 4.3],
    // Propeller notch: |x| < 0.74 m, trailing edge cut forward to z = -0.76 (0.52 m of chord).
    cutouts: [{ y0: 0, y1: 0.74, chordRemovedM: 0.52 }],
    aileron: { y0: 1.45, y1: 4.2, chordFraction: 0.19 },
    airfoil: { alphaZeroDeg: -3.5, stallDeg: 16, stallNegDeg: -12, sepWidthDeg: 1.8, cd0: 0.013, cmAc: -0.06 },
    oswald: 0.78,
    rootPropwash: 0,
    rightRiggingDeg: 0.35,
  },
  htail: {
    position: [0, 1.0, -4.55], spanM: 2.62, areaM2: 1.74, chordM: 0.78, incidenceDeg: -2.2, effectiveAr: 3.5,
    elevatorChordFraction: 0.32, elevatorSpanFraction: 0.9, propwashImmersion: 0.15, downwashFactor: 1,
    airfoil: { alphaZeroDeg: 0, stallDeg: 16, stallNegDeg: -16, sepWidthDeg: 2.5, cd0: 0.014, cmAc: 0 },
  },
  vtail: {
    position: [0, 1.6, -4.45], spanM: 1.35, areaM2: 1.1, chordM: 0.85, effectiveAr: 2.0,
    rudderChordFraction: 0.45, propwashImmersion: 0.45,
    airfoil: { alphaZeroDeg: 0, stallDeg: 18, stallNegDeg: -18, sepWidthDeg: 2.5, cd0: 0.016, cmAc: 0 },
  },
  bluffBodies: [
    // Enclosed pod: the S-12's windshield + doors make it far cleaner than an open-frame ultralight
    // in cruise, but the cage, struts and exposed engine still dominate the drag polar.
    { id: 'cabin_pod', position: [0, 1.25, 0.6], cdA: [0.9, 0.9, 0.24] },
    { id: 'struts_cabane', position: [0, 1.35, -0.3], cdA: [0.15, 0.05, 0.09] },
    { id: 'engine_above_wing', position: [0, 2.08, -0.45], cdA: [0.1, 0.1, 0.1] },
    { id: 'landing_gear', position: [0, 0.3, -0.1], cdA: [0.2, 0.05, 0.07] },
    { id: 'tail_boom', position: [0, 0.9, -3.0], cdA: [0.35, 0.08, 0.03] },
  ],
  controls: { elevatorMaxDeg: 22, aileronUpMaxDeg: 20, aileronDownRatio: 0.7, rudderMaxDeg: 25, surfaceRateDegS: 80 },
  propulsion: {
    thrustPoint: [0, 2.091, -0.87],
    thrustLineDeg: 0,
    propeller: { diameterM: 1.37, rotation: 1, inertiaKgM2: 0.14, swirlGain: 0.1, pFactor: 0.1, wakeFactor: 0.75, designSpeedMs: 26 },
    frictionFraction: 0.08,
  },
  gear: {
    wheels: [
      { id: 'nose', position: [0, -SC, 1.66], radiusM: 0.234, steerable: true, braked: false },
      { id: 'mainL', position: [0.76, -SC, -0.5], radiusM: 0.238, steerable: false, braked: true },
      { id: 'mainR', position: [-0.76, -SC, -0.5], radiusM: 0.238, steerable: false, braked: true },
    ],
    travelM: 0.14,
    staticCompressionM: SC,
    dampingRatio: 0.7,
    tyreMu: 0.85,
    // Small 6-inch wheels: more rolling drag on grass than the Kestrel's (0.45).
    rollingResistance: 0.6,
    maxSteerRad: 0.42,
    toleranceBaseMs: 1.8,
    tolerancePerImpactUnit: 17.5,
  },
  hardPoints: [
    { id: 'wingtipL', position: [4.3, 1.97, -0.5] },
    { id: 'wingtipR', position: [-4.3, 1.97, -0.5] },
    { id: 'nose', position: [0, 0.72, 2.05] },
    // Tail skid: over-rotation past ~10 degrees drags it.
    { id: 'tail', position: [0, 0.77, -4.9] },
    // Roof/engine: the first thing to touch in a nose-over.
    { id: 'canopy', position: [0, 2.2, -0.2] },
    { id: 'bellyFront', position: [0, 0.6, 1.2] },
    { id: 'bellyRear', position: [0, 0.78, -1.2] },
  ],
  damage: {
    // Strut-braced tube wing and a cage around the cabin; a long thin boom carries the tail.
    strengthScale: { wing_l: 1.2, wing_r: 1.2, aileron_l: 0.9, aileron_r: 0.9, [GEAR]: 1.1, nose: 1.3, fuselage: 1.25, tail: 0.85 },
    zoneLoad: {
      // The propeller turns above the wing behind the cabin: nose and belly strikes cannot reach it...
      nose: { nose: 0.7, fuselage: 0.4, [GEAR]: 0.45 },
      bellyFront: { fuselage: 0.45, [GEAR]: 0.5, nose: 0.3 },
      bellyRear: { fuselage: 0.35, tail: 0.4 },
      // ...but a nose-over lands on the engine, the propeller and the wing.
      canopy: { fuselage: 0.75, propeller: 1, engine: 0.5, wing_l: 0.35, wing_r: 0.35, rudder: 0.4 },
      tail: { tail: 0.7, elevator: 0.55, rudder: 0.4, fuselage: 0.1 },
    },
  },
  provenance: {
    'mass.items[].massKg': 'ESTIMATED',
    'mass.items[].position': 'ESTIMATED',
    'mass.items[].size': 'ESTIMATED',
    'mass.fuelPosition': 'ESTIMATED',
    'mass.fuelSize': 'ESTIMATED',
    'mass.fuelCapacityL': 'DOCUMENTED', // installed tank part (content/parts.ts)
    'mass.fuelDensityKgL': 'MEASURED',
    'mass.payloadPosition': 'MEASURED', // right seat of the asset
    'geometry.wingAreaM2': 'MEASURED',
    'geometry.wingspanM': 'MEASURED',
    'geometry.meanChordM': 'MEASURED',
    'geometry.wingAcPosition': 'MEASURED',
    'aero.airfoils': 'ESTIMATED',
    'aero.elements[]': 'ESTIMATED', // planform MEASURED off the asset; incidence/rigging CALIBRATED
    'aero.bluffBodies[]': 'CALIBRATED',
    'controls': 'ESTIMATED',
    'engine': 'DOCUMENTED', // installed engine part (content/engines.ts)
    'engine.position': 'MEASURED',
    'engine.idleThrottle': 'CALIBRATED',
    'engine.inertiaKgM2': 'ESTIMATED',
    'engine.starterTorqueNm': 'ESTIMATED',
    'engine.frictionFraction': 'ESTIMATED',
    'propeller': 'CALIBRATED',
    'propeller.diameterM': 'MEASURED',
    'gear': 'ESTIMATED',
    'gear.wheels[]': 'MEASURED',
    'hardPoints[]': 'MEASURED',
    'damage': 'ESTIMATED',
  },
};

export function buildNightjarDefinition(build: AircraftBuild): AircraftDefinition {
  return buildFromAirframeSpec(NIGHTJAR_AIRFRAME, build);
}
