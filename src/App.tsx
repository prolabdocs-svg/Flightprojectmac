import { useEffect, useRef, Suspense, lazy } from 'react';
import { useGameStore } from './state/gameStore';
import { useProfileStore } from './state/profileStore';
import { audioService } from './audio/audioService';
import { PauseOverlay } from './ui/components/PauseOverlay';

const BootScreen = lazy(() => import('./ui/screens/BootScreen').then((m) => ({ default: m.BootScreen })));
const OnboardingScreen = lazy(() => import('./ui/screens/OnboardingScreen').then((m) => ({ default: m.OnboardingScreen })));
const HangarScreen = lazy(() => import('./ui/screens/HangarScreen').then((m) => ({ default: m.HangarScreen })));
const MapScreen = lazy(() => import('./ui/screens/MapScreen').then((m) => ({ default: m.MapScreen })));
const BriefingScreen = lazy(() => import('./ui/screens/BriefingScreen').then((m) => ({ default: m.BriefingScreen })));
const BuilderScreen = lazy(() => import('./ui/screens/BuilderScreen').then((m) => ({ default: m.BuilderScreen })));
const TechTreeScreen = lazy(() => import('./ui/screens/TechTreeScreen').then((m) => ({ default: m.TechTreeScreen })));
const PaintScreen = lazy(() => import('./ui/screens/PaintScreen').then((m) => ({ default: m.PaintScreen })));
const SettingsScreen = lazy(() => import('./ui/screens/SettingsScreen').then((m) => ({ default: m.SettingsScreen })));
const FlightScreen = lazy(() => import('./ui/screens/FlightScreen').then((m) => ({ default: m.FlightScreen })));
const ResultsScreen = lazy(() => import('./ui/screens/ResultsScreen').then((m) => ({ default: m.ResultsScreen })));

export default function App() {
  const screen = useGameStore((s) => s.screen);
  const paused = useGameStore((s) => s.paused);
  const musicVolume = useProfileStore((s) => s.profile.settings.musicVolume);
  const sfxVolume = useProfileStore((s) => s.profile.settings.sfxVolume);
  const colorblindMode = useProfileStore((s) => s.profile.settings.colorblindMode);
  const reduceMotion = useProfileStore((s) => s.profile.settings.reduceMotion);
  const textSize = useProfileStore((s) => s.profile.settings.textSize);
  const handedness = useProfileStore((s) => s.profile.settings.handedness);
  const screenMounted = useRef(false);

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
  }, [musicVolume, sfxVolume]);

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

  return (
    <div className="app-root">
      <Suspense
        fallback={
          <div className="screen-loading" aria-busy="true" style={{ position: 'fixed', inset: 0, background: '#05121f' }} />
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
        {screen === 'settings' && <SettingsScreen />}
        {screen === 'run' && <FlightScreen />}
        {screen === 'results' && <ResultsScreen />}
      </Suspense>
      {screen === 'run' && paused && <PauseOverlay />}
    </div>
  );
}
