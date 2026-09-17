// RC Mode 2 input state (spec section 7 and 38).
// Left stick: vertical = throttle (sticky, no auto-center), horizontal = rudder/yaw (spring-centers).
// Right stick: vertical = elevator/pitch, horizontal = aileron/roll (both spring-center).

import { create } from 'zustand';

export type AssistMode = 'assisted' | 'standard' | 'acro';
export type ControlPreset = 'beginner' | 'normal' | 'sport' | 'custom';

export interface ExpoRate {
  expo: number;
  rate: number;
}

export const PRESETS: Record<ControlPreset, ExpoRate> = {
  beginner: { expo: 0.65, rate: 0.7 },
  normal: { expo: 0.4, rate: 1.0 },
  sport: { expo: 0.15, rate: 1.0 },
  custom: { expo: 0.4, rate: 1.0 },
};

export function applyExpo(x: number, { expo, rate }: ExpoRate): number {
  const clamped = Math.max(-1, Math.min(1, x));
  return rate * ((1 - expo) * clamped + expo * clamped ** 3);
}

interface Mode2State {
  throttle: number; // 0..1, sticky
  rudder: number; // -1..1, spring
  elevator: number; // -1..1, spring (raw, RC convention: stick down = nose up)
  aileron: number; // -1..1, spring
  invertPitch: boolean;
  preset: ControlPreset;
  assistMode: AssistMode;
  engineOn: boolean;
  brake: boolean;
  flapsDown: boolean;
  chuteDeployed: boolean;

  setThrottle: (v: number) => void;
  setRudder: (v: number) => void;
  setElevator: (v: number) => void;
  setAileron: (v: number) => void;
  toggleEngine: () => void;
  setBrake: (v: boolean) => void;
  toggleFlaps: () => void;
  deployChute: () => void;
  /** Releases controls that should never remain held after a browser focus/gesture loss.
   * Throttle deliberately remains sticky, matching the physical Mode 2 transmitter. */
  releaseMomentaryControls: () => void;
  setInvertPitch: (v: boolean) => void;
  setPreset: (p: ControlPreset) => void;
  setAssistMode: (m: AssistMode) => void;
  reset: () => void;
}

export const useMode2Store = create<Mode2State>((set) => ({
  throttle: 0,
  rudder: 0,
  elevator: 0,
  aileron: 0,
  invertPitch: false,
  preset: 'normal',
  assistMode: 'assisted',
  engineOn: false,
  brake: false,
  flapsDown: false,
  chuteDeployed: false,

  setThrottle: (v) => set({ throttle: Math.max(0, Math.min(1, v)) }),
  setRudder: (v) => set({ rudder: Math.max(-1, Math.min(1, v)) }),
  setElevator: (v) => set({ elevator: Math.max(-1, Math.min(1, v)) }),
  setAileron: (v) => set({ aileron: Math.max(-1, Math.min(1, v)) }),
  toggleEngine: () => set((s) => ({ engineOn: !s.engineOn })),
  setBrake: (v) => set({ brake: v }),
  toggleFlaps: () => set((s) => ({ flapsDown: !s.flapsDown })),
  deployChute: () => set({ chuteDeployed: true }),
  releaseMomentaryControls: () => set({ rudder: 0, elevator: 0, aileron: 0, brake: false }),
  setInvertPitch: (v) => set({ invertPitch: v }),
  setPreset: (p) => set({ preset: p }),
  setAssistMode: (m) => set({ assistMode: m }),
  reset: () =>
    set({ throttle: 0, rudder: 0, elevator: 0, aileron: 0, engineOn: false, brake: false, flapsDown: false, chuteDeployed: false }),
}));

/** Resolved control inputs after expo/rate/invert, ready for the flight controller. */
export function getResolvedControls() {
  const s = useMode2Store.getState();
  const er = PRESETS[s.preset];
  const pitchRaw = s.invertPitch ? -s.elevator : s.elevator;
  return {
    throttle: s.throttle,
    rudder: applyExpo(s.rudder, er),
    // RC convention: stick down (positive elevator value in our virtual stick) = nose up.
    pitch: applyExpo(pitchRaw, er),
    roll: applyExpo(s.aileron, er),
    engineOn: s.engineOn,
    brake: s.brake,
    flapsDown: s.flapsDown,
    chuteDeployed: s.chuteDeployed,
    assistMode: s.assistMode,
  };
}
