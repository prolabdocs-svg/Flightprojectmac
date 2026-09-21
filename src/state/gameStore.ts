// Macro state machine (spec section 33.1): BOOT -> MAIN_HUB (garage/map/...) -> PRE_FLIGHT
// -> RUN -> RESULTS -> back to hub.

import { create } from 'zustand';
import type { FlightResult } from '../core/types';
import type { MapView } from '../map/mapProjection';

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
  /** Region used when launching the sandbox rather than a contract. */
  selectedFreeFlightRegionId: string;
  /** Last viewed campaign region, preserved when returning from a flight/result. */
  selectedMapRegionId: string;
  /** Map camera per region + the selected map target, kept across screens (spec: don't reset on every visit). */
  mapViews: Record<string, MapView>;
  mapSelectionId: string | null;
  lastResult: FlightResult | null;
  paused: boolean;
  /** Monotonic runtime key. Entering RUN always creates a fresh physics session. */
  flightSession: number;
  goTo: (screen: Screen) => void;
  selectMission: (missionId: string | null) => void;
  selectFreeFlight: (regionId: string) => void;
  selectMapRegion: (regionId: string) => void;
  setMapView: (regionId: string, view: MapView) => void;
  setMapSelection: (id: string | null) => void;
  setLastResult: (r: FlightResult) => void;
  setPaused: (p: boolean) => void;
}

export const useGameStore = create<GameState>((set) => ({
  screen: 'boot',
  selectedMissionId: null,
  selectedFreeFlightRegionId: 'the_field',
  selectedMapRegionId: 'the_field',
  mapViews: {},
  mapSelectionId: null,
  lastResult: null,
  paused: false,
  flightSession: 0,
  goTo: (screen) =>
    set((state) => ({
      screen,
      paused: false,
      flightSession: screen === 'run' ? state.flightSession + 1 : state.flightSession,
    })),
  selectMission: (missionId) => set({ selectedMissionId: missionId }),
  selectFreeFlight: (regionId) => set({ selectedMissionId: null, selectedFreeFlightRegionId: regionId, selectedMapRegionId: regionId }),
  selectMapRegion: (regionId) => set({ selectedMapRegionId: regionId, mapSelectionId: null }),
  setMapView: (regionId, view) => set((s) => ({ mapViews: { ...s.mapViews, [regionId]: view } })),
  setMapSelection: (id) => set({ mapSelectionId: id }),
  setLastResult: (r) => set({ lastResult: r }),
  setPaused: (p) => set({ paused: p }),
}));
