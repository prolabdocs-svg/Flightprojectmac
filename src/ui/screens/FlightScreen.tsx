import { useEffect, useRef, useState } from 'react';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { useGameStore } from '../../state/gameStore';
import { useProfileStore } from '../../state/profileStore';
import { useMode2Store, getResolvedControls } from '../../input/mode2Store';
import { mapGamepad } from '../../input/gamepad';
import { resolveAircraft } from '../../content/assembly';
import { getMission, isMissionAvailableToProfile } from '../../content/missions';
import { evaluateMissionReadiness } from '../../content/missionReadiness';
import { getRegion } from '../../content/regions';
import { initPhysics, createWorld } from '../../sim/physics';
import { FlightController, DEFAULT_RUNWAY_CONDITIONS, type FlightTelemetry, type ResolvedControls } from '../../sim/flightController';
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
import { FlightHud } from '../components/FlightHud';
import { audioService } from '../../audio/audioService';
import { sinkRateToIntensity } from '../../audio/flightAudioMappings';
import { getEnvironmentWind } from '../../sim/weather';
import { FixedStepClock } from '../../core/fixedStepClock';
import { createTerrainQueryService } from '../../world/terrainQuery';
import { getHomeBaseBenefits } from '../../content/homeBase';
import { getRegionObstacles } from '../../world/obstacles';

const FIXED_DT = 1 / 60;

export function FlightScreen() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const controllerRef = useRef<FlightController | null>(null);
  const sceneRef = useRef<FlightScene | null>(null);
  const endTimerRef = useRef<number | null>(null);
  const paused = useGameStore((s) => s.paused);
  const setPaused = useGameStore((s) => s.setPaused);
  const selectedMissionId = useGameStore((s) => s.selectedMissionId);
  const selectedFreeFlightRegionId = useGameStore((s) => s.selectedFreeFlightRegionId);
  const goTo = useGameStore((s) => s.goTo);
  const setLastResult = useGameStore((s) => s.setLastResult);
  const profile = useProfileStore((s) => s.profile);
  const applyFlightResult = useProfileStore((s) => s.applyFlightResult);

  const [telemetry, setTelemetry] = useState<FlightTelemetry | null>(null);
  const [ready, setReady] = useState(false);

  const mission = selectedMissionId ? getMission(selectedMissionId) ?? null : null;
  const activeRegion = mission ? getRegion(mission.regionId) : getRegion(selectedFreeFlightRegionId);

  useEffect(() => {
    let disposed = false;
    let frameId = 0;
    let release: (() => void) | undefined;
    const clock = new FixedStepClock(FIXED_DT, 0.1, 8);
    let lastNow = performance.now();

    async function boot() {
      // Last-resort guard against the map/briefing invariant: a contract the profile
      // hasn't unlocked, or the current build can't reasonably complete, must never
      // actually launch here even if UI navigation/state was bypassed to reach RUN.
      if (mission && (!isMissionAvailableToProfile(mission, profile) || !evaluateMissionReadiness(mission, profile.currentBuild).ready)) {
        goTo('briefing');
        return;
      }

      await initPhysics();
      if (disposed || !canvasRef.current) return;

      const world = createWorld();
      // TerrainQueryService (src/world/terrainQuery.ts) is the single authority for ground
      // elevation: WorldEnvironment's visual mesh, this spawn-height calculation, and
      // FlightController's per-tick ground contact (src/sim/flightController.ts) all sample
      // it, so they can never drift apart.
      //
      // A real RAPIER.ColliderDesc.heightfield(...) sampled from `terrainQuery` reliably
      // crashed the Rapier wasm module ("memory access out of bounds") when tried, even with
      // a conservative 65x65 sample grid — likely a sign convention or row/column-major
      // mismatch in how @dimforge/rapier3d-compat@0.20 expects the heights buffer laid out.
      // FlightController instead enforces ground contact against the undulating terrain
      // manually every tick; this collider is kept only as a deep safety-net floor (well
      // below the terrain's ~±80m relief) to catch the aircraft if anything ever pushes it
      // out of the manual clamp's reach, not as the primary ground.
      const region = activeRegion;
      const terrainQuery = createTerrainQueryService(region);
      const SAFETY_FLOOR_Y = -500;
      const groundDesc = RAPIER.ColliderDesc.cuboid(3000, 0.5, 3000).setTranslation(0, SAFETY_FLOOR_Y - 0.5, 0).setFriction(0.04);
      world.createCollider(groundDesc);

      const aircraft = resolveAircraft(profile.currentBuild);
      const freeFlightAirfield = mission ? undefined : getFreeFlightAirfield(region.id);
      const spawnPoint = mission?.spawnPoint ?? freeFlightAirfield?.position ?? ([0, 1.2, 0] as const);
      const spawnGroundY = terrainQuery.getElevation(spawnPoint[0], spawnPoint[2]);
      const spawn = new THREE.Vector3(spawnPoint[0], Math.max(spawnPoint[1], spawnGroundY + 1.2), spawnPoint[2]);
      const destinationAirfield = mission?.destinationAirfieldId ? getAirfield(mission.destinationAirfieldId) : undefined;
      // AirfieldDefinition (src/world/airfields.ts, owned by other work) doesn't carry an
      // explicit roughness value, so surface type stands in for it here: unpaved surfaces
      // are inherently rougher than tarmac/salt.
      const runwayAirfield = destinationAirfield ?? freeFlightAirfield;
      const baseRunwayConditions = runwayAirfield
        ? { surface: runwayAirfield.surface, roughness: SURFACE_ROUGHNESS[runwayAirfield.surface] }
        : DEFAULT_RUNWAY_CONDITIONS;
      // Unlinked missions in The Field use the player's upgraded home strip.
      const runwayConditions = !runwayAirfield && region.id === 'the_field'
        ? { ...baseRunwayConditions, roughness: Math.max(0.04, baseRunwayConditions.roughness - getHomeBaseBenefits(profile.homeBase).runwayRoughnessReduction) }
        : baseRunwayConditions;
      const controller = new FlightController(world, aircraft, spawn, mission?.spawnHeadingDeg ?? 0, terrainQuery, runwayConditions, getRegionObstacles(region.id, terrainQuery));
      controllerRef.current = controller;

      const paint = getPaint(profile.selectedPaintId);
      const scene = new FlightScene(canvasRef.current, region, paint && {
        fabricColor: paint.fabricColor,
        tubeColor: paint.tubeColor,
      }, profile.currentBuild.frameId);
      scene.setTargetMarker(mission?.targetPoint, mission?.targetRadiusM ?? 20);
      sceneRef.current = scene;

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
        if (event.repeat && ['e', 'f', 'escape'].includes(event.key.toLowerCase())) return;
        const key = event.key.toLowerCase();
        if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', ' ', 'a', 'd', 'w', 's', 'e', 'f', 'escape'].includes(key)) {
          event.preventDefault();
        }
        pressed.add(key);
        const input = useMode2Store.getState();
        if (key === 'w') input.setThrottle(1);
        if (key === 's') input.setThrottle(0);
        if (key === 'e') input.toggleEngine();
        if (key === 'f') input.toggleFlaps();
        if (key === 'escape') setPaused(true);
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
      // Edge state for controller buttons. Axes/triggers are continuously sampled,
      // while toggles must fire once per press rather than every animation frame.
      let previousGamepadButtons = { engine: false, flaps: false, pause: false };
      let gamepadWasConnected = false;

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
          previousGamepadButtons = { engine: false, flaps: false, pause: false };
          return;
        }
        gamepadWasConnected = true;
        const controls = useMode2Store.getState();
        controls.setThrottle(input.throttle);
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

      // Damage-system feedback (task item 4): fire once per edge, not every frame, on the
      // damage/crash-outcome transitions FlightController now reports in telemetry.
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
      const engineSpec = aircraft.engine;

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
          telem = controller.step(controlsFor(), wind);
          elapsedFlightS += FIXED_DT;

          const stepPosition = controller.body.translation();
          const stepRotation = controller.body.rotation();
          currentPosition.set(stepPosition.x, stepPosition.y, stepPosition.z);
          currentQuaternion.set(stepRotation.x, stepRotation.y, stepRotation.z, stepRotation.w).normalize();
        }
        if (!telem) return;
        lastTelemetry = telem;
        setTelemetry(telem);

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

        if (telem.damagedPartIds.length !== lastDamagedCount || telem.detachedPartIds.length !== lastDetachedCount) {
          const wingDamaged = telem.damagedPartIds.some((id) => id !== 'elevator' && id !== 'rudder');
          const wingDetached = telem.detachedPartIds.some((id) => id !== 'elevator' && id !== 'rudder');
          const tailDamaged = telem.damagedPartIds.some((id) => id === 'elevator' || id === 'rudder');
          const tailDetached = telem.detachedPartIds.some((id) => id === 'elevator' || id === 'rudder');
          scene.setPartVisualState('wing', wingDamaged, wingDetached);
          scene.setPartVisualState('tail', tailDamaged, tailDetached);
          lastDamagedCount = telem.damagedPartIds.length;
          lastDetachedCount = telem.detachedPartIds.length;
        }

        if ((telem.crashed || telem.landed) && endTimerRef.current === null) {
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
          simulate: (seconds: number, overrides: Partial<ResolvedControls> | ((t: FlightTelemetry | null) => Partial<ResolvedControls>) = {}) => {
            const ticks = Math.round(seconds / FIXED_DT);
            for (let i = 0; i < ticks; i++) {
              advanceSim(1, () => ({ ...getResolvedControls(), ...(typeof overrides === 'function' ? overrides(lastTelemetry) : overrides) }));
            }
            return lastTelemetry;
          },
        };
      }

      const loop = () => {
        if (disposed) return;
        const now = performance.now();
        const frameDt = Math.min(0.1, (now - lastNow) / 1000);
        lastNow = now;

        pollGamepad();

        let renderAlpha = 1;
        if (!useGameStore.getState().paused) {
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
        const speedMs = lastTelemetry?.speedMs ?? 0;
        scene.syncAircraft(renderPosition, renderQuaternion, frameDt, {
          speedMs,
          onGround: lastTelemetry?.onGround ?? true,
          gForce: lastTelemetry?.gForce ?? 1,
          stalled: lastTelemetry?.stalled ?? false,
        });
        scene.updateEnvironment(elapsedFlightS, getEnvironmentWind(region, elapsedFlightS, currentPosition));
        audioService.updateFlight({
          rpm: lastTelemetry?.rpm ?? 0,
          idleRpm: engineSpec?.idleRpm ?? 1600,
          redlineRpm: engineSpec?.redlineRpm ?? 6200,
          throttle: lastTelemetry?.throttle ?? 0,
          airspeedMs: lastTelemetry?.airspeedMs ?? 0,
          groundSpeedMs: lastTelemetry?.groundSpeedMs ?? 0,
          onGround: lastTelemetry?.onGround ?? true,
          stallWarning: lastTelemetry?.stallWarning ?? false,
          engineOn: lastTelemetry?.engineOn ?? false,
          paused: useGameStore.getState().paused,
        });
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
        <FlightHud telemetry={telemetry} mission={mission} freeFlightRegionName={mission ? undefined : activeRegion.name} freeFlightAirfieldName={mission ? undefined : getFreeFlightAirfield(activeRegion.id)?.name} onPause={() => setPaused(true)} paused={paused} />
      )}
      {!ready && <div className="loading-overlay">Cargando taller y pista…</div>}
    </div>
  );
}
