import { useMode2Store } from './mode2Store';

export interface MobileFlightAxes {
  throttle: number;
  pitch: number;
  roll: number;
  yaw: number;
  brake: boolean;
}

/** Apply authenticated RC Mode 2 values to the exact store read by FlightScreen. */
export function applyMobileFlightAxes(axes: MobileFlightAxes): void {
  const controls = useMode2Store.getState();
  controls.setThrottle(axes.throttle);
  controls.setRudder(axes.yaw);
  controls.setElevator(-axes.pitch);
  controls.setAileron(axes.roll);
  controls.setBrake(axes.brake);
}

export function releaseMobileFlightAxes(): void {
  useMode2Store.getState().releaseMomentaryControls();
}
