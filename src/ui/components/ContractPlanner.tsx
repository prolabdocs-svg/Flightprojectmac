import { useMemo, useState } from 'react';
import type { PlayerProfile } from '../../core/types';
import { useProfileStore } from '../../state/profileStore';
import { resolveAircraft } from '../../content/assembly';
import type { RunwaySurface } from '../../world/airfields';
import { SURFACE_LABEL } from '../../map/mapPlan';
import { planMission, recommendLoadout, RUNWAY_SAFETY } from '../../mission/planning';
import { routeContext } from '../../mission/route';
import { archetypeLabel, blockerText, DIFFICULTY_LABEL, LIMITING_LABEL, REACH_LABEL, STATE_LABEL } from '../../mission/labels';
import type { Contract } from '../../mission/types';
import { formatDistance, formatDuration } from '../../map/mapPlan';
import './ContractPlanner.css';

/** Mission planner for a domain contract. Every figure is `planMission` output for the loadout on the sliders;
 * the sliders only choose the loadout. START goes through the state machine (accept -> prepare) or does not happen. */

interface Props {
  profile: PlayerProfile;
  contract: Contract;
  onBack: () => void;
  onStart: () => void;
}

const ROW = ({ label, value, tone, id }: { label: string; value: string; tone?: 'good' | 'warn' | 'bad'; id?: string }) => (
  <div className={`planner-row${tone ? ` planner-${tone}` : ''}`} data-testid={id}><span>{label}</span><b>{value}</b></div>
);
const tone = (u: number): 'good' | 'warn' | 'bad' => (u > 1 ? 'bad' : u > 0.8 ? 'warn' : 'good');

export function ContractPlanner({ profile, contract, onBack, onStart }: Props) {
  const acceptContract = useProfileStore((s) => s.acceptContract);
  const prepareMission = useProfileStore((s) => s.prepareMission);
  const abandonMission = useProfileStore((s) => s.abandonMission);
  const recoverAircraft = useProfileStore((s) => s.recoverAircraft);
  const [error, setError] = useState<string | null>(null);

  const ops = profile.operations;
  const route = useMemo(() => routeContext(contract.originId, contract.destinationId), [contract.originId, contract.destinationId]);
  const capacityL = resolveAircraft(profile.currentBuild).fuelCapacityL;
  const supplyL = route.origin.services.includes('fuel') ? capacityL : Math.min(capacityL, ops.fuelL);
  const active = ops.active;
  const mine = active?.contract.id === contract.id;

  const [loadout, setLoadout] = useState(() =>
    (mine && active?.loadout) || recommendLoadout(profile.currentBuild, route, contract, ops.fuelL, profile.homeBase));

  const plan = useMemo(
    () => planMission({ build: profile.currentBuild, route, contract, loadout, onboardFuelL: ops.fuelL, homeBase: profile.homeBase }),
    [profile.currentBuild, profile.homeBase, route, contract, loadout, ops.fuelL],
  );

  const other = active && !mine;
  const started = mine && active!.session.state !== 'ACCEPTED' && active!.session.state !== 'PREPARED';
  const canStart = plan.feasible && !other && !started;

  const start = () => {
    setError(null);
    if (!active) {
      const r = acceptContract(contract.id);
      if (!r.ok) return setError(r.error);
    }
    const p = prepareMission(loadout);
    if (!p.ok) return setError(p.error);
    onStart();
  };

  const [dep, arr] = [route.origin, route.destination];
  const rwy = (s: RunwaySurface) => SURFACE_LABEL[s];
  const b = plan.blockers;

  return (
    <div className="planner" data-testid="planner">
      <header className="planner-head">
        <button className="back-btn" onClick={onBack}>← Mapa</button>
        <div>
          <span className="kicker">{archetypeLabel(contract.archetype).toUpperCase()} · {DIFFICULTY_LABEL[plan.difficulty].toUpperCase()}</span>
          <h2 data-testid="planner-title">{dep.name} → {arr.name}</h2>
        </div>
        <div className="planner-pay"><b data-testid="expected-net">${plan.economics.expectedNet}</b><span>beneficio esperado</span></div>
      </header>

      <div className="planner-grid">
        <section className="panel" aria-label="Carga">
          <span className="panel-kicker">CONFIGURACIÓN</span>
          <label className="planner-slider">
            <span>Combustible <b data-testid="fuel-value">{loadout.fuelL.toFixed(1)} L</b> <small>de {capacityL} L · {supplyL < capacityL ? `solo hay ${supplyL.toFixed(1)} L a bordo` : 'disponible en pista'}</small></span>
            <input type="range" data-testid="fuel-slider" min={0} max={supplyL} step={0.1} value={loadout.fuelL} disabled={!!other || started}
              onChange={(e) => setLoadout({ ...loadout, fuelL: Number(e.target.value) })} aria-label="Combustible en litros" />
          </label>
          {contract.payloadKg > 0 ? (
            <label className="planner-slider">
              <span>Carga <b data-testid="payload-value">{loadout.payloadKg.toFixed(0)} kg</b> <small>contrato: {contract.minPayloadKg}–{contract.payloadKg} kg</small></span>
              <input type="range" data-testid="payload-slider" min={contract.minPayloadKg} max={contract.payloadKg} step={1} value={loadout.payloadKg}
                disabled={contract.minPayloadKg === contract.payloadKg || !!other || started} onChange={(e) => setLoadout({ ...loadout, payloadKg: Number(e.target.value) })} aria-label="Carga en kilos" />
            </label>
          ) : <p className="planner-note">Sin carga: traslado vacío.</p>}
          <button className="secondary-btn" disabled={!!other || started} onClick={() => setLoadout(recommendLoadout(profile.currentBuild, route, contract, ops.fuelL, profile.homeBase))}>Configuración recomendada</button>
        </section>

        <section className="panel" aria-label="Masa y combustible">
          <span className="panel-kicker">MASA</span>
          <ROW id="mass-total" label="Masa al despegue" value={`${plan.mass.totalKg.toFixed(0)} kg`} tone={tone(plan.utilization.mass)} />
          <ROW label="MTOW" value={`${plan.mass.mtowKg.toFixed(0)} kg`} />
          <ROW label="Vacío + piloto" value={`${plan.mass.emptyKg.toFixed(0)} kg`} />
          <ROW label="Combustible" value={`${plan.mass.fuelKg.toFixed(1)} kg`} />
          <ROW label="Carga" value={`${plan.mass.payloadKg.toFixed(0)} kg`} />
        </section>

        <section className="panel" aria-label="Autonomía">
          <span className="panel-kicker">AUTONOMÍA · {REACH_LABEL[plan.reach]}</span>
          <ROW id="range-required" label="Rango requerido" value={`${plan.range.requiredKm.toFixed(2)} km`} />
          <ROW id="range-estimated" label="Rango estimado" value={`${plan.range.estimatedKm.toFixed(2)} km`} />
          <ROW id="range-usable" label="Rango útil (con reserva)" value={`${plan.range.usableKm.toFixed(2)} km`} tone={tone(plan.utilization.range)} />
          <ROW id="reserve" label="Reserva al llegar" value={`${plan.range.reserveKm.toFixed(2)} km · ${plan.fuel.arrivalL.toFixed(1)} L`} tone={plan.range.reserveKm < 0 ? 'bad' : undefined} />
          <ROW label="Consumo estimado" value={`${plan.fuel.tripL.toFixed(1)} L`} />
          <ROW label="Tiempo" value={formatDuration(plan.timeEstimateS)} />
        </section>

        <section className="panel" aria-label="Pistas y viento">
          <span className="panel-kicker">PISTAS Y VIENTO</span>
          <ROW id="takeoff-runway" label={`Salida · ${rwy(dep.surface)}`} value={`pide ${(plan.takeoff.rollM * RUNWAY_SAFETY).toFixed(0)} m / hay ${dep.runwayLengthM} m`} tone={tone(plan.utilization.takeoff)} />
          <ROW id="landing-runway" label={`Llegada · ${rwy(arr.surface)}`} value={`pide ${(plan.landing.rollM * RUNWAY_SAFETY).toFixed(0)} m / hay ${arr.runwayLengthM} m`} tone={tone(plan.utilization.landing)} />
          <ROW id="crosswind" label="Viento cruzado" value={`${plan.wind.crosswindMs.toFixed(1)} m/s`} tone={tone(plan.utilization.crosswind)} />
          <ROW label="Viento de frente" value={`${plan.wind.headwindMs.toFixed(1)} m/s`} />
          <ROW label="Distancia" value={formatDistance(route.distanceM)} />
          <ROW id="limiting" label="Factor limitante" value={LIMITING_LABEL[plan.limiting]} />
        </section>

        <section className="panel" aria-label="Economía">
          <span className="panel-kicker">ECONOMÍA</span>
          <ROW id="payout" label="Pago del contrato" value={`$${contract.revenueCash}`} />
          <ROW label="Ingreso esperado (con bonos)" value={`$${plan.economics.expectedRevenue}`} />
          <ROW label="Combustible" value={`−$${plan.economics.fuelCost}`} />
          <ROW label="Tasas de aterrizaje" value={`−$${plan.economics.fees}`} />
          <ROW label="Beneficio esperado" value={`$${plan.economics.expectedNet}`} tone={plan.economics.expectedNet < 0 ? 'bad' : 'good'} />
          {ops.debtCash > 0 && <ROW label="Deuda pendiente" value={`$${ops.debtCash}`} tone="warn" />}
        </section>
      </div>

      {b.length > 0 && (
        <ul className="planner-blockers" role="alert" data-testid="blockers">
          {b.map((k) => <li key={k} data-blocker={k}>{blockerText(k, plan)}</li>)}
        </ul>
      )}

      {other && (
        <div className="planner-notice" role="alert" data-testid="other-active">
          Ya tienes un contrato en curso ({STATE_LABEL[active!.session.state]}): {active!.contract.title}.
          <button className="secondary-btn" onClick={() => abandonMission()}>Cancelar ese contrato</button>
        </div>
      )}
      {started && (
        <div className="planner-notice" role="alert" data-testid="started-notice">
          Este contrato ya está en estado {STATE_LABEL[active!.session.state]}; no se puede volver a planificar.
          {(active!.session.state === 'FAILED' || active!.session.state === 'ABORTED') && <button className="secondary-btn" onClick={() => recoverAircraft()}>Recuperar aeronave</button>}
        </div>
      )}
      {error && <p className="planner-error" role="alert" data-testid="planner-error">{error}</p>}

      <div className="sticky-cta">
        <button className="primary-btn" data-testid="start" disabled={!canStart} onClick={start}>
          {canStart ? 'START' : plan.feasible ? 'NO DISPONIBLE' : 'CONFIGURACIÓN NO APTA'}
        </button>
      </div>
    </div>
  );
}
