// Tech tree content (spec section 15 "Árbol tecnológico" + 153.4 "Tech graph").
// Simplified vertical-slice subset: one or two nodes per family, enough to gate the
// tier-2 parts added in content/parts.ts and to demonstrate branch/prerequisite structure.

import type { TechNodeDef } from '../core/types';

export const TECH_NODES: TechNodeDef[] = [
  {
    id: 'airframe_zenith_ch701', category: 'airframe', name: 'Zenith CH 701 Bushbox',
    description: 'Diseño de ala slat con Rotax 912, ruedas de baja presión y depósito de 75 L.',
    costRp: 115, requires: ['power_four_stroke', 'ground_suspension'],
    unlocksPartIds: ['wing_ch701', 'tank_ch701_75'], unlocksFrameIds: ['frame_zenith_ch701'],
  },
  {
    id: 'airframe_nightjar', category: 'airframe', name: 'Planos Ridgeway RW-12 Nightjar',
    description: 'Biplaza de cabina cerrada y ala alta con motor impulsor: la aeronave de ruta para pasajeros y carga ligera.',
    costRp: 65, requires: ['airframe_yardbird'], unlocksPartIds: [], unlocksFrameIds: ['frame_nightjar'],
  },
  {
    id: 'airframe_bracing',
    category: 'airframe',
    name: 'Arriostrado mejorado',
    description: 'Refuerza la estructura del frame con cables de arriostrado adicionales.',
    costRp: 15,
    requires: [],
    unlocksPartIds: [],
  },
  {
    id: 'airframe_trailblazer',
    category: 'airframe',
    name: 'Proyecto Trailblazer',
    description: 'Planos de un fuselaje de ruta reforzado y más limpio. Desbloquea el Trailblazer Mk I en el taller.',
    costRp: 50,
    requires: ['airframe_bracing'],
    unlocksPartIds: [],
    unlocksFrameIds: ['frame_trailblazer'],
  },
  {
    id: 'airframe_yardbird',
    category: 'airframe',
    name: 'Proyecto Yardbird',
    description: 'Planos del esqueleto mínimo de patio. Desbloquea el Yardbird en el taller.',
    costRp: 20,
    requires: ['airframe_bracing'],
    unlocksPartIds: [],
    unlocksFrameIds: ['frame_yardbird'],
  },
  {
    id: 'airframe_bush_king',
    category: 'airframe',
    name: 'Proyecto Bush King',
    description: 'Planos del fuselaje pesado de monte y su ala STOL de gran superficie. Desbloquea el Bush King y el Ala STOL de campo.',
    costRp: 90,
    requires: ['airframe_trailblazer', 'ground_suspension'],
    unlocksPartIds: ['wing_d_bush'],
    unlocksFrameIds: ['frame_bush_king'],
  },
  {
    id: 'aero_efficient_wing',
    category: 'aerodynamics',
    name: 'Ala eficiente',
    description: 'Perfil pulido con menor drag parásito. Desbloquea el Ala eficiente de perfil pulido.',
    costRp: 30,
    requires: ['airframe_bracing'],
    unlocksPartIds: ['wing_c_efficient'],
  },
  {
    id: 'control_improved_ailerons',
    category: 'control',
    name: 'Alerones mejorados',
    description: 'Mayor autoridad de control en roll a baja velocidad.',
    costRp: 20,
    requires: [],
    unlocksPartIds: [],
  },
  {
    id: 'power_efficient',
    category: 'power',
    name: 'Motor eficiente',
    description: 'Ajuste de carburación y hélice de mejor rendimiento. Desbloquea el Field Twin 15hp Eficiente.',
    costRp: 35,
    requires: [],
    unlocksPartIds: ['engine_efficient'],
  },
  {
    id: 'power_rotax_2t',
    category: 'power',
    name: 'Dos tiempos de aviación',
    description: 'Reductoras, escapes sintonizados y reglaje de aviación. Desbloquea el Rotax 447 y el Hirth F-33.',
    costRp: 30,
    requires: [],
    unlocksPartIds: ['rotax_447', 'hirth_f33'],
  },
  {
    id: 'power_dual_carb',
    category: 'power',
    name: 'Doble carburador',
    description: 'Dos carburadores y doble encendido. Desbloquea el Rotax 503 DCDI y el bóxer Hirth F-23.',
    costRp: 45,
    requires: ['power_rotax_2t'],
    unlocksPartIds: ['rotax_503', 'hirth_f23'],
  },
  {
    id: 'power_liquid_cooling',
    category: 'power',
    name: 'Refrigeración líquida',
    description: 'Radiador, bomba y culatas refrigeradas. Desbloquea el Rotax 582 Blue Head y el Hirth 3203.',
    costRp: 70,
    requires: ['power_dual_carb'],
    unlocksPartIds: ['rotax_582', 'hirth_3203'],
  },
  {
    id: 'power_four_stroke',
    category: 'power',
    name: 'Cuatro tiempos bóxer',
    description: 'Cárter seco, válvulas y reductora 2.43. Desbloquea el Rotax 912 UL (fuselajes Trailblazer y Bush King).',
    costRp: 110,
    requires: ['power_liquid_cooling', 'airframe_trailblazer'],
    unlocksPartIds: ['rotax_912'],
  },
  {
    id: 'power_turbo',
    category: 'power',
    name: 'Turbocompresor',
    description: 'Sobrealimentación con control de presión de admisión. Desbloquea el Rotax 914 UL Turbo.',
    costRp: 150,
    requires: ['power_four_stroke'],
    unlocksPartIds: ['rotax_914'],
  },
  {
    id: 'power_turbine',
    category: 'power',
    name: 'Microturbinas',
    description: 'Arranque eléctrico, bomba de queroseno y ECU. Desbloquea la Microturbina JT-80.',
    costRp: 120,
    requires: ['power_liquid_cooling'],
    unlocksPartIds: ['turbojet_jt80'],
  },
  {
    id: 'power_turbine_heavy',
    category: 'power',
    name: 'Turborreactor de ruta',
    description: 'Núcleo de 1.2 kN con tobera de acero. Desbloquea el TJ-100 (solo Trailblazer).',
    costRp: 180,
    requires: ['power_turbine', 'airframe_trailblazer'],
    unlocksPartIds: ['turbojet_tj100'],
  },
  {
    id: 'ground_suspension',
    category: 'ground',
    name: 'Suspensión de campo',
    description: 'Amortiguación en el tren de aterrizaje. Desbloquea el Tren reforzado con suspensión.',
    costRp: 25,
    requires: [],
    unlocksPartIds: ['gear_reinforced'],
  },
  {
    id: 'instruments_telemetry',
    category: 'instruments',
    name: 'Banco de telemetría',
    description: 'Instrumentación básica para leer velocidad, altitud y estado del motor en vuelo.',
    costRp: 20,
    requires: [],
    unlocksPartIds: [],
  },
  {
    id: 'safety_mounts',
    category: 'safety',
    name: 'Anclajes reforzados',
    description: 'Mejora la resistencia de montaje de piezas críticas frente a impactos.',
    costRp: 18,
    requires: ['airframe_bracing'],
    unlocksPartIds: [],
  },
];

export function getTechNode(id: string): TechNodeDef | undefined {
  return TECH_NODES.find((n) => n.id === id);
}

export function isTechUnlocked(unlockedTech: string[], nodeId: string): boolean {
  return unlockedTech.includes(nodeId);
}

export function canUnlockTech(unlockedTech: string[], nodeId: string): boolean {
  const node = getTechNode(nodeId);
  if (!node) return false;
  if (unlockedTech.includes(nodeId)) return false;
  return node.requires.every((reqId) => unlockedTech.includes(reqId));
}

export const TECH_CATEGORY_LABELS: Record<string, string> = {
  airframe: 'Estructura',
  aerodynamics: 'Aerodinámica',
  control: 'Control',
  power: 'Propulsión',
  ground: 'Tren de aterrizaje',
  instruments: 'Instrumentos',
  safety: 'Seguridad',
};
