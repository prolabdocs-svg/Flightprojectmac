import type { MissionDefinition, PlayerProfile } from '../../core/types';
import { isMissionAvailableToProfile } from '../../content/missions';
import { evaluateMissionReadiness } from '../../content/missionReadiness';
import { formatDistance, formatDuration, SURFACE_LABEL, type MapTarget, type RangeStatus, type RouteProfile } from '../../map/mapPlan';

/** Contextual destination panel: distance, range verdict, runway, terrain profile, contracts. */

export interface PanelPlan {
  target: MapTarget;
  origin: MapTarget | null;
  distanceM: number;
  timeS: number;
  elevationM: number;
  status: RangeStatus | null;
  usableKm: number;
  profile: RouteProfile | null;
  tags: string[];
  contracts: MissionDefinition[];
}

const FAMILY_LABEL: Record<string, string> = { distanceRun: 'Distancia', precisionLanding: 'Aterrizaje de precisión', stolChallenge: 'Pista corta (STOL)' };

const STATUS_TEXT: Record<RangeStatus, { glyph: string; label: string }> = {
  comfortable: { glyph: '●', label: 'ALCANCE CÓMODO' },
  marginal: { glyph: '▲', label: 'ALCANCE JUSTO' },
  insufficient: { glyph: '✕', label: 'FUERA DE ALCANCE' },
};

function ProfileChart({ profile, from, to }: { profile: RouteProfile; from: string; to: string }) {
  const W = 260, H = 54, span = Math.max(60, profile.maxM - profile.minM), lo = profile.minM - span * 0.12;
  const x = (d: number) => (d / Math.max(1, profile.totalM)) * W;
  const y = (e: number) => H - 4 - ((e - lo) / (span * 1.24)) * (H - 8);
  const line = profile.elevM.map((e, i) => `${i ? 'L' : 'M'}${x(profile.distM[i]).toFixed(1)} ${y(e).toFixed(1)}`).join(' ');
  const last = profile.elevM.length - 1;
  return (
    <figure className="wmap-profile" aria-label={`Perfil de terreno de ${from} a ${to}: ${Math.round(profile.minM)} a ${Math.round(profile.maxM)} m`}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img">
        <path d={`${line} L${W} ${H} L0 ${H} Z`} className="wmap-profile-fill" />
        <path d={line} className="wmap-profile-line" />
        {profile.wet.map((w, i) => w && i < last ? <rect key={i} x={x(profile.distM[i])} y={H - 5} width={Math.max(1, x(profile.distM[i + 1]) - x(profile.distM[i]))} height="5" className="wmap-profile-water" /> : null)}
      </svg>
      <figcaption>
        <span>{from} <b>{Math.round(profile.elevM[0])} m</b></span>
        <span>máx <b>{Math.round(profile.maxM)} m</b></span>
        <span>{to} <b>{Math.round(profile.elevM[last])} m</b></span>
      </figcaption>
    </figure>
  );
}

interface Props {
  plan: PanelPlan;
  profile: PlayerProfile;
  contractId: string | null;
  onContract: (id: string) => void;
  onPlan: () => void;
  onWorkshop: () => void;
  onClose: () => void;
  panelRef: React.Ref<HTMLElement>;
}

export function MapDestinationPanel({ plan, profile, contractId, onContract, onPlan, onWorkshop, onClose, panelRef }: Props) {
  const { target, origin } = plan;
  const isOrigin = origin?.id === target.id;
  const a = target.airfield;
  const status = plan.status ? STATUS_TEXT[plan.status] : null;
  const name = target.revealed ? target.name : 'Pista sin descubrir';
  const chosen = plan.contracts.find((m) => m.id === contractId) ?? null;
  return (
    <aside className="wmap-panel" ref={panelRef} aria-label={`Destino: ${name}`}>
      <header>
        <div>
          <span className="wmap-kicker">{isOrigin ? 'BASE ACTUAL' : a ? 'DESTINO' : 'REFERENCIA'}</span>
          <h3>{name}</h3>
        </div>
        <button className="wmap-close" onClick={onClose} aria-label="Cerrar destino">×</button>
      </header>

      {status && !isOrigin && (
        <div className={`wmap-range wmap-range-${plan.status}`}>
          <span aria-hidden="true">{status.glyph}</span> {status.label}
          <small>{plan.status === 'insufficient'
            ? `Necesitas ${formatDistance(plan.distanceM)}; tu avión rinde ${plan.usableKm.toFixed(1)} km con reserva.`
            : plan.status === 'marginal'
              ? `Llegas con poco margen (${plan.usableKm.toFixed(1)} km útiles): sin combustible para volver.`
              : `Sobra combustible (${plan.usableKm.toFixed(1)} km útiles).`}</small>
        </div>
      )}

      <dl className="wmap-stats">
        {!isOrigin && <div><dt>Distancia</dt><dd>{formatDistance(plan.distanceM)}</dd></div>}
        {!isOrigin && <div><dt>Tiempo est.</dt><dd>{formatDuration(plan.timeS)}</dd></div>}
        <div><dt>Elevación</dt><dd>{Math.round(plan.elevationM)} m</dd></div>
        {a && target.revealed && <div><dt>Pista</dt><dd>{SURFACE_LABEL[a.surface]} · {a.runwayLengthM} m</dd></div>}
      </dl>

      {!a && <p className="wmap-note">Sin pista de aterrizaje: punto de referencia para navegar. Sirve para medir hasta dónde llega tu avión.</p>}

      {a && plan.contracts.length > 0 && (
        <section aria-label="Contratos">
          <span className="wmap-kicker">CONTRATOS</span>
          <ul className="wmap-contracts">
            {plan.contracts.map((m) => {
              const locked = !isMissionAvailableToProfile(m, profile);
              const readiness = locked ? null : evaluateMissionReadiness(m, profile.currentBuild);
              const best = profile.completedMissions[m.id]?.bestScore;
              return (
                <li key={m.id}>
                  <button className={`wmap-contract${m.id === contractId ? ' is-selected' : ''}`} disabled={locked} onClick={() => onContract(m.id)} aria-pressed={m.id === contractId}>
                    <span className="wmap-contract-name">{m.name}</span>
                    <span className="wmap-contract-reward">${m.rewardBaseCash} · {m.rewardBaseRp} RP</span>
                    <small>{locked ? 'Bloqueada' : readiness && !readiness.ready ? (m.aircraftRequirement?.label ?? 'Avión no apto') : best !== undefined ? `Mejor: ${best.toFixed(0)} m` : (FAMILY_LABEL[m.family] ?? m.family)}</small>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {a && plan.contracts.length === 0 && <p className="wmap-note">Sin contratos aquí todavía.</p>}

      <div className="wmap-terrain">
        {plan.tags.length > 0 && <ul className="wmap-tags">{plan.tags.map((t) => <li key={t}>{t}</li>)}</ul>}
        {plan.profile && origin && !isOrigin && <ProfileChart profile={plan.profile} from={origin.name} to={name} />}
      </div>

      {plan.status === 'insufficient' && (
        <button className="secondary-btn wmap-workshop" onClick={onWorkshop}>Ampliar alcance en el Taller</button>
      )}
      {chosen && <button className="primary-btn wmap-plan" onClick={onPlan}>PLANIFICAR VUELO</button>}
    </aside>
  );
}
