import { useGameStore } from '../../state/gameStore';
import './PauseOverlay.css';

// Spec 82.13 Pause: resume / restart / exit mission.
export function PauseOverlay() {
  const setPaused = useGameStore((s) => s.setPaused);
  const goTo = useGameStore((s) => s.goTo);
  const selectMission = useGameStore((s) => s.selectMission);

  return (
    <div className="pause-overlay">
      <div className="pause-panel">
        <h2>Pausa</h2>
        <button className="primary-btn" onClick={() => setPaused(false)}>
          Reanudar
        </button>
        <button
          className="secondary-btn"
          onClick={() => {
            setPaused(false);
            goTo('run');
          }}
        >
          Reiniciar vuelo
        </button>
        <button
          className="secondary-btn"
          onClick={() => {
            setPaused(false);
            selectMission(null);
            goTo('hangar');
          }}
        >
          Salir al taller
        </button>
      </div>
    </div>
  );
}
