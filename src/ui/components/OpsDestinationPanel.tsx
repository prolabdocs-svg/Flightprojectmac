import type { RouteProfile, MapTarget } from '../../map/mapPlan';
import { formatDistance, formatDuration, SURFACE_LABEL } from '../../map/mapPlan';
import type { ContractOffer } from '../../mission/contracts';
import type { DestinationStatus } from '../../mission/operations';
import { archetypeLabel, blockerText, DIFFICULTY_LABEL, LIMITING_LABEL, REACH_LABEL } from '../../mission/labels';
import { ProfileChart } from './MapDestinationPanel';

/** Destination panel for the operations region. Every number and verdict comes from the mission domain
 * (planner assessments + generated offers); this component only lays them out. */

export interface OpsPanelPlan {
  target: MapTarget;
  origin: MapTarget | null;
  status: DestinationStatus | null;
  offers: ContractOffer[];
  known: boolean;
  visited: boolean;
  elevationM: number;
  profile: RouteProfile | null;
  tags: string[];
  fuelOnBoardL: number;
  fuelCapacityL: number;
  /** Reference points (no runway): same planner range, straight-line distance, no contract. */
  reference: { reach: 'REACHABLE' | 'MARGINAL' | 'OUT_OF_RANGE'; distanceKm: number; usableKm: number } | null;
}

const GLYPH = { REACHABLE: '●', MARGINAL: '▲', OUT_OF_RANGE: '✕' } as const;
const CLASS = { REACHABLE: 'comfortable', MARGINAL: 'marginal', OUT_OF_RANGE: 'insufficient' } as const;

interface Props {
  plan: OpsPanelPlan;
  contractId: string | null;
  onContract: (id: string) => void;
  onPlan: (id: string) => void;
  onWorkshop: () => void;
  onClose: () => void;
  panelRef: React.Ref<HTMLElement>;
}

export function OpsDestinationPanel({ plan, contractId, onContract, onPlan, onWorkshop, onClose, panelRef }: Props) {
  const { target, origin, status } = plan;
  const isOrigin = origin?.id === target.id;
  const a = target.airfield;
  const name = plan.known ? target.name : 'Pista sin descubrir';
  const chosen = plan.offers.find((o) => o.contract.id === contractId) ?? null;
  const p = status?.assessment.plan;
  const knowledge = isOrigin ? 'AQUÍ' : plan.visited ? 'VISITADO' : plan.known ? 'CONOCIDO · SIN VISITAR' : 'SIN DESCUBRIR';
  return (
    <aside className="wmap-panel" ref={panelRef} aria-label={`Destino: ${name}`} data-testid="ops-panel">
      <header>
        <div>
          <span className="wmap-kicker">{isOrigin ? 'AERONAVE ESTACIONADA' : a ? 'DESTINO' : 'REFERENCIA'} · <span data-testid="knowledge">{knowledge}</span></span>
          <h3>{name}</h3>
        </div>
        <button className="wmap-close" onClick={onClose} aria-label="Cerrar destino">×</button>
      </header>

      {status && p && !isOrigin && (
        <div className={`wmap-range wmap-range-${CLASS[status.assessment.reach]}`} data-testid="reach" data-reach={status.assessment.reach}>
          <span aria-hidden="true">{GLYPH[status.assessment.reach]}</span> {REACH_LABEL[status.assessment.reach]} · {DIFFICULTY_LABEL[status.assessment.difficulty].toUpperCase()}
          <small data-testid="reach-detail">
            Necesitas {p.range.requiredKm.toFixed(2)} km · rindes {p.range.usableKm.toFixed(2)} km útiles ({p.range.estimatedKm.toFixed(2)} km sin reserva).
            {' '}Limita: {LIMITING_LABEL[p.limiting]}.
          </small>
        </div>
      )}

      {plan.reference && !isOrigin && (
        <div className={`wmap-range wmap-range-${CLASS[plan.reference.reach]}`} data-testid="reach" data-reach={plan.reference.reach}>
          <span aria-hidden="true">{GLYPH[plan.reference.reach]}</span> {REACH_LABEL[plan.reference.reach]}
          <small>A {plan.reference.distanceKm.toFixed(2)} km en línea recta; tu avión rinde {plan.reference.usableKm.toFixed(2)} km útiles según el planificador.</small>
        </div>
      )}

      <dl className="wmap-stats">
        {p && !isOrigin && <div><dt>Distancia</dt><dd>{formatDistance(p.range.distanceKm * 1000)}</dd></div>}
        {p && !isOrigin && <div><dt>Tiempo est.</dt><dd>{formatDuration(p.timeEstimateS)}</dd></div>}
        <div><dt>Elevación</dt><dd>{Math.round(plan.elevationM)} m</dd></div>
        {a && plan.known && <div><dt>Pista</dt><dd>{SURFACE_LABEL[a.surface]} · {a.runwayLengthM} m</dd></div>}
        {isOrigin && <div><dt>Combustible</dt><dd data-testid="fuel-onboard">{plan.fuelOnBoardL.toFixed(1)} / {plan.fuelCapacityL} L</dd></div>}
      </dl>

      {!a && <p className="wmap-note">Sin pista de aterrizaje: punto de referencia para navegar.</p>}
      {a && !plan.known && <p className="wmap-note">Una pista que aún no has localizado. Aterriza cerca de ella para descubrirla.</p>}

      {a && !isOrigin && plan.known && plan.offers.length > 0 && (
        <section aria-label="Contratos">
          <span className="wmap-kicker">CONTRATOS</span>
          <ul className="wmap-contracts">
            {plan.offers.map((o) => (
              <li key={o.contract.id}>
                <button className={`wmap-contract${o.contract.id === contractId ? ' is-selected' : ''}`} data-testid="offer" data-available={o.available} onClick={() => onContract(o.contract.id)} aria-pressed={o.contract.id === contractId}>
                  <span className="wmap-contract-name">{archetypeLabel(o.contract.archetype)}{o.contract.payloadKg > 0 ? ` · ${o.contract.payloadKg} kg` : ''}</span>
                  <span className="wmap-contract-reward">${o.contract.revenueCash}</span>
                  <small>{o.available ? DIFFICULTY_LABEL[o.assessment.difficulty] : o.lockedReason === 'REPUTATION' ? 'Reputación insuficiente' : `Bloqueado · ${LIMITING_LABEL[o.assessment.plan.limiting]}`}</small>
                </button>
              </li>
            ))}
          </ul>
          {chosen && !chosen.available && chosen.lockedReason && chosen.lockedReason !== 'REPUTATION' && (
            <p className="wmap-note" data-testid="locked-reason">{blockerText(chosen.lockedReason, chosen.assessment.plan)}</p>
          )}
        </section>
      )}
      {a && !isOrigin && plan.known && plan.offers.length === 0 && <p className="wmap-note">Sin contratos hacia aquí desde tu posición.</p>}

      <div className="wmap-terrain">
        {plan.tags.length > 0 && <ul className="wmap-tags">{plan.tags.map((t) => <li key={t}>{t}</li>)}</ul>}
        {plan.profile && origin && !isOrigin && <ProfileChart profile={plan.profile} from={origin.name} to={name} />}
      </div>

      {(status?.assessment.reach ?? plan.reference?.reach) === 'OUT_OF_RANGE' && (
        <button className="secondary-btn wmap-workshop" onClick={onWorkshop}>Ampliar alcance en el Taller</button>
      )}
      {chosen && <button className="primary-btn wmap-plan" disabled={!chosen.available} onClick={() => onPlan(chosen.contract.id)}>PLANIFICAR VUELO</button>}
    </aside>
  );
}
