// Macro state machine (spec section 33.1): BOOT -> MAIN_HUB (garage/map/...) -> PRE_FLIGHT
// -> RUN -> RESULTS -> back to hub.

import { create } from 'zustand';
import type { FlightResult } from '../core/types';
import type { FlightTelemetry } from '../flight/flightTypes';
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
  | 'aircraft'
  | 'career'
  | 'pilot'
  | 'settings'
  | 'run'
  | 'results';

let selectedWorldStartId: string | null = null;

interface GameState {
  screen: Screen;
  selectedMissionId: string | null;
  /** Region used when launching the sandbox rather than a contract. */
  selectedFreeFlightRegionId: string;
  /** Optional globally charted aerodrome used as the free-flight start. */
  selectedWorldStartId: string | null;
  /** Discovered destination for continuous-world free flight; spawn remains at operations.locationId. */
  selectedWorldDestinationId: string | null;
  /** Last viewed campaign region, preserved when returning from a flight/result. */
  selectedMapRegionId: string;
  /** Map camera per region + the selected map target, kept across screens (spec: don't reset on every visit). */
  mapViews: Record<string, MapView>;
  mapSelectionId: string | null;
  lastResult: FlightResult | null;
  /** Which pipeline produced the results on screen: a settled contract (read from the profile) or a legacy flight. */
  lastOutcome: 'contract' | 'legacy' | null;
  /** Latest simulation sample of the flight in progress, so the pause menu can abandon with real fuel/damage. */
  flightTelemetry: FlightTelemetry | null;
  paused: boolean;
  /** Monotonic runtime key. Entering RUN always creates a fresh physics session. */
  flightSession: number;
  goTo: (screen: Screen) => void;
  selectMission: (missionId: string | null) => void;
  selectFreeFlight: (regionId: string) => void;
  selectWorldStart: (airfieldId: string, regionId: string) => void;
  selectWorldDestination: (airfieldId: string, originRegionId: string) => void;
  selectMapRegion: (regionId: string) => void;
  setMapView: (regionId: string, view: MapView) => void;
  setMapSelection: (id: string | null) => void;
  setLastResult: (r: FlightResult) => void;
  setLastOutcome: (o: 'contract' | 'legacy' | null) => void;
  setFlightTelemetry: (t: FlightTelemetry | null) => void;
  setPaused: (p: boolean) => void;
  /** Drops every progress-derived runtime cache (Reset Progress). Keeps the current screen. */
  resetRuntime: () => void;
}

const RUNTIME_DEFAULTS = {
  selectedMissionId: null,
  selectedFreeFlightRegionId: 'the_field',
  selectedWorldStartId,
  selectedWorldDestinationId: null,
  selectedMapRegionId: 'the_field',
  mapViews: {},
  mapSelectionId: null,
  lastResult: null,
  lastOutcome: null,
  flightTelemetry: null,
  paused: false,
} satisfies Partial<GameState>;

export const useGameStore = create<GameState>((set) => ({
  screen: 'boot',
  ...RUNTIME_DEFAULTS,
  flightSession: 0,
  goTo: (screen) =>
    set((state) => ({
      screen,
      paused: false,
      flightSession: screen === 'run' ? state.flightSession + 1 : state.flightSession,
    })),
  selectMission: (missionId) => { selectedWorldStartId = null; set({ selectedMissionId: missionId, selectedWorldStartId: null, selectedWorldDestinationId: null }); },
  selectFreeFlight: (regionId) => { selectedWorldStartId = null; set({ selectedMissionId: null, selectedFreeFlightRegionId: regionId, selectedWorldStartId: null, selectedWorldDestinationId: null, selectedMapRegionId: 'master' }); },
  selectWorldStart: (airfieldId, regionId) => { selectedWorldStartId = airfieldId; set({ selectedMissionId: null, selectedFreeFlightRegionId: regionId, selectedWorldStartId: airfieldId, selectedWorldDestinationId: null, selectedMapRegionId: 'master' }); },
  selectWorldDestination: (airfieldId, originRegionId) => { selectedWorldStartId = null; set({ selectedMissionId: null, selectedFreeFlightRegionId: originRegionId, selectedWorldStartId: null, selectedWorldDestinationId: airfieldId, selectedMapRegionId: 'master' }); },
  selectMapRegion: (regionId) => set({ selectedMapRegionId: regionId, mapSelectionId: null }),
  setMapView: (regionId, view) => set((s) => ({ mapViews: { ...s.mapViews, [regionId]: view } })),
  setMapSelection: (id) => set({ mapSelectionId: id }),
  setLastResult: (r) => set({ lastResult: r, lastOutcome: 'legacy' }),
  setLastOutcome: (o) => set({ lastOutcome: o }),
  setFlightTelemetry: (t) => set({ flightTelemetry: t }),
  setPaused: (p) => set({ paused: p }),
  resetRuntime: () => { selectedWorldStartId = null; set(RUNTIME_DEFAULTS); },
}));
