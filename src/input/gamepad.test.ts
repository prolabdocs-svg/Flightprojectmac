import { describe, expect, it } from 'vitest';
import { mapGamepad } from './gamepad';

function pad(overrides: Partial<Gamepad> = {}): Gamepad {
  return {
    connected: true,
    axes: [0, 0, 0],
    buttons: Array.from({ length: 10 }, () => ({ pressed: false, touched: false, value: 0 } as GamepadButton)),
    id: 'test pad', index: 0, mapping: 'standard', timestamp: 0, vibrationActuator: null,
    hapticActuators: [],
    ...overrides,
  } as Gamepad;
}

describe('mapGamepad', () => {
  it('returns a neutral disconnected input when no controller is available', () => {
    expect(mapGamepad(null)).toMatchObject({ connected: false, throttle: 0, roll: 0, pitch: 0, rudder: 0 });
  });

  it('maps standard sticks, triggers, and action buttons to flight controls', () => {
    const buttons = Array.from({ length: 10 }, () => ({ pressed: false, touched: false, value: 0 } as GamepadButton));
    buttons[7] = { pressed: true, touched: true, value: 0.75 } as GamepadButton;
    buttons[6] = { pressed: true, touched: true, value: 1 } as GamepadButton;
    buttons[0] = { pressed: true, touched: true, value: 1 } as GamepadButton;
    const input = mapGamepad(pad({ axes: [1, -1, 0.5], buttons }));
    expect(input).toMatchObject({ connected: true, throttle: 0.75, roll: 1, pitch: -1, rudder: expect.closeTo(0.432, 2), brake: true, enginePressed: true });
  });

  it('filters tiny stick drift with a dead zone', () => {
    expect(mapGamepad(pad({ axes: [0.08, -0.1, 0.11] }))).toMatchObject({ roll: 0, pitch: 0, rudder: 0 });
  });
});
