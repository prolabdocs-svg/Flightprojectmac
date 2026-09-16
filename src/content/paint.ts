// Paint/customization presets (spec 82.11 "Paint/Customization").
// V1 scope: fabric + tube color presets shared across players (no per-player textures),
// per spec 15's note that "el sistema de pintura debe reutilizar máscaras para evitar
// nuevas texturas por jugador".

import type { PaintPreset } from '../core/types';

export const PAINT_PRESETS: PaintPreset[] = [
  { id: 'paint_default', name: 'Lona cruda', fabricColor: '#d8cf9a', tubeColor: '#b8b2a4', priceCash: 0, tier: 0 },
  { id: 'paint_barnstormer', name: 'Rojo barnstormer', fabricColor: '#a3372c', tubeColor: '#3a3a3a', priceCash: 150, tier: 0 },
  { id: 'paint_field_green', name: 'Verde de campo', fabricColor: '#4c6b3d', tubeColor: '#565247', priceCash: 150, tier: 0 },
  { id: 'paint_sky_blue', name: 'Azul cielo', fabricColor: '#3f6fa3', tubeColor: '#c8c4b6', priceCash: 250, tier: 1 },
  { id: 'paint_racer_yellow', name: 'Amarillo carrera', fabricColor: '#d9a72e', tubeColor: '#20201c', priceCash: 250, tier: 1 },
  { id: 'paint_night_ops', name: 'Operaciones nocturnas', fabricColor: '#2b2f33', tubeColor: '#17181a', priceCash: 400, tier: 2 },
];

export function getPaint(id: string): PaintPreset | undefined {
  return PAINT_PRESETS.find((p) => p.id === id);
}
