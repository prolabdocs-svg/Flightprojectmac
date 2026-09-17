// Tech tree content (spec section 15 "Árbol tecnológico" + 153.4 "Tech graph").
// Simplified vertical-slice subset: one or two nodes per family, enough to gate the
// tier-2 parts added in content/parts.ts and to demonstrate branch/prerequisite structure.

import type { TechNodeDef } from '../core/types';

export const TECH_NODES: TechNodeDef[] = [
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
