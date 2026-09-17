import { useGameStore } from '../../state/gameStore';
import { useProfileStore } from '../../state/profileStore';
import { getRegionMissions, isMissionAvailableToProfile } from '../../content/missions';
import { REGIONS, isRegionUnlocked } from '../../content/regions';
import { getAirfield, getRegionAirfields } from '../../world/airfields';
import { RouteGraph } from '../../world/routePlanner';
import { MenuNavigation } from '../components/MenuNavigation';
import './Screens.css';

// Spec 82.4 Map: region selector + mission cards with best score / rewards preview.
export function MapScreen() {
  const goTo = useGameStore((s) => s.goTo);
  const selectMission = useGameStore((s) => s.selectMission);
  const selectFreeFlight = useGameStore((s) => s.selectFreeFlight);
  const selectedRegionId = useGameStore((s) => s.selectedMapRegionId);
  const selectMapRegion = useGameStore((s) => s.selectMapRegion);
  const profile = useProfileStore((s) => s.profile);

  const region = REGIONS.find((r) => r.id === selectedRegionId) ?? REGIONS[0];
  const missions = getRegionMissions(region.id);
  const airfields = getRegionAirfields(region.id);
  const routeGraph = new RouteGraph();
  const routes = airfields.flatMap((airfield) => routeGraph.neighbors(airfield.id).map((edge) => ({
    from: airfield.name,
    to: getAirfield(edge.toId)?.name ?? edge.toId,
    distanceM: edge.distanceM,
    difficulty: edge.difficulty,
  })));

  return (
    <div className="screen map-screen">
      <header className="screen-header">
        <button className="back-btn" onClick={() => goTo('hangar')}>
          ← Taller
        </button>
        <h2>{region.name}</h2>
      </header>

      {REGIONS.length > 1 && (
        <div className="region-tabs">
          {REGIONS.map((r) => {
            const unlocked = isRegionUnlocked(r, profile);
            return (
              <button
                key={r.id}
                className={`region-tab${r.id === selectedRegionId ? ' region-tab-active' : ''}`}
                disabled={!unlocked}
                onClick={() => selectMapRegion(r.id)}
              >
                {r.name}
                {!unlocked && ' 🔒'}
              </button>
            );
          })}
        </div>
      )}

      <p className="region-desc">{region.description}</p>

      {airfields.length > 0 && (
        <div className="airfield-list">
          {airfields.map((a) => (
            <div key={a.id} className="airfield-chip" title={`${a.runwayLengthM}m · ${a.surface}`}>
              {a.discoveryState === 'known' ? a.name : a.discoveryState === 'hidden' ? '¿ Pista sin descubrir ?' : '¿ Rumor de pista ?'}
            </div>
          ))}
        </div>
      )}

      {routes.length > 0 && (
        <div className="route-list" aria-label="Rutas aéreas">
          <span className="route-list-title">RUTAS AÉREAS</span>
          {routes.map((route) => (
            <div className="route-chip" key={`${route.from}-${route.to}`} title={`Dificultad ${Math.round(route.difficulty * 100)}%`}>
              {route.from} <span>→</span> {route.to} <small>{route.distanceM.toFixed(0)} m</small>
            </div>
          ))}
        </div>
      )}

      <button
        className="free-flight-card"
        onClick={() => {
          selectFreeFlight(region.id);
          goTo('run');
        }}
      >
        <span>✈</span>
        <span><strong>Vuelo libre</strong><small>Explora {region.name} sin objetivo ni límite de tiempo</small></span>
        <span aria-hidden="true">›</span>
      </button>

      <div className="mission-list">
        {missions.length === 0 && (
          <p className="region-desc">Contratos de esta región en preparación. Completa las regiones anteriores para desbloquear su paquete de vuelo.</p>
        )}
        {missions.map((m) => {
          const best = profile.completedMissions[m.id]?.bestScore;
          const locked = !isMissionAvailableToProfile(m, profile);
          return (
            <button
              key={m.id}
              className="mission-card"
              disabled={locked}
              onClick={() => {
                selectMission(m.id);
                goTo('briefing');
              }}
            >
              <div className="mission-card-title">{m.name}</div>
              <div className="mission-card-family">{m.family}</div>
              <div className="mission-card-reward">${m.rewardBaseCash} · {m.rewardBaseRp} RP</div>
              {best !== undefined && <div className="mission-card-best">Mejor: {best.toFixed(0)} m</div>}
              {locked && <div className="mission-card-locked">Bloqueada</div>}
            </button>
          );
        })}
      </div>
      <MenuNavigation active="map" goTo={goTo} />
    </div>
  );
}
