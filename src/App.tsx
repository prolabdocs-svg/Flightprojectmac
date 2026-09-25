import { useEffect, useRef, useState, Suspense, lazy } from 'react';
import { useGameStore } from './state/gameStore';
import { useProfileStore } from './state/profileStore';
import { audioService } from './audio/audioService';
import { PauseOverlay } from './ui/components/PauseOverlay';
import { REGIONS } from './content/regions';

const BootScreen = lazy(() => import('./ui/screens/BootScreen').then((m) => ({ default: m.BootScreen })));
const OnboardingScreen = lazy(() => import('./ui/screens/OnboardingScreen').then((m) => ({ default: m.OnboardingScreen })));
const HangarScreen = lazy(() => import('./ui/screens/HangarScreen').then((m) => ({ default: m.HangarScreen })));
const MapScreen = lazy(() => import('./ui/screens/MapScreen').then((m) => ({ default: m.MapScreen })));
const BriefingScreen = lazy(() => import('./ui/screens/BriefingScreen').then((m) => ({ default: m.BriefingScreen })));
const BuilderScreen = lazy(() => import('./ui/screens/BuilderScreen').then((m) => ({ default: m.BuilderScreen })));
const TechTreeScreen = lazy(() => import('./ui/screens/TechTreeScreen').then((m) => ({ default: m.TechTreeScreen })));
const PaintScreen = lazy(() => import('./ui/screens/PaintScreen').then((m) => ({ default: m.PaintScreen })));
const AircraftScreen = lazy(() => import('./ui/screens/AircraftScreen').then((m) => ({ default: m.AircraftScreen })));
const CareerScreen = lazy(() => import('./ui/screens/CareerScreen').then((m) => ({ default: m.CareerScreen })));
const PilotScreen = lazy(() => import('./ui/screens/PilotScreen').then((m) => ({ default: m.PilotScreen })));
const SettingsScreen = lazy(() => import('./ui/screens/SettingsScreen').then((m) => ({ default: m.SettingsScreen })));
const FlightScreen = lazy(() => import('./ui/screens/FlightScreen').then((m) => ({ default: m.FlightScreen })));
const ResultsScreen = lazy(() => import('./ui/screens/ResultsScreen').then((m) => ({ default: m.ResultsScreen })));
const MobileControllerPanel = lazy(() => import('./ui/components/MobileControllerPanel').then((m) => ({ default: m.MobileControllerPanel })));

export default function App() {
  const screen = useGameStore((s) => s.screen);
  const paused = useGameStore((s) => s.paused);
  const flightSession = useGameStore((s) => s.flightSession);
  const setPaused = useGameStore((s) => s.setPaused);
  const musicVolume = useProfileStore((s) => s.profile.settings.musicVolume);
  const sfxVolume = useProfileStore((s) => s.profile.settings.sfxVolume);
  const engineVolume = useProfileStore((s) => s.profile.settings.engineVolume);
  const colorblindMode = useProfileStore((s) => s.profile.settings.colorblindMode);
  const reduceMotion = useProfileStore((s) => s.profile.settings.reduceMotion);
  const textSize = useProfileStore((s) => s.profile.settings.textSize);
  const handedness = useProfileStore((s) => s.profile.settings.handedness);
  const screenMounted = useRef(false);
  const [mobilePanelMounted, setMobilePanelMounted] = useState(false);
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);

  useEffect(() => {
    const open = () => { setMobilePanelMounted(true); setMobilePanelOpen(true); };
    window.addEventListener('project-flight-open-mobile-controller', open);
    return () => window.removeEventListener('project-flight-open-mobile-controller', open);
  }, []);

  // Developer-only visual-tour entry point. `?qaRegion=coast_run` (and the other
  // authored region ids) starts a free flight immediately, making it possible to
  // inspect every biome from the actual chase camera without unlocking a campaign
  // profile or contaminating production navigation.
  useEffect(() => {
    async function enterQaRansFlight(regionId: string) {
      const frame = 'frame_nightjar';
      useProfileStore.setState((s) => {
        const currentBuild = { frameId: frame, installed: { engine: 'rotax_503', fuelTank: 'tank_nightjar_20', landingGear: 'gear_light' } };
        return { profile: { ...s.profile, ownedFrameIds: [...new Set([...s.profile.ownedFrameIds, frame])], currentBuild } };
      });
      useProfileStore.getState().persist();
      const controls = await import('./input/mode2Store');
      controls.useMode2Store.setState({ throttle: 0.72, engineOn: true });
      const state = useGameStore.getState();
      state.selectFreeFlight(regionId);
      state.goTo('run');
    }
    if (!import.meta.env.DEV) return;
    if (new URLSearchParams(location.search).has('qaAircraft')) {
      const frame = 'frame_nightjar';
      useProfileStore.setState((s) => ({ profile: { ...s.profile, ownedFrameIds: [...new Set([...s.profile.ownedFrameIds, frame])], currentBuild: { frameId: frame, installed: { engine: 'rotax_503', fuelTank: 'tank_nightjar_20', landingGear: 'gear_light' } } } }));
      useGameStore.getState().goTo('aircraft');
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const regionId = params.get('qaRansFlight') ?? params.get('qaRegion');
    if (!regionId || !REGIONS.some((region) => region.id === regionId)) return;
    if (params.has('qaRansFlight')) {
      void enterQaRansFlight(regionId);
      return;
    }
    const state = useGameStore.getState();
    state.selectFreeFlight(regionId);
    state.goTo('run');
  }, []);

  // Accessibility settings (spec 55.1/55.2/170.2): exposed as root data-attributes so any
  // screen's CSS can opt in without every screen needing its own wiring.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.colorblind = String(colorblindMode);
    root.dataset.reduceMotion = String(reduceMotion);
    root.dataset.textSize = textSize;
    root.dataset.handedness = handedness;
  }, [colorblindMode, reduceMotion, textSize, handedness]);

  // Audio bootstrap (spec 23/53/150): unlock the AudioContext on first user
  // gesture (mobile autoplay policy), play a tap tone for any button press,
  // and keep bus volumes in sync with the settings screen sliders.
  useEffect(() => {
    audioService.installUnlockListener();
  }, []);

  useEffect(() => {
    audioService.setVolume('music', musicVolume);
    audioService.setVolume('sfx', sfxVolume);
    audioService.setVolume('engine', engineVolume);
  }, [musicVolume, sfxVolume, engineVolume]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('button')) audioService.playTone('tap');
    };
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, []);

  useEffect(() => {
    if (!screenMounted.current) {
      screenMounted.current = true;
      return;
    }
    audioService.playTone('transition');
  }, [screen]);

  // Music context per screen (musicDirector.ts). Results keeps whatever overlay the
  // flight/results raised (victory / aftermath); starting a flight clears it.
  useEffect(() => {
    const hangarScreens: string[] = ['hangar', 'builder', 'paint', 'aircraft', 'techtree'];
    if (screen === 'run') audioService.setMusicContext(useProfileStore.getState().profile.operations.active ? 'MISSION' : 'CALM_FLIGHT', true);
    else audioService.setMusicContext(hangarScreens.includes(screen) ? 'HANGAR' : 'MENU');
  }, [screen, flightSession]);

  // Mobile/browser lifecycle: a hidden flight is always paused. This prevents an
  // accumulated wall-clock gap or stale control state from advancing physics on resume.
  useEffect(() => {
    // Dev-only `?qa`: automated browsers hide/show the page between captures.
    const qaMode = import.meta.env.DEV && new URLSearchParams(window.location.search).has('qa');
    const pauseActiveFlight = () => {
      if (!qaMode && useGameStore.getState().screen === 'run') setPaused(true);
    };
    const onVisibilityChange = () => {
      if (document.hidden) pauseActiveFlight();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', pauseActiveFlight);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', pauseActiveFlight);
    };
  }, [setPaused]);

  return (
    <div className="app-root">
      <Suspense
        fallback={
          <div className="screen-loading" aria-busy="true" style={{ position: 'fixed', inset: 0, background: '#141719' }} />
        }
      >
        {screen === 'boot' && <BootScreen />}
        {screen === 'onboarding' && <OnboardingScreen />}
        {screen === 'hangar' && <HangarScreen />}
        {screen === 'map' && <MapScreen />}
        {screen === 'briefing' && <BriefingScreen />}
        {screen === 'builder' && <BuilderScreen />}
        {screen === 'techtree' && <TechTreeScreen />}
        {screen === 'paint' && <PaintScreen />}
        {screen === 'aircraft' && <AircraftScreen />}
        {screen === 'career' && <CareerScreen />}
        {screen === 'pilot' && <PilotScreen />}
        {screen === 'settings' && <SettingsScreen />}
        {screen === 'run' && <FlightScreen key={flightSession} />}
        {screen === 'results' && <ResultsScreen />}
      </Suspense>
      {screen === 'run' && paused && <PauseOverlay />}
      {mobilePanelMounted && <Suspense fallback={null}><MobileControllerPanel open={mobilePanelOpen} onClose={() => setMobilePanelOpen(false)} /></Suspense>}
    </div>
  );
}
