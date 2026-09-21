import { useGameStore } from '../../state/gameStore';
import { useProfileStore } from '../../state/profileStore';
import { resolveAircraft } from '../../content/assembly';
import { getNextAvailableMission } from '../../content/missions';
import { BrandMark } from '../components/BrandMark';
import { MenuNavigation } from '../components/MenuNavigation';
import { ResourceBar } from '../components/ScreenHeader';
import { PAINT_PRESETS } from '../../content/paint';
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
            <button className="fly-cta" onClick={flyFirstAvailable}><UiIcon name="flight" size={22} /> Volar ahora <UiIcon name="chevron" size={18} /></button>
            <span className="hangar-caption">LISTO PARA PISTA · CONDICIÓN OPERATIVA</span>
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
