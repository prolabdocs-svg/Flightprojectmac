import { useEffect, useRef, useState } from 'react';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { useGameStore } from '../../state/gameStore';
import { useProfileStore } from '../../state/profileStore';
import { useMode2Store, getResolvedControls } from '../../input/mode2Store';
import { resolveAircraft } from '../../content/assembly';
import { getMission } from '../../content/missions';
import { THE_FIELD, getRegion } from '../../content/regions';
import { initPhysics, createWorld } from '../../sim/physics';
import { FlightController, DEFAULT_RUNWAY_CONDITIONS, type FlightTelemetry } from '../../sim/flightController';
import { getAirfield, type RunwaySurface } from '../../world/airfields';

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
import { getEnvironmentWind } from '../../sim/weather';
import { FixedStepClock } from '../../core/fixedStepClock';
import { createTerrainQueryService } from '../../world/terrainQuery';

const FIXED_DT = 1 / 60;

export function FlightScreen() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const controllerRef = useRef<FlightController | null>(null);
  const sceneRef = useRef<FlightScene | null>(null);
  const rafRef = useRef<number>(0);
  const endTimerRef = useRef<number | null>(null);
  const paused = useGameStore((s) => s.paused);
  const setPaused = useGameStore((s) => s.setPaused);
  const selectedMissionId = useGameStore((s) => s.selectedMissionId);
  const goTo = useGameStore((s) => s.goTo);
  const setLastResult = useGameStore((s) => s.setLastResult);
  const profile = useProfileStore((s) => s.profile);
  const applyFlightResult = useProfileStore((s) => s.applyFlightResult);

  const [telemetry, setTelemetry] = useState<FlightTelemetry | null>(null);
  const [ready, setReady] = useState(false);

  const mission = selectedMissionId ? getMission(selectedMissionId) ?? null : null;

  useEffect(() => {
    let disposed = false;
    const clock = new FixedStepClock(FIXED_DT, 0.1, 8);
    let lastNow = performance.now();

    async function boot() {
      await initPhysics();
      if (disposed || !canvasRef.current) return;

      const world = createWorld();
      // Match the aircraft collider's rolling-resistance approximation. A high ground
      // coefficient reintroduces the taxi/contact forces already removed in the physics fix.
      //
      // TerrainQueryService (src/world/terrainQuery.ts) is the single authority for ground
      // elevation: WorldEnvironment's visual mesh and this spawn-height calculation both
      // sample it, so they can never drift apart.
      //
      // NEXT STEP (not done in this pass): replace this flat collider with a
      // RAPIER.ColliderDesc.heightfield(...) sampled from `terrainQuery`, so the physics
      // ground actually matches the visual relief everywhere, not just at the spawn point.
      // A heightfield attempt was tried here and reliably crashed the Rapier wasm module
      // ("memory access out of bounds") as soon as the aircraft body was simulated against
      // it, even with a conservative 65x65 sample grid — likely a sign convention or
      // row/column-major mismatch in how @dimforge/rapier3d-compat@0.20 expects the heights
      // buffer laid out relative to world axes, which needs to be verified against a working
      // Rapier heightfield example (not blind extrapolation from the .d.ts alone) before
      // shipping. Given flight-feel correctness is the higher priority for this change, the
      // flat collider is kept and only the spawn height is corrected via TerrainQueryService.
      const region = mission ? getRegion(mission.regionId) : THE_FIELD;
      const terrainQuery = createTerrainQueryService(region);
      const groundDesc = RAPIER.ColliderDesc.cuboid(3000, 0.5, 3000).setTranslation(0, -0.5, 0).setFriction(0.04);
      world.createCollider(groundDesc);

      const aircraft = resolveAircraft(profile.currentBuild);
      const spawnPoint = mission ? mission.spawnPoint : ([0, 1.2, 0] as const);
      const spawnGroundY = terrainQuery.getElevation(spawnPoint[0], spawnPoint[2]);
      const spawn = new THREE.Vector3(spawnPoint[0], Math.max(spawnPoint[1], spawnGroundY + 1.2), spawnPoint[2]);
      const destinationAirfield = mission?.destinationAirfieldId ? getAirfield(mission.destinationAirfieldId) : undefined;
      // AirfieldDefinition (src/world/airfields.ts, owned by other work) doesn't carry an
      // explicit roughness value, so surface type stands in for it here: unpaved surfaces
      // are inherently rougher than tarmac/salt.
      const runwayConditions = destinationAirfield
        ? { surface: destinationAirfield.surface, roughness: SURFACE_ROUGHNESS[destinationAirfield.surface] }
        : DEFAULT_RUNWAY_CONDITIONS;
      const controller = new FlightController(world, aircraft, spawn, mission?.spawnHeadingDeg ?? 0, runwayConditions);
      controllerRef.current = controller;

      const paint = getPaint(profile.selectedPaintId);
      const scene = new FlightScene(canvasRef.current, region, paint && {
        fabricColor: paint.fabricColor,
        tubeColor: paint.tubeColor,
      });
      scene.setTargetMarker(mission?.targetPoint, mission?.targetRadiusM ?? 20);
      sceneRef.current = scene;

      const resize = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const { clientWidth, clientHeight } = canvas;
        scene.resize(clientWidth || window.innerWidth, clientHeight || window.innerHeight);
      };
      resize();
      window.addEventListener('resize', resize);

      useMode2Store.getState().reset();
      useMode2Store.setState({
        preset: profile.settings.controlPreset,
        assistMode: profile.settings.assistMode,
        invertPitch: profile.settings.invertPitch,
      });

      setReady(true);

      let elapsedFlightS = 0;

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

      const loop = () => {
        if (disposed) return;
        const now = performance.now();
        const frameDt = Math.min(0.1, (now - lastNow) / 1000);
        lastNow = now;

        let renderAlpha = 1;
        if (!useGameStore.getState().paused) {
          const frame = clock.advance(frameDt);
          renderAlpha = frame.alpha;
          let telem: FlightTelemetry | null = null;
          for (let step = 0; step < frame.steps; step++) {
            previousPosition.copy(currentPosition);
            previousQuaternion.copy(currentQuaternion);

            const controls = getResolvedControls();
            const bodyPosition = controller.body.translation();
            windPosition.set(bodyPosition.x, bodyPosition.y, bodyPosition.z);
            const wind = getEnvironmentWind(region, elapsedFlightS, windPosition);
            telem = controller.step(controls, wind);
            elapsedFlightS += FIXED_DT;

            const stepPosition = controller.body.translation();
            const stepRotation = controller.body.rotation();
            currentPosition.set(stepPosition.x, stepPosition.y, stepPosition.z);
            currentQuaternion.set(stepRotation.x, stepRotation.y, stepRotation.z, stepRotation.w).normalize();
          }
          if (telem) {
            setTelemetry(telem);

            // Impact feedback: screen shake + stinger the moment damage/crash severity
            // escalates, and re-tint/hide the placeholder wing/tail meshes to reflect the
            // functional damage FlightController is already applying to aero forces.
            if (telem.crashOutcome !== lastCrashOutcome && telem.crashOutcome !== 'none') {
              const magnitude = telem.crashOutcome === 'totalLoss' ? 0.55 : 0.22;
              scene.triggerImpactShake(magnitude, telem.crashOutcome === 'totalLoss' ? 0.6 : 0.35);
              audioService.playTone(telem.crashOutcome === 'totalLoss' ? 'fail' : 'transition');
            }
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
              endTimerRef.current = window.setTimeout(() => {
                const result = computeFlightResult(mission, telem!, aircraft, profile.currentBuild);
                applyFlightResult(result);
                setLastResult(result);
                goTo('results');
              }, 1600);
            }
          }
        } else {
          // Pause/background boundaries must not retain fractional catch-up time.
          clock.reset();
          previousPosition.copy(currentPosition);
          previousQuaternion.copy(currentQuaternion);
        }

        renderPosition.copy(previousPosition).lerp(currentPosition, renderAlpha);
        renderQuaternion.copy(previousQuaternion).slerp(currentQuaternion, renderAlpha).normalize();
        scene.syncAircraft(renderPosition, renderQuaternion, frameDt);
        scene.updateEnvironment(elapsedFlightS, getEnvironmentWind(region, elapsedFlightS, currentPosition));
        scene.render();

        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);

      return () => {
        window.removeEventListener('resize', resize);
        controllerRef.current = null;
        world.free();
      };
    }

    const cleanupPromise = boot();

    return () => {
      disposed = true;
      cancelAnimationFrame(rafRef.current);
      if (endTimerRef.current) window.clearTimeout(endTimerRef.current);
      sceneRef.current?.dispose();
      cleanupPromise.then((fn) => fn?.());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flight-screen">
      <canvas ref={canvasRef} className="flight-canvas" />
      {ready && telemetry && (
        <FlightHud telemetry={telemetry} mission={mission} onPause={() => setPaused(true)} paused={paused} />
      )}
      {!ready && <div className="loading-overlay">Cargando taller y pista…</div>}
    </div>
  );
}
