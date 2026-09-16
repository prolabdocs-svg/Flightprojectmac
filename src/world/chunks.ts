import * as THREE from 'three';

export type ChunkState = 'unseen' | 'prefetching' | 'visual_low' | 'active' | 'cooldown';

export interface WorldChunkDefinition {
  id: string;
  regionId: string;
  center: [number, number];
  radiusM: number;
  preloadNeighbors: string[];
}

/** Small runtime scheduler for the Region Kit chunk contract (GDD §41/147). Asset
 * loading is intentionally outside this class; callers receive desired states and can
 * map them to low/full visual packs and physics proxies. */
export class WorldChunkScheduler {
  private readonly states = new Map<string, ChunkState>();
  private readonly chunks: WorldChunkDefinition[];
  constructor(chunks: WorldChunkDefinition[]) { this.chunks = chunks; for (const chunk of chunks) this.states.set(chunk.id, 'unseen'); }

  update(position: THREE.Vector3, velocity: THREE.Vector3): ReadonlyMap<string, ChunkState> {
    const speed = velocity.length();
    const forward = speed > 0.5 ? velocity.clone().setY(0).normalize() : new THREE.Vector3();
    const preloadDistance = 240 + Math.min(560, speed * 12);
    for (const chunk of this.chunks) {
      const delta = new THREE.Vector3(chunk.center[0] - position.x, 0, chunk.center[1] - position.z);
      const distance = delta.length();
      const ahead = forward.dot(delta.normalize());
      const effectiveDistance = distance - Math.max(0, ahead) * Math.min(220, speed * 5);
      const state: ChunkState = effectiveDistance <= chunk.radiusM ? 'active'
        : effectiveDistance <= chunk.radiusM + preloadDistance * 0.35 ? 'visual_low'
          : effectiveDistance <= chunk.radiusM + preloadDistance ? 'prefetching' : 'cooldown';
      this.states.set(chunk.id, state);
    }
    return this.states;
  }
}

export const FIELD_CHUNKS: WorldChunkDefinition[] = [
  { id: 'field_workshop', regionId: 'the_field', center: [0, 80], radiusM: 260, preloadNeighbors: ['field_north'] },
  { id: 'field_north', regionId: 'the_field', center: [0, 620], radiusM: 310, preloadNeighbors: ['field_workshop'] },
];

export const SCRAP_VALLEY_CHUNKS: WorldChunkDefinition[] = [
  { id: 'scrap_yard', regionId: 'scrap_valley', center: [0, 160], radiusM: 260, preloadNeighbors: ['scrap_quarry'] },
  { id: 'scrap_quarry', regionId: 'scrap_valley', center: [0, 680], radiusM: 330, preloadNeighbors: ['scrap_yard'] },
];
