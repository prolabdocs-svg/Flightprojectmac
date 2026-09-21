import { useGameStore } from '../../state/gameStore';
import { UiIcon } from './UiIcon';
import './PauseOverlay.css';

// Spec 82.13 Pause: resume / restart / exit mission.
export function PauseOverlay() {
  const setPaused = useGameStore((s) => s.setPaused);
  const goTo = useGameStore((s) => s.goTo);
  const selectMission = useGameStore((s) => s.selectMission);
  const selectedMissionId = useGameStore((s) => s.selectedMissionId);

  return (
    <div className="pause-overlay">
      <div className="pause-panel">
        <span className="kicker">EN PAUSA</span>
        <h2>Pausa</h2>
        <button className="primary-btn" onClick={() => setPaused(false)}>
          <UiIcon name="flight" size={18} />Reanudar
        </button>
        <button
          className="secondary-btn"
          onClick={() => {
            setPaused(false);
            goTo('run');
          }}
        >
          <UiIcon name="retry" size={18} />Reiniciar vuelo
        </button>
        <button
          className="secondary-btn"
          onClick={() => {
            setPaused(false);
            selectMission(null);
            goTo('map');
          }}
        >
          <UiIcon name="map" size={18} />{selectedMissionId ? 'Abandonar contrato' : 'Salir al mapa'}
        </button>
        <button
          className="secondary-btn"
          onClick={() => {
            setPaused(false);
            goTo('hangar');
          }}
        >
          <UiIcon name="home" size={18} />Volver al hangar
        </button>
      </div>
    </div>
  );
}
