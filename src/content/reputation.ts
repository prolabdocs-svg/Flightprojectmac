export interface PilotRank {
  id: string;
  name: string;
  minimumReputation: number;
}

export const PILOT_RANKS: PilotRank[] = [
  { id: 'rookie', name: 'Novato', minimumReputation: 0 },
  { id: 'field_pilot', name: 'Piloto de Campo', minimumReputation: 12 },
  { id: 'contractor', name: 'Contratista', minimumReputation: 35 },
  { id: 'route_captain', name: 'Capitán de Ruta', minimumReputation: 70 },
  { id: 'range_legend', name: 'Leyenda del Aire', minimumReputation: 120 },
];

export function getPilotRank(reputation: number): PilotRank {
  return [...PILOT_RANKS].reverse().find((rank) => reputation >= rank.minimumReputation) ?? PILOT_RANKS[0];
}

export function getNextPilotRank(reputation: number): PilotRank | undefined {
  return PILOT_RANKS.find((rank) => rank.minimumReputation > reputation);
}
