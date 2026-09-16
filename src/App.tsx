import { useEffect, useRef } from 'react';
import { useGameStore } from './state/gameStore';
import { useProfileStore } from './state/profileStore';
import { audioService } from './audio/audioService';
import { BootScreen } from './ui/screens/BootScreen';
import { OnboardingScreen } from './ui/screens/OnboardingScreen';
import { HangarScreen } from './ui/screens/HangarScreen';
import { MapScreen } from './ui/screens/MapScreen';
import { BriefingScreen } from './ui/screens/BriefingScreen';
import { BuilderScreen } from './ui/screens/BuilderScreen';
import { TechTreeScreen } from './ui/screens/TechTreeScreen';
import { PaintScreen } from './ui/screens/PaintScreen';
import { SettingsScreen } from './ui/screens/SettingsScreen';
import { FlightScreen } from './ui/screens/FlightScreen';
import { ResultsScreen } from './ui/screens/ResultsScreen';
import { PauseOverlay } from './ui/components/PauseOverlay';

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
      {screen === 'run' && paused && <PauseOverlay />}
    </div>
  );
}
