import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useGameStore } from '../../state/gameStore';
import { useProfileStore } from '../../state/profileStore';
import { REGIONS, isRegionUnlocked } from '../../content/regions';
import { isMissionAvailableToProfile } from '../../content/missions';
import { estimatePerformance } from '../../sim/performance';
import { getDestinationStatuses, getOffers, operationsRegionId } from '../../mission/operations';
import { ROUTE_FACTOR } from '../../mission/planning';
import { archetypeLabel } from '../../mission/labels';
import { resolveAircraft } from '../../content/assembly';
import { OpsDestinationPanel, type OpsPanelPlan } from '../components/OpsDestinationPanel';
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
  const abandonMission = useProfileStore((s) => s.abandonMission);

  const region = REGIONS.find((r) => r.id === selectedRegionId) ?? REGIONS[0];
  const mapRef = useRef<WorldMapHandle>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const [insets, setInsets] = useState<Insets>(NO_INSETS);
  const [contractId, setContractId] = useState<string | null>(null);

  // Operations region = where the aircraft is parked. There the mission domain is the ONLY authority for
  // range, availability and contracts; other regions keep the legacy campaign view until the world graph spans them.
  const isOps = region.id === operationsRegionId(profile);
  const ops = profile.operations;
  const statuses = useMemo(() => (isOps ? getDestinationStatuses(profile) : []), [profile, isOps]);
  const offers = useMemo(() => (isOps ? getOffers(profile) : []), [profile, isOps]);
  const perf = useMemo(() => estimatePerformance(profile.currentBuild), [profile.currentBuild]);
  const legacyUsableKm = usableRangeKm(perf.rangeKm);
  const statusFor = (id: string) => statuses.find((s) => s.airfieldId === id) ?? null;
  const rawTargets = useMemo(() => getMapTargets(region.id), [region.id]);
  // Knowledge comes from the save: known = visible on the map, visited = landed there (marked with a check).
  const targets = useMemo(() => (isOps
    ? rawTargets.map((t) => (t.kind === 'airfield' ? { ...t, revealed: ops.knownAirfieldIds.includes(t.id), name: ops.visitedAirfieldIds.includes(t.id) && t.id !== ops.locationId ? `${t.name} ✓` : t.name } : t))
    : rawTargets), [rawTargets, isOps, ops.knownAirfieldIds, ops.visitedAirfieldIds, ops.locationId]);
  const origin = useMemo(() => targets.find((t) => t.id === (isOps ? ops.locationId : getOrigin(region.id)?.id)) ?? null, [targets, region.id, isOps, ops.locationId]);
  const selectedForRange = statusFor(selectionId ?? '');
  // Range ring: the planner's usable range for the selected route (or the first known one), as straight-line metres.
  const usableKm = isOps
    ? ((selectedForRange ?? statuses[0])?.assessment.plan.range.usableKm ?? 0) / ROUTE_FACTOR
    : legacyUsableKm;
  const range = useMemo(() => ({ usableM: usableKm * 1000, comfortableM: usableKm * 1000 * COMFORTABLE_FRACTION }), [usableKm]);
  const routes = useMemo(() => getRegionAirRoutes(region.id).flatMap((r) => {
    const from = targets.find((t) => t.id === r.fromId), to = targets.find((t) => t.id === r.toId);
    return from && to ? [{ from, to }] : [];
  }), [targets, region.id]);

  const statusOf = (t: MapTarget) => {
    if (!origin || t.id === origin.id) return null;
    if (isOps) {
      const st = statusFor(t.id);
      if (st) return ({ REACHABLE: 'comfortable', MARGINAL: 'marginal', OUT_OF_RANGE: 'insufficient' } as const)[st.assessment.reach];
      return classifyRange((distanceM(origin.x, origin.z, t.x, t.z) / 1000) * ROUTE_FACTOR, usableKm * ROUTE_FACTOR); // reference points: same planner range
    }
    return classifyRange(distanceM(origin.x, origin.z, t.x, t.z) / 1000, legacyUsableKm);
  };
  const selected = targets.find((t) => t.id === selectionId) ?? null;

  const plan = useMemo<PanelPlan | null>(() => {
    if (!selected || isOps) return null;
    const terrain = regionTerrain(region.id);
    const dM = origin ? distanceM(origin.x, origin.z, selected.x, selected.z) : 0;
    const profileLine = origin && selected.id !== origin.id ? sampleRouteProfile(terrain, [origin.x, origin.z], [selected.x, selected.z]) : null;
    return {
      target: selected, origin, distanceM: dM, timeS: flightTimeS(dM, perf.cruiseSpeedKmh), elevationM: terrain.getElevation(selected.x, selected.z),
      status: origin && selected.id !== origin.id ? statusOf(selected) : null, usableKm: legacyUsableKm, profile: profileLine,
      tags: profileLine ? routeTags(profileLine, selected, terrain) : selected.airfield ? routeTags(sampleRouteProfile(terrain, [selected.x, selected.z], [selected.x, selected.z], 2), selected, terrain) : [],
      contracts: selected.airfield ? contractsForAirfield(region.id, selected.airfield.id) : [],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, origin, perf, legacyUsableKm, region.id, isOps]);

  const opsPlan = useMemo<OpsPanelPlan | null>(() => {
    if (!selected || !isOps) return null;
    const terrain = regionTerrain(region.id);
    const line = origin && selected.id !== origin.id ? sampleRouteProfile(terrain, [origin.x, origin.z], [selected.x, selected.z]) : null;
    return {
      target: selected, origin, status: statusFor(selected.id), offers: offers.filter((o) => o.contract.destinationId === selected.id),
      known: selected.revealed, visited: ops.visitedAirfieldIds.includes(selected.id), elevationM: terrain.getElevation(selected.x, selected.z),
      profile: line, tags: line ? routeTags(line, selected, terrain) : [], fuelOnBoardL: ops.fuelL, fuelCapacityL: resolveAircraft(profile.currentBuild).fuelCapacityL,
      reference: !statusFor(selected.id) && origin && selected.id !== origin.id ? (() => {
        const st = statusOf(selected);
        const dKm = distanceM(origin.x, origin.z, selected.x, selected.z) / 1000;
        return st ? { reach: ({ comfortable: 'REACHABLE', marginal: 'MARGINAL', insufficient: 'OUT_OF_RANGE' } as const)[st], distanceKm: dKm, usableKm } : null;
      })() : null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, origin, statuses, offers, isOps, ops.fuelL, ops.visitedAirfieldIds]);
  const [opsContractId, setOpsContractId] = useState<string | null>(null);
  useEffect(() => { setOpsContractId(opsPlan?.offers.find((o) => o.available)?.contract.id ?? opsPlan?.offers[0]?.contract.id ?? null); }, [opsPlan?.target.id, opsPlan?.offers.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const opsContract = offers.find((o) => o.contract.id === opsContractId)?.contract ?? null;

  // Default the highlighted contract to the first one the profile can take.
  useEffect(() => { setContractId(plan?.contracts.find((m) => isMissionAvailableToProfile(m, profile))?.id ?? null); }, [plan?.target.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const contract = plan?.contracts.find((m) => m.id === contractId);
  const shownContract = isOps ? opsContract?.mission : contract;
  const contractTarget = shownContract?.targetPoint ? { x: shownContract.targetPoint[0], z: shownContract.targetPoint[2], radiusM: shownContract.targetRadiusM ?? 20 } : null;

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
  }, [plan?.target.id, opsPlan?.target.id]);

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
        {!plan && !opsPlan && <span className="wmap-hint">Toca una pista o un lugar para planear la ruta</span>}

        {ops.active && isOps && (
          <div className="wmap-active" role="status" data-testid="active-contract">
            <span><b>{archetypeLabel(ops.active.contract.archetype)}</b> · {ops.active.contract.title}</span>
            <button className="secondary-btn" onClick={() => { selectMission(ops.active!.contract.id); goTo('briefing'); }}>Continuar</button>
            {(ops.active.session.state === 'ACCEPTED' || ops.active.session.state === 'PREPARED') && <button className="secondary-btn" onClick={() => abandonMission()}>Cancelar</button>}
          </div>
        )}

        {opsPlan && (
          <OpsDestinationPanel
            plan={opsPlan}
            contractId={opsContractId}
            onContract={setOpsContractId}
            onPlan={(id) => { selectMission(id); goTo('briefing'); }}
            onWorkshop={() => goTo('builder')}
            onClose={() => setSelection(null)}
            panelRef={panelRef}
          />
        )}

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
