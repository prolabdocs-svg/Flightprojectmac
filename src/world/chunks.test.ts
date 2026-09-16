import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { FIELD_CHUNKS, WorldChunkScheduler } from './chunks';

describe('WorldChunkScheduler', () => {
  it('activates the local chunk and prefetches a forward chunk earlier at speed', () => {
    const scheduler = new WorldChunkScheduler(FIELD_CHUNKS);
    const states = scheduler.update(new THREE.Vector3(0, 0, 80), new THREE.Vector3(0, 0, 45));
    expect(states.get('field_workshop')).toBe('active');
    expect(states.get('field_north')).not.toBe('cooldown');
  });

  it('moves distant chunks into cooldown', () => {
    const states = new WorldChunkScheduler(FIELD_CHUNKS).update(new THREE.Vector3(0, 0, -3000), new THREE.Vector3());
    expect([...states.values()]).toEqual(['cooldown', 'cooldown']);
  });
});
