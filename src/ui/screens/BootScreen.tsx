import { useEffect, useState } from 'react';
import { useGameStore } from '../../state/gameStore';
import { useProfileStore } from '../../state/profileStore';
import './Screens.css';

// Spec 82.1 Boot screen: logo, loading status, then routes to onboarding or hangar.
export function BootScreen() {
  const goTo = useGameStore((s) => s.goTo);
  const load = useProfileStore((s) => s.load);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const loaded = load();
    let raf: number;
    const start = performance.now();
    const tick = () => {
      const elapsed = performance.now() - start;
      const p = Math.min(1, elapsed / 900);
      setProgress(p);
      if (p < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        void loaded.then(() => {
          // Legacy localStorage flag (pre-profile-settings) OR the profile flag, so returning
          // players on an old save still skip straight to the hangar.
          const legacySeenOnboarding = localStorage.getItem('project-flight/onboarded');
          const seenOnboarding = legacySeenOnboarding || useProfileStore.getState().profile.settings.hasSeenOnboarding;
          goTo(seenOnboarding ? 'hangar' : 'onboarding');
        });
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="screen boot-screen">
      <h1 className="boot-title">PROJECT FLIGHT</h1>
      <p className="boot-subtitle">construido a mano, volado con cuidado</p>
      <div className="boot-bar">
        <div className="boot-bar-fill" style={{ width: `${progress * 100}%` }} />
      </div>
    </div>
  );
}
