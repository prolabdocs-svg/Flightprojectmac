import { useEffect } from 'react';
import { useGameStore } from '../../state/gameStore';
import { audioService } from '../../audio/audioService';
import { UiIcon } from '../components/UiIcon';
import './Screens.css';
import { getResultsHeadline } from './resultsHeadline';

// Spec 82.14 Results: score, rewards, damage, next action.
export function ResultsScreen() {
  const goTo = useGameStore((s) => s.goTo);
  const result = useGameStore((s) => s.lastResult);
  const selectMission = useGameStore((s) => s.selectMission);

  // Spec 23.8 "record moment: sting breve" — placeholder success/fail stinger.
  useEffect(() => {
    if (!result) return;
    audioService.playTone(result.crashed ? 'fail' : result.crashOutcome === 'hardLanding' ? 'transition' : 'success');
  }, [result]);

  // A stale deep link or interrupted session can reach Results without a payload. Redirect
  // after commit rather than mutating the Zustand store while React is rendering.
  useEffect(() => {
    if (!result) goTo('hangar');
  }, [goTo, result]);

  if (!result) {
    return null;
  }

  const hasDamage = (result.damagedPartIds?.length ?? 0) > 0 || (result.detachedPartIds?.length ?? 0) > 0;
  const headline = getResultsHeadline(result);

  const tone = result.crashed ? 'is-crash' : result.crashOutcome === 'hardLanding' ? 'is-hard' : '';
  const fuelCost = result.fuelCost ?? 0;
  const repairCost = result.repairCost ?? 0;

  return (
    <div className="screen results-screen">
      <main className="screen-body">
        <section className={`results-hero ${tone}`}>
          <span className="kicker">RESULTADO DEL VUELO</span>
          <h2>{headline.title}</h2>
          {headline.caution && <p className="results-caution">{headline.caution}</p>}
          {result.missionId && result.missionCompleted === false && !result.crashed && (
            <p className="results-note">El vuelo cuenta para ganancias, pero no desbloquea la siguiente zona.</p>
          )}
        </section>

        <div className="results-layout">
          <section className="panel">
            <span className="panel-kicker">TELEMETRÍA</span>
            <div className="tile-row">
              <div className="tile"><b>{result.distanceM.toFixed(0)}<small>m</small></b><span>Distancia</span></div>
              <div className="tile"><b>{result.maxAltitudeM.toFixed(0)}<small>m</small></b><span>Altitud máxima</span></div>
              <div className="tile"><b>{(result.maxSpeedMs * 3.6).toFixed(0)}<small>km/h</small></b><span>Velocidad máxima</span></div>
              <div className="tile"><b>{(result.landingQuality * 100).toFixed(0)}<small>%</small></b><span>Calidad de aterrizaje</span></div>
            </div>
            {result.bonusesAchieved.length > 0 && (
              <div className="chip-row">{result.bonusesAchieved.map((b) => <span key={b} className="chip chip-good"><UiIcon name="check" size={11} />{b}</span>)}</div>
            )}
            {hasDamage && (
              <p className="results-note">
                {(result.detachedPartIds?.length ?? 0) > 0
                  ? `Piezas desprendidas: ${result.detachedPartIds!.join(', ')}`
                  : `Piezas dañadas: ${result.damagedPartIds!.join(', ')}`}
              </p>
            )}
          </section>

          <section className="panel">
            <span className="panel-kicker">RECOMPENSAS</span>
            <div className="results-rewards">
              <div className="tile"><b>+${result.rewardCash}</b><span>Efectivo</span></div>
              <div className="tile"><b>+{result.rewardRp}</b><span>RP</span></div>
              <div className="tile"><b>+{result.reputationGain ?? (result.crashed ? 0.5 : 1.5)}</b><span>Rep</span></div>
            </div>
            {(fuelCost > 0 || repairCost > 0) && (
              <div className="ledger">
                {fuelCost > 0 && <div className="neg">Combustible<b>−${fuelCost}</b></div>}
                {repairCost > 0 && <div className="neg">Reparaciones<b>−${repairCost}</b></div>}
                <div className="net">Neto<b>${result.netCash ?? result.rewardCash}</b></div>
              </div>
            )}
          </section>
        </div>
      </main>

      <div className="results-actions">
        <button className="secondary-btn" onClick={() => { selectMission(null); goTo('map'); }}><UiIcon name="map" size={18} />Volver al mapa</button>
        <button className="primary-btn" onClick={() => goTo('run')}><UiIcon name="retry" size={18} />Reintentar</button>
      </div>
    </div>
  );
}
