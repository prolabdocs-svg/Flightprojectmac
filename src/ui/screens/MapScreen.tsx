import { routeContext, routeFlightPlan } from '../../mission/route';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useGameStore } from '../../state/gameStore';
import { useProfileStore } from '../../state/profileStore';
import { REGIONS } from '../../content/regions';
import { isMissionAvailableToProfile } from '../../content/missions';
import { estimatePerformance } from '../../sim/performance';
import { getDestinationStatuses, getOffers, operationsRegionId } from '../../mission/operations';
import { ROUTE_FACTOR } from '../../mission/planning';
import { archetypeLabel } from '../../mission/labels';
import { resolveAircraft } from '../../content/assembly';
import { OpsDestinationPanel, type OpsPanelPlan } from '../components/OpsDestinationPanel';
import { classifyRange, COMFORTABLE_FRACTION, contractsForAirfield, flightTimeS, getMapTargets, getMasterAirRoutes, getMasterMapTargets, getOrigin, getRegionAirRoutes, regionTerrain, routeTags, sampleRouteProfile, usableRangeKm, formatDistance, type MapTarget } from '../../map/mapPlan';
import { distanceM, type Insets } from '../../map/mapProjection';
import { buildFlightPlan } from '../../nav/flightPlan';
import { getAirfield } from '../../world/airfields';
import { airfieldKnowledge, chartedFog } from '../../world/exploration';
import { getMasterTerrain } from '../../world/master/masterRuntime';
import { MASTER_MAP_ID } from '../../map/masterMapGeography';
import type { TerrainQueryService } from '../../world/terrainQuery';
import { MenuNavigation } from '../components/MenuNavigation';
import { UiIcon } from '../components/UiIcon';
import { WorldMapCanvas, type WorldMapHandle } from '../components/WorldMapCanvas';
import { MapDestinationPanel, type PanelPlan } from '../components/MapDestinationPanel';
import './Screens.css';
import './MapScreen.css';

const NO_INSETS: Insets = { left: 0, right: 0, top: 0, bottom: 0 };
const worldTerrain: TerrainQueryService = {
  getElevation: (x, z) => getMasterTerrain().groundAt(x, z),
  getSlopeDeg: (x, z) => getMasterTerrain().slopeDegAt(x, z),
  getSurfaceId: (x, z) => getMasterTerrain().surfaceAt(x, z),
  getWaterDepth: (x, z) => getMasterTerrain().waterAt(x, z)?.depthM ?? 0,
  isOnGradedRunway: () => false,
  getBiomeWeights: () => ({ temperate_grassland: 1 }),
  sample: (x, z) => {
    const w = getMasterTerrain();
    const elevationM = w.groundAt(x, z), slopeDeg = w.slopeDegAt(x, z), surfaceId = w.surfaceAt(x, z), waterDepthM = w.waterAt(x, z)?.depthM ?? 0;
    const biomeWeights = { temperate_grassland: 1 };
    return { elevationM, slopeDeg, surfaceId, waterDepthM, dominantBiomeId: 'temperate_grassland', biomeWeights, emergencyLandingSuitability: waterDepthM > 0 ? 0 : Math.max(0, 1 - slopeDeg / 45) };
  },
};
const createWorldTerrain = () => worldTerrain;

// The map is the interface: geography + range + destination panel. Contracts hang off destinations.
export function MapScreen() {
  const goTo = useGameStore((s) => s.goTo);
  const selectMission = useGameStore((s) => s.selectMission);
  const selectWorldStart = useGameStore((s) => s.selectWorldStart);
  const savedMapView = useGameStore((s) => s.mapViews.master);
  const setMapView = useGameStore((s) => s.setMapView);
  const selectionId = useGameStore((s) => s.mapSelectionId);
  const setSelection = useGameStore((s) => s.setMapSelection);
  const profile = useProfileStore((s) => s.profile);
  const abandonMission = useProfileStore((s) => s.abandonMission);

  // The map is one continuous world chart. Keep the old store field as a view-state adapter
  // while older saves/UI state migrate.
  const isWorldMap = true;
  const region = REGIONS[0];
  const mapRef = useRef<WorldMapHandle>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const [insets, setInsets] = useState<Insets>(NO_INSETS);
  const [contractId, setContractId] = useState<string | null>(null);
  const mapView = savedMapView;

  // Operations region = where the aircraft is parked. There the mission domain is the ONLY authority for
  // range, availability and contracts; other regions keep the legacy campaign view until the world graph spans them.
  const isOps = !isWorldMap && region.id === operationsRegionId(profile);
  const ops = profile.operations;
  const statuses = useMemo(() => (isOps ? getDestinationStatuses(profile) : []), [profile, isOps]);
  const offers = useMemo(() => (isOps ? getOffers(profile) : []), [profile, isOps]);
  const perf = useMemo(() => estimatePerformance(profile.currentBuild), [profile.currentBuild]);
  const legacyUsableKm = usableRangeKm(perf.rangeKm);
  const statusFor = (id: string) => statuses.find((s) => s.airfieldId === id) ?? null;
  const rawTargets = useMemo(() => isWorldMap ? getMasterMapTargets() : getMapTargets(region.id), [region.id, isWorldMap]);
  // Knowledge comes from the save: known = visible on the map, visited = landed there (marked with a check).
  // World chart = Fog of Discovery: UNKNOWN fields are not drawn, SIGHTED ones are an unnamed strip,
  // DISCOVERED ones carry their name, VISITED ones a check.
  const fog = useMemo(() => (isWorldMap ? chartedFog(ops.exploration, ops) : null), [isWorldMap, ops]);
  const targets = useMemo(() => {
    if (isWorldMap) return rawTargets.flatMap((t) => {
      const k = airfieldKnowledge(t.id, ops.exploration, ops);
      if (k === 'UNKNOWN') return [];
      return [{ ...t, revealed: k !== 'SIGHTED', name: k === 'VISITED' && t.id !== ops.locationId ? `${t.name} ✓` : t.name }];
    });
    return isOps
      ? rawTargets.map((t) => (t.kind === 'airfield' ? { ...t, revealed: ops.knownAirfieldIds.includes(t.id), name: ops.visitedAirfieldIds.includes(t.id) && t.id !== ops.locationId ? `${t.name} ✓` : t.name } : t))
      : rawTargets;
  }, [rawTargets, isOps, isWorldMap, ops]);
  const originId = ops.locationId || getOrigin('the_field')?.id;
  const origin = useMemo(() => {
    const parked = rawTargets.find((t) => t.id === originId) ?? rawTargets.find((t) => t.id === getOrigin('the_field')?.id);
    return parked ? { ...parked, revealed: true } : null;
  }, [rawTargets, originId]);
  const selectedForRange = statusFor(selectionId ?? '');
  // Range ring: the planner's usable range for the selected route (or the first known one), as straight-line metres.
  const usableKm = isOps
    ? ((selectedForRange ?? statuses[0])?.assessment.plan.range.usableKm ?? 0) / ROUTE_FACTOR
    : legacyUsableKm;
  const range = useMemo(() => ({ usableM: usableKm * 1000, comfortableM: usableKm * 1000 * COMFORTABLE_FRACTION }), [usableKm]);
  const routes = useMemo(() => (isWorldMap ? getMasterAirRoutes() : getRegionAirRoutes(region.id)).flatMap((r) => {
    const from = targets.find((t) => t.id === r.fromId), to = targets.find((t) => t.id === r.toId);
    return from && to ? [{ from, to }] : [];
  }), [targets, region.id, isWorldMap]);

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
  const worldSelected = isWorldMap ? selected : null;

  const plan = useMemo<PanelPlan | null>(() => {
    if (!selected || isOps) return null;
    const terrain = isWorldMap ? createWorldTerrain() : regionTerrain(region.id);
    const dM = origin ? distanceM(origin.x, origin.z, selected.x, selected.z) : 0;
    const profileLine = origin && selected.id !== origin.id ? sampleRouteProfile(terrain, [origin.x, origin.z], [selected.x, selected.z]) : null;
    return {
      target: selected, origin, distanceM: dM, timeS: flightTimeS(dM, perf.cruiseSpeedKmh), elevationM: terrain.getElevation(selected.x, selected.z),
      status: origin && selected.id !== origin.id ? statusOf(selected) : null, usableKm: legacyUsableKm, profile: profileLine,
      tags: profileLine ? routeTags(profileLine, selected, terrain) : selected.airfield ? routeTags(sampleRouteProfile(terrain, [selected.x, selected.z], [selected.x, selected.z], 2), selected, terrain) : [],
      contracts: selected.airfield && !isWorldMap ? contractsForAirfield(region.id, selected.airfield.id) : [],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, origin, perf, legacyUsableKm, region.id, isOps, isWorldMap]);

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
  // Same FlightPlan the flight will fly: only charted (revealed) destinations get a planned route.
  const via = useMemo(() => {
    if (!isOps || !origin || !selected?.airfield || !selected.revealed || selected.id === origin.id) return undefined;
    return routeFlightPlan(routeContext(origin.id, selected.id), ops.knownAirfieldIds).points.slice(1, -1);
  }, [isOps, origin, selected, ops.knownAirfieldIds]);
  const contractTarget = shownContract?.targetPoint ? { x: shownContract.targetPoint[0], z: shownContract.targetPoint[2], radiusM: shownContract.targetRadiusM ?? 20 } : null;
  const missionVia = useMemo(() => {
    if (!shownContract?.targetPoint) return undefined;
    const destinationAirfieldId = 'destinationAirfieldId' in shownContract && typeof shownContract.destinationAirfieldId === 'string' ? shownContract.destinationAirfieldId : undefined;
    const destinationField = destinationAirfieldId ? getAirfield(destinationAirfieldId) : undefined;
    const destinationKnown = destinationField ? ops.knownAirfieldIds.includes(destinationField.id) || destinationField.discoveryState === 'known' : true;
    const routePlan = buildFlightPlan(
      { id: origin?.id ?? 'origin', label: origin?.name ?? 'Salida', known: true, x: origin?.x ?? shownContract.spawnPoint[0], z: origin?.z ?? shownContract.spawnPoint[2] },
      { id: destinationField?.id ?? shownContract.id, label: destinationField?.name ?? shownContract.name, known: destinationKnown, x: shownContract.targetPoint[0], z: shownContract.targetPoint[2] },
      { elevationAt: (x, z) => regionTerrain(shownContract.regionId).getElevation(x, z), runway: destinationField ? {
        id: destinationField.id, label: destinationField.name, x: shownContract.targetPoint![0], z: shownContract.targetPoint![2],
        elevationM: regionTerrain(shownContract.regionId).getElevation(shownContract.targetPoint![0], shownContract.targetPoint![2]),
        lengthM: destinationField.runwayLengthM, widthM: destinationField.runwayWidthM, headingDeg: 0,
      } : undefined },
    );
    return routePlan.points.slice(1, -1);
  }, [shownContract, origin, ops.knownAirfieldIds]);

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
  }, [plan?.target.id, opsPlan?.target.id, worldSelected?.id]);

  return (
    <div className="screen map-screen">
      <header className="map-topbar">
        <button className="back-btn" onClick={() => goTo('hangar')}>← Taller</button>
        <div className="map-title">
          <h2>{isWorldMap ? 'Mapa mundial' : region.name}</h2>
          <p title={isWorldMap ? 'Lo no volado sigue bajo las nubes' : region.description}>{isWorldMap ? 'Carta de exploración · lo no volado sigue bajo las nubes' : region.description}</p>
        </div>
        <button className="map-free-flight" onClick={() => {
          selectWorldStart(ops.locationId || 'field_home', getAirfield(ops.locationId || 'field_home')?.regionId ?? 'the_field'); goTo('run');
        }}>
          <UiIcon name="flight" size={16} /> Vuelo libre
        </button>
      </header>

      <div className="map-stage" ref={stageRef}>
      <WorldMapCanvas
          key={MASTER_MAP_ID}
          ref={mapRef}
          regionId={MASTER_MAP_ID}
          targets={targets}
          origin={origin}
          originHeadingDeg={0}
          routes={routes}
          range={range}
          statusOf={statusOf}
          selectedId={selected?.id ?? null}
          contractTarget={contractTarget}
          via={missionVia ?? via}
          insets={insets}
          initialView={mapView}
          onViewChange={(v) => setMapView('master', v)}
          onSelect={setSelection}
          fog={fog}
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
        {!plan && !opsPlan && !worldSelected && <span className="wmap-hint">Explora desde la base y descubre rutas al volar</span>}

        {worldSelected?.airfield && (
          <aside className="wmap-panel" ref={panelRef} aria-label={`Aeródromo: ${worldSelected.name}`}>
            <header>
              <div><span className="wmap-kicker">{worldSelected.revealed ? worldSelected.airfield.regionId.replaceAll('_', ' ') : 'Avistada desde el aire'}</span><h3>{worldSelected.revealed ? worldSelected.name : 'Pista sin descubrir'}</h3></div>
              <button className="wmap-close" onClick={() => setSelection(null)} aria-label="Cerrar destino">×</button>
            </header>
            <dl className="wmap-stats">
              {origin && origin.id !== worldSelected.id && <div><dt>Desde tu base</dt><dd>{formatDistance(distanceM(origin.x, origin.z, worldSelected.x, worldSelected.z))}</dd></div>}
              {worldSelected.revealed && <div><dt>Pista</dt><dd>{worldSelected.airfield.surface} · {worldSelected.airfield.runwayLengthM} m</dd></div>}
              {worldSelected.revealed && <div><dt>Elevación</dt><dd>{Math.round(worldSelected.airfield.position[1])} m</dd></div>}
            </dl>
            <p className="wmap-note">{worldSelected.revealed ? 'Aeródromo descubierto. Puedes comenzar aquí en vuelo libre.' : 'Solo una franja vista a lo lejos. Vuela bajo y cerca para identificarla.'}</p>
            {worldSelected.revealed && <button className="primary-btn" onClick={() => {
              selectWorldStart(worldSelected.id, worldSelected.airfield!.regionId); goTo('run');
            }}>
              Volar a {worldSelected.airfield!.name}
            </button>}
          </aside>
        )}

        {ops.active && isOps && (
          <div className="wmap-active" role="status" data-testid="active-contract">
            <span><b>{archetypeLabel(ops.active.contract.archetype)}</b> · {ops.active.contract.title}</span>
            <button className="secondary-btn" onClick={() => { selectMission(ops.active!.contract.id); goTo('briefing'); }}>Continuar</button>
            {(ops.active.session.state === 'ACCEPTED' || ops.active.session.state === 'PREPARED') && <button className="secondary-btn" onClick={() => abandonMission()}>Cancelar</button>}
          </div>
        )}

        {opsPlan && !isWorldMap && (
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
