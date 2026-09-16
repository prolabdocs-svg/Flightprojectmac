// Tier 0/1 content: FRAME ZERO airframe and its earliest parts.
// Values are gameplay abstractions, not real aeronautical data (see spec section "Nota de seguridad").

import type { AeroSurfaceSpec, EngineSpec, FrameDefinition, PartDefinition } from '../core/types';

export const WING_A: AeroSurfaceSpec = {
  id: 'wing_root_main',
  localPosition: [0, 0.3, 0],
  areaM2: 12,
  spanM: 9,
  chordM: 1.4,
  zeroLiftAoADeg: -2,
  stallPositiveDeg: 15,
  stallNegativeDeg: -13,
  inducedDragFactor: 0.045,
  parasiticCd: 0.028,
};

export const WING_B_HIGH_LIFT: AeroSurfaceSpec = {
  ...WING_A,
  id: 'wing_root_main',
  areaM2: 14.5,
  spanM: 10,
  stallPositiveDeg: 17,
  parasiticCd: 0.034,
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
};

export const ENGINE_MEDIUM: EngineSpec = {
  ...ENGINE_SMALL,
  id: 'engine_medium',
  name: 'Field Twin 18hp',
  maxPowerKw: 13.5,
  responseTime: 0.3,
  propEfficiency: 0.66,
};

export const ENGINE_EFFICIENT: EngineSpec = {
  ...ENGINE_SMALL,
  id: 'engine_efficient',
  name: 'Field Twin 15hp Eficiente',
  maxPowerKw: 11,
  responseTime: 0.28,
  propEfficiency: 0.74,
};

export const WING_C_EFFICIENT: AeroSurfaceSpec = {
  ...WING_A,
  id: 'wing_root_main',
  areaM2: 12.5,
  spanM: 9.4,
  inducedDragFactor: 0.036,
  parasiticCd: 0.021,
};

export const PARTS: PartDefinition[] = [
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
    id: 'tank_12',
    category: 'fuelTank',
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
];

export const FRAME_ZERO: FrameDefinition = {
  id: 'frame_zero',
  name: 'Frame Zero',
  tier: 0,
  hardpoints: [
    { id: 'engineMountRear', category: 'engine', accepts: ['engine_small', 'engine_medium', 'engine_efficient'] },
    { id: 'wingRoot', category: 'wingSet', accepts: ['wing_a_basic', 'wing_b_highlift', 'wing_c_efficient'] },
    { id: 'tankBay', category: 'fuelTank', accepts: ['tank_8', 'tank_12'] },
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
  defaultLoadout: {
    engine: 'engine_small',
    wingSet: 'wing_a_basic',
    fuelTank: 'tank_8',
    landingGear: 'gear_light',
  },
};

export const FRAMES: FrameDefinition[] = [FRAME_ZERO];

export function getPart(id: string): PartDefinition | undefined {
  return PARTS.find((p) => p.id === id);
}
