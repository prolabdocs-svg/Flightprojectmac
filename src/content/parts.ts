// Tier 0/1 content: FRAME ZERO airframe and its earliest parts.
// Values are gameplay abstractions, not real aeronautical data (see spec section "Nota de seguridad").

import type { AeroSurfaceSpec, EngineSpec, FrameDefinition, PartDefinition } from '../core/types';
import { ENGINE_PARTS } from './engines';

export const WING_A: AeroSurfaceSpec = {
  id: 'wing_root_main',
  localPosition: [0, 0.3, 0],
  areaM2: 12,
  spanM: 9,
  chordM: 1.4,
  // Built-in wing incidence (playability fix): FlightController now actually applies this
  // (it used to be a dead field), so the wing generates real lift at level fuselage attitude
  // once ground speed builds, instead of needing to rotate first — rotation was physically
  // impossible while the flat-bottomed collider was fully seated on the ground. -10 gives a
  // ~10-14s ground roll to liftoff at full throttle, tuned against a headless physics harness.
  zeroLiftAoADeg: -10,
  stallPositiveDeg: 15,
  stallNegativeDeg: -13,
  inducedDragFactor: 0.045,
  parasiticCd: 0.028,
};

export const WING_B_HIGH_LIFT: AeroSurfaceSpec = {
  ...WING_A,
  id: 'wing_root_main',
  areaM2: 19.2,
  spanM: 10.6,
  stallPositiveDeg: 18,
  parasiticCd: 0.034,
};

/** Zenith CH 701 planform: short, broad and squared off, with the fixed slats in the airframe GLB. */
export const WING_CH701: AeroSurfaceSpec = {
  ...WING_A,
  id: 'wing_root_main', localPosition: [0, 2.05, 0], areaM2: 11.3, spanM: 8.23, chordM: 1.37,
  stallPositiveDeg: 18, stallNegativeDeg: -15, inducedDragFactor: 0.052, parasiticCd: 0.034,
};

/** Aerofox Kestrel 2 high-lift, partial-double-surface wing (180 sq ft, 32 ft 7 in; the MX II-class
 * planform it was developed from). Reference geometry; airfoil polar and control tuning remain estimates. */
export const WING_QUICKSILVER_MXII: AeroSurfaceSpec = {
  ...WING_A,
  id: 'wing_root_main', localPosition: [0, 0.3, 0], areaM2: 180 * 0.09290304, spanM: 32.583 * 0.3048,
  chordM: (180 * 0.09290304) / (32.583 * 0.3048), zeroLiftAoADeg: -5,
  stallPositiveDeg: 16, stallNegativeDeg: -13, inducedDragFactor: 0.047, parasiticCd: 0.026,
};

export const AILERON_L: AeroSurfaceSpec = {
  id: 'aileron_l',
  localPosition: [-4.2, 0.3, -0.2],
  areaM2: 0.9,
  spanM: 1.8,
  chordM: 0.5,
  zeroLiftAoADeg: 0,
  stallPositiveDeg: 20,
  stallNegativeDeg: -20,
  inducedDragFactor: 0.02,
  parasiticCd: 0.02,
  controlAuthority: 1.0,
  controlAxis: 'roll',
  maxDeflectionDeg: 18,
};

export const AILERON_R: AeroSurfaceSpec = { ...AILERON_L, id: 'aileron_r', localPosition: [4.2, 0.3, -0.2] };

export const ELEVATOR: AeroSurfaceSpec = {
  id: 'elevator',
  localPosition: [0, 0.4, -4.4],
  areaM2: 1.6,
  spanM: 3.0,
  chordM: 0.55,
  zeroLiftAoADeg: 0,
  stallPositiveDeg: 22,
  stallNegativeDeg: -22,
  inducedDragFactor: 0.03,
  parasiticCd: 0.02,
  controlAuthority: 1.0,
  controlAxis: 'pitch',
  maxDeflectionDeg: 22,
};

export const RUDDER: AeroSurfaceSpec = {
  id: 'rudder',
  localPosition: [0, 0.9, -4.4],
  areaM2: 0.8,
  spanM: 1.1,
  chordM: 0.6,
  zeroLiftAoADeg: 0,
  stallPositiveDeg: 25,
  stallNegativeDeg: -25,
  inducedDragFactor: 0.02,
  parasiticCd: 0.02,
  controlAuthority: 1.0,
  controlAxis: 'yaw',
  maxDeflectionDeg: 22,
};

const CH701_AILERON_L: AeroSurfaceSpec = { ...AILERON_L, id: 'aileron_l', localPosition: [-2.95, 2.1, -0.54], areaM2: 0.72, spanM: 1.45, chordM: 0.34 };
const CH701_AILERON_R: AeroSurfaceSpec = { ...CH701_AILERON_L, id: 'aileron_r', localPosition: [2.95, 2.1, -0.54] };
const CH701_ELEVATOR: AeroSurfaceSpec = { ...ELEVATOR, localPosition: [0, 0.82, -3.07], areaM2: 1.35, spanM: 2.56, chordM: 0.48 };
const CH701_RUDDER: AeroSurfaceSpec = { ...RUDDER, localPosition: [0, 1.2, -3.08], areaM2: 0.78, spanM: 1.0, chordM: 0.48 };

export const ENGINE_SMALL: EngineSpec = {
  id: 'engine_small',
  name: 'Field Twin 12hp',
  type: 'twoStroke',
  maxPowerKw: 9,
  idleRpm: 1600,
  redlineRpm: 6200,
  responseTime: 0.35,
  thermalLimit: 1,
  reliabilityClass: 1,
  propEfficiency: 0.62,
  propDiameterM: 1.27,
  fuelBurnLpm: 4,
};

export const ENGINE_MEDIUM: EngineSpec = {
  ...ENGINE_SMALL,
  id: 'engine_medium',
  name: 'Field Twin 18hp',
  maxPowerKw: 13.5,
  responseTime: 0.3,
  propEfficiency: 0.66,
  fuelBurnLpm: 5.2,
};

export const ENGINE_EFFICIENT: EngineSpec = {
  ...ENGINE_SMALL,
  id: 'engine_efficient',
  name: 'Field Twin 15hp Eficiente',
  maxPowerKw: 11,
  responseTime: 0.28,
  propEfficiency: 0.74,
  fuelBurnLpm: 3.3,
};

export const WING_C_EFFICIENT: AeroSurfaceSpec = {
  ...WING_A,
  id: 'wing_root_main',
  areaM2: 12.5,
  spanM: 9.4,
  inducedDragFactor: 0.036,
  parasiticCd: 0.021,
};

/** Big-chord STOL wing for the heavy rough-field airframe: much more area and a later
 * stall than any starter wing, paid for in mass and parasitic drag. */
export const WING_D_BUSH: AeroSurfaceSpec = {
  ...WING_A,
  id: 'wing_root_main',
  areaM2: 18,
  spanM: 11.5,
  chordM: 1.6,
  stallPositiveDeg: 18,
  stallNegativeDeg: -14,
  inducedDragFactor: 0.05,
  parasiticCd: 0.042,
};

export const PARTS: PartDefinition[] = [
  {
    id: 'wing_quicksilver_mxii', category: 'wingSet', name: 'Ala Aerofox Kestrel 2',
    description: 'Ala alta de gran cuerda y doble superficie parcial; 180 ft² según la ficha de Aerofox.',
    tier: 0, priceCash: 0,
    physics: { massKg: 42, localCenterOfMass: [0, 0.3, 0], dragArea: 0.05, dragCoefficient: 0.05, structuralStrength: 50, impactTolerance: 30, mountStrength: 55 },
    aeroSurfaces: [WING_QUICKSILVER_MXII, AILERON_L, AILERON_R],
  },
  {
    id: 'tank_quicksilver_22_7', category: 'fuelTank', name: 'Depósito Kestrel · 6 US gal',
    description: 'Capacidad de fábrica: 6 galones estadounidenses (22,7 L).',
    tier: 0, priceCash: 0, fuelCapacityL: 22.7,
    physics: { massKg: 8, localCenterOfMass: [0, -0.1, 0.6], dragArea: 0.01, dragCoefficient: 0.3, structuralStrength: 30, impactTolerance: 20, mountStrength: 40 },
  },
  {
    id: 'wing_ch701', category: 'wingSet', name: 'Ala slat Zenith CH 701',
    description: 'Ala alta rectangular con slats fijos integrados. Gran autoridad a baja velocidad y velocidad de crucero modesta.',
    tier: 3, priceCash: 0,
    physics: { massKg: 58, localCenterOfMass: [0, 2.05, 0], dragArea: 0.075, dragCoefficient: 0.08, structuralStrength: 84, impactTolerance: 48, mountStrength: 86 },
    aeroSurfaces: [WING_CH701, CH701_AILERON_L, CH701_AILERON_R],
  },
  {
    id: 'tank_ch701_75', category: 'fuelTank', name: 'Depósito CH 701 · 75 L',
    description: 'Depósito de largo alcance de la configuración bush-plane.',
    tier: 3, priceCash: 0, fuelCapacityL: 75,
    physics: { massKg: 22, localCenterOfMass: [0, 0.55, -0.25], dragArea: 0.02, dragCoefficient: 0.3, structuralStrength: 70, impactTolerance: 40, mountStrength: 74 },
  },
  {
    id: 'engine_small',
    category: 'engine',
    name: 'Field Twin 12hp',
    description: 'Motor de dos tiempos rescatado de una cortadora industrial. Fiable, ruidoso, suficiente para empezar.',
    tier: 0,
    priceCash: 0,
    physics: {
      massKg: 28,
      localCenterOfMass: [0, 0, 2.1],
      dragArea: 0.18,
      dragCoefficient: 0.9,
      structuralStrength: 60,
      impactTolerance: 40,
      mountStrength: 70,
    },
    engine: ENGINE_SMALL,
  },
  {
    id: 'engine_medium',
    category: 'engine',
    name: 'Field Twin 18hp',
    description: 'Versión reconstruida con más cilindrada. Más empuje, más peso, más sed de combustible.',
    tier: 1,
    priceCash: 850,
    physics: {
      massKg: 33,
      localCenterOfMass: [0, 0, 2.1],
      dragArea: 0.2,
      dragCoefficient: 0.9,
      structuralStrength: 65,
      impactTolerance: 42,
      mountStrength: 75,
    },
    engine: ENGINE_MEDIUM,
  },
  {
    id: 'wing_a_basic',
    category: 'wingSet',
    name: 'Ala de tela básica',
    description: 'Costillas simples y tela tensada. Sustentación decente, drag alto.',
    tier: 0,
    priceCash: 0,
    physics: {
      massKg: 42,
      localCenterOfMass: [0, 0.3, 0],
      dragArea: 0.05,
      dragCoefficient: 0.05,
      structuralStrength: 50,
      impactTolerance: 30,
      mountStrength: 55,
    },
    aeroSurfaces: [WING_A, AILERON_L, AILERON_R],
  },
  {
    id: 'wing_b_highlift',
    category: 'wingSet',
    name: 'Ala de alta sustentación',
    description: 'Mayor superficie y perfil más curvo. Vuela más lento y despega antes, a costa de velocidad punta.',
    tier: 1,
    priceCash: 650,
    physics: {
      massKg: 47,
      localCenterOfMass: [0, 0.3, 0],
      dragArea: 0.06,
      dragCoefficient: 0.05,
      structuralStrength: 55,
      impactTolerance: 32,
      mountStrength: 58,
    },
    aeroSurfaces: [WING_B_HIGH_LIFT, AILERON_L, AILERON_R],
  },
  {
    id: 'tank_8',
    category: 'fuelTank',
    fuelCapacityL: 8,
    name: 'Tanque 8L',
    description: 'Depósito plástico reciclado. Ligero, poca autonomía.',
    tier: 0,
    priceCash: 0,
    physics: {
      massKg: 6,
      localCenterOfMass: [0, -0.1, 0.6],
      dragArea: 0.01,
      dragCoefficient: 0.3,
      structuralStrength: 30,
      impactTolerance: 20,
      mountStrength: 40,
    },
  },
  {
    id: 'tank_nightjar_20', category: 'fuelTank', fuelCapacityL: 20,
    name: 'Depósito Nightjar 20L', description: 'Depósito de serie tras los asientos del Nightjar.',
    tier: 2, priceCash: 0,
    physics: { massKg: 4, localCenterOfMass: [0, 0.95, -0.55], dragArea: 0, dragCoefficient: 0, structuralStrength: 40, impactTolerance: 30, mountStrength: 50 },
  },
  {
    id: 'tank_nightjar_32', category: 'fuelTank', fuelCapacityL: 32,
    name: 'Depósito largo alcance 32L', description: 'Segundo depósito bajo el asiento derecho: más ruta, más peso en ruedas.',
    tier: 2, priceCash: 650,
    physics: { massKg: 6, localCenterOfMass: [0, 0.95, -0.55], dragArea: 0, dragCoefficient: 0, structuralStrength: 40, impactTolerance: 30, mountStrength: 50 },
  },
  {
    id: 'tank_12',
    category: 'fuelTank',
    fuelCapacityL: 12,
    name: 'Tanque 12L',
    description: 'Más autonomía, más peso muerto cerca del centro de gravedad.',
    tier: 1,
    priceCash: 300,
    physics: {
      massKg: 9,
      localCenterOfMass: [0, -0.1, 0.6],
      dragArea: 0.012,
      dragCoefficient: 0.3,
      structuralStrength: 32,
      impactTolerance: 20,
      mountStrength: 42,
    },
  },
  {
    id: 'gear_light',
    category: 'landingGear',
    name: 'Tren ligero de tres ruedas',
    description: 'Ruedas pequeñas recicladas. Rueda bien en pista firme, sufre en terreno irregular.',
    tier: 0,
    priceCash: 0,
    physics: {
      massKg: 14,
      localCenterOfMass: [0, -0.6, 0.3],
      dragArea: 0.04,
      dragCoefficient: 0.8,
      structuralStrength: 40,
      impactTolerance: 35,
      mountStrength: 50,
    },
    groundFrictionMul: 1.0,
  },
  {
    id: 'gear_field',
    category: 'landingGear',
    name: 'Tren de campo reforzado',
    description: 'Ruedas grandes de baja presión. Más peso y drag, tolera terreno irregular.',
    tier: 1,
    priceCash: 500,
    physics: {
      massKg: 20,
      localCenterOfMass: [0, -0.6, 0.3],
      dragArea: 0.06,
      dragCoefficient: 0.9,
      structuralStrength: 55,
      impactTolerance: 55,
      mountStrength: 65,
    },
    groundFrictionMul: 1.35,
  },
  {
    id: 'engine_efficient',
    category: 'engine',
    name: 'Field Twin 15hp Eficiente',
    description: 'Carburador reajustado y hélice de mejor rendimiento. Menos potencia pico que el 18hp, pero mejor eficiencia de propulsión.',
    tier: 2,
    priceCash: 1200,
    physics: {
      massKg: 29,
      localCenterOfMass: [0, 0, 2.1],
      dragArea: 0.17,
      dragCoefficient: 0.85,
      structuralStrength: 62,
      impactTolerance: 41,
      mountStrength: 72,
    },
    engine: ENGINE_EFFICIENT,
    requiresTechId: 'power_efficient',
  },
  {
    id: 'wing_c_efficient',
    category: 'wingSet',
    name: 'Ala eficiente de perfil pulido',
    description: 'Costillas optimizadas y tela mejor tensada. Menos drag parásito a igual superficie.',
    tier: 2,
    priceCash: 900,
    physics: {
      massKg: 44,
      localCenterOfMass: [0, 0.3, 0],
      dragArea: 0.045,
      dragCoefficient: 0.045,
      structuralStrength: 53,
      impactTolerance: 31,
      mountStrength: 56,
    },
    aeroSurfaces: [WING_C_EFFICIENT, AILERON_L, AILERON_R],
    requiresTechId: 'aero_efficient_wing',
  },
  {
    id: 'gear_reinforced',
    category: 'landingGear',
    name: 'Tren reforzado con suspensión',
    description: 'Amortiguación mejorada sobre el tren de campo. Reduce el impacto de aterrizajes duros.',
    tier: 2,
    priceCash: 800,
    physics: {
      massKg: 22,
      localCenterOfMass: [0, -0.6, 0.3],
      dragArea: 0.055,
      dragCoefficient: 0.85,
      structuralStrength: 65,
      impactTolerance: 70,
      mountStrength: 72,
    },
    groundFrictionMul: 1.4,
    requiresTechId: 'ground_suspension',
  },
  {
    id: 'wing_d_bush',
    category: 'wingSet',
    name: 'Ala STOL de campo',
    description: 'Ala de gran superficie con borde de ataque fijo. Despega y aterriza cortísimo con carga, pero castiga la velocidad de crucero.',
    tier: 3,
    priceCash: 1400,
    physics: {
      massKg: 62,
      localCenterOfMass: [0, 0.3, 0],
      dragArea: 0.07,
      dragCoefficient: 0.06,
      structuralStrength: 78,
      impactTolerance: 46,
      mountStrength: 80,
    },
    aeroSurfaces: [WING_D_BUSH, AILERON_L, AILERON_R],
    requiresTechId: 'airframe_bush_king',
  },
  ...ENGINE_PARTS,
];

export const FRAME_ZERO: FrameDefinition = {
  id: 'frame_zero',
  name: 'Aerofox Kestrel 2',
  description: 'Ultraligero experimental de Aerofox: ala alta, estructura tubular abierta, tren triciclo y hélice propulsora. La configuración de fábrica usa Rotax 582.',
  tier: 0,
  hardpoints: [
    { id: 'engineMountRear', category: 'engine', accepts: ['engine_small', 'engine_medium', 'engine_efficient', 'hirth_f33', 'rotax_447', 'rotax_503', 'hirth_f23', 'rotax_582', 'hirth_3203', 'turbojet_jt80'] },
    { id: 'wingRoot', category: 'wingSet', accepts: ['wing_quicksilver_mxii', 'wing_a_basic', 'wing_b_highlift', 'wing_c_efficient'] },
    { id: 'tankBay', category: 'fuelTank', accepts: ['tank_quicksilver_22_7', 'tank_8', 'tank_12'] },
    { id: 'gearMain', category: 'landingGear', accepts: ['gear_light', 'gear_field', 'gear_reinforced'] },
  ],
  basePhysics: {
    massKg: 95,
    localCenterOfMass: [0, 0, -0.2],
    dragArea: 0.35,
    dragCoefficient: 1.1,
    structuralStrength: 45,
    impactTolerance: 30,
    mountStrength: 50,
  },
  baseAeroSurfaces: [ELEVATOR, RUDDER],
  mtowKg: 360,
  defaultLoadout: {
    engine: 'engine_small',
    wingSet: 'wing_a_basic',
    fuelTank: 'tank_8',
    landingGear: 'gear_light',
  },
};

/** A sturdier next-step airframe. It shares the starter hardpoint standards so a
 * player can move their existing inventory over immediately, but its lower base drag
 * rewards long routes and its higher mass asks for deliberate landing management. */
export const FRAME_TRAILBLAZER: FrameDefinition = {
  id: 'frame_trailblazer',
  name: 'Trailblazer Mk I',
  description: 'Fuselaje cerrado de ruta. Menos drag y más estabilidad: el fuselaje de los contratos largos.',
  tier: 2,
  priceCash: 1600,
  requiresTechId: 'airframe_trailblazer',
  hardpoints: [
    { id: 'engineMountRear', category: 'engine', accepts: ['engine_small', 'engine_medium', 'engine_efficient', 'rotax_447', 'rotax_503', 'hirth_f23', 'rotax_582', 'hirth_3203', 'rotax_912', 'rotax_914', 'turbojet_jt80', 'turbojet_tj100'] },
    { id: 'wingRoot', category: 'wingSet', accepts: ['wing_a_basic', 'wing_b_highlift', 'wing_c_efficient'] },
    { id: 'tankBay', category: 'fuelTank', accepts: ['tank_8', 'tank_12'] },
    { id: 'gearMain', category: 'landingGear', accepts: ['gear_light', 'gear_field', 'gear_reinforced'] },
  ],
  basePhysics: {
    massKg: 112,
    localCenterOfMass: [0, 0, -0.1],
    dragArea: 0.29,
    dragCoefficient: 0.92,
    structuralStrength: 68,
    impactTolerance: 48,
    mountStrength: 70,
  },
  baseAeroSurfaces: [ELEVATOR, RUDDER],
  defaultLoadout: { ...FRAME_ZERO.defaultLoadout, wingSet: 'wing_a_basic', fuelTank: 'tank_8' },
  // Stiffer, better-rigged airframe: crisper roll, steadier in pitch and gusts.
  handling: { rollAuthority: 7.4, rollDamping: 4.6, pitchStability: 21, yawStability: 7.5, dihedral: 4 },
};

/** The cheap DIY featherweight. Strips the starter down to the bare tube: the lowest mass
 * and shortest ground roll in the game, bought with a fragile structure, one small tank and
 * no upgrade path beyond the starter parts it shares. */
export const FRAME_YARDBIRD: FrameDefinition = {
  id: 'frame_yardbird',
  name: 'Yardbird',
  description: 'Esqueleto mínimo de patio. Despega en nada y se posa donde sea, pero no aguanta golpes ni lleva peso.',
  tier: 1,
  priceCash: 700,
  requiresTechId: 'airframe_yardbird',
  hardpoints: [
    { id: 'engineMountRear', category: 'engine', accepts: ['engine_small', 'engine_medium', 'hirth_f33', 'rotax_447'] },
    { id: 'wingRoot', category: 'wingSet', accepts: ['wing_a_basic'] },
    { id: 'tankBay', category: 'fuelTank', accepts: ['tank_8'] },
    { id: 'gearMain', category: 'landingGear', accepts: ['gear_light'] },
  ],
  basePhysics: {
    massKg: 62,
    localCenterOfMass: [0, 0, -0.25],
    dragArea: 0.4,
    dragCoefficient: 1.15,
    structuralStrength: 30,
    impactTolerance: 22,
    mountStrength: 36,
  },
  baseAeroSurfaces: [ELEVATOR, RUDDER],
  defaultLoadout: {
    engine: 'engine_small',
    wingSet: 'wing_a_basic',
    fuelTank: 'tank_8',
    landingGear: 'gear_light',
  },
  // Almost no mass to swing around: quick on the controls and just as quick to diverge.
  handling: { rollAuthority: 6.6, pitchDamping: 3.6, pitchStability: 14, yawStability: 5, dihedral: 2.6 },
};

/** The heavy rough-field hauler that ends the ladder. Big STOL wing, reinforced gear and a
 * full tank make it the only airframe that can take a loaded contract into a gravel strip;
 * it pays for that in mass, drag and cruise speed. */
export const FRAME_BUSH_KING: FrameDefinition = {
  id: 'frame_bush_king',
  name: 'Bush King',
  description: 'Fuselaje pesado de monte. Ala grande, tren reforzado y depósito lleno: lento, pero entra donde no entra nadie.',
  tier: 3,
  priceCash: 3800,
  requiresTechId: 'airframe_bush_king',
  hardpoints: [
    { id: 'engineMountRear', category: 'engine', accepts: ['engine_medium', 'engine_efficient', 'rotax_503', 'rotax_582', 'hirth_3203', 'rotax_912', 'rotax_914'] },
    { id: 'wingRoot', category: 'wingSet', accepts: ['wing_b_highlift', 'wing_d_bush'] },
    { id: 'tankBay', category: 'fuelTank', accepts: ['tank_12'] },
    { id: 'gearMain', category: 'landingGear', accepts: ['gear_field', 'gear_reinforced'] },
  ],
  basePhysics: {
    massKg: 165,
    localCenterOfMass: [0, 0, -0.1],
    dragArea: 0.46,
    dragCoefficient: 1.0,
    structuralStrength: 96,
    impactTolerance: 78,
    mountStrength: 98,
  },
  baseAeroSurfaces: [ELEVATOR, RUDDER],
  defaultLoadout: {
    engine: 'engine_medium',
    wingSet: 'wing_d_bush',
    fuelTank: 'tank_12',
    landingGear: 'gear_field',
  },
  // Heavy and deliberately damped: it tracks through gusts instead of reacting to them.
  handling: { pitchAuthority: 3.8, rollAuthority: 4.2, pitchDamping: 4.6, rollDamping: 4.8, pitchStability: 24, yawStability: 8.5, dihedral: 4.5 },
};

/** Ridgeway RW-12 Nightjar: two-seat side-by-side enclosed high-wing pusher (RANS S-12 class). Physics come
 * from its own AirframeSpec (src/flight/aircraft/nightjar.ts); basePhysics/baseAeroSurfaces only feed the
 * catalogue-level estimates (mass/COM summary, workshop drag readout). */
export const FRAME_NIGHTJAR: FrameDefinition = {
  id: 'frame_nightjar', name: 'Ridgeway RW-12 Nightjar',
  description: 'Biplaza lado a lado con cabina cerrada, ala alta arriostrada y motor impulsor sobre el ala. Más rápido y con más autonomía que el Kestrel; pide más pista y más mano en el alabeo.',
  tier: 2, priceCash: 2600, requiresTechId: 'airframe_nightjar',
  hardpoints: [
    { id: 'engineMountRear', category: 'engine', accepts: ['rotax_503', 'rotax_582'] },
    { id: 'tankBay', category: 'fuelTank', accepts: ['tank_nightjar_20', 'tank_nightjar_32'] },
    { id: 'gearMain', category: 'landingGear', accepts: ['gear_light', 'gear_field'] },
  ],
  basePhysics: { massKg: 152, localCenterOfMass: [0, 1.3, 0.05], dragArea: 0.48, dragCoefficient: 0.9, structuralStrength: 80, impactTolerance: 62, mountStrength: 82 },
  baseAeroSurfaces: [
    { ...AILERON_L, id: 'aileron_l', localPosition: [2.83, 1.95, -1.1], areaM2: 0.41, spanM: 2.75, chordM: 0.28, maxDeflectionDeg: 20 },
    { ...AILERON_R, id: 'aileron_r', localPosition: [-2.83, 1.95, -1.1], areaM2: 0.41, spanM: 2.75, chordM: 0.28, maxDeflectionDeg: 20 },
    { ...ELEVATOR, localPosition: [0, 1.0, -4.55], areaM2: 1.74, spanM: 2.62, chordM: 0.78, maxDeflectionDeg: 22 },
    { ...RUDDER, localPosition: [0, 1.6, -4.45], areaM2: 1.1, spanM: 1.35, chordM: 0.85, maxDeflectionDeg: 25 },
  ],
  mtowKg: 440,
  defaultLoadout: { engine: 'rotax_503', fuelTank: 'tank_nightjar_20', landingGear: 'gear_light' },
  handling: { pitchAuthority: 4.2, rollAuthority: 4.6, pitchDamping: 4.4, rollDamping: 4.4, pitchStability: 21, yawStability: 7.8, dihedral: 1.5 },
};

/** Zenith STOL CH 701: compact high wing with fixed slats, large cabin and nose tractor. */
export const FRAME_ZENITH_CH701: FrameDefinition = {
  id: 'frame_zenith_ch701', name: 'Zenith CH 701 Bushbox',
  description: 'Ala alta con slats fijos, cabina amplia y tren de campo. Diseñado para operar desde pistas cortas y ásperas.',
  tier: 3, priceCash: 6200, requiresTechId: 'airframe_zenith_ch701',
  hardpoints: [
    { id: 'engineMountNose', category: 'engine', accepts: ['rotax_912'] },
    { id: 'wingRoot', category: 'wingSet', accepts: ['wing_ch701'] },
    { id: 'tankBay', category: 'fuelTank', accepts: ['tank_ch701_75'] },
    { id: 'gearMain', category: 'landingGear', accepts: ['gear_field', 'gear_reinforced'] },
  ],
  // The resolved build adds the 80 hp engine, wing, tank, gear, and pilot as separate masses;
  // keep this at the airframe shell mass so the assembled empty aircraft is near 580 lb.
  basePhysics: { massKg: 100, localCenterOfMass: [0, 0.65, -0.25], dragArea: 0.34, dragCoefficient: 0.88, structuralStrength: 88, impactTolerance: 72, mountStrength: 92 },
  baseAeroSurfaces: [CH701_ELEVATOR, CH701_RUDDER], mtowKg: 500,
  defaultLoadout: { engine: 'rotax_912', wingSet: 'wing_ch701', fuelTank: 'tank_ch701_75', landingGear: 'gear_field' },
  handling: { pitchAuthority: 4.8, rollAuthority: 5.4, pitchDamping: 4.6, rollDamping: 4.4, pitchStability: 22, yawStability: 8.1, dihedral: 1.5 },
};

/** Authored progression order: each entry is a materially different airframe with its own
 * GLB (src/render/assetManifest.ts#FRAME_ASSET_IDS), price and research gate. */
export const FRAMES: FrameDefinition[] = [FRAME_ZERO, FRAME_YARDBIRD, FRAME_NIGHTJAR, FRAME_ZENITH_CH701, FRAME_TRAILBLAZER, FRAME_BUSH_KING];

export function getFrame(id: string): FrameDefinition | undefined {
  return FRAMES.find((f) => f.id === id);
}

export function getPart(id: string): PartDefinition | undefined {
  return PARTS.find((p) => p.id === id);
}
