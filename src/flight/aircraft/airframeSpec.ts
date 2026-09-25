// Data-driven airframe -> AircraftDefinition. An AirframeSpec describes one real airframe in its own
// model axes (the GLB's: +X left wing, +Y up, +Z nose, metres, wheels on y = 0): fixed structure masses,
// stations, wing planform + control spans, tail, fin, bluff bodies, gear and hard points. The installed
// parts (engine, fuel tank, landing gear) are resolved from the player's build, so upgrades change the
// physics through the same path. Adding an airframe = writing a spec (see nightjar.ts), not a builder.

import type { AircraftBuild } from '../../core/types';
import { getPart } from '../../content/parts';
import { DEG } from '../core/constants';
import type { Vec3 } from '../core/coordinates';
import { finiteWingSlope } from '../aero/airfoil';
import type { AeroElementSpec, BluffBodySpec } from '../aero/aeroElement';
import type { DamageStructure } from '../../sim/damageSystem';
import type { AircraftDefinition, ControlDefinition, MassItem, Provenance, WheelDefinition } from './aircraftDefinition';
import { matchFixedPitchPropeller, ratedRpmFor } from './propSizing';
import { FUEL_DENSITY_KG_L } from './fuelDensity';

export interface SurfaceAirfoil {
  alphaZeroDeg: number;
  stallDeg: number;
  stallNegDeg: number;
  sepWidthDeg: number;
  cd0: number;
  cmAc: number;
}

export interface AirframeSpec {
  id: string;
  name: string;
  /** Fixed airframe masses: structure and systems. Engine, tank, gear, fuel and pilot come from stations. */
  structure: MassItem[];
  stations: {
    pilot: { position: Vec3; size: Vec3; massKg: number };
    engine: { position: Vec3; size: Vec3 };
    fuel: { position: Vec3; size: Vec3 };
    mainGear: { position: Vec3; size: Vec3 };
    /** Passenger seat / cargo bay: where contract payload is carried. */
    payload: Vec3;
  };
  wing: {
    spanM: number;
    chordM: number;
    leadingEdgeZ: number;
    heightY: number;
    dihedralDeg: number;
    /** Root rigging incidence and linear washout to the tip, deg. */
    incidenceDeg: number;
    washoutDeg: number;
    /** Half-span station edges from the centreline, m (the last one is the tip). */
    stations: number[];
    /** Trailing-edge cut-outs (e.g. a pusher propeller notch) over a half-span range. */
    cutouts?: Array<{ y0: number; y1: number; chordRemovedM: number }>;
    aileron: { y0: number; y1: number; chordFraction: number };
    flap?: { y0: number; y1: number; chordFraction: number; maxDeg: number };
    airfoil: SurfaceAirfoil;
    oswald: number;
    /** Propeller slipstream immersion of the root section (0 for a pusher behind the wing). */
    rootPropwash: number;
    /** Extra rigging incidence on the right wing, deg (balances a solo pilot in the left seat). */
    rightRiggingDeg: number;
  };
  htail: {
    position: Vec3; spanM: number; areaM2: number; chordM: number; incidenceDeg: number; effectiveAr: number;
    elevatorChordFraction: number; elevatorSpanFraction: number; propwashImmersion: number; downwashFactor: number; airfoil: SurfaceAirfoil;
  };
  vtail: {
    position: Vec3; spanM: number; areaM2: number; chordM: number; effectiveAr: number;
    rudderChordFraction: number; propwashImmersion: number; airfoil: SurfaceAirfoil;
  };
  bluffBodies: BluffBodySpec[];
  controls: ControlDefinition;
  propulsion: {
    /** Propeller hub = thrust application point, and thrust-line tilt (deg, nose-up +). */
    thrustPoint: Vec3;
    thrustLineDeg: number;
    /** The airframe's own propeller (sized to its clearance), pitched to absorb whatever engine is installed. */
    /** designSpeedMs: true airspeed the fixed pitch is chosen for (rated power absorbed there), so a lower-geared engine gets a coarser prop. */
    propeller: { diameterM: number; rotation: 1 | -1; inertiaKgM2: number; swirlGain: number; pFactor: number; wakeFactor: number; designSpeedMs: number };
    frictionFraction: number;
  };
  gear: {
    wheels: WheelDefinition[];
    travelM: number;
    staticCompressionM: number;
    dampingRatio: number;
    tyreMu: number;
    rollingResistance: number;
    maxSteerRad: number;
    /** Sink tolerance = base + installed gear part impactTolerance / perImpactUnit. */
    toleranceBaseMs: number;
    tolerancePerImpactUnit: number;
  };
  hardPoints: AircraftDefinition['hardPoints'];
  damage?: DamageStructure;
  provenance: Record<string, Provenance>;
}

const airfoil = (clAlpha: number, a: SurfaceAirfoil) => ({
  clAlpha, alphaZeroRad: a.alphaZeroDeg * DEG, stallPosRad: a.stallDeg * DEG, stallNegRad: a.stallNegDeg * DEG,
  sepWidthRad: a.sepWidthDeg * DEG, cd0: a.cd0, cmAc: a.cmAc,
});

const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

/** Wing strip elements, both sides, with control-surface coverage, cut-outs, washout and rigging. */
function wingElements(spec: AirframeSpec, clAlpha: number, ar: number): AeroElementSpec[] {
  const w = spec.wing;
  const half = w.spanM / 2;
  const out: AeroElementSpec[] = [];
  for (const side of [1, -1] as const) {
    for (let i = 0; i + 1 < w.stations.length; i++) {
      const y0 = w.stations[i], y1 = w.stations[i + 1], span = y1 - y0;
      const removed = (w.cutouts ?? []).reduce((s, c) => s + (overlap(y0, y1, c.y0, c.y1) / span) * c.chordRemovedM, 0);
      const chord = w.chordM - removed;
      const ym = (y0 + y1) / 2;
      const aileron = overlap(y0, y1, w.aileron.y0, w.aileron.y1) / span;
      const flap = w.flap ? overlap(y0, y1, w.flap.y0, w.flap.y1) / span : 0;
      const control = aileron > 0.01
        ? { kind: 'aileron' as const, chordFraction: (w.aileron.chordFraction * w.chordM) / chord, spanFraction: aileron }
        : flap > 0.01 && w.flap ? { kind: 'flap' as const, chordFraction: (w.flap.chordFraction * w.chordM) / chord, spanFraction: flap } : undefined;
      const sideId = side > 0 ? 'L' : 'R';
      out.push({
        id: `wing_${sideId}${i}`,
        group: 'wing',
        position: [side * ym, w.heightY + Math.tan(w.dihedralDeg * DEG) * ym, w.leadingEdgeZ - chord / 4],
        areaM2: chord * span,
        chordM: chord,
        spanM: span,
        orientation: 'up',
        incidenceDeg: w.incidenceDeg - (w.washoutDeg * ym) / half + (side < 0 ? w.rightRiggingDeg : 0),
        dihedralDeg: w.dihedralDeg,
        outboard: side,
        clAlpha,
        effectiveAr: ar,
        oswald: w.oswald,
        downwashFactor: 0,
        propwashImmersion: i === 0 ? w.rootPropwash : 0,
        control,
        damageId: control?.kind === 'aileron' ? (side > 0 ? 'aileron_l' : 'aileron_r') : (side > 0 ? 'wing_l' : 'wing_r'),
      });
    }
  }
  return out;
}

export function buildFromAirframeSpec(spec: AirframeSpec, build: AircraftBuild): AircraftDefinition {
  const enginePart = build.installed.engine ? getPart(build.installed.engine) : undefined;
  const tankPart = build.installed.fuelTank ? getPart(build.installed.fuelTank) : undefined;
  const gearPart = build.installed.landingGear ? getPart(build.installed.landingGear) : undefined;
  const eng = enginePart?.engine ?? null;
  const st = spec.stations;

  // ---- mass: structure + installed parts at the airframe's own stations ----
  const items: MassItem[] = spec.structure.map((m) => ({ ...m }));
  if (enginePart) items.push({ id: enginePart.id, massKg: enginePart.physics.massKg, position: st.engine.position, size: st.engine.size });
  if (tankPart) items.push({ id: tankPart.id, massKg: tankPart.physics.massKg, position: st.fuel.position, size: st.fuel.size });
  if (gearPart) items.push({ id: gearPart.id, massKg: gearPart.physics.massKg, position: st.mainGear.position, size: st.mainGear.size });
  items.push({ id: 'pilot', massKg: st.pilot.massKg, position: st.pilot.position, size: st.pilot.size });

  // ---- aerodynamics ----
  const wingEls = (() => {
    const provisional = wingElements(spec, 1, 1);
    const area = provisional.reduce((s, e) => s + e.areaM2, 0);
    const ar = (spec.wing.spanM * spec.wing.spanM) / area;
    return wingElements(spec, finiteWingSlope(ar), ar);
  })();
  const wingArea = wingEls.reduce((s, e) => s + e.areaM2, 0);
  const ar = (spec.wing.spanM * spec.wing.spanM) / wingArea;
  const aWing = finiteWingSlope(ar);
  const h = spec.htail, v = spec.vtail;
  const aTail = finiteWingSlope(h.effectiveAr), aFin = finiteWingSlope(v.effectiveAr);
  const elements: AeroElementSpec[] = [...wingEls];
  for (const side of [1, -1] as const) {
    elements.push({
      id: `htail_${side > 0 ? 'L' : 'R'}`, group: 'htail', position: [side * h.spanM / 4, h.position[1], h.position[2]],
      areaM2: h.areaM2 / 2, chordM: h.chordM, spanM: h.spanM / 2, orientation: 'up', incidenceDeg: h.incidenceDeg, dihedralDeg: 0,
      outboard: side, clAlpha: aTail, effectiveAr: h.effectiveAr, oswald: 0.8, downwashFactor: h.downwashFactor, propwashImmersion: h.propwashImmersion,
      control: { kind: 'elevator', chordFraction: h.elevatorChordFraction, spanFraction: h.elevatorSpanFraction }, damageId: 'elevator',
    });
  }
  elements.push({
    id: 'vtail', group: 'vtail', position: v.position, areaM2: v.areaM2, chordM: v.chordM, spanM: v.spanM, orientation: 'side',
    incidenceDeg: 0, dihedralDeg: 0, outboard: 0, clAlpha: aFin, effectiveAr: v.effectiveAr, oswald: 0.8, downwashFactor: 0,
    propwashImmersion: v.propwashImmersion, control: { kind: 'rudder', chordFraction: v.rudderChordFraction, spanFraction: 1 }, damageId: 'rudder',
  });

  // ---- propulsion: the airframe's propeller, pitched for the installed engine ----
  const p = spec.propulsion.propeller;
  const powerKw = eng ? eng.shaftPowerKw ?? eng.maxPowerKw * 2.4 : 0;
  const ratedRpm = eng ? ratedRpmFor(eng.redlineRpm) : 0;
  const gearRatio = eng?.gearRatio ?? 2.58;
  const designJ = eng ? p.designSpeedMs / ((ratedRpm / gearRatio / 60) * p.diameterM) : 0;
  const match = eng && !eng.jet
    ? matchFixedPitchPropeller({ powerKw, ratedRpm, idleRpm: eng.idleRpm, gearRatio, diameterM: p.diameterM, efficiency: eng.propEfficiency, frictionFraction: spec.propulsion.frictionFraction, designJ, j0: designJ * 1.5 })
    : null;

  const impact = gearPart?.physics.impactTolerance ?? 35;
  const rolling = spec.gear.rollingResistance * (gearPart?.groundFrictionMul ?? 1);

  return {
    id: spec.id,
    name: spec.name,
    mass: {
      items,
      fuelPosition: st.fuel.position,
      fuelSize: st.fuel.size,
      fuelCapacityL: tankPart?.fuelCapacityL ?? 0,
      fuelDensityKgL: FUEL_DENSITY_KG_L,
      payloadPosition: st.payload,
    },
    geometry: { wingAreaM2: wingArea, wingspanM: spec.wing.spanM, meanChordM: wingArea / spec.wing.spanM, wingAcPosition: [0, spec.wing.heightY, spec.wing.leadingEdgeZ - spec.wing.chordM / 4] },
    aero: {
      airfoils: { wing: airfoil(aWing, spec.wing.airfoil), tail: airfoil(aTail, h.airfoil), fin: airfoil(aFin, v.airfoil) },
      elements,
      bluffBodies: spec.bluffBodies.map((b) => ({ ...b })),
    },
    controls: { ...spec.controls, ...(spec.wing.flap ? { flapMaxDeg: spec.wing.flap.maxDeg } : {}) },
    engine: eng && match
      ? {
          maxPowerKw: powerKw,
          ratedRpm,
          idleRpm: eng.idleRpm,
          redlineRpm: eng.redlineRpm,
          inertiaKgM2: Math.max(0.01, (2 * eng.responseTime * match.ratedTorqueNm) / match.ratedOmega),
          frictionFraction: spec.propulsion.frictionFraction,
          gearRatio,
          idleThrottle: match.idleThrottle,
          starterTorqueNm: Math.max(12, match.ratedTorqueNm * 0.25),
          altitudeLapse: eng.altitudeLapse ?? 1,
          position: spec.propulsion.thrustPoint,
          thrustLineDeg: spec.propulsion.thrustLineDeg,
          fuelBurnLph: (eng.fuelBurnLpm ?? eng.maxPowerKw * 0.44) * 60,
          thermal: eng.thermal ?? { heatAtFull: 0.8, airflowRelief: 0.2, timeConstantS: 40 },
        }
      : null,
    propeller: match
      ? { diameterM: p.diameterM, j0: match.j0, ct0: match.ct0, cp0: match.cp0, rotation: p.rotation, inertiaKgM2: p.inertiaKgM2, swirlGain: p.swirlGain, pFactor: p.pFactor, wakeFactor: p.wakeFactor }
      : null,
    gear: {
      wheels: spec.gear.wheels.map((w) => ({ ...w, position: [...w.position] as Vec3 })),
      travelM: spec.gear.travelM,
      staticCompressionM: spec.gear.staticCompressionM,
      dampingRatio: spec.gear.dampingRatio,
      tyreMu: spec.gear.tyreMu,
      rollingResistance: rolling,
      maxSteerRad: spec.gear.maxSteerRad,
      toleranceMs: spec.gear.toleranceBaseMs + impact / spec.gear.tolerancePerImpactUnit,
    },
    hardPoints: spec.hardPoints.map((hp) => ({ ...hp, position: [...hp.position] as Vec3 })),
    damage: spec.damage,
    provenance: { ...spec.provenance },
  };
}
