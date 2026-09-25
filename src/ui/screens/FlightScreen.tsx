import { getEngineCharacter } from '../../content/engines';
import { useCallback, useEffect, useRef, useState } from 'react';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { useProfileStore } from '../../state/profileStore';
import { useGameStore } from '../../state/gameStore';
import { hasFlaps } from '../../flight/aircraft/aircraftDefinition';
import { useMode2Store, getResolvedControls, stepKeyboardThrottle } from '../../input/mode2Store';
import { mapGamepad } from '../../input/gamepad';
import { resolveAircraft } from '../../content/assembly';
import { isMissionAvailableToProfile } from '../../content/missions';
import { resolveMission } from '../../mission/operations';
import { conditionToPartIntegrity } from '../../mission/damageIntegration';
import { tickContractFlight, concludeContractFlight } from '../../state/contractFlight';
import { PHASE_LABEL, STATE_LABEL } from '../../mission/labels';
import { evaluateMissionReadiness } from '../../content/missionReadiness';
import { getRegion } from '../../content/regions';
import { initPhysics, createWorld } from '../../sim/physics';
import { FlightModel } from '../../flight/flightModel';
import { isFlightDebugEnabled } from '../../flight/flag';
import { FlightRecorder } from '../../flight/telemetry/flightRecorder';
import { FlightGizmos } from '../../render/FlightGizmos';
import { FlightDebugOverlay } from '../components/FlightDebugOverlay';
import { DEFAULT_RUNWAY_CONDITIONS, type FlightTelemetry, type ResolvedControls } from '../../flight/flightTypes';
import { getAirfield, getFreeFlightAirfield, type RunwaySurface } from '../../world/airfields';

/** Roughness (0-1, see landingValidator.ts) per runway surface. Airfields don't store this
 * directly, so it's derived here from surface type — unpaved surfaces are inherently
 * rougher underfoot than tarmac/salt. */
const SURFACE_ROUGHNESS: Record<RunwaySurface, number> = {
  tarmac: 0.1,
  salt: 0.15,
  gravel: 0.35,
  dirt: 0.4,
  grass: 0.3,
};
import { FlightScene } from '../../render/FlightScene';
import { computeFlightResult } from '../../content/economy';
import { getPaint } from '../../content/paint';
import { activateFlightPlan, advancePlan, buildFlightPlan, guidance, guidanceVisibility, goAroundPlan, type FlightPlan, type Guidance } from '../../nav/flightPlan';
import { FlightHud } from '../components/FlightHud';
import { audioService } from '../../audio/audioService';
import { sinkRateToIntensity } from '../../audio/flightAudioMappings';
import { discoverLandmarks } from '../../world/landmarks';

/** Regions flown this app session: the first takeoff in each one plays as 'regionEnter'. */
const visitedMusicRegions = new Set<string>();
import { getEnvironmentWind } from '../../sim/weather';
import { FixedStepClock } from '../../core/fixedStepClock';
import { createTerrainQueryService } from '../../world/terrainQuery';
import { buildHeightGrid, createHeightfieldCollider, FIELD_TERRAIN_SEGMENTS, FIELD_TERRAIN_SIZE_M } from '../../world/terrainHeightfield';
import { getHomeBaseBenefits } from '../../content/homeBase';
import { getRegionObstacles } from '../../world/obstacles';
import { createMasterRegionTerrain, getMasterTerrain } from '../../world/master/masterRuntime';
import { MasterWorldAdapter } from '../../world/master/masterWorldAdapter';
import { uiSound } from '../../audio/uiSound';
import { REGIONS } from '../../content/regions';
import type { ExplorationEvent } from '../../world/exploration';

function describeDiscovery(e: ExplorationEvent): string {
  switch (e.kind) {
    case 'airfield_sighted': return 'Pista avistada';
    case 'airfield_discovered': return `Aeródromo descubierto: ${getAirfield(e.id)?.name ?? e.id}`;
    case 'airfield_visited': return `Primera visita: ${getAirfield(e.id)?.name ?? e.id}`;
    case 'landmark': return `Referencia registrada: ${getMasterTerrain().landmarks().find((l) => l.id === e.id)?.name ?? e.id}`;
    case 'region': return `Nueva región: ${REGIONS.find((r) => r.id === e.id)?.name ?? e.id}`;
  }
}


function masterTerrainForStart(airfieldId: string): string {
  return getAirfield(airfieldId)?.regionId ?? 'the_field';
}

export function FlightScreen() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const controllerRef = useRef<FlightModel | null>(null);
  const sceneRef = useRef<FlightScene | null>(null);
  const recorderRef = useRef(new FlightRecorder());
  const gizmosRef = useRef<FlightGizmos | null>(null);
  const [debugOn, setDebugOn] = useState(isFlightDebugEnabled);
  const debugRef = useRef(debugOn);
  const [gizmosOn, setGizmosOn] = useState(true);
  const gizmosOnRef = useRef(true);
  const endTimerRef = useRef<number | null>(null);
  const paused = useGameStore((s) => s.paused);
  const setPaused = useGameStore((s) => s.setPaused);
  const selectedMissionId = useGameStore((s) => s.selectedMissionId);
  const selectedFreeFlightRegionId = useGameStore((s) => s.selectedFreeFlightRegionId);
  const selectedWorldStartId = useGameStore((s) => s.selectedWorldStartId);
  const goTo = useGameStore((s) => s.goTo);
  const setLastResult = useGameStore((s) => s.setLastResult);
  const profile = useProfileStore((s) => s.profile);
  const applyFlightResult = useProfileStore((s) => s.applyFlightResult);

  const [telemetry, setTelemetry] = useState<FlightTelemetry | null>(null);
  const [nav, setNav] = useState<Guidance | null>(null);
  const [ready, setReady] = useState(false);
  const [fpv, setFpv] = useState(false);
  const [discoveryToast, setDiscoveryToast] = useState<string | null>(null);
  useEffect(() => {
    if (!discoveryToast) return;
    uiSound('discovery');
    const id = window.setTimeout(() => setDiscoveryToast(null), 4500);
    return () => window.clearTimeout(id);
  }, [discoveryToast]);
  useEffect(() => { sceneRef.current?.setFpv(fpv); }, [fpv, ready]);

  // Dynamic contracts resolve through the profile (persisted active contract), not just the static campaign.
  // Resolved once at mount: the contract leaves `active` the moment it is settled, but this flight still ends on it.
  const resolvedRef = useRef<ReturnType<typeof resolveMission> | null>(null);
  if (!resolvedRef.current) resolvedRef.current = resolveMission(profile, selectedMissionId);
  const { mission, contract } = resolvedRef.current;
  const activeRegionId = mission ? mission.regionId : selectedFreeFlightRegionId;
  const activeRegion = getRegion(activeRegionId);
  const missionSession = profile.operations.active?.contract.id === contract?.id ? profile.operations.active?.session ?? null : null;
  const fuelCapacityL = resolveAircraft(profile.currentBuild).fuelCapacityL;

  const getModel = useCallback(() => controllerRef.current, []);

  useEffect(() => {
    debugRef.current = debugOn;
    gizmosOnRef.current = gizmosOn;
    gizmosRef.current?.setVisible(debugOn && gizmosOn);
  }, [debugOn, gizmosOn]);

  useEffect(() => {
    let disposed = false;
    let frameId = 0;
    let release: (() => void) | undefined;
    let fixedDt = 1 / 60;
    let clock = new FixedStepClock(fixedDt, 0.1, 8);
    let lastNow = performance.now();

    async function boot() {
      // Last-resort guard against the map/briefing invariant: a contract the profile
      // hasn't unlocked, or the current build can't reasonably complete, must never
      // actually launch here even if UI navigation/state was bypassed to reach RUN.
      if (contract) {
        // A domain contract only launches from PREPARED: accepted, configured and feasible through the state machine.
        if (profile.operations.active?.contract.id !== contract.id || profile.operations.active.session.state !== 'PREPARED') {
          goTo('briefing');
          return;
        }
      } else if (mission && (!isMissionAvailableToProfile(mission, profile) || !evaluateMissionReadiness(mission, profile.currentBuild).ready)) {
        goTo('briefing');
        return;
      }

      await initPhysics();
      if (disposed || !canvasRef.current) return;

      const world = createWorld();
      // TerrainQueryService (src/world/terrainQuery.ts) is the single authority for ground
      // elevation: WorldEnvironment's visual mesh, this spawn-height calculation, and
      // the flight model's per-tick ground contact (src/flight/ground/) all sample
      // it, so they can never drift apart.
      //
      // Ownership: terrainQuery is the surface; the Rapier heightfield (The Field) is that
      // same surface for rigid-body containment of the airframe's small body collider
      // (AircraftPhysics' 0.3 m ball). Gear, hard points, crash detection and AGL are
      // analytic terrainQuery queries in the flight model, so nothing is double-counted:
      // the body collider only touches terrain once the airframe is already wrecked.
      // Every region keeps a deep flat floor as the last resort.
      // A contract flies in ITS weather (the same wind the planner used), not the region's generic mean.
      const startAreaId = !mission && selectedWorldStartId ? masterTerrainForStart(selectedWorldStartId) : activeRegionId;
      const startArea = getRegion(startAreaId);
      const region = contract
        ? { ...startArea, windBaseMs: contract.weather.windMs, environment: { ...startArea.environment, gustStrengthMs: contract.weather.gustMs } }
        : startArea;
      // PHASE 2C: a campaign-site region with a master-world frame (src/world/master/masterRuntime.ts)
      // gets its terrain/physics from the real streamed master authority instead of the flat safety
      // floor it had before. Two regions are excluded, both to keep single terrain authority (never
      // two ground truths for the same region — see docs/world/PHASE_2C_GAMEPLAY_INTEGRATION.md):
      //   - 'the_field' keeps its own authored/legacy terrain exactly as-is (spec item 6: preserve
      //     the vertical slice).
      const masterTerrain = getMasterTerrain();
      const hasCrossRegionDestination = Boolean(contract && contract.mission.regionId !== getAirfield(contract.destinationId)?.regionId);
      // Free flight is exploration: The Field joins the continuous master world too, so the player can
      // fly out of the basin into unknown regions with no loading screen or teleport.
      const useMasterWorld = masterTerrain.hasFrame(region.id) && (region.id !== 'the_field' || hasCrossRegionDestination || !mission);
      const terrainQuery = useMasterWorld ? createMasterRegionTerrain(region, masterTerrain) : createTerrainQueryService(region);
      const SAFETY_FLOOR_Y = -500;
      const groundDesc = RAPIER.ColliderDesc.cuboid(3000, 0.5, 3000).setTranslation(0, SAFETY_FLOOR_Y - 0.5, 0).setFriction(0.04);
      world.createCollider(groundDesc);
      if (region.environment.terrain === 'meadow') {
        createHeightfieldCollider(RAPIER, world, buildHeightGrid(terrainQuery.getElevation), FIELD_TERRAIN_SIZE_M, FIELD_TERRAIN_SEGMENTS);
      }

      const aircraft = resolveAircraft(profile.currentBuild);
      const freeFlightAirfield = mission ? undefined : getFreeFlightAirfield(region.id);
      const worldStartField = !mission && selectedWorldStartId ? masterTerrain.airfield(selectedWorldStartId) : undefined;
      if (worldStartField && worldStartField.namedAreaId !== region.id) throw new Error('World start must use its named-area compatibility origin');
      const worldSpawnXZ = worldStartField?.worldPosition ?? (useMasterWorld ? masterTerrain.localToWorld(region.id, freeFlightAirfield?.position[0] ?? 0, freeFlightAirfield?.position[2] ?? 0) : undefined);
      const spawnFrameId = worldStartField?.namedAreaId ?? region.id;
      const localSpawn = worldSpawnXZ && useMasterWorld ? masterTerrain.worldToLocal(spawnFrameId, worldSpawnXZ[0], worldSpawnXZ[1]) : undefined;
      const spawnPoint = mission?.spawnPoint ?? (localSpawn ? [localSpawn[0], 0, localSpawn[1]] as const : freeFlightAirfield?.position ?? ([0, 1.2, 0] as const));
      const spawnGroundY = terrainQuery.getElevation(spawnPoint[0], spawnPoint[2]);
      const spawn = new THREE.Vector3(spawnPoint[0], Math.max(spawnPoint[1], spawnGroundY + 1.2), spawnPoint[2]);
      const guidanceAirfield = mission?.destinationAirfieldId ? getAirfield(mission.destinationAirfieldId) : undefined;
      const destinationAirfield = mission ? guidanceAirfield : undefined;
      // AirfieldDefinition (src/world/airfields.ts, owned by other work) doesn't carry an
      // explicit roughness value, so surface type stands in for it here: unpaved surfaces
      // are inherently rougher than tarmac/salt.
      const runwayAirfield = guidanceAirfield ?? (worldStartField ? getAirfield(worldStartField.id) : freeFlightAirfield);
      const baseRunwayConditions = runwayAirfield
        ? { surface: runwayAirfield.surface, roughness: SURFACE_ROUGHNESS[runwayAirfield.surface] }
        : DEFAULT_RUNWAY_CONDITIONS;
      // Unlinked missions in The Field use the player's upgraded home strip.
      const runwayConditions = !runwayAirfield && region.id === 'the_field'
        ? { ...baseRunwayConditions, roughness: Math.max(0.04, baseRunwayConditions.roughness - getHomeBaseBenefits(profile.homeBase).runwayRoughnessReduction) }
        : baseRunwayConditions;
      const obstacles = getRegionObstacles(region.id, terrainQuery);
      // Persistent damage/wear (mission/aircraftCondition.ts) carries into every flight, contract
      // or free-flight alike — it's the same airframe either way (spec item 3).
      const condition = profile.operations.aircraftCondition;
      const controller = new FlightModel(world, aircraft, profile.currentBuild, spawn, mission?.spawnHeadingDeg ?? 0, terrainQuery, {
        runwayConditions, obstacles, load: contract ? profile.operations.active?.loadout ?? undefined : undefined,
        initialPartIntegrity: condition ? conditionToPartIntegrity(condition, aircraft.aeroSurfaces.map((s) => s.id)) : undefined,
      });
      // The simulation owns its fixed step (PHYSICS_HZ); the clock must match it.
      fixedDt = controller.dtS;
      clock = new FixedStepClock(fixedDt, 0.1, Math.ceil(0.1 / fixedDt) + 2);
      controllerRef.current = controller;

      const paint = getPaint(profile.selectedPaintId);
      const remoteDestination = mission && getAirfield(mission.destinationAirfieldId ?? '')?.regionId !== region.id
        ? { airfield: getAirfield(mission.destinationAirfieldId ?? '')!, position: mission.targetPoint! }
        : undefined;
      const scene = new FlightScene(canvasRef.current, region, paint && {
        fabricColor: paint.fabricColor,
        tubeColor: paint.tubeColor,
      }, profile.currentBuild.frameId, useMasterWorld ? { terrainQuery, skipTerrainMesh: true, remoteDestination } : undefined);
      scene.setPilotAppearance(profile.avatar);
      const navVis = guidanceVisibility(profile.settings.navGuidance);
      // Destination landing zone is itself a world cue: Minimal guidance leaves it to the chart.
      scene.setTargetMarker(navVis.worldDestination && profile.settings.navGuidance !== 'off' ? mission?.targetPoint : undefined, mission?.targetRadiusM ?? 20);
      // The one route model (src/nav): contracts and campaign missions fly the same FlightPlan.
      let navPlan: FlightPlan | null = null;
      if (mission?.targetPoint) {
        const originField = contract ? getAirfield(contract.originId) : undefined;
        const known = !destinationAirfield || destinationAirfield.discoveryState === 'known' || profile.operations.knownAirfieldIds.includes(destinationAirfield.id);
        navPlan = buildFlightPlan(
          { id: originField?.id ?? 'spawn', label: originField?.name ?? 'Salida', known: true, x: spawn.x, z: spawn.z },
          { id: destinationAirfield?.id ?? mission.id, label: destinationAirfield?.name ?? mission.name, known, x: mission.targetPoint[0], z: mission.targetPoint[2] },
          { elevationAt: (x, z) => terrainQuery.getElevation(x, z), runway: destinationAirfield ? {
            id: destinationAirfield.id, label: destinationAirfield.name, x: mission.targetPoint[0], z: mission.targetPoint[2],
            elevationM: terrainQuery.getElevation(mission.targetPoint[0], mission.targetPoint[2]),
            lengthM: destinationAirfield.runwayLengthM, widthM: destinationAirfield.runwayWidthM, headingDeg: 0,
          } : undefined },
        );
      } else if (worldStartField) {
        const targetField = getAirfield(worldStartField.id);
        if (targetField) {
          const [worldX, worldZ] = masterTerrain.localToWorld(spawnFrameId, spawnPoint[0], spawnPoint[2]);
          const [localTargetX, localTargetZ] = masterTerrain.worldToLocal(spawnFrameId, worldX, worldZ);
          const targetPoint = { x: localTargetX, z: localTargetZ };
          const [targetWorldX, targetWorldZ] = masterTerrain.localToWorld(spawnFrameId, targetField.position[0], targetField.position[2]);
          const [targetX, targetZ] = masterTerrain.worldToLocal(spawnFrameId, targetWorldX, targetWorldZ);
          navPlan = buildFlightPlan(
            { id: `start_${targetField.id}`, label: targetField.name, known: true, x: targetPoint.x, z: targetPoint.z },
            { id: targetField.id, label: targetField.name, known: true, x: targetX, z: targetZ },
            { elevationAt: (x, z) => terrainQuery.getElevation(x, z), runway: { id: targetField.id, label: targetField.name, x: targetX, z: targetZ,
              elevationM: terrainQuery.getElevation(targetX, targetZ), lengthM: targetField.runwayLengthM, widthM: targetField.runwayWidthM, headingDeg: 0 } },
          );
        }
      }
      sceneRef.current = scene;
      // PHASE 2C: real THREE.Scene + real Rapier.World wiring for MasterStreamingRuntime (see
      // masterWorldAdapter.ts for why region-local coordinates, not master-world-absolute ones).
      const masterWorld = useMasterWorld ? new MasterWorldAdapter(region, scene.scene, RAPIER, world, masterTerrain) : null;
      {
        const gizmos = new FlightGizmos(scene.scene);
        gizmos.setVisible(debugRef.current && gizmosOnRef.current);
        gizmosRef.current = gizmos;
      }

      // React dev mode may tear this effect down while the asynchronous physics
      // bootstrap is resolving. Install ownership cleanup before scheduling any
      // listeners or animation work so a stale boot can never leave a live world.
      let cleaned = false;
      release = () => {
        if (cleaned) return;
        cleaned = true;
        cancelAnimationFrame(frameId);
        window.removeEventListener('resize', resize);
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('blur', onInputBlur);
        if (controllerRef.current === controller) controllerRef.current = null;
        if (sceneRef.current === scene) sceneRef.current = null;
        gizmosRef.current?.dispose();
        gizmosRef.current = null;
        masterWorld?.dispose();
        scene.dispose();
        world.free();
        audioService.stopFlight();
        if (import.meta.env.DEV) delete (window as unknown as { __pf?: unknown }).__pf;
      };

      const resize = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const { clientWidth, clientHeight } = canvas;
        scene.resize(clientWidth || window.innerWidth, clientHeight || window.innerHeight);
      };
      if (disposed) {
        release();
        return;
      }
      resize();
      window.addEventListener('resize', resize);

      useMode2Store.getState().reset();
      useMode2Store.setState({
        preset: profile.settings.controlPreset,
        assistMode: profile.settings.assistMode,
        invertPitch: profile.settings.invertPitch,
      });

      // Keyboard support makes the desktop build immediately playable without
      // pretending a mouse is a touch stick. The virtual sticks remain the primary
      // mobile input; keys only update the same single input store, so simulation
      // behaviour is identical on both platforms.
      const pressed = new Set<string>();
      const applyKeyboardAxes = () => {
        const down = (key: string) => pressed.has(key);
        useMode2Store.getState().setAileron((down('arrowright') ? 1 : 0) + (down('arrowleft') ? -1 : 0));
        // Flight-sim convention: ArrowUp pushes the stick forward (nose down), ArrowDown pulls back.
        useMode2Store.getState().setElevator((down('arrowup') ? 1 : 0) + (down('arrowdown') ? -1 : 0));
        useMode2Store.getState().setRudder((down('d') ? 1 : 0) + (down('a') ? -1 : 0));
        useMode2Store.getState().setBrake(down(' '));
      };
      const onKeyDown = (event: KeyboardEvent) => {
        // Native range controls are the screen-reader/keyboard alternative to the touch
        // gimbals. Do not hijack their arrow keys for the global flight shortcuts.
        if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement) return;
        if (event.key === 'F3') {
          event.preventDefault();
          if (!event.repeat) setDebugOn((v) => !v);
          return;
        }
        if (event.repeat && ['e', 'f', 'escape'].includes(event.key.toLowerCase())) return;
        const key = event.key.toLowerCase();
        if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', ' ', 'a', 'd', 'w', 's', 'e', 'f', 'escape'].includes(key)) {
          event.preventDefault();
        }
        pressed.add(key);
        const input = useMode2Store.getState();
        if (key === 'e') input.toggleEngine();
        if (key === 'f') input.toggleFlaps();
        if (key === 'escape') setPaused(true);
        if (key === 'c' && !event.repeat) setFpv((v) => !v);
        applyKeyboardAxes();
      };
      const onKeyUp = (event: KeyboardEvent) => {
        if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement) return;
        pressed.delete(event.key.toLowerCase());
        applyKeyboardAxes();
      };
      const onInputBlur = () => {
        pressed.clear();
        useMode2Store.getState().releaseMomentaryControls();
      };
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
      window.addEventListener('blur', onInputBlur);

      setReady(true);

      let elapsedFlightS = 0;
      let previousNavState = 'PREFLIGHT';
      let exploreElapsedS = 1;
      // The simulation remains at its fixed 60 Hz, while the HUD only needs fresh
      // React snapshots at 15 Hz. This avoids rerendering the full HUD/store tree
      // every physics tick without delaying simulation-side edge events.
      const HUD_UPDATE_INTERVAL_S = 1 / 15;
      let hudUpdateElapsedS = 0;
      // Edge state for controller buttons. Axes/triggers are continuously sampled,
      // while toggles must fire once per press rather than every animation frame.
      let previousGamepadButtons = { engine: false, flaps: false, pause: false };
      let gamepadWasConnected = false;
      // Analog trigger only writes throttle when it moves, so it doesn't stomp keyboard
      // accumulation every frame; whichever device moved last owns the throttle.
      let lastGamepadThrottle = -1;

      const pollGamepad = () => {
        const gamepad = navigator.getGamepads?.().find((pad) => pad?.connected);
        const input = mapGamepad(gamepad);
        if (!input.connected) {
          // A controller can disconnect mid-turn. Do this only on the connected ->
          // disconnected edge so keyboard/touch controls are not overwritten every frame.
          if (gamepadWasConnected) {
            const controls = useMode2Store.getState();
            controls.setThrottle(0);
            controls.releaseMomentaryControls();
          }
          gamepadWasConnected = false;
          lastGamepadThrottle = -1;
          previousGamepadButtons = { engine: false, flaps: false, pause: false };
          return;
        }
        gamepadWasConnected = true;
        const controls = useMode2Store.getState();
        if (Math.abs(input.throttle - lastGamepadThrottle) > 0.01) {
          controls.setThrottle(input.throttle);
          lastGamepadThrottle = input.throttle;
        }
        controls.setAileron(input.roll);
        // Gamepad Y axis is -1 when pushed up; elevator +1 means stick pushed forward.
        controls.setElevator(-input.pitch);
        controls.setRudder(input.rudder);
        controls.setBrake(input.brake);
        if (input.enginePressed && !previousGamepadButtons.engine) controls.toggleEngine();
        if (input.flapsPressed && !previousGamepadButtons.flaps) controls.toggleFlaps();
        if (input.pausePressed && !previousGamepadButtons.pause) setPaused(true);
        previousGamepadButtons = { engine: input.enginePressed, flaps: input.flapsPressed, pause: input.pausePressed };
      };

      // Render-only snapshots. Rapier remains authoritative; these are never fed back
      // into simulation and exist solely to interpolate a smooth pose between fixed ticks.
      const initialPos = controller.body.translation();
      const initialRot = controller.body.rotation();
      const previousPosition = new THREE.Vector3(initialPos.x, initialPos.y, initialPos.z);
      const currentPosition = previousPosition.clone();
      const renderPosition = previousPosition.clone();
      const previousQuaternion = new THREE.Quaternion(initialRot.x, initialRot.y, initialRot.z, initialRot.w);
      const currentQuaternion = previousQuaternion.clone();
      const renderQuaternion = previousQuaternion.clone();
      const windPosition = previousPosition.clone();

      // PHASE 2C floating origin: a master-world rebase shifts every registered THREE object AND the
      // streamed terrain colliders (inside MasterWorldAdapter/MasterStreamingRuntime) by `delta`. The
      // aircraft's Rapier body and this loop's render-interpolation vectors hold the SAME region-local
      // x/z but are not registered with FloatingOrigin (that only shifts `Object3D.position`), so they
      // must be shifted here by the identical delta — a pure relabelling of the same geographic point,
      // never touching velocity, attitude, altitude, heading or fuel (spec item 5).
      if (masterWorld) {
        masterWorld.addFollower((delta) => {
          const t = controller.body.translation();
          controller.body.setTranslation({ x: t.x - delta.x, y: t.y, z: t.z - delta.z }, true);
          previousPosition.x -= delta.x; previousPosition.z -= delta.z;
          currentPosition.x -= delta.x; currentPosition.z -= delta.z;
          renderPosition.x -= delta.x; renderPosition.z -= delta.z;
          windPosition.x -= delta.x; windPosition.z -= delta.z;
          scene.shiftOrigin(delta.x, delta.z);
        });
      }

      // Damage-system feedback (task item 4): fire once per edge, not every frame, on the
      // damage/crash-outcome transitions FlightModel reports in telemetry.
      let lastCrashOutcome: FlightTelemetry['crashOutcome'] = 'none';
      let lastDamagedCount = 0;
      let lastDetachedCount = 0;
      // Kept across frames so the camera FOV/roll and wind-sound feedback (task:
      // speed-feel) have a speed value even on frames where the fixed-step sim
      // doesn't advance (e.g. paused, or between physics ticks).
      let lastTelemetry: FlightTelemetry | null = null;
      // Audio edge detection (one-shot events fire once per transition).
      let lastTouchdown: number | null = null;
      let lastEngineOn = false;
      let lastStalled = false;
      // Music triggers (musicDirector.ts): edges and a 1 Hz landmark scan.
      let lastOnGround = true;
      let landmarkScanS = 0;
      let seenLandmarks: Set<string> | null = null;
      const gustMs = region.environment?.gustStrengthMs ?? 0;
      let lastImpactSpeed = 0;
      const engineSpec = aircraft.engine;
      const engineVoice = getEngineCharacter(engineSpec?.id).sound;

      /** Advances the authoritative simulation by whole fixed ticks and applies every
       * per-tick side effect (feedback, damage visuals, end of flight). Shared by the
       * real-time loop and the dev-only deterministic driver below. */
      const advanceSim = (steps: number, controlsFor: () => ResolvedControls) => {
        let telem: FlightTelemetry | null = null;
        for (let step = 0; step < steps; step++) {
          previousPosition.copy(currentPosition);
          previousQuaternion.copy(currentQuaternion);

          const bodyPosition = controller.body.translation();
          windPosition.set(bodyPosition.x, bodyPosition.y, bodyPosition.z);
          const wind = getEnvironmentWind(region, elapsedFlightS, windPosition);
          const stepControls = controlsFor();
          telem = controller.step(stepControls, wind);
          if (debugRef.current) recorderRef.current.tick(controller, stepControls, fixedDt);
          elapsedFlightS += fixedDt;

          const stepPosition = controller.body.translation();
          const stepRotation = controller.body.rotation();
          currentPosition.set(stepPosition.x, stepPosition.y, stepPosition.z);
          currentQuaternion.set(stepRotation.x, stepRotation.y, stepRotation.z, stepRotation.w).normalize();
        }
        if (!telem) return;
        lastTelemetry = telem;
        hudUpdateElapsedS += steps * fixedDt;
        if (hudUpdateElapsedS >= HUD_UPDATE_INTERVAL_S || telem.crashed || telem.landed) {
          hudUpdateElapsedS %= HUD_UPDATE_INTERVAL_S;
          setTelemetry(telem);
          useGameStore.getState().setFlightTelemetry(telem);
          if (navPlan) {
            // Plan coordinates are the unshifted streaming frame; telemetry is floating-origin relative.
            const off = masterWorld?.runtime.origin.originOffset;
            const ox = off?.x ?? 0, oz = off?.z ?? 0;
            const pos = [telem.position[0] + ox, telem.position[1], telem.position[2] + oz] as const;
            navPlan = activateFlightPlan(advancePlan(navPlan, pos[0], pos[2], telem.headingDeg));
            let g = guidance(navPlan, { position: pos, headingDeg: telem.headingDeg, landed: telem.landed, airspeedMs: telem.airspeedMs, verticalSpeedMs: telem.verticalSpeedMs });
            if (g.goAroundRecommended && !telem.onGround && navPlan.runway) {
              navPlan = goAroundPlan(navPlan, { x: pos[0], z: pos[2] }, telem.headingDeg);
              g = guidance(navPlan, { position: pos, headingDeg: telem.headingDeg, airspeedMs: telem.airspeedMs, verticalSpeedMs: telem.verticalSpeedMs });
            }
            if (g.state !== previousNavState) {
              if (g.state === 'APPROACH') audioService.playEvent('approach');
              else if (g.state === 'FINAL') audioService.playEvent('final');
              else if (g.state === 'GO_AROUND') audioService.playEvent('goAround');
              else if (g.state === 'ENROUTE' && navPlan.active > 1) audioService.playEvent('waypoint');
              previousNavState = g.state;
            }
            setNav(g);
            scene.setGuidanceCue(
              navVis.worldMarker && ['waypoint', 'approach', 'final', 'threshold'].includes(g.target.kind) ? { x: g.target.x - ox, z: g.target.z - oz, minAltM: g.target.minAltM, kind: g.target.kind, runway: g.runway ? { elevationM: g.runway.elevationM, headingDeg: g.runway.approachHeadingDeg, glideAngleDeg: g.runway.glideAngleDeg, thresholdX: navPlan!.points.find((p) => p.kind === 'threshold')!.x - ox, thresholdZ: navPlan!.points.find((p) => p.kind === 'threshold')!.z - oz } : undefined } : null,
              navVis.hudArrow ? g.deltaDeg : null,
            );
          }
        }

        // Impact feedback: screen shake + stinger the moment damage/crash severity escalates.
        if (telem.crashOutcome !== lastCrashOutcome && telem.crashOutcome !== 'none') {
          const magnitude = telem.crashOutcome === 'totalLoss' ? 0.55 : 0.22;
          scene.triggerImpactShake(magnitude, telem.crashOutcome === 'totalLoss' ? 0.6 : 0.35);
          audioService.playEvent(telem.crashOutcome === 'totalLoss' ? 'crash' : 'hardLanding', 1);
        }
        if (telem.lastTouchdownVsMs !== null && telem.lastTouchdownVsMs !== lastTouchdown && !telem.crashed) {
          const sink = Math.abs(telem.lastTouchdownVsMs);
          audioService.playEvent('touchdown', sinkRateToIntensity(sink));
          scene.triggerImpactShake(Math.min(0.25, sink * 0.06), 0.25);
        }
        lastTouchdown = telem.lastTouchdownVsMs;
        if (telem.engineOn !== lastEngineOn) audioService.playEvent(telem.engineOn ? 'engineStart' : 'engineStop');
        lastEngineOn = telem.engineOn;
        if (telem.stalled && !lastStalled) audioService.playEvent('stallBreak');
        lastStalled = telem.stalled;
        lastCrashOutcome = telem.crashOutcome;

        if (telem.crashOutcome === 'totalLoss') audioService.musicEvent('crash');
        else if (!telem.onGround) {
          if (lastOnGround) {
            audioService.musicEvent(visitedMusicRegions.has(region.id) ? 'takeoff' : 'regionEnter');
            visitedMusicRegions.add(region.id);
            if (gustMs >= 7) audioService.musicEvent('dangerousWeather');
          }
          if (telem.stallWarning || !telem.engineOn || telem.fuelFraction < 0.08) audioService.musicEvent('emergency');
          if (gustMs >= 5 && useProfileStore.getState().profile.operations.active?.session.phase === 'APPROACH') audioService.musicEvent('hardApproach');
          landmarkScanS += steps * fixedDt;
          if (landmarkScanS >= 1) {
            landmarkScanS = 0;
            const found = discoverLandmarks(region.id, terrainQuery, { x: telem.position[0], z: telem.position[2], elevationM: telem.position[1] }, seenLandmarks ?? new Set());
            // First scan only seeds what is already in view at departure.
            if (seenLandmarks && found.size > seenLandmarks.size) audioService.musicEvent('landmarkDiscovered');
            seenLandmarks = found;
          }
        }
        lastOnGround = telem.onGround;

        if (telem.damagedPartIds.length !== lastDamagedCount || telem.detachedPartIds.length !== lastDetachedCount) {
          const isWing = (id: string) => id.startsWith('wing') || id.startsWith('aileron');
          const isTail = (id: string) => id === 'elevator' || id === 'rudder' || id === 'tail';
          const wingDamaged = telem.damagedPartIds.some(isWing);
          const wingDetached = telem.detachedPartIds.some(isWing);
          const tailDamaged = telem.damagedPartIds.some(isTail);
          const tailDetached = telem.detachedPartIds.some(isTail);
          scene.setPartVisualState('wing', wingDamaged, wingDetached);
          scene.setPartVisualState('tail', tailDamaged, tailDetached);
          lastDamagedCount = telem.damagedPartIds.length;
          lastDetachedCount = telem.detachedPartIds.length;
        }
        scene.setImpactDamage(telem.impactZone, telem.detachedPartIds, telem.impactSpeedMs, telem.partIntegrity);
        const impactSpeed = telem.impactSpeedMs ?? 0;
        if (telem.impactZone && impactSpeed > lastImpactSpeed + 0.5) {
          // Metal/structure dragged fast along the ground throws sparks; everything else kicks up dust.
          const sparks = telem.impactZone !== 'gear' && impactSpeed > 8;
          scene.spawnImpactBurst(telem.impactZone, 'dust', impactSpeed / 15);
          if (sparks) scene.spawnImpactBurst(telem.impactZone, 'sparks', impactSpeed / 25);
        }
        lastImpactSpeed = impactSpeed;
        const vibration = telem.vibration ?? 0;
        if (vibration > 0.1 && telem.engineOn) scene.triggerImpactShake(vibration * 0.06 * (telem.rpm > 0 ? 1 : 0), 0.12);

        if (contract) {
          // Phases, terminal states and payment all come from the mission domain, fed by real telemetry.
          if (tickContractFlight(telem) && endTimerRef.current === null) {
            const final = telem;
            endTimerRef.current = window.setTimeout(() => {
              concludeContractFlight(final);
            }, 1600);
          }
        } else if ((telem.crashed || telem.landed) && endTimerRef.current === null) {
          const final = telem;
          endTimerRef.current = window.setTimeout(() => {
            const result = computeFlightResult(mission, final, aircraft, profile.currentBuild, profile.homeBase);
            applyFlightResult(result);
            setLastResult(result);
            goTo('results');
          }, 1600);
        }
      };

      if (import.meta.env.DEV) {
        // Dev/QA only: fly the real simulation deterministically from the console or an
        // automated browser (background tabs throttle requestAnimationFrame).
        (window as unknown as { __pf?: unknown }).__pf = {
          controller,
          scene,
          recorder: recorderRef.current,
          // Dev/QA: the scripted test pilot (src/mission/bot.ts), loaded lazily so it never ships in the production bundle.
          loadBot: () => import('../../mission/bot').then((m) => m.BotPilot),
          // Phase 2C instrumentation (item 8): off the HUD by default, available from devtools —
          // `__pf.masterWorld()` — global/local position, origin offset, tile/collider counts, LOD,
          // triangles, pending queues and distance to unprepared terrain. null outside master-world regions.
          masterWorld: () => {
            if (!masterWorld) return null;
            const t = controller.body.translation();
            return {
              localPosition: { x: t.x, y: t.y, z: t.z },
              originOffset: masterWorld.runtime.origin.originOffset,
              ...masterWorld.metrics(),
            };
          },
          simulate: (seconds: number, overrides: Partial<ResolvedControls> | ((t: FlightTelemetry | null) => Partial<ResolvedControls>) = {}) => {
            const ticks = Math.round(seconds / fixedDt);
            for (let i = 0; i < ticks; i++) {
              advanceSim(1, () => ({ ...getResolvedControls(), ...(typeof overrides === 'function' ? overrides(lastTelemetry) : overrides) }));
            }
            return lastTelemetry;
          },
        };
      }

      const instrumentFit = { engine: controller.sim.def.engine, hasFlaps: hasFlaps(controller.sim.def) };
      const loop = () => {
        if (disposed) return;
        if (document.hidden) {
          // RAF can keep firing in some embedded browsers while hidden. Skip all
          // scene, audio and gamepad work; visibilitychange already pauses flight.
          frameId = requestAnimationFrame(loop);
          return;
        }
        const now = performance.now();
        const frameDt = Math.min(0.1, (now - lastNow) / 1000);
        lastNow = now;

        pollGamepad();

        let renderAlpha = 1;
        if (!useGameStore.getState().paused) {
          const up = pressed.has('w');
          const down = pressed.has('s');
          if (up || down) {
            const controls = useMode2Store.getState();
            controls.setThrottle(stepKeyboardThrottle(controls.throttle, up, down, pressed.has('shift'), frameDt));
          }
          const frame = clock.advance(frameDt);
          renderAlpha = frame.alpha;
          advanceSim(frame.steps, getResolvedControls);
        } else {
          // Pause/background boundaries must not retain fractional catch-up time.
          clock.reset();
          previousPosition.copy(currentPosition);
          previousQuaternion.copy(currentQuaternion);
        }

        renderPosition.copy(previousPosition).lerp(currentPosition, renderAlpha);
        renderQuaternion.copy(previousQuaternion).slerp(currentQuaternion, renderAlpha).normalize();

        // Phase 2C: drive the master streamer once per render frame (not per physics substep — tile
        // selection is a render/LOD concern) from the aircraft's real position/velocity/AGL, predictive
        // on heading+speed (masterStreaming.ts `physicsRing`/look-ahead already takes vx/vz/aglM as an
        // aircraft-agnostic API, so a faster future airframe just widens the same ring).
        if (masterWorld) {
          const t = controller.body.translation();
          const v = controller.body.linvel();
          const aglM = t.y - terrainQuery.getElevation(t.x, t.z);
          masterWorld.update(t.x, t.z, v.x, v.z, aglM);
        }

        // Fog of Discovery (world/exploration.ts), ~1 Hz from the aircraft's TRUE master-world position.
        exploreElapsedS += frameDt;
        if (exploreElapsedS >= 1 && masterTerrain.hasFrame(region.id)) {
          exploreElapsedS = 0;
          const t = controller.body.translation();
          const off = masterWorld?.runtime.origin.originOffset;
          const lx = t.x + (off?.x ?? 0), lz = t.z + (off?.z ?? 0);
          const [wx, wz] = masterTerrain.localToWorld(region.id, lx, lz);
          const events = useProfileStore.getState().recordExploration({
            x: wx, z: wz, aglM: t.y - terrainQuery.getElevation(t.x, t.z), onGround: lastTelemetry?.onGround ?? true,
          });
          const shown = events.filter((e) => e.kind !== 'airfield_sighted' || !events.some((o) => o.id === e.id && o.kind !== e.kind));
          if (shown.length) setDiscoveryToast(shown.map(describeDiscovery).join(' · '));
        }

        const speedMs = lastTelemetry?.speedMs ?? 0;
        scene.syncAircraft(renderPosition, renderQuaternion, frameDt, {
          speedMs,
          onGround: lastTelemetry?.onGround ?? true,
          gForce: lastTelemetry?.gForce ?? 1,
          stalled: lastTelemetry?.stalled ?? false,
        });
        if (lastTelemetry) scene.updateInstruments(lastTelemetry, frameDt, instrumentFit);
        scene.animateAircraft(
          { ...controller.sim.controls.target, flaps: controller.sim.controls.actuators.position.flaps }, lastTelemetry?.rpm ?? 0, frameDt,
          lastTelemetry?.groundSpeedMs ?? 0, lastTelemetry?.onGround ?? true,
          aircraft.engine?.gearRatio ?? 2.3,
          { compressionM: controller.sim.gear.wheels.map((w) => w.compressionM), steerRad: controller.sim.gear.wheels[0]?.steerRad ?? 0 },
        );
        scene.animatePilot({ ...controller.sim.assisted, gForce: lastTelemetry?.gForce ?? 1 }, frameDt);
        scene.updateEnvironment(elapsedFlightS, getEnvironmentWind(region, elapsedFlightS, currentPosition));
        audioService.updateFlight({
          rpm: lastTelemetry?.rpm ?? 0,
          idleRpm: engineSpec?.idleRpm ?? 1600,
          redlineRpm: engineSpec?.redlineRpm ?? 6200,
          voice: engineVoice,
          throttle: lastTelemetry?.throttle ?? 0,
          airspeedMs: lastTelemetry?.airspeedMs ?? 0,
          groundSpeedMs: lastTelemetry?.groundSpeedMs ?? 0,
          onGround: lastTelemetry?.onGround ?? true,
          stallWarning: lastTelemetry?.stallWarning ?? false,
          engineOn: lastTelemetry?.engineOn ?? false,
          paused: useGameStore.getState().paused,
        });
        gizmosRef.current?.update(controller);
        scene.render();

        frameId = requestAnimationFrame(loop);
      };
      if (disposed) {
        release();
        return;
      }
      frameId = requestAnimationFrame(loop);
    }

    void boot();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      if (endTimerRef.current) window.clearTimeout(endTimerRef.current);
      release?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flight-screen">
      <canvas ref={canvasRef} className="flight-canvas" />
      {ready && telemetry && (
        <FlightHud telemetry={telemetry} mission={mission} nav={nav} navMode={profile.settings.navGuidance} fuelCapacityL={fuelCapacityL} phaseLabel={missionSession?.phase ? PHASE_LABEL[missionSession.phase] : missionSession ? STATE_LABEL[missionSession.state] : undefined} contractState={missionSession?.state} freeFlightRegionName={mission ? undefined : activeRegion.name} freeFlightAirfieldName={mission ? undefined : getFreeFlightAirfield(activeRegion.id)?.name} onPause={() => setPaused(true)} paused={paused} fpv={fpv} onToggleCamera={() => setFpv((v) => !v)} />
      )}
      {ready && debugOn && (
        <FlightDebugOverlay getModel={getModel} recorder={recorderRef.current} showGizmos={gizmosOn} onToggleGizmos={() => setGizmosOn((v) => !v)} />
      )}
      {discoveryToast && <div className="discovery-toast" role="status" data-testid="discovery-toast">{discoveryToast}</div>}
      {!ready && <div className="loading-overlay">Cargando taller y pista…</div>}
    </div>
  );
}
