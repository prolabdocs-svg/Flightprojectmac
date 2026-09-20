import { useGameStore } from '../../state/gameStore';
import { useProfileStore } from '../../state/profileStore';
import { resolveAircraft } from '../../content/assembly';
import { getNextAvailableMission } from '../../content/missions';
import { BrandMark } from '../components/BrandMark';
import { MenuNavigation } from '../components/MenuNavigation';
import { UiIcon } from '../components/UiIcon';
import { HangarAircraft } from '../components/HangarAircraft';
import { MAX_HOME_BASE_LEVEL, getHomeBaseBenefits } from '../../content/homeBase';
import { getNextPilotRank, getPilotRank } from '../../content/reputation';
import './Screens.css';

// Spec 82.3 Main Hangar: primary hub with FLY CTA and navigation to other screens.
export function HangarScreen() {
  const goTo = useGameStore((s) => s.goTo);
  const selectMission = useGameStore((s) => s.selectMission);
  const selectFreeFlight = useGameStore((s) => s.selectFreeFlight);
  const profile = useProfileStore((s) => s.profile);
  const upgradeHomeBase = useProfileStore((s) => s.upgradeHomeBase);
  const aircraft = resolveAircraft(profile.currentBuild);
  const homeBaseBenefits = getHomeBaseBenefits(profile.homeBase);
  const pilotRank = getPilotRank(profile.reputation);
  const nextPilotRank = getNextPilotRank(profile.reputation);

  const runwayCost = (profile.homeBase.runwayLevel + 1) * 300 - 100;
  const hangarCost = (profile.homeBase.hangarLevel + 1) * 300 - 100;

  const flyFirstAvailable = () => {
    const mission = getNextAvailableMission(profile);
    if (!mission) {
      selectFreeFlight('the_range');
      goTo('run');
      return;
    }
    selectMission(mission.id);
    // Give a first-time player the contract objective, reward and landing target
    // before handing them the controls. The map already follows this route, so the
    // primary hangar CTA should not bypass the playable mission loop.
    goTo('briefing');
  };

  return (
    <div className="screen hangar-screen">
      <header className="hangar-header">
        <BrandMark />
        <div className="resource-cluster" aria-label="Recursos">
          <div className="resource-pill"><UiIcon name="cash" size={15}/>${profile.cash.toFixed(0)}</div>
          <div className="resource-pill"><UiIcon name="research" size={15}/>{profile.researchPoints} RP</div>
          <div className="resource-pill"><UiIcon name="salvage" size={15}/>{profile.salvage}</div>
        </div>
      </header>

      <main className="hangar-layout">
        <section className="hangar-hero">
          <div className="hangar-grid" aria-hidden="true" />
          <div className="aircraft-silhouette" aria-hidden="true"><HangarAircraft /></div>
          <div className="hangar-eyebrow">AERONAVE ACTIVA · {pilotRank.name.toUpperCase()} · REP {profile.reputation.toFixed(1)}{nextPilotRank ? ` · SIGUIENTE: ${nextPilotRank.name} (${nextPilotRank.minimumReputation})` : ' · RANGO MÁXIMO'}</div>
          <h1>{aircraft.frame.name}</h1>
          <p className="hangar-stats">{aircraft.totalMassKg.toFixed(0)} kg <i/> {aircraft.engine?.name ?? 'SIN MOTOR'} <i/> {aircraft.fuelCapacityL} L</p>
          <button className="fly-cta" onClick={flyFirstAvailable}><UiIcon name="flight" size={21}/> VOLAR AHORA <UiIcon name="chevron" size={18}/></button>
          <span className="hangar-caption">LISTO PARA PISTA · CONDICIÓN OPERATIVA</span>
        </section>

        <section className="home-base-panel">
          <div className="panel-kicker">INSTALACIONES</div>
          <h2 className="home-base-title">Base Aérea</h2>
        <div className="home-base-row">
          <span className="home-base-label">Pista nivel {profile.homeBase.runwayLevel}</span>
          <button
            className="home-base-upgrade-btn"
            onClick={() => upgradeHomeBase('runway', runwayCost)}
            disabled={profile.cash < runwayCost || profile.homeBase.runwayLevel >= MAX_HOME_BASE_LEVEL}
          >
            {profile.homeBase.runwayLevel >= MAX_HOME_BASE_LEVEL ? 'MÁXIMO' : `Mejorar ($${runwayCost})`}
          </button>
          <small className="home-base-benefit">Pista más suave: −{Math.round(homeBaseBenefits.runwayRoughnessReduction * 100)}% rugosidad</small>
        </div>
        <div className="home-base-row">
          <span className="home-base-label">Hangar nivel {profile.homeBase.hangarLevel}</span>
          <button
            className="home-base-upgrade-btn"
            onClick={() => upgradeHomeBase('hangar', hangarCost)}
            disabled={profile.cash < hangarCost || profile.homeBase.hangarLevel >= MAX_HOME_BASE_LEVEL}
          >
            {profile.homeBase.hangarLevel >= MAX_HOME_BASE_LEVEL ? 'MÁXIMO' : `Mejorar ($${hangarCost})`}
          </button>
          <small className="home-base-benefit">Taller: −{Math.round(homeBaseBenefits.repairDiscount * 100)}% reparaciones</small>
        </div>
        </section>
      </main>

      <MenuNavigation goTo={goTo} />
    </div>
  );
}
