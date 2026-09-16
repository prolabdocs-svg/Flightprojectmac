import { useGameStore } from '../../state/gameStore';
import './Screens.css';

// Spec 82.14 Results: score, rewards, damage, next action.
export function ResultsScreen() {
  const goTo = useGameStore((s) => s.goTo);
  const result = useGameStore((s) => s.lastResult);
  const selectMission = useGameStore((s) => s.selectMission);

  if (!result) {
    goTo('hangar');
    return null;
  }

  return (
    <div className="screen results-screen">
      <h2>{result.crashed ? 'Accidente' : result.landed ? 'Vuelo completado' : 'Vuelo interrumpido'}</h2>
      <div className="results-grid">
        <div>
          <span className="results-value">{result.distanceM.toFixed(0)} m</span>
          <span className="results-label">Distancia</span>
        </div>
        <div>
          <span className="results-value">{result.maxAltitudeM.toFixed(0)} m</span>
          <span className="results-label">Altitud máxima</span>
        </div>
        <div>
          <span className="results-value">{(result.maxSpeedMs * 3.6).toFixed(0)} km/h</span>
          <span className="results-label">Velocidad máxima</span>
        </div>
        <div>
          <span className="results-value">{(result.landingQuality * 100).toFixed(0)}%</span>
          <span className="results-label">Calidad de aterrizaje</span>
        </div>
      </div>

      <div className="results-rewards">
        <span>+${result.rewardCash}</span>
        <span>+{result.rewardRp} RP</span>
      </div>

      {result.bonusesAchieved.length > 0 && (
        <div className="results-bonuses">
          Bonos logrados: {result.bonusesAchieved.join(', ')}
        </div>
      )}

      <div className="results-actions">
        <button
          className="primary-btn"
          onClick={() => {
            goTo('run');
          }}
        >
          Reintentar
        </button>
        <button
          className="secondary-btn"
          onClick={() => {
            selectMission(null);
            goTo('hangar');
          }}
        >
          Volver al taller
        </button>
      </div>
    </div>
  );
}
