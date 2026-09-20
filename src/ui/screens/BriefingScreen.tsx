import { useGameStore } from '../../state/gameStore';
import { useProfileStore } from '../../state/profileStore';
import { getMission } from '../../content/missions';
import { evaluateMissionReadiness } from '../../content/missionReadiness';
import { getRegion } from '../../content/regions';
import './Screens.css';

// Spec 82.5 Mission briefing: fits on one mobile screen, single START action.
export function BriefingScreen() {
  const goTo = useGameStore((s) => s.goTo);
  const selectedMissionId = useGameStore((s) => s.selectedMissionId);
  const build = useProfileStore((s) => s.profile.currentBuild);
  const mission = selectedMissionId ? getMission(selectedMissionId) : null;

  if (!mission) {
    goTo('map');
    return null;
  }

  const readiness = evaluateMissionReadiness(mission, build);

  return (
    <div className="screen briefing-screen">
      <header className="screen-header">
        <button className="back-btn" onClick={() => goTo('map')}>
          ← Mapa
        </button>
        <h2>{mission.name}</h2>
      </header>
      <p>{mission.description}</p>
      <ul className="briefing-list">
        <li>Región: {getRegion(mission.regionId).name}</li>
        <li>Viento base: suave</li>
        <li>Recompensa base: ${mission.rewardBaseCash} · {mission.rewardBaseRp} RP</li>
        {mission.minDistanceM && <li>Distancia objetivo: {mission.minDistanceM} m</li>}
        {mission.targetRadiusM && <li>Zona de aterrizaje: {mission.targetRadiusM} m de radio</li>}
      </ul>
      <div className="briefing-bonuses">
        <strong>Bonos opcionales</strong>
        {mission.bonuses.map((b) => (
          <div key={b.id} className="bonus-row">
            {b.label} — +${b.rewardCash} / +{b.rewardRp} RP
          </div>
        ))}
      </div>
      {mission.aircraftRequirement && (
        <div className={`briefing-requirement${readiness.ready ? ' briefing-requirement-ready' : ''}`}>
          <strong>{mission.aircraftRequirement.label}</strong>
          {readiness.ready
            ? <div className="requirement-row">Tu avión actual cumple este contrato.</div>
            : readiness.shortfalls.map((s) => <div key={s} className="requirement-row">{s}</div>)}
        </div>
      )}
      <button className="primary-btn" disabled={!readiness.ready} onClick={() => goTo('run')}>
        {readiness.ready ? 'START' : 'AVIÓN NO APTO'}
      </button>
    </div>
  );
}
