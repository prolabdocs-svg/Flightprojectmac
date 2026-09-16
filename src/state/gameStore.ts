// Macro state machine (spec section 33.1): BOOT -> MAIN_HUB (garage/map/...) -> PRE_FLIGHT
// -> RUN -> RESULTS -> back to hub.

import { create } from 'zustand';
import type { FlightResult } from '../core/types';

export type Screen =
  | 'boot'
  | 'onboarding'
  | 'hangar'
  | 'map'
  | 'briefing'
  | 'builder'
  | 'techtree'
  | 'paint'
  | 'settings'
  | 'run'
  | 'results';

interface GameState {
  screen: Screen;
  selectedMissionId: string | null;
  lastResult: FlightResult | null;
  paused: boolean;
  goTo: (screen: Screen) => void;
  selectMission: (missionId: string | null) => void;
  setLastResult: (r: FlightResult) => void;
  setPaused: (p: boolean) => void;
}

export const useGameStore = create<GameState>((set) => ({
  screen: 'boot',
  selectedMissionId: null,
  lastResult: null,
  paused: false,
  goTo: (screen) => set({ screen }),
  selectMission: (missionId) => set({ selectedMissionId: missionId }),
  setLastResult: (r) => set({ lastResult: r }),
  setPaused: (p) => set({ paused: p }),
}));
