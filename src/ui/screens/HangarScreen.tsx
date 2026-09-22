import { useGameStore } from '../../state/gameStore';
import { useProfileStore } from '../../state/profileStore';
import { resolveAircraft } from '../../content/assembly';
import { getAirfield } from '../../world/airfields';
import { getPart } from '../../content/parts';
import { getDestinationStatuses } from '../../mission/operations';
import { STATE_LABEL } from '../../mission/labels';
import { BrandMark } from '../components/BrandMark';
import { MenuNavigation } from '../components/MenuNavigation';
import { ResourceBar } from '../components/ScreenHeader';
import { PAINT_PRESETS } from '../../content/paint';
import { UiIcon } from '../components/UiIcon';
import { HangarAircraft } from '../components/HangarAircraft';
import { MAX_HOME_BASE_LEVEL, getHomeBaseBenefits } from '../../content/homeBase';
import { getNextPilotRank, getPilotRank } from '../../content/reputation';
import '../components/ContractPlanner.css';
import './Screens.css';

// Spec 82.3 Main Hangar: primary hub with FLY CTA and navigation to other screens.
export function HangarScreen() {
  const goTo = useGameStore((s) => s.goTo);
  const selectMission = useGameStore((s) => s.selectMission);
  const profile = useProfileStore((s) => s.profile);
  const upgradeHomeBase = useProfileStore((s) => s.upgradeHomeBase);
  const abandonMission = useProfileStore((s) => s.abandonMission);
  const recoverAircraft = useProfileStore((s) => s.recoverAircraft);
  const aircraft = resolveAircraft(profile.currentBuild);
  const homeBaseBenefits = getHomeBaseBenefits(profile.homeBase);
  const pilotRank = getPilotRank(profile.reputation);
  const nextPilotRank = getNextPilotRank(profile.reputation);

  const runwayCost = (profile.homeBase.runwayLevel + 1) * 300 - 100;
  const hangarCost = (profile.homeBase.hangarLevel + 1) * 300 - 100;

  const ops = profile.operations;
  const location = getAirfield(ops.locationId);
  const bestUsableKm = getDestinationStatuses(profile).reduce((m, st) => Math.max(m, st.assessment.plan.range.usableKm), 0);
  const parts = Object.values(profile.currentBuild.installed).map((id) => (id ? getPart(id)?.name : undefined)).filter(Boolean);

  // Flying always starts from the map (contracts hang off destinations); an accepted contract resumes in its briefing.
  const fly = () => {
    if (ops.active && (ops.active.session.state === 'ACCEPTED' || ops.active.session.state === 'PREPARED')) {
      selectMission(ops.active.contract.id);
      goTo('briefing');
      return;
    }
    goTo('map');
  };

  const paint = PAINT_PRESETS.find((x) => x.id === profile.selectedPaintId);
  const facilities = [
    { key: 'runway' as const, label: 'Pista', level: profile.homeBase.runwayLevel, cost: runwayCost, benefit: `Superficie más lisa: −${Math.round(homeBaseBenefits.runwayRoughnessReduction * 100)}% rugosidad` },
    { key: 'hangar' as const, label: 'Hangar', level: profile.homeBase.hangarLevel, cost: hangarCost, benefit: `Taller: −${Math.round(homeBaseBenefits.repairDiscount * 100)}% en reparaciones` },
  ];

  return (
    <div className="screen hangar-screen">
      <header className="hangar-header">
        <BrandMark />
        <ResourceBar />
      </header>

      <main className="screen-body">
        <div className="hangar-layout">
          <section className="hangar-hero">
            <div className="hangar-grid" aria-hidden="true" />
            <div className="aircraft-silhouette" aria-hidden="true"><HangarAircraft fabric={paint?.fabricColor} tube={paint?.tubeColor} /></div>
            <span className="hangar-eyebrow">AERONAVE ACTIVA · {pilotRank.name.toUpperCase()} · REP {profile.reputation.toFixed(1)}{nextPilotRank ? ` · SIGUIENTE: ${nextPilotRank.name} (${nextPilotRank.minimumReputation})` : ' · RANGO MÁXIMO'}</span>
            <h1>{aircraft.frame.name}</h1>
            <div className="chip-row">
              <span className="chip">{aircraft.totalMassKg.toFixed(0)} kg</span>
              <span className="chip">{aircraft.engine?.name ?? 'SIN MOTOR'}</span>
              <span className="chip">{aircraft.fuelCapacityL} L</span>
            </div>
            <button className="fly-cta" onClick={fly} data-testid="fly"><UiIcon name="flight" size={22} /> Volar ahora <UiIcon name="chevron" size={18} /></button>
            <span className="hangar-caption">{location?.name?.toUpperCase() ?? 'EN PISTA'} · {ops.active ? STATE_LABEL[ops.active.session.state].toUpperCase() : 'LISTO PARA PISTA'}</span>
          </section>

          <section className="panel ops-panel" data-testid="ops-panel">
            <div><span className="panel-kicker">OPERACIONES</span><h3>Estado de la aeronave</h3></div>
            <div className="tile-row">
              <div className="tile"><b data-testid="hangar-location">{location?.name ?? ops.locationId}</b><span>Ubicación</span></div>
              <div className="tile"><b data-testid="hangar-fuel">{ops.fuelL.toFixed(1)}<small>/ {aircraft.fuelCapacityL} L</small></b><span>Combustible a bordo</span></div>
              <div className="tile"><b data-testid="hangar-range">{bestUsableKm.toFixed(1)}<small>km</small></b><span>Alcance útil</span></div>
              <div className={`tile${ops.debtCash > 0 ? ' tile-warn' : ''}`}><b data-testid="hangar-debt">${ops.debtCash}</b><span>Deuda</span></div>
            </div>
            <p className="results-note" data-testid="hangar-condition">Condición: {ops.condition.flights} vuelos · {ops.condition.landings} aterrizajes · {ops.condition.hardLandings} duros · Configuración: {parts.join(' · ')}</p>
            {ops.active && (
              <div className="planner-notice" data-testid="hangar-active">
                Contrato {STATE_LABEL[ops.active.session.state].toLowerCase()}: {ops.active.contract.title}
                {(ops.active.session.state === 'ACCEPTED' || ops.active.session.state === 'PREPARED' || ops.active.session.state === 'ACTIVE') && <button className="secondary-btn" onClick={() => abandonMission()}>Cancelar contrato</button>}
                {(ops.active.session.state === 'FAILED' || ops.active.session.state === 'ABORTED') && <button className="secondary-btn" onClick={() => recoverAircraft()}>Recuperar aeronave</button>}
              </div>
            )}
          </section>

          <section className="panel home-base-panel">
            <div><span className="panel-kicker">INSTALACIONES</span><h3>Base aérea</h3></div>
            {facilities.map((f) => {
              const maxed = f.level >= MAX_HOME_BASE_LEVEL;
              return (
                <div key={f.key} className="upgrade-row">
                  <div>
                    <b>{f.label} · nivel {f.level}</b>
                    <div className="pips" aria-hidden="true">{Array.from({ length: MAX_HOME_BASE_LEVEL }, (_, i) => <i key={i} className={i < f.level ? 'on' : ''} />)}</div>
                  </div>
                  <button className="secondary-btn" onClick={() => upgradeHomeBase(f.key, f.cost)} disabled={profile.cash < f.cost || maxed}>
                    {maxed ? 'Máximo' : `Mejorar $${f.cost}`}
                  </button>
                  <small>{f.benefit}</small>
                </div>
              );
            })}
          </section>
        </div>
      </main>

      <MenuNavigation goTo={goTo} />
    </div>
  );
}
