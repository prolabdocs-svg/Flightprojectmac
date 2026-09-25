import { useEffect } from 'react';
import { useGameStore } from '../../state/gameStore';
import { audioService } from '../../audio/audioService';
import { UiIcon } from '../components/UiIcon';
import { ContractResults } from '../components/ContractResults';
import { CountUp } from '../components/kit';
import './Screens.css';
import { getResultsHeadline } from './resultsHeadline';

// Spec 82.14 Results: score, rewards, damage, next action.
// Contract flights are settled by the mission domain and shown from the profile; legacy flights keep their own path.
export function ResultsScreen() {
  const outcome = useGameStore((s) => s.lastOutcome);
  return outcome === 'contract' ? <ContractResults /> : <LegacyResults />;
}

function LegacyResults() {
  const goTo = useGameStore((s) => s.goTo);
  const result = useGameStore((s) => s.lastResult);
  const selectMission = useGameStore((s) => s.selectMission);

  // Spec 23.8 "record moment: sting breve" — placeholder success/fail stinger.
  useEffect(() => {
    if (!result) return;
    audioService.playTone(result.crashed ? 'fail' : result.crashOutcome === 'hardLanding' ? 'transition' : 'success');
    if (!result.crashed) audioService.musicEvent('missionComplete');
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

  const stampTone = result.crashed ? 'is-bad' : result.crashOutcome === 'hardLanding' ? 'is-warn' : 'is-ok';
  return (
    <div className="screen results-screen">
      <main className={`report paper ${tone}`}>
        <span className={`stamp-mark ${stampTone}`} aria-hidden="true">{result.crashed ? 'Siniestro' : result.landed ? 'En tierra' : 'Interrumpido'}</span>
        <div className="report-col">
          <div className="report-head">
            <span className="kicker">Parte de vuelo</span>
            <h2>{headline.title}</h2>
          </div>
          {(headline.caution || hasDamage) && (
            <div className="report-cause">
              {headline.caution && <b>{headline.caution}</b>}
              {hasDamage && (
                <div className="chip-row">
                  {((result.detachedPartIds?.length ?? 0) > 0 ? result.detachedPartIds! : result.damagedPartIds!).map((id) => <span key={id} className="tag tag-bad">{id}</span>)}
                  <span className="results-caution">{(result.detachedPartIds?.length ?? 0) > 0 ? 'Piezas desprendidas' : 'Piezas dañadas'}</span>
                </div>
              )}
            </div>
          )}
          {result.missionId && result.missionCompleted === false && !result.crashed && (
            <p className="results-note">El vuelo cuenta para ganancias, pero no desbloquea la siguiente zona.</p>
          )}
          <div className="tile-row">
            <div className="tile"><b>{result.distanceM.toFixed(0)}<small>m</small></b><span>Distancia</span></div>
            <div className="tile"><b>{result.maxAltitudeM.toFixed(0)}<small>m</small></b><span>Altitud máxima</span></div>
            <div className="tile"><b>{(result.maxSpeedMs * 3.6).toFixed(0)}<small>km/h</small></b><span>Velocidad máxima</span></div>
            <div className="tile"><b>{(result.landingQuality * 100).toFixed(0)}<small>%</small></b><span>Aterrizaje</span></div>
          </div>
          {result.bonusesAchieved.length > 0 && (
            <div className="chip-row">{result.bonusesAchieved.map((b) => <span key={b} className="tag tag-good">{b}</span>)}</div>
          )}
        </div>
        <div className="report-col">
          <span className="panel-kicker">Recompensas</span>
          <div className="ledger">
            <div>Efectivo<b>+$<CountUp value={result.rewardCash} /></b></div>
            <div>Investigación<b>+<CountUp value={result.rewardRp} /> RP</b></div>
            <div>Reputación<b>+{result.reputationGain ?? (result.crashed ? 0.5 : 1.5)}</b></div>
            {fuelCost > 0 && <div className="neg">Combustible<b>−${fuelCost}</b></div>}
            {repairCost > 0 && <div className="neg">Reparaciones<b>−${repairCost}</b></div>}
          </div>
          <div className="report-total"><span>Neto</span><b>${result.netCash ?? result.rewardCash}</b></div>
        </div>
      </main>

      <div className="results-actions">
        <button className="secondary-btn" onClick={() => { selectMission(null); goTo('map'); }}><UiIcon name="map" size={18} />Volver al mapa</button>
        <button className="primary-btn" onClick={() => goTo('run')}><UiIcon name="retry" size={18} />Reintentar</button>
      </div>
    </div>
  );
}
