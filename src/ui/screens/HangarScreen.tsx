import { useGameStore } from '../../state/gameStore';
import { useProfileStore } from '../../state/profileStore';
import { resolveAircraft } from '../../content/assembly';
import { MISSIONS } from '../../content/missions';
import './Screens.css';

// Spec 82.3 Main Hangar: primary hub with FLY CTA and navigation to other screens.
export function HangarScreen() {
  const goTo = useGameStore((s) => s.goTo);
  const selectMission = useGameStore((s) => s.selectMission);
  const profile = useProfileStore((s) => s.profile);
  const aircraft = resolveAircraft(profile.currentBuild);

  const flyFirstAvailable = () => {
    const missionId = profile.unlockedMissions[0] ?? MISSIONS[0].id;
    selectMission(missionId);
    goTo('run');
  };

  return (
    <div className="screen hangar-screen">
      <header className="hangar-header">
        <div className="resource-pill">${profile.cash.toFixed(0)}</div>
        <div className="resource-pill">{profile.researchPoints} RP</div>
        <div className="resource-pill">{profile.salvage} Salvage</div>
        <div className="resource-pill">Rep {profile.reputation.toFixed(1)}</div>
      </header>

      <div className="hangar-center">
        <h1>{aircraft.frame.name}</h1>
        <p className="hangar-stats">
          {aircraft.totalMassKg.toFixed(0)} kg · {aircraft.engine?.name ?? 'sin motor'} ·{' '}
          {aircraft.fuelCapacityL} L
        </p>
        <button className="fly-cta" onClick={flyFirstAvailable}>
          VOLAR
        </button>
      </div>

      <nav className="hangar-nav">
        <button onClick={() => goTo('map')}>Mapa / Misiones</button>
        <button onClick={() => goTo('builder')}>Taller</button>
        <button onClick={() => goTo('techtree')}>Árbol tecnológico</button>
        <button onClick={() => goTo('paint')}>Pintura</button>
        <button onClick={() => goTo('settings')}>Ajustes</button>
      </nav>
    </div>
  );
}
