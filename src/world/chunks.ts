import * as THREE from 'three';

export type ChunkState = 'unseen' | 'prefetching' | 'visual_low' | 'active' | 'cooldown' | 'evicted';

export interface WorldChunkDefinition {
  id: string;
  regionId: string;
  center: [number, number];
  radiusM: number;
  preloadNeighbors: string[];
}

/** Consecutive updates a chunk must spend in cooldown, with no active neighbor,
 * before it's evicted (WLD-09 spec §255). Keeps collision geometry resident long
 * enough to survive a quick reversal at speed. */
const EVICT_AFTER_COOLDOWNS = 5;

/** Small runtime scheduler for the Region Kit chunk contract (GDD §41/147). Asset
 * loading is intentionally outside this class; callers receive desired states and can
 * map them to low/full visual packs and physics proxies. */
export class WorldChunkScheduler {
  private readonly states = new Map<string, ChunkState>();
  private readonly cooldownStreak = new Map<string, number>();
  private readonly chunks: WorldChunkDefinition[];
  constructor(chunks: WorldChunkDefinition[]) {
    this.chunks = chunks;
    for (const chunk of chunks) { this.states.set(chunk.id, 'unseen'); this.cooldownStreak.set(chunk.id, 0); }
  }

  update(position: THREE.Vector3, velocity: THREE.Vector3): ReadonlyMap<string, ChunkState> {
    const speed = velocity.length();
    const forward = speed > 0.5 ? velocity.clone().setY(0).normalize() : new THREE.Vector3();
    const preloadDistance = 240 + Math.min(560, speed * 12);

    const rawStates = new Map<string, Exclude<ChunkState, 'evicted'>>();
    for (const chunk of this.chunks) {
      const delta = new THREE.Vector3(chunk.center[0] - position.x, 0, chunk.center[1] - position.z);
      const distance = delta.length();
      const ahead = forward.dot(delta.normalize());
      const effectiveDistance = distance - Math.max(0, ahead) * Math.min(220, speed * 5);
      const state: Exclude<ChunkState, 'evicted'> = effectiveDistance <= chunk.radiusM ? 'active'
        : effectiveDistance <= chunk.radiusM + preloadDistance * 0.35 ? 'visual_low'
          : effectiveDistance <= chunk.radiusM + preloadDistance ? 'prefetching' : 'cooldown';
      rawStates.set(chunk.id, state);
    }

    // Collision safety: a chunk adjacent to one that's active/loading must keep its
    // collision resident (never evicted), since the aircraft could reach it next tick.
    const activeIds = new Set([...rawStates].filter(([, s]) => s !== 'cooldown').map(([id]) => id));
    const protectedIds = new Set(activeIds);
    for (const chunk of this.chunks) if (activeIds.has(chunk.id)) for (const n of chunk.preloadNeighbors) protectedIds.add(n);

    for (const chunk of this.chunks) {
      const raw = rawStates.get(chunk.id)!;
      if (raw !== 'cooldown') { this.cooldownStreak.set(chunk.id, 0); this.states.set(chunk.id, raw); continue; }
      if (protectedIds.has(chunk.id)) { this.cooldownStreak.set(chunk.id, 0); this.states.set(chunk.id, 'cooldown'); continue; }
      const streak = (this.cooldownStreak.get(chunk.id) ?? 0) + 1;
      this.cooldownStreak.set(chunk.id, streak);
      this.states.set(chunk.id, streak >= EVICT_AFTER_COOLDOWNS ? 'evicted' : 'cooldown');
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
