import { describe, expect, it } from 'vitest';
import { getNextPilotRank, getPilotRank } from './reputation';

describe('pilot reputation ranks', () => {
  it('selects the highest rank threshold reached', () => {
    expect(getPilotRank(0).name).toBe('Novato');
    expect(getPilotRank(35).name).toBe('Contratista');
    expect(getPilotRank(999).name).toBe('Leyenda del Aire');
  });

  it('finds the next milestone or none at the top rank', () => {
    expect(getNextPilotRank(12)?.name).toBe('Contratista');
    expect(getNextPilotRank(120)).toBeUndefined();
  });
});
