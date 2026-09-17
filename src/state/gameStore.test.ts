import { beforeEach, describe, expect, it } from 'vitest';
import { useGameStore } from './gameStore';

describe('gameStore flight lifecycle', () => {
  beforeEach(() => {
    useGameStore.setState({ screen: 'hangar', paused: false, flightSession: 0 });
  });

  it('creates a fresh flight session every time run is entered', () => {
    useGameStore.getState().goTo('run');
    expect(useGameStore.getState().flightSession).toBe(1);
    useGameStore.getState().goTo('run');
    expect(useGameStore.getState().flightSession).toBe(2);
  });

  it('clears pause when navigating', () => {
    useGameStore.setState({ paused: true });
    useGameStore.getState().goTo('run');
    expect(useGameStore.getState().paused).toBe(false);
  });
});
