import { useGameStore } from './state/gameStore';
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
