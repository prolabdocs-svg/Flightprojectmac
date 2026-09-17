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
import { FlightController, type FlightTelemetry } from '../../sim/flightController';
import { FlightScene } from '../../render/FlightScene';
import { computeFlightResult } from '../../content/economy';
import { getPaint } from '../../content/paint';
import { FlightHud } from '../components/FlightHud';
import { audioService } from '../../audio/audioService';
import { getEnvironmentWind } from '../../sim/weather';
import { FixedStepClock } from '../../core/fixedStepClock';

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
      const groundDesc = RAPIER.ColliderDesc.cuboid(3000, 0.5, 3000).setTranslation(0, -0.5, 0).setFriction(0.04);
      world.createCollider(groundDesc);

      const aircraft = resolveAircraft(profile.currentBuild);
      const spawn = mission
        ? new THREE.Vector3(...mission.spawnPoint)
        : new THREE.Vector3(0, 1.2, 0);
      const controller = new FlightController(world, aircraft, spawn, mission?.spawnHeadingDeg ?? 0);
      controllerRef.current = controller;

      const region = mission ? getRegion(mission.regionId) : THE_FIELD;

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
                const result = computeFlightResult(mission, telem!);
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
