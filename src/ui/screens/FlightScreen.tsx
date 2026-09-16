import { useEffect, useRef, useState } from 'react';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { useGameStore } from '../../state/gameStore';
import { useProfileStore } from '../../state/profileStore';
import { useMode2Store, getResolvedControls } from '../../input/mode2Store';
import { resolveAircraft } from '../../content/assembly';
import { getMission } from '../../content/missions';
import { THE_FIELD } from '../../content/regions';
import { initPhysics, createWorld } from '../../sim/physics';
import { FlightController, type FlightTelemetry } from '../../sim/flightController';
import { FlightScene } from '../../render/FlightScene';
import { computeFlightResult } from '../../content/economy';
import { getPaint } from '../../content/paint';
import { FlightHud } from '../components/FlightHud';

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
    let accumulator = 0;
    let lastNow = performance.now();

    async function boot() {
      await initPhysics();
      if (disposed || !canvasRef.current) return;

      const world = createWorld();
      const groundDesc = RAPIER.ColliderDesc.cuboid(3000, 0.5, 3000).setTranslation(0, -0.5, 0).setFriction(0.85);
      world.createCollider(groundDesc);

      const aircraft = resolveAircraft(profile.currentBuild);
      const spawn = mission
        ? new THREE.Vector3(...mission.spawnPoint)
        : new THREE.Vector3(0, 1.2, 0);
      const controller = new FlightController(world, aircraft, spawn, mission?.spawnHeadingDeg ?? 0);
      controllerRef.current = controller;

      const paint = getPaint(profile.selectedPaintId);
      const scene = new FlightScene(canvasRef.current, THE_FIELD, paint && {
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

      const wind = new THREE.Vector3(...THE_FIELD.windBaseMs);

      const loop = () => {
        if (disposed) return;
        const now = performance.now();
        const frameDt = Math.min(0.1, (now - lastNow) / 1000);
        lastNow = now;

        if (!useGameStore.getState().paused) {
          accumulator += frameDt;
          let telem: FlightTelemetry | null = null;
          let steps = 0;
          while (accumulator >= FIXED_DT && steps < 8) {
            const controls = getResolvedControls();
            telem = controller.step(controls, wind);
            accumulator -= FIXED_DT;
            steps++;
          }
          if (telem) {
            setTelemetry(telem);
            if ((telem.crashed || telem.landed) && endTimerRef.current === null) {
              endTimerRef.current = window.setTimeout(() => {
                const result = computeFlightResult(mission, telem!);
                applyFlightResult(result);
                setLastResult(result);
                goTo('results');
              }, 1600);
            }
          }
        }

        const pos = controller.body.translation();
        const rot = controller.body.rotation();
        scene.syncAircraft(new THREE.Vector3(pos.x, pos.y, pos.z), new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w));
        scene.render();

        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);

      return () => window.removeEventListener('resize', resize);
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
