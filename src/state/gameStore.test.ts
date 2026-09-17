import { beforeEach, describe, expect, it } from 'vitest';
import { useGameStore } from './gameStore';

describe('gameStore flight lifecycle', () => {
  beforeEach(() => {
    useGameStore.setState({ screen: 'hangar', paused: false, flightSession: 0, selectedMissionId: null, selectedFreeFlightRegionId: 'the_field', selectedMapRegionId: 'the_field' });
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

  it('launches free flight without retaining a prior mission', () => {
    useGameStore.setState({ selectedMissionId: 'field_distance_01' });
    useGameStore.getState().selectFreeFlight('coast_run');
    expect(useGameStore.getState().selectedMissionId).toBeNull();
    expect(useGameStore.getState().selectedFreeFlightRegionId).toBe('coast_run');
    expect(useGameStore.getState().selectedMapRegionId).toBe('coast_run');
  });

  it('remembers the last map region independently of the active mission', () => {
    useGameStore.getState().selectMission('field_distance_01');
    useGameStore.getState().selectMapRegion('scrap_valley');
    expect(useGameStore.getState().selectedMissionId).toBe('field_distance_01');
    expect(useGameStore.getState().selectedMapRegionId).toBe('scrap_valley');
  });
});
