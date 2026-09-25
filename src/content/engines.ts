// Upgrade engine line: Rotax two-strokes (447 / 503 / 582 Blue Head), Rotax four-strokes (912 / 914 Turbo),
// Hirth two-strokes (F-33 / F-23 / 3203) and two small turbojets. Power, rpm, reduction ratios and installed
// masses follow the manufacturers' published figures (rounded; installed = engine + gearbox + exhaust +
// coolant/oil where it applies). Fuel flows and thermal behaviour are gameplay abstractions.
//
// Each engine has two halves:
//  - EngineSpec / PartDefinition: what the flight model and the economy read.
//  - EngineCharacter: what the player SEES and HEARS (layout, cylinder-head colour, carbs, radiator, exhaust,
//    smoke, vibration, sound). Render and audio read this; nothing in the physics does.

import type { EngineSpec, PartDefinition } from '../core/types';

export type EngineLayout = 'stock' | 'single' | 'inlineTwin' | 'flatTwin' | 'flatFour' | 'turbojet';
export type EngineCooling = 'free-air' | 'fan' | 'liquid' | 'liquid-heads' | 'turbine';

export interface EngineSound {
  /** Combustion events per crank revolution (2-stroke twin = 2, single = 1, 4-stroke flat-four = 2). */
  firingPerRev: number;
  osc1: OscillatorType;
  osc2: OscillatorType;
  /** osc2 frequency as a multiple of the firing frequency. */
  osc2Ratio: number;
  osc2Mix: number;
  /** Multiplies the low-pass cutoff: >1 = raspy two-stroke, <1 = muffled four-stroke. */
  brightness: number;
  gain: number;
  /** Turbine: high whine + broadband roar instead of a firing pulse. */
  jet?: boolean;
}

export interface EngineCharacter {
  brand: 'Field' | 'Rotax' | 'Hirth' | 'Turbina';
  layout: EngineLayout;
  cooling: EngineCooling;
  cylinderColor: string;
  headColor: string;
  caseColor: string;
  accentColor: string;
  carbs: number;
  fanShroud: boolean;
  radiator: boolean;
  turbo: boolean;
  exhaust: 'none' | 'tunedPipe' | 'twinPipes' | 'muffler' | 'nozzle';
  /** Exhaust haze: colour, puffs/s at full throttle, puff size (m). */
  smoke: { color: string; rate: number; size: number };
  /** Mount shake, 0..1 (singles shake, flat-fours are smooth, turbines hum). */
  vibration: number;
  sound: EngineSound;
  /** Short tags for the workshop ("Cabeza azul", "Refrigeración líquida"...). */
  traits: string[];
}

const TWO_STROKE_SOUND: EngineSound = { firingPerRev: 2, osc1: 'sawtooth', osc2: 'square', osc2Ratio: 2.01, osc2Mix: 0.6, brightness: 1.25, gain: 1 };

export const ENGINE_CHARACTER: Record<string, EngineCharacter> = {
  // Field Twin salvage engines keep the A0's baked engine and the original sound.
  engine_small: {
    brand: 'Field', layout: 'stock', cooling: 'fan', cylinderColor: '#3a3d3c', headColor: '#3a3d3c', caseColor: '#2a2d2d', accentColor: '#8a6a3a',
    carbs: 1, fanShroud: false, radiator: false, turbo: false, exhaust: 'muffler',
    smoke: { color: '#8f949a', rate: 6, size: 0.35 }, vibration: 0.55,
    sound: { firingPerRev: 1, osc1: 'sawtooth', osc2: 'square', osc2Ratio: 2.01, osc2Mix: 0.55, brightness: 1, gain: 1 },
    traits: ['Rescatado', 'Arranque de tirón'],
  },
  rotax_447: {
    brand: 'Rotax', layout: 'inlineTwin', cooling: 'fan', cylinderColor: '#b9bcbc', headColor: '#c9cbc9', caseColor: '#a9acaa', accentColor: '#151718',
    carbs: 1, fanShroud: true, radiator: false, turbo: false, exhaust: 'tunedPipe',
    smoke: { color: '#9fb0c4', rate: 10, size: 0.4 }, vibration: 0.35, sound: { ...TWO_STROKE_SOUND },
    traits: ['2T · 2 cilindros', 'Ventilador', '1 carburador'],
  },
  rotax_503: {
    brand: 'Rotax', layout: 'inlineTwin', cooling: 'fan', cylinderColor: '#b9bcbc', headColor: '#c9cbc9', caseColor: '#a9acaa', accentColor: '#151718',
    carbs: 2, fanShroud: true, radiator: false, turbo: false, exhaust: 'tunedPipe',
    smoke: { color: '#9fb0c4', rate: 13, size: 0.45 }, vibration: 0.35, sound: { ...TWO_STROKE_SOUND, brightness: 1.3, gain: 1.08 },
    traits: ['2T · 2 cilindros', 'Ventilador', 'Doble carburador', 'Doble encendido'],
  },
  rotax_582: {
    brand: 'Rotax', layout: 'inlineTwin', cooling: 'liquid', cylinderColor: '#aeb2b3', headColor: '#1f5fd0', caseColor: '#a3a7a6', accentColor: '#1f5fd0',
    carbs: 2, fanShroud: false, radiator: true, turbo: false, exhaust: 'tunedPipe',
    smoke: { color: '#a8b6c6', rate: 9, size: 0.45 }, vibration: 0.28, sound: { ...TWO_STROKE_SOUND, brightness: 1.15, osc2Mix: 0.5, gain: 1.1 },
    traits: ['Blue Head', 'Refrigeración líquida', 'Válvula rotativa', 'Radiador'],
  },
  rotax_912: {
    brand: 'Rotax', layout: 'flatFour', cooling: 'liquid-heads', cylinderColor: '#b4b7b6', headColor: '#d4d6d4', caseColor: '#9fa3a2', accentColor: '#161819',
    carbs: 2, fanShroud: false, radiator: true, turbo: false, exhaust: 'muffler',
    smoke: { color: '#b9bec4', rate: 1.5, size: 0.3 }, vibration: 0.1,
    sound: { firingPerRev: 2, osc1: 'triangle', osc2: 'sawtooth', osc2Ratio: 0.5, osc2Mix: 0.7, brightness: 0.62, gain: 1.05 },
    traits: ['4T · bóxer 4 cilindros', 'Culatas líquidas', 'Reductora 2.43', 'Bajo consumo'],
  },
  rotax_914: {
    brand: 'Rotax', layout: 'flatFour', cooling: 'liquid-heads', cylinderColor: '#b4b7b6', headColor: '#d4d6d4', caseColor: '#9fa3a2', accentColor: '#c8322a',
    carbs: 2, fanShroud: false, radiator: true, turbo: true, exhaust: 'muffler',
    smoke: { color: '#b9bec4', rate: 1.5, size: 0.3 }, vibration: 0.1,
    sound: { firingPerRev: 2, osc1: 'triangle', osc2: 'sawtooth', osc2Ratio: 0.5, osc2Mix: 0.65, brightness: 0.75, gain: 1.12 },
    traits: ['Turbo', '4T · bóxer 4 cilindros', 'Potencia en altura', 'Culatas líquidas'],
  },
  hirth_f33: {
    brand: 'Hirth', layout: 'single', cooling: 'free-air', cylinderColor: '#2b2d2e', headColor: '#c3c5c3', caseColor: '#3a3c3d', accentColor: '#d8531f',
    carbs: 1, fanShroud: false, radiator: false, turbo: false, exhaust: 'twinPipes',
    smoke: { color: '#98a4b2', rate: 8, size: 0.35 }, vibration: 0.85,
    sound: { firingPerRev: 1, osc1: 'square', osc2: 'sawtooth', osc2Ratio: 3.02, osc2Mix: 0.45, brightness: 1.45, gain: 0.95 },
    traits: ['2T · monocilíndrico', 'Aire libre', 'Ultraligero'],
  },
  hirth_f23: {
    brand: 'Hirth', layout: 'flatTwin', cooling: 'free-air', cylinderColor: '#2b2d2e', headColor: '#c3c5c3', caseColor: '#3a3c3d', accentColor: '#d8531f',
    carbs: 1, fanShroud: false, radiator: false, turbo: false, exhaust: 'twinPipes',
    smoke: { color: '#98a4b2', rate: 12, size: 0.4 }, vibration: 0.3,
    sound: { ...TWO_STROKE_SOUND, osc1: 'square', osc2Ratio: 1.5, brightness: 1.35 },
    traits: ['2T · bóxer', 'Aire libre', 'Se calienta en tierra'],
  },
  hirth_3203: {
    brand: 'Hirth', layout: 'inlineTwin', cooling: 'free-air', cylinderColor: '#2b2d2e', headColor: '#c3c5c3', caseColor: '#3a3c3d', accentColor: '#d8531f',
    carbs: 2, fanShroud: false, radiator: false, turbo: false, exhaust: 'twinPipes',
    smoke: { color: '#98a4b2', rate: 14, size: 0.45 }, vibration: 0.45,
    sound: { ...TWO_STROKE_SOUND, brightness: 1.45, gain: 1.12 },
    traits: ['2T · 2 cilindros', 'Aire libre', 'Mucho par', 'Sediento'],
  },
  turbojet_jt80: {
    brand: 'Turbina', layout: 'turbojet', cooling: 'turbine', cylinderColor: '#c4c7c9', headColor: '#6d5a8a', caseColor: '#8d9193', accentColor: '#d08a2e',
    carbs: 0, fanShroud: false, radiator: false, turbo: false, exhaust: 'nozzle',
    smoke: { color: '#c9ccd0', rate: 3, size: 0.5 }, vibration: 0.06,
    sound: { firingPerRev: 1, osc1: 'sine', osc2: 'triangle', osc2Ratio: 1.5, osc2Mix: 0.4, brightness: 2, gain: 0.8, jet: true },
    traits: ['Sin hélice', 'Retraso de spool', 'Queroseno', 'Empuje constante'],
  },
  turbojet_tj100: {
    brand: 'Turbina', layout: 'turbojet', cooling: 'turbine', cylinderColor: '#c4c7c9', headColor: '#5a4a86', caseColor: '#7d8183', accentColor: '#d08a2e',
    carbs: 0, fanShroud: false, radiator: false, turbo: false, exhaust: 'nozzle',
    smoke: { color: '#c9ccd0', rate: 4, size: 0.6 }, vibration: 0.05,
    sound: { firingPerRev: 1, osc1: 'sine', osc2: 'triangle', osc2Ratio: 1.5, osc2Mix: 0.5, brightness: 2.2, gain: 0.95, jet: true },
    traits: ['Sin hélice', 'Retraso de spool', 'Muy sediento', 'Velocidad punta'],
  },
};
ENGINE_CHARACTER.engine_medium = ENGINE_CHARACTER.engine_small;
ENGINE_CHARACTER.engine_efficient = ENGINE_CHARACTER.engine_small;

export function getEngineCharacter(engineId: string | undefined): EngineCharacter {
  return (engineId && ENGINE_CHARACTER[engineId]) || ENGINE_CHARACTER.engine_small;
}

// ---- Physics specs ------------------------------------------------------------------------------
// maxPowerKw stays in the catalogue's abstract scale (real / 2.4) so old comparisons keep working;
// shaftPowerKw is what the flight model uses for these engines. fuelBurnLpm is on the game's compressed fuel
// scale (the Field Twin 12hp burns 4 L/min); relative consumption follows real BSFC: four-strokes ~35 % leaner
// than two-strokes per kW, free-air Hirths a little thirstier, turbojets several times thirstier.
const spec = (id: string, name: string, type: EngineSpec['type'], hp: number, s: Partial<EngineSpec>): EngineSpec => ({
  id, name, type,
  maxPowerKw: (hp * 0.7457) / 2.4,
  shaftPowerKw: hp * 0.7457,
  idleRpm: 2000,
  redlineRpm: 6800,
  responseTime: 0.28,
  thermalLimit: 1,
  reliabilityClass: 2,
  propEfficiency: 0.66,
  propDiameterM: 1.6,
  gearRatio: 2.58,
  altitudeLapse: 1,
  ...s,
});

export const ROTAX_447 = spec('rotax_447', 'Rotax 447 UL', 'twoStroke', 40, {
  propDiameterM: 1.52, fuelBurnLpm: 4.6, responseTime: 0.26, propEfficiency: 0.65,
  thermal: { heatAtFull: 0.9, airflowRelief: 0.1, timeConstantS: 35 },
});
export const ROTAX_503 = spec('rotax_503', 'Rotax 503 UL DCDI', 'twoStroke', 50, {
  propDiameterM: 1.63, fuelBurnLpm: 5.8, responseTime: 0.26, propEfficiency: 0.66, reliabilityClass: 3,
  thermal: { heatAtFull: 0.98, airflowRelief: 0.1, timeConstantS: 35 },
});
export const ROTAX_582 = spec('rotax_582', 'Rotax 582 UL Blue Head', 'twoStroke', 65, {
  propDiameterM: 68 * 0.0254, gearRatio: 3.0, fuelBurnLpm: 7.2, responseTime: 0.24, propEfficiency: 0.68, reliabilityClass: 3,
  thermal: { heatAtFull: 0.8, airflowRelief: 0.05, timeConstantS: 90 },
});
export const ROTAX_912 = spec('rotax_912', 'Rotax 912 UL', 'fourStroke', 80, {
  idleRpm: 1400, redlineRpm: 5800, propDiameterM: 1.73, gearRatio: 2.43, fuelBurnLpm: 6.3, responseTime: 0.4, propEfficiency: 0.72, reliabilityClass: 5,
  thermal: { heatAtFull: 0.75, airflowRelief: 0.05, timeConstantS: 120 },
});
export const ROTAX_914 = spec('rotax_914', 'Rotax 914 UL Turbo', 'fourStroke', 115, {
  idleRpm: 1400, redlineRpm: 5800, propDiameterM: 1.83, gearRatio: 2.43, fuelBurnLpm: 9.4, responseTime: 0.55, propEfficiency: 0.72, reliabilityClass: 4,
  altitudeLapse: 0.3,
  thermal: { heatAtFull: 0.88, airflowRelief: 0.05, timeConstantS: 110 },
});
export const HIRTH_F33 = spec('hirth_f33', 'Hirth F-33', 'twoStroke', 28, {
  propDiameterM: 1.37, gearRatio: 2.5, fuelBurnLpm: 3.3, responseTime: 0.2, propEfficiency: 0.63, reliabilityClass: 2,
  thermal: { heatAtFull: 1.02, airflowRelief: 0.3, timeConstantS: 30 },
});
export const HIRTH_F23 = spec('hirth_f23', 'Hirth F-23', 'twoStroke', 50, {
  propDiameterM: 1.63, gearRatio: 2.5, fuelBurnLpm: 6.0, responseTime: 0.24, propEfficiency: 0.66, reliabilityClass: 2,
  thermal: { heatAtFull: 1.2, airflowRelief: 0.32, timeConstantS: 25 },
});
export const HIRTH_3203 = spec('hirth_3203', 'Hirth 3203', 'twoStroke', 65, {
  propDiameterM: 1.73, gearRatio: 2.62, fuelBurnLpm: 8.2, responseTime: 0.25, propEfficiency: 0.67, reliabilityClass: 2,
  thermal: { heatAtFull: 1.22, airflowRelief: 0.32, timeConstantS: 25 },
});
// Turbojets: rpm is reported as N1 x 100 (10 000 = 100 %), so the tach, HUD and audio read a percentage.
export const TURBOJET_JT80 = spec('turbojet_jt80', 'Microturbina JT-80', 'turbine', 0, {
  maxPowerKw: 14, shaftPowerKw: 34, idleRpm: 3800, redlineRpm: 10000, propDiameterM: 0.3, gearRatio: 1, fuelBurnLpm: 11, responseTime: 3.2,
  propEfficiency: 1, reliabilityClass: 3, altitudeLapse: 1,
  jet: { maxThrustN: 850, spoolTimeS: 3.2, idleFraction: 0.38 },
  thermal: { heatAtFull: 0.82, airflowRelief: 0.05, timeConstantS: 6 },
});
export const TURBOJET_TJ100 = spec('turbojet_tj100', 'Turborreactor TJ-100', 'turbine', 0, {
  maxPowerKw: 26, shaftPowerKw: 62, idleRpm: 3600, redlineRpm: 10000, propDiameterM: 0.3, gearRatio: 1, fuelBurnLpm: 16, responseTime: 4.2,
  propEfficiency: 1, reliabilityClass: 4, altitudeLapse: 1,
  jet: { maxThrustN: 1250, spoolTimeS: 4.2, idleFraction: 0.36 },
  thermal: { heatAtFull: 0.86, airflowRelief: 0.05, timeConstantS: 6 },
});

const mountPhysics = (massKg: number, dragArea: number, strength: number) => ({
  massKg,
  localCenterOfMass: [0, 0, 2.1] as [number, number, number],
  dragArea,
  dragCoefficient: 0.9,
  structuralStrength: strength,
  impactTolerance: Math.round(strength * 0.65),
  mountStrength: strength + 10,
});

export const ENGINE_PARTS: PartDefinition[] = [
  {
    id: 'hirth_f33', category: 'engine', name: 'Hirth F-33 · 28 hp',
    description: 'Monocilíndrico de dos tiempos refrigerado por aire libre. El más ligero del catálogo: vibra como una licuadora y se calienta si rueda mucho en tierra.',
    tier: 1, priceCash: 1100, physics: mountPhysics(19, 0.12, 55), engine: HIRTH_F33, requiresTechId: 'power_rotax_2t',
  },
  {
    id: 'rotax_447', category: 'engine', name: 'Rotax 447 UL · 40 hp',
    description: 'El clásico gris de los ultraligeros: dos cilindros en línea con ventilador y cubierta negra, un solo carburador y reductora tipo B. Fiable y fácil de mantener.',
    tier: 1, priceCash: 1900, physics: mountPhysics(30, 0.17, 62), engine: ROTAX_447, requiresTechId: 'power_rotax_2t',
  },
  {
    id: 'rotax_503', category: 'engine', name: 'Rotax 503 UL DCDI · 50 hp',
    description: 'El motor de serie del Kestrel 2: doble carburador y doble encendido. Diez caballos más que el 447 con casi el mismo peso; a tope en tierra roza el límite de temperatura.',
    tier: 2, priceCash: 3200, physics: mountPhysics(41, 0.19, 66), engine: ROTAX_503, requiresTechId: 'power_dual_carb',
  },
  {
    id: 'hirth_f23', category: 'engine', name: 'Hirth F-23 · 50 hp',
    description: 'Bóxer de dos tiempos con los cilindros al viento. Liso y más ligero que el 503, pero sin ventilador: en ascensos lentos y rodajes largos la temperatura sube y pierde potencia.',
    tier: 2, priceCash: 3000, physics: mountPhysics(33, 0.2, 60), engine: HIRTH_F23, requiresTechId: 'power_dual_carb',
  },
  {
    id: 'rotax_582', category: 'engine', name: 'Rotax 582 UL · Blue Head',
    description: 'Culatas azules, refrigeración líquida, válvula rotativa y radiador. 64 hp que no se recalientan en el ascenso, con reductora tipo C y hélice grande.',
    tier: 3, priceCash: 5200, physics: mountPhysics(52, 0.24, 72), engine: ROTAX_582, requiresTechId: 'power_liquid_cooling',
  },
  {
    id: 'hirth_3203', category: 'engine', name: 'Hirth 3203 · 65 hp',
    description: 'Dos cilindros en línea de aire libre con mucho par. Tanta potencia como el 582 por menos peso, a cambio de sed de combustible y temperatura siempre alta.',
    tier: 3, priceCash: 4600, physics: mountPhysics(40, 0.22, 66), engine: HIRTH_3203, requiresTechId: 'power_liquid_cooling',
  },
  {
    id: 'rotax_912', category: 'engine', name: 'Rotax 912 UL · 80 hp',
    description: 'Cuatro tiempos, bóxer de cuatro cilindros con culatas refrigeradas por líquido. Suave, silencioso y mucho más eficiente, pero pesa casi el doble que un dos tiempos.',
    tier: 4, priceCash: 11500, physics: mountPhysics(66, 0.28, 80), engine: ROTAX_912, requiresTechId: 'power_four_stroke',
  },
  {
    id: 'rotax_914', category: 'engine', name: 'Rotax 914 UL Turbo · 115 hp',
    description: 'El 912 con turbocompresor: mantiene la potencia en altura donde los atmosféricos se ahogan. El más potente de pistón, el más pesado y el más caro.',
    tier: 5, priceCash: 19000, physics: mountPhysics(78, 0.32, 86), engine: ROTAX_914, requiresTechId: 'power_turbo',
  },
  {
    id: 'turbojet_jt80', category: 'engine', name: 'Microturbina JT-80',
    description: 'Turborreactor de 850 N sin hélice. Pesa casi nada y el empuje no cae con la velocidad, pero tarda segundos en responder al acelerador y quema queroseno a chorros.',
    tier: 4, priceCash: 14000, physics: mountPhysics(11, 0.08, 60), engine: TURBOJET_JT80, requiresTechId: 'power_turbine',
  },
  {
    id: 'turbojet_tj100', category: 'engine', name: 'Turborreactor TJ-100',
    description: '1250 N de empuje continuo: la aeronave más rápida del taller. Spool lento, autonomía de minutos y un silbido que se oye desde el pueblo.',
    tier: 5, priceCash: 24000, physics: mountPhysics(22, 0.1, 70), engine: TURBOJET_TJ100, requiresTechId: 'power_turbine_heavy',
  },
];

/** Every engine part id, in progression order (Field Twins first). */
export const ENGINE_LADDER = ['engine_small', 'engine_medium', 'engine_efficient', ...ENGINE_PARTS.map((p) => p.id)];
