import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useGameStore } from '../../state/gameStore';
import { useProfileStore } from '../../state/profileStore';
import { REGIONS, isRegionUnlocked } from '../../content/regions';
import { isMissionAvailableToProfile } from '../../content/missions';
import { estimatePerformance } from '../../sim/performance';
import { classifyRange, COMFORTABLE_FRACTION, contractsForAirfield, flightTimeS, getMapTargets, getOrigin, getRegionAirRoutes, regionTerrain, routeTags, sampleRouteProfile, usableRangeKm, formatDistance, type MapTarget } from '../../map/mapPlan';
import { distanceM, type Insets } from '../../map/mapProjection';
import { MenuNavigation } from '../components/MenuNavigation';
import { UiIcon } from '../components/UiIcon';
import { WorldMapCanvas, type WorldMapHandle } from '../components/WorldMapCanvas';
import { MapDestinationPanel, type PanelPlan } from '../components/MapDestinationPanel';
import './Screens.css';
import './MapScreen.css';

const NO_INSETS: Insets = { left: 0, right: 0, top: 0, bottom: 0 };

// The map is the interface: geography + range + destination panel. Contracts hang off destinations.
export function MapScreen() {
  const goTo = useGameStore((s) => s.goTo);
  const selectMission = useGameStore((s) => s.selectMission);
  const selectFreeFlight = useGameStore((s) => s.selectFreeFlight);
  const selectedRegionId = useGameStore((s) => s.selectedMapRegionId);
  const selectMapRegion = useGameStore((s) => s.selectMapRegion);
  const mapView = useGameStore((s) => s.mapViews[s.selectedMapRegionId]);
  const setMapView = useGameStore((s) => s.setMapView);
  const selectionId = useGameStore((s) => s.mapSelectionId);
  const setSelection = useGameStore((s) => s.setMapSelection);
  const profile = useProfileStore((s) => s.profile);

  const region = REGIONS.find((r) => r.id === selectedRegionId) ?? REGIONS[0];
  const mapRef = useRef<WorldMapHandle>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const [insets, setInsets] = useState<Insets>(NO_INSETS);
  const [contractId, setContractId] = useState<string | null>(null);

  const perf = useMemo(() => estimatePerformance(profile.currentBuild), [profile.currentBuild]);
  const usableKm = usableRangeKm(perf.rangeKm);
  const range = useMemo(() => ({ usableM: usableKm * 1000, comfortableM: usableKm * 1000 * COMFORTABLE_FRACTION }), [usableKm]);
  const targets = useMemo(() => getMapTargets(region.id), [region.id]);
  const origin = useMemo(() => targets.find((t) => t.id === getOrigin(region.id)?.id) ?? null, [targets, region.id]);
  const routes = useMemo(() => getRegionAirRoutes(region.id).flatMap((r) => {
    const from = targets.find((t) => t.id === r.fromId), to = targets.find((t) => t.id === r.toId);
    return from && to ? [{ from, to }] : [];
  }), [targets, region.id]);

  const statusOf = (t: MapTarget) => origin ? classifyRange(distanceM(origin.x, origin.z, t.x, t.z) / 1000, usableKm) : null;
  const selected = targets.find((t) => t.id === selectionId) ?? null;

  const plan = useMemo<PanelPlan | null>(() => {
    if (!selected) return null;
    const terrain = regionTerrain(region.id);
    const dM = origin ? distanceM(origin.x, origin.z, selected.x, selected.z) : 0;
    const profileLine = origin && selected.id !== origin.id ? sampleRouteProfile(terrain, [origin.x, origin.z], [selected.x, selected.z]) : null;
    return {
      target: selected, origin, distanceM: dM, timeS: flightTimeS(dM, perf.cruiseSpeedKmh), elevationM: terrain.getElevation(selected.x, selected.z),
      status: origin && selected.id !== origin.id ? statusOf(selected) : null, usableKm, profile: profileLine,
      tags: profileLine ? routeTags(profileLine, selected, terrain) : selected.airfield ? routeTags(sampleRouteProfile(terrain, [selected.x, selected.z], [selected.x, selected.z], 2), selected, terrain) : [],
      contracts: selected.airfield ? contractsForAirfield(region.id, selected.airfield.id) : [],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, origin, perf, usableKm, region.id]);

  // Default the highlighted contract to the first one the profile can take.
  useEffect(() => { setContractId(plan?.contracts.find((m) => isMissionAvailableToProfile(m, profile))?.id ?? null); }, [plan?.target.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const contract = plan?.contracts.find((m) => m.id === contractId);
  const contractTarget = contract?.targetPoint ? { x: contract.targetPoint[0], z: contract.targetPoint[2], radiusM: contract.targetRadiusM ?? 20 } : null;

  // Tell the canvas how much of the stage the panel hides, so routes stay visible beside/above it.
  useLayoutEffect(() => {
    const panel = panelRef.current, stage = stageRef.current;
    if (!panel || !stage) { setInsets((i) => (i.right || i.bottom ? NO_INSETS : i)); return; }
    const measure = () => {
      const p = panel.getBoundingClientRect(), s = stage.getBoundingClientRect();
      const side = p.width < s.width * 0.7;
      const next: Insets = side ? { ...NO_INSETS, right: Math.round(s.right - p.left + 6) } : { ...NO_INSETS, bottom: Math.round(s.bottom - p.top + 6) };
      setInsets((i) => (i.right === next.right && i.bottom === next.bottom ? i : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(panel); ro.observe(stage);
    return () => ro.disconnect();
  }, [plan?.target.id]);

  return (
    <div className="screen map-screen">
      <header className="map-topbar">
        <button className="back-btn" onClick={() => goTo('hangar')}>← Taller</button>
        <div className="map-title">
          <h2>{region.name}</h2>
          <p title={region.description}>{region.description}</p>
        </div>
        {REGIONS.length > 1 && (
          <div className="region-tabs" role="tablist" aria-label="Regiones">
            {REGIONS.map((r) => {
              const unlocked = isRegionUnlocked(r, profile);
              return (
                <button key={r.id} role="tab" aria-selected={r.id === selectedRegionId} className={`region-tab${r.id === selectedRegionId ? ' region-tab-active' : ''}`}
                  disabled={!unlocked} onClick={() => selectMapRegion(r.id)}>
                  {r.name}{!unlocked && ' 🔒'}
                </button>
              );
            })}
          </div>
        )}
        <button className="map-free-flight" onClick={() => { selectFreeFlight(region.id); goTo('run'); }}>
          <UiIcon name="flight" size={16} /> Vuelo libre
        </button>
      </header>

      <div className="map-stage" ref={stageRef}>
        <WorldMapCanvas
          key={region.id}
          ref={mapRef}
          regionId={region.id}
          targets={targets}
          origin={origin}
          originHeadingDeg={0}
          routes={routes}
          range={range}
          statusOf={statusOf}
          selectedId={selected?.id ?? null}
          contractTarget={contractTarget}
          insets={insets}
          initialView={mapView}
          onViewChange={(v) => setMapView(region.id, v)}
          onSelect={setSelection}
        />

        <div className="wmap-hud">
          <span className="wmap-compass" role="img" aria-label="Norte arriba"><i />N</span>
          <span className="wmap-chip" title="Alcance estimado con reserva, según el avión actual">
            <UiIcon name="flight" size={14} /> ALCANCE <b>{formatDistance(usableKm * 1000)}</b>
          </span>
        </div>
        <div className="wmap-controls">
          <button onClick={() => mapRef.current?.zoomBy(1.6)} aria-label="Acercar">+</button>
          <button onClick={() => mapRef.current?.zoomBy(1 / 1.6)} aria-label="Alejar">−</button>
          <button onClick={() => mapRef.current?.centerHome()} aria-label="Centrar en la base" title="Centrar en la base">⌖</button>
        </div>
        {!plan && <span className="wmap-hint">Toca una pista o un lugar para planear la ruta</span>}

        {plan && (
          <MapDestinationPanel
            plan={plan}
            profile={profile}
            contractId={contractId}
            onContract={setContractId}
            onPlan={() => { if (contractId) { selectMission(contractId); goTo('briefing'); } }}
            onWorkshop={() => goTo('builder')}
            onClose={() => setSelection(null)}
            panelRef={panelRef}
          />
        )}

        <ul className="wmap-sr" aria-label="Destinos">
          {targets.filter((t) => t.kind === 'airfield').map((t) => (
            <li key={t.id}><button onClick={() => setSelection(t.id)}>{t.revealed ? t.name : 'Pista sin descubrir'}</button></li>
          ))}
        </ul>
      </div>
      <MenuNavigation active="map" goTo={goTo} />
    </div>
  );
}
