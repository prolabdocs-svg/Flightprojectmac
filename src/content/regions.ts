import type { RegionDefinition } from '../core/types';

// Región 1 — THE FIELD (spec 12.2). Único bioma implementado en este vertical slice.
export const THE_FIELD: RegionDefinition = {
  id: 'the_field',
  name: 'The Field',
  description: 'Granja y taller rural. Viento bajo, térmicas suaves, visibilidad alta. Origen del taller.',
  windBaseMs: [1.5, 0, 0.5],
  groundColor: '#5f8a4a',
  skyColor: '#bfe3ff',
};

export const REGIONS: RegionDefinition[] = [THE_FIELD];
