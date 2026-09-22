import { useEffect } from 'react';
import { useGameStore } from '../../state/gameStore';
import { useProfileStore } from '../../state/profileStore';
import { audioService } from '../../audio/audioService';
import { getAirfield } from '../../world/airfields';
import { CRASH_REASON_LABEL, STATE_LABEL } from '../../mission/labels';
import { UiIcon } from './UiIcon';

/** Results of a settled contract. Read-only: the settlement was applied exactly once by the domain (ledger);
 * this screen only displays `operations.lastSettlement`, so reloading or navigating back can never charge again. */
export function ContractResults() {
  const goTo = useGameStore((s) => s.goTo);
  const selectMission = useGameStore((s) => s.selectMission);
  const setLastOutcome = useGameStore((s) => s.setLastOutcome);
  const s = useProfileStore((st) => st.profile.operations.lastSettlement);
  const active = useProfileStore((st) => st.profile.operations.active);
  const recoverAircraft = useProfileStore((st) => st.recoverAircraft);

  useEffect(() => {
    if (!s) { goTo('hangar'); return; }
    audioService.playTone(s.outcome === 'COMPLETED' ? 'success' : s.outcome === 'FAILED' ? 'fail' : 'transition');
  }, [s, goTo]);
  if (!s) return null;

  const needsRecovery = !!active && active.contract.id === s.contractId && (active.session.state === 'FAILED' || active.session.state === 'ABORTED');
  const tone = s.outcome === 'COMPLETED' ? '' : s.outcome === 'FAILED' ? 'is-crash' : 'is-hard';
  const title = s.outcome === 'COMPLETED' ? 'Contrato completado' : s.outcome === 'FAILED' ? 'Contrato fallido' : s.abortReason === 'DIVERTED' ? 'Vuelo desviado' : 'Contrato abortado';
  const detail = s.failure ? (s.failure.code === 'FUEL_EXHAUSTED' ? 'Sin combustible' : `Accidente: ${CRASH_REASON_LABEL[s.failure.detail ?? ''] ?? s.failure.detail ?? 'impacto'}`) : null;
  const discovered = s.discoveredAirfieldId ? getAirfield(s.discoveredAirfieldId)?.name : null;
  const usd = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(n)}`;
  const back = () => { setLastOutcome(null); selectMission(null); goTo('map'); };

  const lines: Array<[string, number, 'pos' | 'neg', string]> = [
    ['Ingreso del contrato', s.revenue.base, 'pos', 'revenue-base'],
    ['Bonos', s.revenue.bonuses, 'pos', 'revenue-bonus'],
    ['Descubrimiento', s.revenue.discovery, 'pos', 'revenue-discovery'],
    ['Combustible', s.costs.fuel, 'neg', 'cost-fuel'],
    ['Daños / reparación', s.costs.damage, 'neg', 'cost-damage'],
    ['Recuperación', s.costs.recovery, 'neg', 'cost-recovery'],
    ['Tasas de aterrizaje', s.costs.fees, 'neg', 'cost-fees'],
    ['Penalización: entrega tardía', s.penalties.late, 'neg', 'pen-late'],
    ['Penalización: abandono', s.penalties.abandonment, 'neg', 'pen-abandon'],
    ['Penalización: carga perdida', s.penalties.cargoLoss, 'neg', 'pen-cargo'],
    ['Penalización: aterrizaje duro', s.penalties.hardLanding, 'neg', 'pen-hard'],
  ];

  return (
    <div className="screen results-screen" data-testid="contract-results">
      <main className="screen-body">
        <section className={`results-hero ${tone}`}>
          <span className="kicker">{s.title}</span>
          <h2 data-testid="results-title">{title}</h2>
          {detail && <p className="results-caution">{detail}</p>}
          {discovered && <p className="results-note" data-testid="discovery">Pista descubierta: {discovered}{s.revealedAirfieldIds.length > 0 ? ` · nuevas pistas a la vista: ${s.revealedAirfieldIds.map((id) => getAirfield(id)?.name ?? id).join(', ')}` : ''}</p>}
        </section>

        <div className="results-layout">
          <section className="panel">
            <span className="panel-kicker">LIQUIDACIÓN</span>
            <div className="ledger" data-testid="ledger">
              {lines.filter(([, v]) => v !== 0).map(([label, v, kind, id]) => (
                <div key={id} className={kind === 'neg' ? 'neg' : ''} data-testid={id}>{label}<b>{kind === 'neg' ? '−' : '+'}${v}</b></div>
              ))}
              <div className="net">Neto<b data-testid="net">{usd(s.net)}</b></div>
            </div>
            <p className="results-note" data-testid="wallet">Caja ${s.cashAfter}{s.debtChange !== 0 ? ` · deuda ${s.debtChange > 0 ? 'creada' : 'amortizada'} $${Math.abs(s.debtChange)} (saldo $${s.debtAfter})` : s.debtAfter > 0 ? ` · deuda $${s.debtAfter}` : ''}</p>
          </section>

          <section className="panel">
            <span className="panel-kicker">PROGRESO</span>
            <div className="tile-row">
              <div className="tile"><b>{s.reputationDelta >= 0 ? '+' : ''}{s.reputationDelta}</b><span>Reputación</span></div>
              <div className="tile"><b>+{s.researchPoints}</b><span>RP</span></div>
              <div className="tile"><b data-testid="fuel-left">{s.fuelRemainingL.toFixed(1)}<small>L</small></b><span>Combustible a bordo</span></div>
            </div>
            <p className="results-note" data-testid="condition">Condición: {s.conditionAfter.flights} vuelos · {s.conditionAfter.landings} aterrizajes · {s.conditionAfter.hardLandings} duros</p>
            {needsRecovery && <p className="results-caution" data-testid="needs-recovery">Contrato {active ? STATE_LABEL[active.session.state].toLowerCase() : ''}: recupera la aeronave para volver a volar.</p>}
          </section>
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
