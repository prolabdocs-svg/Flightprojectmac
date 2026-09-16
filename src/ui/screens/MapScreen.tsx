import { useGameStore } from '../../state/gameStore';
import { useProfileStore } from '../../state/profileStore';
import { MISSIONS } from '../../content/missions';
import { THE_FIELD } from '../../content/regions';
import './Screens.css';

// Spec 82.4 Map: region + mission cards with best score / rewards preview.
export function MapScreen() {
  const goTo = useGameStore((s) => s.goTo);
  const selectMission = useGameStore((s) => s.selectMission);
  const profile = useProfileStore((s) => s.profile);

  return (
    <div className="screen map-screen">
      <header className="screen-header">
        <button className="back-btn" onClick={() => goTo('hangar')}>
          ← Taller
        </button>
        <h2>{THE_FIELD.name}</h2>
      </header>
      <p className="region-desc">{THE_FIELD.description}</p>
      <div className="mission-list">
        {MISSIONS.map((m) => {
          const best = profile.completedMissions[m.id]?.bestScore;
          const locked = !profile.unlockedMissions.includes(m.id) && m.id !== MISSIONS[0].id;
          return (
            <button
              key={m.id}
              className="mission-card"
              disabled={locked}
              onClick={() => {
                selectMission(m.id);
                goTo('briefing');
              }}
            >
              <div className="mission-card-title">{m.name}</div>
              <div className="mission-card-family">{m.family}</div>
              <div className="mission-card-reward">${m.rewardBaseCash} · {m.rewardBaseRp} RP</div>
              {best !== undefined && <div className="mission-card-best">Mejor: {best.toFixed(0)} m</div>}
              {locked && <div className="mission-card-locked">Bloqueada</div>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
