import { useEffect, useState } from 'react';
import { useGameStore } from '../../state/gameStore';
import { useProfileStore } from '../../state/profileStore';
import { resolveAircraft } from '../../content/assembly';
import { getAirfield } from '../../world/airfields';
import { getDestinationStatuses, aircraftAirworthiness, repairEstimateFor } from '../../mission/operations';
import { STATE_LABEL } from '../../mission/labels';
import { componentTopology, COMPONENT_LABEL, componentSeverity } from '../../mission/aircraftCondition';
import { BrandMark } from '../components/BrandMark';
import { ResourceBar } from '../components/ScreenHeader';
import { PAINT_PRESETS } from '../../content/paint';
import { UiIcon, type IconName } from '../components/UiIcon';
import { HangarStage } from '../components/HangarStage';
import { MAX_HOME_BASE_LEVEL, getHomeBaseBenefits } from '../../content/homeBase';
import { getNextPilotRank, getPilotRank } from '../../content/reputation';
import type { Screen } from '../../state/gameStore';
import './Screens.css';

// Home hangar (UI spec §5): the aircraft is the hub. Left = what to do, centre = the machine, right = its clipboard.
export function HangarScreen() {
  const goTo = useGameStore((s) => s.goTo);
  const selectMission = useGameStore((s) => s.selectMission);
  const profile = useProfileStore((s) => s.profile);
  const upgradeHomeBase = useProfileStore((s) => s.upgradeHomeBase);
  const abandonMission = useProfileStore((s) => s.abandonMission);
  const recoverAircraft = useProfileStore((s) => s.recoverAircraft);
  const startRepair = useProfileStore((s) => s.startRepair);
  const collectRepair = useProfileStore((s) => s.collectRepair);
  const aircraft = resolveAircraft(profile.currentBuild);
  const homeBaseBenefits = getHomeBaseBenefits(profile.homeBase);
  const pilotRank = getPilotRank(profile.reputation);
  const nextPilotRank = getNextPilotRank(profile.reputation);

  const runwayCost = (profile.homeBase.runwayLevel + 1) * 300 - 100;
  const hangarCost = (profile.homeBase.hangarLevel + 1) * 300 - 100;

  const ops = profile.operations;
  const location = getAirfield(ops.locationId);
  const bestUsableKm = getDestinationStatuses(profile).reduce((m, st) => Math.max(m, st.assessment.plan.range.usableKm), 0);

  // Flying always starts from the map (contracts hang off destinations); an accepted contract resumes in its briefing.
  const resumable = !!ops.active && (ops.active.session.state === 'ACCEPTED' || ops.active.session.state === 'PREPARED');
  const fly = () => {
    if (resumable) {
      selectMission(ops.active!.contract.id);
      goTo('briefing');
      return;
    }
    goTo('map');
  };

  const airworthiness = aircraftAirworthiness(profile);
  const repairEstimate = repairEstimateFor(profile);
  const pendingRepair = ops.pendingRepair;
  // Date.now() only runs inside the effect (never during render) so the "ready" flag can tick
  // forward while a repair is in progress without calling an impure function on every render.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!pendingRepair) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [pendingRepair]);
  const repairReady = pendingRepair ? now >= pendingRepair.readyAtMs : false;

  const paint = PAINT_PRESETS.find((x) => x.id === profile.selectedPaintId);
  const facilities = [
    { key: 'runway' as const, label: 'Pista', level: profile.homeBase.runwayLevel, cost: runwayCost, benefit: `−${Math.round(homeBaseBenefits.runwayRoughnessReduction * 100)}% rugosidad` },
    { key: 'hangar' as const, label: 'Hangar', level: profile.homeBase.hangarLevel, cost: hangarCost, benefit: `−${Math.round(homeBaseBenefits.repairDiscount * 100)}% en reparaciones` },
  ];

  const fuelFrac = aircraft.fuelCapacityL > 0 ? ops.fuelL / aircraft.fuelCapacityL : 0;
  const worst = componentTopology().reduce((m, id) => Math.min(m, ops.aircraftCondition[id].integrity), 1);
  const statusTone = airworthiness.status === 'AIRWORTHY' ? 'is-ok' : airworthiness.status === 'GROUNDED' ? 'is-bad' : 'is-warn';
  const statusLabel = airworthiness.status === 'AIRWORTHY' ? 'Apta para volar' : airworthiness.status === 'GROUNDED' ? 'En tierra' : 'Volar con cuidado';
  const rankFrac = nextPilotRank ? Math.min(1, (profile.reputation - pilotRank.minimumReputation) / (nextPilotRank.minimumReputation - pilotRank.minimumReputation)) : 1;

  const actions: Array<{ screen: Screen; label: string; hint: string; icon: IconName }> = [
    { screen: 'builder', label: 'Taller', hint: 'Motor, alas, tren y librea', icon: 'wrench' },
    { screen: 'aircraft', label: 'Aeronaves', hint: 'Tu colección y la próxima máquina', icon: 'flight' },
    { screen: 'career', label: 'Bitácora', hint: 'Vuelos, descubrimientos y rango', icon: 'logbook' },
    { screen: 'pilot', label: 'Piloto', hint: 'Rostro, pelo, ropa y accesorios', icon: 'star' },
  ];

  return (
    <div className="screen hub-screen hangar-screen">
      <div className="hub-backdrop" />
      <HangarStage frameId={profile.currentBuild.frameId} paint={paint} focus="overview" />

      <div className="hub-chrome">
        <header className="hub-top hangar-header">
          <BrandMark />
          <div className="hub-rank" title={nextPilotRank ? `Siguiente: ${nextPilotRank.name} (${nextPilotRank.minimumReputation} rep)` : 'Rango máximo'}>
            <span className="hub-rank-badge">{pilotRank.name.slice(0, 1)}</span>
            <div>
              <b>{pilotRank.name}</b>
              <small>REP {profile.reputation.toFixed(1)}{nextPilotRank ? ` / ${nextPilotRank.minimumReputation} · ${nextPilotRank.name}` : ' · máximo'}</small>
              <div className="meter" aria-hidden="true"><i style={{ width: `${rankFrac * 100}%` }} /></div>
            </div>
          </div>
          <ResourceBar />
          <button className="back-btn" onClick={() => goTo('settings')} aria-label="Ajustes"><UiIcon name="settings" size={18} /></button>
        </header>

        <nav className="hub-actions" aria-label="Hangar">
          <button className="hub-action is-primary" onClick={fly} data-testid="fly">
            <span className="hub-action-icon"><UiIcon name={resumable ? 'target' : 'map'} size={24} /></span>
            <span><b>{resumable ? 'Continuar' : 'Volar'}</b><small>{resumable ? ops.active!.contract.title : `Mapa del mundo · desde ${location?.name ?? 'la pista'}`}</small></span>
            <UiIcon name="chevron" size={20} />
          </button>
          {actions.map((a) => (
            <button key={a.screen} className="hub-action" onClick={() => goTo(a.screen)}>
              <span className="hub-action-icon"><UiIcon name={a.icon} size={22} /></span>
              <span><b>{a.label}</b><small>{a.hint}</small></span>
              <UiIcon name="chevron" size={18} />
            </button>
          ))}
        </nav>

        <div className="hub-nameplate">
          <span className="kicker">Aeronave activa · Tier {aircraft.frame.tier}</span>
          <h1>{aircraft.frame.name}</h1>
          <div className="chip-row">
            <span className="chip">{aircraft.engine?.name ?? 'Sin motor'}</span>
            <span className="chip">{aircraft.totalMassKg.toFixed(0)} kg</span>
            <span className="chip">{aircraft.fuelCapacityL} L</span>
            {paint && <span className="chip">{paint.name}</span>}
          </div>
          <span className="hub-drag-hint">Arrastra para girar</span>
        </div>

        <aside className="hub-status paper" data-testid="ops-panel">
          <div>
            <span className="panel-kicker">Parte de la aeronave</span>
            <h3 data-testid="hangar-location">{location?.name ?? ops.locationId}</h3>
          </div>
          <div className={`hub-airworthy ${statusTone}`} data-testid="airworthiness">
            <span className="stamp">{statusLabel}</span>
            {airworthiness.reasons.length > 0 && <small>{airworthiness.reasons.map((r) => `${COMPONENT_LABEL[r.componentId]} (${r.severity})`).join(', ')}</small>}
          </div>
          {ops.active && (
            <div className="hub-alert" data-testid="hangar-active">
              <UiIcon name="warning" size={16} />
              <span>Contrato {STATE_LABEL[ops.active.session.state].toLowerCase()}: {ops.active.contract.title}</span>
              {(ops.active.session.state === 'ACCEPTED' || ops.active.session.state === 'PREPARED' || ops.active.session.state === 'ACTIVE') && <button className="secondary-btn" onClick={() => abandonMission()}>Cancelar contrato</button>}
              {(ops.active.session.state === 'FAILED' || ops.active.session.state === 'ABORTED') && <button className="secondary-btn" onClick={() => recoverAircraft()}>Recuperar aeronave</button>}
            </div>
          )}
          <div className="hub-gauge">
            <span><UiIcon name="fuel" size={12} /> Combustible</span>
            <b data-testid="hangar-fuel">{ops.fuelL.toFixed(1)}<small>/ {aircraft.fuelCapacityL} L</small></b>
            <div className={`meter${fuelFrac < 0.25 ? ' is-bad' : fuelFrac < 0.5 ? ' is-warn' : ''}`} aria-hidden="true"><i style={{ width: `${fuelFrac * 100}%` }} /></div>
          </div>
          <div className="hub-gauge">
            <span>Alcance útil</span>
            <b data-testid="hangar-range">{bestUsableKm.toFixed(1)}<small>km</small></b>
          </div>
          <div className="hub-gauge">
            <span>Estructura</span>
            <b>{Math.round(worst * 100)}<small>%</small></b>
            <div className={`meter${worst < 0.5 ? ' is-bad' : worst < 0.85 ? ' is-warn' : ''}`} aria-hidden="true"><i style={{ width: `${worst * 100}%` }} /></div>
          </div>
          <div className="hub-gauge">
            <span>Deuda</span>
            <b data-testid="hangar-debt" style={ops.debtCash > 0 ? { color: 'var(--status-critical)' } : undefined}>${ops.debtCash}</b>
          </div>
          <div className="hub-divider" />
          <details data-testid="maintenance-panel">
            <summary>Mantenimiento <span>{repairEstimate.componentIds.length > 0 ? `${repairEstimate.componentIds.length} pendientes` : 'al día'} ▾</span></summary>
            <ul className="component-list">
              {componentTopology().map((id) => {
                const c = ops.aircraftCondition[id];
                return (
                  <li key={id} data-testid={`component-${id}`} className={c.integrity < 0.5 ? 'is-bad' : c.integrity < 0.85 ? 'is-warn' : ''} title={componentSeverity(c)}>
                    {COMPONENT_LABEL[id]}<b>{Math.round(c.integrity * 100)}%</b>
                  </li>
                );
              })}
            </ul>
            <p className="results-note" data-testid="hangar-condition">{ops.condition.flights} vuelos · {ops.condition.landings} aterrizajes · {ops.condition.hardLandings} duros</p>
          </details>
          {pendingRepair ? (
            repairReady ? (
              <button className="secondary-btn" data-testid="collect-repair" onClick={() => collectRepair()}>Recoger reparación (${pendingRepair.costCash})</button>
            ) : (
              <p className="results-note" data-testid="repair-in-progress">Reparación en curso: lista {new Date(pendingRepair.readyAtMs).toLocaleTimeString()}</p>
            )
          ) : repairEstimate.componentIds.length > 0 && (
            <button
              className="secondary-btn"
              data-testid="start-repair"
              disabled={profile.cash < repairEstimate.costCash}
              onClick={() => startRepair()}
            >
              Reparar todo (${repairEstimate.costCash})
            </button>
          )}
          <details>
            <summary>Base aérea <span>▾</span></summary>
            {facilities.map((f) => {
              const maxed = f.level >= MAX_HOME_BASE_LEVEL;
              return (
                <div key={f.key} className="facility-row">
                  <div>
                    <b>{f.label} · Nv {f.level}</b>
                    <div className="pips" aria-hidden="true">{Array.from({ length: MAX_HOME_BASE_LEVEL }, (_, i) => <i key={i} className={i < f.level ? 'on' : ''} />)}</div>
                  </div>
                  <button className="secondary-btn" onClick={() => upgradeHomeBase(f.key, f.cost)} disabled={profile.cash < f.cost || maxed}>
                    {maxed ? 'Máximo' : `Mejorar $${f.cost}`}
                  </button>
                  <small>{f.benefit}</small>
                </div>
              );
            })}
          </details>
        </aside>
      </div>
    </div>
  );
}
