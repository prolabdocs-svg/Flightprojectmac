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

  it('evicts a chunk only after it sits in cooldown for a while', () => {
    const scheduler = new WorldChunkScheduler(FIELD_CHUNKS);
    let states;
    for (let i = 0; i < 5; i++) states = scheduler.update(new THREE.Vector3(0, 0, -3000), new THREE.Vector3());
    expect(states!.get('field_workshop')).toBe('evicted');
    expect(states!.get('field_north')).toBe('evicted');
  });

  it('never evicts a chunk adjacent to an active one (collision safety)', () => {
    const scheduler = new WorldChunkScheduler(FIELD_CHUNKS);
    let states;
    for (let i = 0; i < 20; i++) states = scheduler.update(new THREE.Vector3(0, 0, 80), new THREE.Vector3());
    expect(states!.get('field_workshop')).toBe('active');
    expect(states!.get('field_north')).not.toBe('evicted');
  });
});
