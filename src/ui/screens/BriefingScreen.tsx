import { useGameStore } from '../../state/gameStore';
import { useProfileStore } from '../../state/profileStore';
import { getMission } from '../../content/missions';
import { evaluateMissionReadiness } from '../../content/missionReadiness';
import { getRegion } from '../../content/regions';
import { ScreenHeader } from '../components/ScreenHeader';
import { UiIcon } from '../components/UiIcon';
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
      <ScreenHeader title={mission.name} kicker="BRIEFING DE CONTRATO" goTo={goTo} back="map" backLabel="Mapa" />

      <main className="screen-body">
        <div className="briefing-layout">
          <section className="panel">
            <p className="briefing-lead">{mission.description}</p>
            <ul className="objective-list">
              <li><UiIcon name="map" size={18} />Región: {getRegion(mission.regionId).name}</li>
              <li><UiIcon name="flight" size={18} />Viento base: suave</li>
              {mission.minDistanceM && <li><UiIcon name="target" size={18} />Distancia objetivo: {mission.minDistanceM} m</li>}
              {mission.targetRadiusM && <li><UiIcon name="target" size={18} />Zona de aterrizaje: {mission.targetRadiusM} m de radio</li>}
            </ul>
            {mission.aircraftRequirement && (
              <div className={`briefing-requirement${readiness.ready ? ' briefing-requirement-ready' : ''}`}>
                <strong>{mission.aircraftRequirement.label}</strong>
                {readiness.ready
                  ? <div className="requirement-row">Tu avión actual cumple este contrato.</div>
                  : readiness.shortfalls.map((s) => <div key={s} className="requirement-row">{s}</div>)}
              </div>
            )}
          </section>

          <aside className="panel">
            <span className="panel-kicker">RECOMPENSA BASE</span>
            <div className="tile-row">
              <div className="tile"><b>${mission.rewardBaseCash}</b><span>Efectivo</span></div>
              <div className="tile"><b>{mission.rewardBaseRp}<small>RP</small></b><span>Investigación</span></div>
            </div>
            <span className="panel-kicker">BONOS OPCIONALES</span>
            <div className="briefing-bonuses">
              {mission.bonuses.map((b) => (
                <div key={b.id} className="bonus-row"><span>{b.label}</span><b>+${b.rewardCash} / +{b.rewardRp} RP</b></div>
              ))}
            </div>
          </aside>
        </div>
      </main>

      <div className="sticky-cta">
        <button className="primary-btn" disabled={!readiness.ready} onClick={() => goTo('run')}>
          {readiness.ready ? 'START' : 'AVIÓN NO APTO'}
        </button>
      </div>
    </div>
  );
}
