import { beforeEach, describe, expect, it } from 'vitest';
import { useMode2Store } from './mode2Store';

describe('Mode 2 focus safety', () => {
  beforeEach(() => useMode2Store.getState().reset());

  it('releases transient axes and brake without cutting sticky throttle', () => {
    useMode2Store.getState().setThrottle(.72);
    useMode2Store.getState().setRudder(.5);
    useMode2Store.getState().setElevator(-.8);
    useMode2Store.getState().setAileron(.3);
    useMode2Store.getState().setBrake(true);
    useMode2Store.getState().releaseMomentaryControls();
    expect(useMode2Store.getState()).toMatchObject({ throttle: .72, rudder: 0, elevator: 0, aileron: 0, brake: false });
  });
});
