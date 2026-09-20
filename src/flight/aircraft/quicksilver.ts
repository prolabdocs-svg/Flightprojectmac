// Reference aircraft: the starter ultralight ("Quicksilver-class", FRAME_ZERO + default loadout).
// The repo has no real Quicksilver MX II data, so this is NOT a replica: geometry and masses come
// from the parts catalogue (content/parts.ts) and everything else is tagged ESTIMATED /
// PLACEHOLDER / CALIBRATED in `provenance`. The definition is derived from an AircraftBuild so the
// same function serves every frame later (spec section 28: generalise after the slice passes).

import type { AircraftBuild } from '../../core/types';
import { resolveAircraft } from '../../content/assembly';
import { getPart } from '../../content/parts';
import { DEG } from '../core/constants';
import { finiteWingSlope } from '../aero/airfoil';
import { cpShape, ctShape } from '../propulsion/propeller';
import { powerCurve } from '../propulsion/engine';
import type { AeroElementSpec } from '../aero/aeroElement';
import type { AircraftDefinition, MassItem, Provenance } from './aircraftDefinition';

export const QUICKSILVER_REFERENCE_ID = 'quicksilver_class_reference';

/** Catalogue -> physics mapping knobs (CALIBRATED against the gameplay targets in Phase 9). */
export const CATALOGUE_CALIBRATION = {
  /** Multiplier on catalogue engine kW. The "12 hp" catalogue engine is a gameplay abstraction. */
  enginePowerScale: 2.4,
  /** Multiplier on catalogue frame/engine drag area x Cd (fixed-gear frames are draggier than the abstraction). */
  bodyDragScale: 0.5,
};

/** Tailplane setting angle. CALIBRATED with testing/trim.ts: sets the hands-off power-off trim speed (~82 km/h). */
export const HTAIL_INCIDENCE_DEG = -3.5;
/** Tailplane aspect ratio as seen by the flow (open tube frame: worse than the geometric span^2/area). */
const TAIL_EFFECTIVE_AR = 3.5;
const WING_SECTIONS = 4;
const PILOT_MASS_KG = 70;
const PILOT_Z = -0.55; // PLACEHOLDER seat station
const GEAR_RATIO = 2.3;

export function buildAircraftDefinition(build: AircraftBuild, cal = CATALOGUE_CALIBRATION): AircraftDefinition {
  const resolved = resolveAircraft(build);
  const wing = resolved.aeroSurfaces.find((s) => s.id === 'wing_root_main');
  if (!wing) throw new Error(`build ${build.frameId} has no main wing`);
  const elevator = resolved.aeroSurfaces.find((s) => s.controlAxis === 'pitch');
  const rudder = resolved.aeroSurfaces.find((s) => s.controlAxis === 'yaw');
  const aileron = resolved.aeroSurfaces.find((s) => s.controlAxis === 'roll');
  if (!elevator || !rudder || !aileron) throw new Error('build is missing tail or aileron surfaces');

  // ---- mass items (empty aircraft + pilot). Fuel is separate. ----
  const items: MassItem[] = [
    { id: 'frame', massKg: resolved.frame.basePhysics.massKg, position: resolved.frame.basePhysics.localCenterOfMass, size: [1.2, 1.4, 6.6] },
  ];
  const sizes: Record<string, [number, number, number]> = {
    engine: [0.6, 0.6, 0.5], wingSet: [wing.spanM, 0.25, wing.areaM2 / wing.spanM], fuelTank: [0.4, 0.3, 0.4], landingGear: [2.3, 0.8, 2.2],
  };
  let tankPos: [number, number, number] = [0, -0.1, 0.6];
  for (const [category, partId] of Object.entries(build.installed)) {
    const part = partId ? getPart(partId) : undefined;
    if (!part) continue;
    items.push({ id: part.id, massKg: part.physics.massKg, position: part.physics.localCenterOfMass, size: sizes[category] ?? [0.3, 0.3, 0.3] });
    if (category === 'fuelTank') tankPos = part.physics.localCenterOfMass;
  }
  items.push({ id: 'pilot', massKg: PILOT_MASS_KG, position: [0, 0.05, PILOT_Z], size: [0.5, 0.9, 0.5] });

  // ---- wing planform ----
  const span = wing.spanM;
  const area = wing.areaM2;
  const meanChord = area / span;
  const ar = (span * span) / area;
  const aWing = finiteWingSlope(ar);
  const half = span / 2;
  const secSpan = half / WING_SECTIONS;
  const secArea = area / (2 * WING_SECTIONS);
  const aTail = finiteWingSlope(TAIL_EFFECTIVE_AR);
  const finAr = 2.2; // effective AR of the fin incl. fuselage end-plate effect
  const aFin = finiteWingSlope(finAr);
  const wingIncidence = 3.0;
  const twist = [0, -0.35, -0.7, -1.0];
  const rightRiggingExtra = 0.04; // small rigging asymmetry (deg) -> deterministic wing-drop side

  const elements: AeroElementSpec[] = [];
  const aileronInboard = half - aileron.spanM;
  for (const side of [1, -1] as const) {
    for (let i = 0; i < WING_SECTIONS; i++) {
      const y0 = i * secSpan;
      const y1 = y0 + secSpan;
      const overlap = Math.max(0, Math.min(y1, half) - Math.max(y0, aileronInboard)) / secSpan;
      elements.push({
        id: `wing_${side > 0 ? 'L' : 'R'}${i}`,
        group: 'wing',
        position: [side * (y0 + secSpan / 2), wing.localPosition[1], wing.localPosition[2]],
        areaM2: secArea,
        chordM: meanChord,
        spanM: secSpan,
        orientation: 'up',
        incidenceDeg: wingIncidence + twist[i] + (side < 0 ? rightRiggingExtra : 0),
        dihedralDeg: 5,
        outboard: side,
        clAlpha: aWing,
        effectiveAr: ar,
        oswald: 0.8,
        downwashFactor: 0,
        propwashImmersion: i === 0 ? 0.55 : 0,
        control: overlap > 0.01 ? { kind: 'aileron', chordFraction: Math.min(0.4, aileron.chordM / meanChord), spanFraction: overlap } : undefined,
        damageId: overlap > 0.01 ? (side > 0 ? 'aileron_l' : 'aileron_r') : 'wing_root_main',
      });
    }
  }
  for (const side of [1, -1] as const) {
    elements.push({
      id: `htail_${side > 0 ? 'L' : 'R'}`,
      group: 'htail',
      position: [side * elevator.spanM / 4, elevator.localPosition[1], elevator.localPosition[2]],
      areaM2: elevator.areaM2 / 2,
      chordM: elevator.chordM,
      spanM: elevator.spanM / 2,
      orientation: 'up',
      incidenceDeg: HTAIL_INCIDENCE_DEG,
      dihedralDeg: 0,
      outboard: side,
      clAlpha: aTail,
      effectiveAr: TAIL_EFFECTIVE_AR,
      oswald: 0.8,
      downwashFactor: 1.0,
      propwashImmersion: 0.3,
      control: { kind: 'elevator', chordFraction: 0.4, spanFraction: 1 },
      damageId: 'elevator',
    });
  }
  elements.push({
    id: 'vtail',
    group: 'vtail',
    position: [0, rudder.localPosition[1], rudder.localPosition[2]],
    areaM2: rudder.areaM2,
    chordM: rudder.chordM,
    spanM: rudder.spanM,
    orientation: 'side',
    incidenceDeg: 0,
    dihedralDeg: 0,
    outboard: 0,
    clAlpha: aFin,
    effectiveAr: finAr,
    oswald: 0.8,
    downwashFactor: 0,
    propwashImmersion: 0.15,
    control: { kind: 'rudder', chordFraction: 0.5, spanFraction: 1 },
    damageId: 'rudder',
  });

  // ---- propulsion ----
  const eng = resolved.engine;
  const powerKw = eng ? eng.maxPowerKw * cal.enginePowerScale : 0;
  const ratedRpm = eng ? Math.min(eng.redlineRpm * 0.94, eng.redlineRpm - 200) : 0;
  const propDia = eng?.propDiameterM ?? 1.27;
  const propRps = ratedRpm / GEAR_RATIO / 60;
  const rho0 = 1.225;
  const designJ = 0.43;
  const j0 = 0.65;
  const xd = designJ / j0;
  // Cp/Ct shapes vs x = J/J0 (see propulsion/propeller.ts): the prop absorbs rated power at rated rpm at the design J.
  const cp0 = eng ? (powerKw * 1000) / (cpShape(xd) * rho0 * propRps ** 3 * propDia ** 5) : 0;
  const ct0 = eng ? (cp0 * eng.propEfficiency * cpShape(xd)) / (designJ * ctShape(xd)) : 0;
  // Idle throttle that balances prop + friction load at idle rpm (throttle 0 must idle, not stall or race).
  const idleRps = (eng?.idleRpm ?? 0) / GEAR_RATIO / 60;
  const idleX = eng ? eng.idleRpm / ratedRpm : 0;
  const frictionFraction = 0.08;
  const idlePowerNeed = eng ? cp0 * rho0 * idleRps ** 3 * propDia ** 5 + frictionFraction * powerKw * 1000 * (0.4 + 0.6 * idleX) * idleX : 0;
  const idleThrottle = eng ? Math.min(0.35, idlePowerNeed / (powerKw * 1000 * powerCurve(idleX))) : 0;
  const ratedOmega = (ratedRpm * 2 * Math.PI) / 60;
  const ratedTorque = eng ? (powerKw * 1000) / ratedOmega : 0;

  const gearPart = build.installed.landingGear ? getPart(build.installed.landingGear) : undefined;
  const impactTolerance = gearPart?.physics.impactTolerance ?? 35;

  const provenance: Record<string, Provenance> = {
    'mass.items[].massKg': 'DOCUMENTED', // content/parts.ts catalogue masses (pilot: PLACEHOLDER below)
    'mass.items[].position': 'DOCUMENTED',
    'mass.items[].size': 'ESTIMATED',
    'mass.fuelPosition': 'DOCUMENTED',
    'mass.fuelSize': 'ESTIMATED',
    'mass.fuelCapacityL': 'DOCUMENTED',
    'mass.fuelDensityKgL': 'MEASURED', // gasoline ~0.72-0.75 kg/L
    'geometry.wingAreaM2': 'DOCUMENTED',
    'geometry.wingspanM': 'DOCUMENTED',
    'geometry.meanChordM': 'DOCUMENTED',
    'geometry.wingAcPosition': 'DOCUMENTED',
    'aero.airfoils.wing': 'ESTIMATED',
    'aero.airfoils.tail': 'ESTIMATED',
    'aero.airfoils.fin': 'ESTIMATED',
    'aero.elements[]': 'ESTIMATED', // section split, incidence, dihedral, downwash, propwash: ESTIMATED; areas/spans DOCUMENTED
    'aero.bluffBodies[]': 'CALIBRATED',
    'controls.elevatorMaxDeg': 'DOCUMENTED',
    'controls.aileronUpMaxDeg': 'DOCUMENTED',
    'controls.aileronDownRatio': 'ESTIMATED',
    'controls.rudderMaxDeg': 'DOCUMENTED',
    'controls.surfaceRateDegS': 'ESTIMATED',
    'engine': 'CALIBRATED',
    'propeller': 'ESTIMATED',
    'gear': 'ESTIMATED',
    'gear.toleranceMs': 'DOCUMENTED',
    'hardPoints[]': 'ESTIMATED',
  };
  if (build.installed.fuelTank === undefined) provenance['mass.fuelCapacityL'] = 'PLACEHOLDER';
  provenance['mass.pilot'] = 'PLACEHOLDER';

  return {
    id: QUICKSILVER_REFERENCE_ID,
    name: 'Quicksilver-class reference (starter ultralight)',
    mass: {
      items,
      fuelPosition: tankPos,
      fuelSize: [0.4, 0.3, 0.4],
      fuelCapacityL: resolved.fuelCapacityL,
      fuelDensityKgL: 0.72,
    },
    geometry: { wingAreaM2: area, wingspanM: span, meanChordM: meanChord, wingAcPosition: [0, wing.localPosition[1], wing.localPosition[2]] },
    aero: {
      airfoils: {
        wing: { clAlpha: aWing, alphaZeroRad: -4 * DEG, stallPosRad: wing.stallPositiveDeg * DEG + 1.5 * DEG, stallNegRad: -12 * DEG, sepWidthRad: 1.4 * DEG, cd0: wing.parasiticCd * 0.8, cmAc: -0.06 },
        tail: { clAlpha: aTail, alphaZeroRad: 0, stallPosRad: 16 * DEG, stallNegRad: -16 * DEG, sepWidthRad: 2.5 * DEG, cd0: 0.015, cmAc: 0 },
        fin: { clAlpha: aFin, alphaZeroRad: 0, stallPosRad: 17 * DEG, stallNegRad: -17 * DEG, sepWidthRad: 2.5 * DEG, cd0: 0.015, cmAc: 0 },
      },
      elements,
      bluffBodies: [
        { id: 'pod_frame_engine', position: [0, 0.1, 0.4], cdA: [1.1, 0.9, (resolved.totalDragArea * 0.5) * cal.bodyDragScale] },
        { id: 'tail_boom', position: [0, 0.2, -2.5], cdA: [0.3, 0.1, 0.02] },
        { id: 'gear', position: [0, -0.9, 0.3], cdA: [0.25, 0.05, 0.05] },
      ],
    },
    controls: {
      elevatorMaxDeg: elevator.maxDeflectionDeg ?? 22,
      aileronUpMaxDeg: aileron.maxDeflectionDeg ?? 18,
      aileronDownRatio: 0.6,
      rudderMaxDeg: rudder.maxDeflectionDeg ?? 22,
      surfaceRateDegS: 90,
    },
    engine: eng
      ? {
          maxPowerKw: powerKw,
          ratedRpm,
          idleRpm: eng.idleRpm,
          redlineRpm: eng.redlineRpm,
          inertiaKgM2: Math.max(0.01, (2 * eng.responseTime * ratedTorque) / ratedOmega),
          gearRatio: GEAR_RATIO,
          idleThrottle,
          starterTorqueNm: 12,
          frictionFraction,
          altitudeLapse: 1,
          position: [0, 0, 2.54],
          thrustLineDeg: 0,
          fuelBurnLph: (eng.fuelBurnLpm ?? eng.maxPowerKw * 0.44) * 60,
        }
      : null,
    propeller: eng
      ? { diameterM: propDia, j0, ct0, cp0, rotation: 1, inertiaKgM2: 0.12, swirlGain: 0.12, pFactor: 0.12, wakeFactor: 0.8 }
      : null,
    gear: {
      wheels: [
        { id: 'nose', position: [0, -1.13, 1.9], radiusM: 0.18, steerable: true, braked: false },
        { id: 'mainL', position: [1.15, -1.08, -0.32], radiusM: 0.2, steerable: false, braked: true },
        { id: 'mainR', position: [-1.15, -1.08, -0.32], radiusM: 0.2, steerable: false, braked: true },
      ],
      travelM: 0.22,
      staticCompressionM: 0.07,
      dampingRatio: 0.65,
      tyreMu: 0.9,
      rollingResistance: 0.45,
      maxSteerRad: 0.5,
      toleranceMs: 1.5 + impactTolerance / 17.5,
    },
    hardPoints: [
      { id: 'wingtipL', position: [span / 2 + 0.3, 0.42, -0.25] },
      { id: 'wingtipR', position: [-(span / 2 + 0.3), 0.42, -0.25] },
      { id: 'nose', position: [0, 0, 2.75] },
      { id: 'tail', position: [0, 0.3, -4.9] },
      { id: 'canopy', position: [0, 1.35, -0.3] },
      { id: 'bellyFront', position: [0, -0.4, 0.9] },
      { id: 'bellyRear', position: [0, -0.25, -1.6] },
    ],
    provenance,
  };
}
