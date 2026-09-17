/**
 * Standard Gamepad API adapter.  It deliberately returns the same normalized axes
 * used by Mode 2 rather than teaching the flight model about controller brands.
 * This keeps touch, keyboard and USB/Bluetooth controllers behaviourally identical.
 */
export interface GamepadFlightInput {
  connected: boolean;
  throttle: number;
  roll: number;
  pitch: number;
  rudder: number;
  brake: boolean;
  enginePressed: boolean;
  flapsPressed: boolean;
  pausePressed: boolean;
}

const DEAD_ZONE = 0.12;

function axis(value: number | undefined): number {
  const raw = value ?? 0;
  if (Math.abs(raw) <= DEAD_ZONE) return 0;
  // Rescale after the dead zone so full throw remains full throw.
  return Math.sign(raw) * Math.min(1, (Math.abs(raw) - DEAD_ZONE) / (1 - DEAD_ZONE));
}

function pressed(gamepad: Gamepad, index: number): boolean {
  return Boolean(gamepad.buttons[index]?.pressed || (gamepad.buttons[index]?.value ?? 0) > 0.5);
}

/** Xbox/PlayStation/standard mapping: left stick = roll/pitch, right stick X = yaw,
 * right trigger = throttle, left trigger = brake, A/Cross = engine, X/Square = flaps,
 * Start/Options = pause. Unrecognised pads still work when the browser exposes the
 * standard mapping; unsupported controls safely resolve to neutral. */
export function mapGamepad(gamepad: Gamepad | null | undefined): GamepadFlightInput {
  if (!gamepad?.connected) {
    return { connected: false, throttle: 0, roll: 0, pitch: 0, rudder: 0, brake: false, enginePressed: false, flapsPressed: false, pausePressed: false };
  }
  return {
    connected: true,
    throttle: Math.max(0, Math.min(1, gamepad.buttons[7]?.value ?? 0)),
    roll: axis(gamepad.axes[0]),
    pitch: axis(gamepad.axes[1]),
    rudder: axis(gamepad.axes[2]),
    brake: pressed(gamepad, 6),
    enginePressed: pressed(gamepad, 0),
    flapsPressed: pressed(gamepad, 2),
    pausePressed: pressed(gamepad, 9),
  };
}
