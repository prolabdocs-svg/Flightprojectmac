import { useEffect } from 'react';
import { useGameStore } from '../../state/gameStore';
import { useProfileStore } from '../../state/profileStore';
import { uiSound } from '../../audio/uiSound';
import { audioService } from '../../audio/audioService';
import { getAirfield } from '../../world/airfields';
import { CRASH_REASON_LABEL, STATE_LABEL } from '../../mission/labels';
import { COMPONENT_LABEL } from '../../mission/aircraftCondition';
import { UiIcon } from './UiIcon';
import { CountUp } from './kit';

/** Results of a settled contract. Read-only: the settlement was applied exactly once by the domain (ledger);
 * this screen only displays `operations.lastSettlement`, so reloading or navigating back can never charge again.
 * Presented as a stamped flight report (UI spec §26–27): success asks "was it worth it?", failure answers
 * "what went wrong, and what now?". */
export function ContractResults() {
  const goTo = useGameStore((s) => s.goTo);
  const selectMission = useGameStore((s) => s.selectMission);
  const setLastOutcome = useGameStore((s) => s.setLastOutcome);
  const s = useProfileStore((st) => st.profile.operations.lastSettlement);
  const active = useProfileStore((st) => st.profile.operations.active);
  const recoverAircraft = useProfileStore((st) => st.recoverAircraft);

  useEffect(() => {
    if (!s) { goTo('hangar'); return; }
    uiSound(s.outcome === 'COMPLETED' ? 'missionSuccess' : s.outcome === 'FAILED' ? 'missionFailure' : 'back');
    if (s.outcome === 'COMPLETED') audioService.musicEvent('missionComplete');
    if (s.discoveredAirfieldId) window.setTimeout(() => uiSound('discovery'), 600);
  }, [s, goTo]);
  if (!s) return null;

  const needsRecovery = !!active && active.contract.id === s.contractId && (active.session.state === 'FAILED' || active.session.state === 'ABORTED');
  const ok = s.outcome === 'COMPLETED';
  const failed = s.outcome === 'FAILED';
  const title = ok ? 'Contrato completado' : failed ? 'Contrato fallido' : s.abortReason === 'DIVERTED' ? 'Vuelo desviado' : 'Contrato abortado';
  const stamp = ok ? 'Cumplido' : failed ? 'Fallido' : s.abortReason === 'DIVERTED' ? 'Desviado' : 'Abortado';
  const cause = s.failure ? (s.failure.code === 'FUEL_EXHAUSTED' ? 'Sin combustible' : CRASH_REASON_LABEL[s.failure.detail ?? ''] ?? s.failure.detail ?? 'Impacto') : null;
  const discovered = s.discoveredAirfieldId ? getAirfield(s.discoveredAirfieldId)?.name : null;
  const origin = getAirfield(s.originId)?.name ?? s.originId;
  const dest = getAirfield(s.destinationId)?.name ?? s.destinationId;
  const back = () => { setLastOutcome(null); selectMission(null); goTo('map'); };

  const lines: Array<[string, number, 'pos' | 'neg', string]> = [
    ['Ingreso del contrato', s.revenue.base, 'pos', 'revenue-base'],
    ['Bonos', s.revenue.bonuses, 'pos', 'revenue-bonus'],
    ['Descubrimiento', s.revenue.discovery, 'pos', 'revenue-discovery'],
    ['Combustible', s.costs.fuel, 'neg', 'cost-fuel'],
    ['Recuperación', s.costs.recovery, 'neg', 'cost-recovery'],
    ['Tasas de aterrizaje', s.costs.fees, 'neg', 'cost-fees'],
    ['Penalización: entrega tardía', s.penalties.late, 'neg', 'pen-late'],
    ['Penalización: abandono', s.penalties.abandonment, 'neg', 'pen-abandon'],
    ['Penalización: carga perdida', s.penalties.cargoLoss, 'neg', 'pen-cargo'],
    ['Penalización: aterrizaje duro', s.penalties.hardLanding, 'neg', 'pen-hard'],
  ];

  // What to do differently next time — derived from the facts of this flight, never generic.
  const advice: string[] = [];
  if (s.failure?.code === 'FUEL_EXHAUSTED') advice.push('Carga más combustible en el planificador o elige un destino dentro del alcance cómodo.');
  if (s.failure?.detail === 'hardLanding') advice.push('Llega más lento y con menos régimen de descenso: la pista no se mueve.');
  if (s.failure?.detail === 'terrain' || s.failure?.detail === 'obstacle') advice.push('Sube antes de cruzar relieve; el perfil de ruta del mapa muestra dónde.');
  if (s.damagedComponentIds.length > 0) advice.push(`Repara en el hangar antes del próximo vuelo${s.costs.damage > 0 ? ` (≈ $${s.costs.damage})` : ''}.`);
  if (needsRecovery) advice.push('Recupera la aeronave para volver a volar.');

  return (
    <div className="screen results-screen" data-testid="contract-results">
      <main className="report paper">
        <span className={`stamp-mark ${ok ? 'is-ok' : failed ? 'is-bad' : 'is-warn'}`} aria-hidden="true">{stamp}</span>

        <div className="report-col">
          <div className="report-head">
            <span className="kicker">Parte de vuelo · {s.title}</span>
            <h2 data-testid="results-title">{title}</h2>
            <div className="report-route"><span>{origin}</span><i /><span>{dest}</span></div>
          </div>

          {discovered && (
            <div className="discovery-banner" data-testid="discovery">
              <UiIcon name="star" size={22} />
              <div>
                <small>Nueva pista descubierta</small>
                <b>{discovered}</b>
                {s.revealedAirfieldIds.length > 0 && <small>Nuevas pistas a la vista: {s.revealedAirfieldIds.map((id) => getAirfield(id)?.name ?? id).join(', ')}</small>}
              </div>
            </div>
          )}

          {(cause || s.damagedComponentIds.length > 0) && (
            <div className="report-cause">
              {cause && <b>{cause}</b>}
              {s.damagedComponentIds.length > 0 && (
                <div className="chip-row" data-testid="flight-damage">
                  {s.damagedComponentIds.map((id) => <span key={id} className="tag tag-bad">{COMPONENT_LABEL[id]}</span>)}
                  <span className="results-caution">Daño este vuelo (sin reparar){s.costs.damage > 0 ? ` · reparación estimada $${s.costs.damage}` : ''}</span>
                </div>
              )}
            </div>
          )}

          <div className="tile-row">
            <div className="tile"><b>{s.reputationDelta >= 0 ? '+' : ''}{s.reputationDelta}</b><span>Reputación</span></div>
            <div className="tile"><b>+{s.researchPoints}</b><span>RP</span></div>
            <div className="tile"><b data-testid="fuel-left">{s.fuelRemainingL.toFixed(1)}<small>L</small></b><span>Combustible a bordo</span></div>
          </div>
          <p className="results-note" data-testid="condition">Condición: {s.conditionAfter.flights} vuelos · {s.conditionAfter.landings} aterrizajes · {s.conditionAfter.hardLandings} duros</p>
          {needsRecovery && <p className="results-caution" data-testid="needs-recovery">Contrato {active ? STATE_LABEL[active.session.state].toLowerCase() : ''}: recupera la aeronave para volver a volar.</p>}
          {advice.length > 0 && (
            <>
              <span className="panel-kicker">Para la próxima</span>
              <ul className="report-next">{advice.map((a) => <li key={a}>{a}</li>)}</ul>
            </>
          )}
        </div>

        <div className="report-col">
          <span className="panel-kicker">Liquidación</span>
          <div className="ledger" data-testid="ledger">
            {lines.filter(([, v]) => v !== 0).map(([label, v, kind, id]) => (
              <div key={id} className={kind === 'neg' ? 'neg' : ''} data-testid={id}>{label}<b>{kind === 'neg' ? '−' : '+'}${v}</b></div>
            ))}
          </div>
          <div className="report-total">
            <span>Neto del vuelo</span>
            <b className={s.net < 0 ? 'is-neg' : ''} data-testid="net">{`${s.net < 0 ? '−' : ''}$${Math.abs(s.net)}`}</b>
          </div>
          <p className="results-note" data-testid="wallet">
            Caja <b><CountUp value={s.cashAfter} format={(n) => `$${Math.round(n)}`} /></b>
            {s.debtChange !== 0 ? ` · deuda ${s.debtChange > 0 ? 'creada' : 'amortizada'} $${Math.abs(s.debtChange)} (saldo $${s.debtAfter})` : s.debtAfter > 0 ? ` · deuda $${s.debtAfter}` : ''}
          </p>
        </div>
      </main>

      <div className="results-actions">
        {needsRecovery
          ? <button className="primary-btn" data-testid="recover" onClick={() => { recoverAircraft(); back(); }}><UiIcon name="retry" size={18} />Recuperar aeronave</button>
          : <button className="primary-btn" data-testid="back-to-map" onClick={back}><UiIcon name="map" size={18} />Volver al mapa</button>}
        <button className="secondary-btn" onClick={() => { setLastOutcome(null); goTo('hangar'); }}><UiIcon name="home" size={18} />Hangar</button>
      </div>
    </div>
  );
}
