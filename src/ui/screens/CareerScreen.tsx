import { useGameStore } from '../../state/gameStore';
import { useProfileStore } from '../../state/profileStore';
import { AIRFIELDS, getAirfield } from '../../world/airfields';
import { ARCHETYPES } from '../../mission/archetypes';
import { CRASH_REASON_LABEL } from '../../mission/labels';
import { FRAMES } from '../../content/parts';
import { TECH_NODES } from '../../content/techtree';
import { getPilotRank } from '../../content/reputation';
import type { OperationsLogEntry } from '../../mission/types';
import { ScreenHeader } from '../components/ScreenHeader';
import { MenuNavigation } from '../components/MenuNavigation';
import { usd } from '../components/kit';
import './Screens.css';

interface FlightRow {
  contractId: string;
  archetype: string;
  originId?: string;
  destinationId?: string;
  outcome: 'ok' | 'crash' | 'abort' | 'open';
  net?: number;
  fuelL?: number;
  touchdownMs?: number;
  damaged: boolean;
  discovered: boolean;
  crashReason?: string;
}

/** Contract ids are `c<seed>_<origin>_<destination>_<archetype>`; airfield ids contain underscores, so the split
 * is resolved against the real airfield list. */
function parseContractId(id: string): { archetype: string; originId?: string; destinationId?: string } {
  const archetype = ARCHETYPES.find((a) => id.endsWith(`_${a.id}`))?.id ?? '';
  const middle = id.replace(/^c[a-z0-9]+_/, '').slice(0, archetype ? -(archetype.length + 1) : undefined);
  for (const f of AIRFIELDS) {
    if (middle.startsWith(`${f.id}_`) && getAirfield(middle.slice(f.id.length + 1))) return { archetype, originId: f.id, destinationId: middle.slice(f.id.length + 1) };
  }
  return { archetype };
}

/** Folds the operations ledger into one row per contract flight, newest first. */
export function logbookRows(log: OperationsLogEntry[]): FlightRow[] {
  const rows = new Map<string, FlightRow>();
  for (const e of log) {
    if (!e.contractId) continue;
    let r = rows.get(e.contractId);
    if (!r) {
      r = { contractId: e.contractId, ...parseContractId(e.contractId), outcome: 'open', damaged: false, discovered: false };
      rows.set(e.contractId, r);
    }
    if (e.kind === 'mission_complete') { r.outcome = 'ok'; r.net = e.value; }
    if (e.kind === 'crash') { r.outcome = 'crash'; r.crashReason = e.note; }
    if (e.kind === 'mission_abandon' && r.outcome === 'open') r.outcome = 'abort';
    if (e.kind === 'fuel_used') r.fuelL = e.value;
    if (e.kind === 'landing') r.touchdownMs = e.value;
    if (e.kind === 'damage') r.damaged = true;
    if (e.kind === 'destination_discovered') r.discovered = true;
  }
  // A flight that never started its engine is not a logbook entry.
  return [...rows.values()].filter((r) => r.outcome !== 'open' || r.fuelL != null).reverse();
}

const km = (a?: string, b?: string) => {
  const A = a ? getAirfield(a) : undefined, B = b ? getAirfield(b) : undefined;
  return A && B ? Math.hypot(A.position[0] - B.position[0], A.position[2] - B.position[2]) / 1000 : 0;
};

// Career / pilot logbook (UI spec §19–20): "How far have I come?" — a travel journal, not analytics.
export function CareerScreen() {
  const goTo = useGameStore((s) => s.goTo);
  const profile = useProfileStore((s) => s.profile);
  const ops = profile.operations;
  const rows = logbookRows(ops.log);
  const completed = rows.filter((r) => r.outcome === 'ok');
  const distanceKm = completed.reduce((sum, r) => sum + km(r.originId, r.destinationId), 0);
  const earned = completed.reduce((sum, r) => sum + Math.max(0, r.net ?? 0), 0);
  const rank = getPilotRank(profile.reputation);

  const totals: Array<[string, string]> = [
    ['Vuelos', String(ops.condition.flights)],
    ['Contratos cumplidos', String(completed.length)],
    ['Distancia volada', `${distanceKm.toFixed(1)} km`],
    ['Ganado en contratos', usd(earned)],
    ['Aterrizajes', `${ops.condition.landings}${ops.condition.hardLandings ? ` · ${ops.condition.hardLandings} duros` : ''}`],
    ['Accidentes / abortos', `${rows.filter((r) => r.outcome === 'crash').length} / ${rows.filter((r) => r.outcome === 'abort').length}`],
    ['Pistas visitadas', `${ops.visitedAirfieldIds.length} / ${AIRFIELDS.length}`],
    ['Aeronaves', `${profile.ownedFrameIds.length} / ${FRAMES.length}`],
    ['I+D', `${profile.unlockedTech.length} / ${TECH_NODES.length}`],
    ['Reputación', `${profile.reputation.toFixed(1)} · ${rank.name}`],
  ];

  return (
    <div className="screen career-screen">
      <ScreenHeader title="Bitácora" kicker="Carrera del piloto" goTo={goTo} />
      <main className="screen-body">
        <div className="career-layout">
          <section className="panel paper">
            <span className="panel-kicker">Hasta ahora</span>
            <div className="career-totals">
              {totals.map(([label, value]) => <div key={label} className="career-total"><b>{value}</b><span>{label}</span></div>)}
            </div>
            <span className="panel-kicker">Pistas descubiertas</span>
            <div className="discovery-list">
              {AIRFIELDS.map((f) => {
                const visited = ops.visitedAirfieldIds.includes(f.id);
                const known = ops.knownAirfieldIds.includes(f.id);
                return <span key={f.id} className={`tag ${visited ? 'tag-good' : known ? '' : 'tag-dark'}`}>{visited || known ? f.name : '???'}</span>;
              })}
            </div>
          </section>

          <section className="panel paper logbook" data-testid="logbook">
            <div className="logbook-head">
              <h3>Libro de vuelo</h3>
              <span className="panel-kicker">{rows.length} entradas</span>
            </div>
            {rows.length === 0 ? (
              <p className="logbook-empty">Todavía no hay vuelos registrados. Tu primera página te espera en el mapa.</p>
            ) : (
              <table>
                <thead><tr><th>#</th><th>Ruta</th><th>Contrato</th><th>Aterrizaje</th><th>Resultado</th></tr></thead>
                <tbody>
                  {rows.map((r, i) => {
                    const o = r.originId ? getAirfield(r.originId)?.name : undefined;
                    const d = r.destinationId ? getAirfield(r.destinationId)?.name : undefined;
                    const dist = km(r.originId, r.destinationId);
                    return (
                      <tr key={r.contractId}>
                        <td>{rows.length - i}</td>
                        <td><b>{o ?? '—'} → {d ?? '—'}</b>{dist > 0 && <><br /><small>{dist.toFixed(1)} km{r.fuelL != null ? ` · ${r.fuelL.toFixed(1)} L` : ''}</small></>}{r.discovered && <><br /><span className="tag tag-warn">Nueva pista</span></>}</td>
                        <td>{ARCHETYPES.find((a) => a.id === r.archetype)?.title ?? '—'}</td>
                        <td>{r.touchdownMs != null ? `${r.touchdownMs.toFixed(1)} m/s` : '—'}{r.damaged && <><br /><small>con daños</small></>}</td>
                        <td>
                          {r.outcome === 'ok' && <span className="outcome is-ok">✓ Cumplido {r.net != null ? usd(r.net) : ''}</span>}
                          {r.outcome === 'crash' && <span className="outcome is-bad">✕ Accidente{r.crashReason ? ` · ${CRASH_REASON_LABEL[r.crashReason] ?? r.crashReason}` : ''}</span>}
                          {r.outcome === 'abort' && <span className="outcome is-warn">◐ Abortado</span>}
                          {r.outcome === 'open' && <span className="outcome">En curso</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        </div>
      </main>
      <MenuNavigation active="career" goTo={goTo} />
    </div>
  );
}
