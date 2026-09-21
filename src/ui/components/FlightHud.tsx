import { useCallback, useEffect, useRef } from 'react';
import type { MissionDefinition } from '../../core/types';
import type { FlightTelemetry } from '../../flight/flightTypes';
import { useMode2Store } from '../../input/mode2Store';
import { audioService } from '../../audio/audioService';
import { getMissionProgress } from '../../content/missionProgress';
import { VirtualStick } from './VirtualStick';
import './FlightHud.css';

// Placeholder engine RPM range used to normalize the procedural engine sound
// (spec 150.2). Real per-aircraft idle/redline RPM lives in content/parts.ts;
// this is a reasonable approximation since telemetry only exposes absolute rpm.
const ENGINE_RPM_IDLE = 1200;
const ENGINE_RPM_REDLINE = 6200;

interface FlightHudProps {
  telemetry: FlightTelemetry;
  mission: MissionDefinition | null;
  freeFlightRegionName?: string;
  freeFlightAirfieldName?: string;
  paused: boolean;
  onPause: () => void;
}

export function FlightHud({ telemetry, mission, freeFlightRegionName, freeFlightAirfieldName, paused, onPause }: FlightHudProps) {
  const setThrottle = useMode2Store((s) => s.setThrottle);
  const setRudder = useMode2Store((s) => s.setRudder);
  const setElevator = useMode2Store((s) => s.setElevator);
  const setAileron = useMode2Store((s) => s.setAileron);
  const engineOn = useMode2Store((s) => s.engineOn);
  const toggleEngine = useMode2Store((s) => s.toggleEngine);
  const brake = useMode2Store((s) => s.brake);
  const setBrake = useMode2Store((s) => s.setBrake);
  const flapsDown = useMode2Store((s) => s.flapsDown);
  const toggleFlaps = useMode2Store((s) => s.toggleFlaps);

  // Spec 23.2/150.2: procedural engine sound driven by live RPM/throttle
  // telemetry. Lives here (not in FlightScreen/flightModel, which are
  // owned by other in-progress work) since FlightHud already receives
  // telemetry every frame as a prop.
  const engineStartedRef = useRef(false);
  useEffect(() => {
    if (!engineStartedRef.current) {
      audioService.startEngine();
      engineStartedRef.current = true;
    }
    return () => {
      audioService.stopEngine();
      audioService.stopWind();
      engineStartedRef.current = false;
    };
  }, []);
  useEffect(() => {
    const rpmFrac = (telemetry.rpm - ENGINE_RPM_IDLE) / (ENGINE_RPM_REDLINE - ENGINE_RPM_IDLE);
    audioService.updateEngine(rpmFrac, engineOn && !telemetry.crashed);
  }, [telemetry.rpm, engineOn, telemetry.crashed]);

  const onLeftStick = useCallback(
    (x: number, y: number) => {
      setThrottle((y + 1) / 2); // 0..1
      setRudder(x);
    },
    [setThrottle, setRudder],
  );
  const onRightStick = useCallback(
    (x: number, y: number) => {
      setElevator(y);
      setAileron(x);
    },
    [setElevator, setAileron],
  );

  const speedKmh = Math.round(telemetry.speedMs * 3.6);
  // Speed vignette (task item 4, optional): a pure-CSS radial darkening at high
  // airspeed, cheap enough for mobile since it's one absolutely-positioned div
  // with a gradient — no canvas/WebGL work. Fades in over the same range the
  // camera FOV widens (FlightScene.FOV_SPEED_MIN_MS/MAX_MS) so both cues agree.
  const speedVignetteOpacity = Math.max(0, Math.min(1, (telemetry.speedMs - 20) / 35));
  const altFt = Math.round(telemetry.altitudeM * 3.281);
  const fuelPct = Math.round(telemetry.fuelFraction * 100);
  const rpmFrac = telemetry.rpm / ENGINE_RPM_REDLINE;

  // Functional color coding only (spec 83.2): green nominal / amber caution / red
  // critical, never relying on color alone — the unit label + numeric value are
  // always present alongside the tint.
  const fuelStatus = fuelPct <= 12 ? 'critical' : fuelPct <= 28 ? 'caution' : 'nominal';
  const rpmStatus = rpmFrac >= 0.97 ? 'critical' : rpmFrac >= 0.88 ? 'caution' : 'nominal';
  const missionProgress = getMissionProgress(mission, telemetry);
  const bearingLabel = missionProgress?.bearingDeltaDeg === undefined
    ? null
    : `${missionProgress.bearingDeltaDeg < -8 ? '←' : missionProgress.bearingDeltaDeg > 8 ? '→' : '↑'} ${Math.abs(Math.round(missionProgress.bearingDeltaDeg))}°`;

  return (
    <div className="flight-hud">
      {speedVignetteOpacity > 0 && (
        <div className="hud-speed-vignette" style={{ opacity: speedVignetteOpacity }} />
      )}
      <div className="hud-top">
        <div className="hud-readout hud-readout-nav">
          <span className="hud-value">{speedKmh}</span>
          <span className="hud-unit">km/h</span>
        </div>
        <div className="hud-readout hud-readout-nav">
          <span className="hud-value">{altFt}</span>
          <span className="hud-unit">ft ALT</span>
        </div>
        <div className={`hud-readout hud-readout-${fuelStatus}`}>
          <span className="hud-value">{fuelPct}%</span>
          <span className="hud-unit">FUEL</span>
        </div>
        <div className={`hud-readout hud-readout-${rpmStatus}`}>
          <span className="hud-value">{Math.round(telemetry.rpm)}</span>
          <span className="hud-unit">RPM</span>
        </div>
        <button className="hud-pause-btn" onClick={onPause} disabled={paused}>
          <span aria-hidden="true">Ⅱ</span><span className="sr-only">Pausar</span>
        </button>
      </div>

      {mission && (
        <div className="hud-mission-banner">
          <strong>{mission.name}</strong>
          <span className={`hud-objective hud-objective-${missionProgress?.state ?? 'active'}`}>{missionProgress?.primaryLabel}</span>
          {missionProgress?.secondaryLabel && <span>{missionProgress.secondaryLabel}</span>}
          {bearingLabel && <span className="hud-bearing" aria-label={`Rumbo al destino ${bearingLabel}`}>{bearingLabel}</span>}
          <span>{telemetry.elapsedS.toFixed(1)} s</span>
        </div>
      )}
      {!mission && freeFlightRegionName && (
        <div className="hud-mission-banner hud-free-flight-banner">
          <strong>VUELO LIBRE — {freeFlightRegionName}</strong>
          <span>Salida: {freeFlightAirfieldName ?? 'pista local'} · Explora y aterriza donde quieras</span>
          <span>{telemetry.elapsedS.toFixed(1)} s</span>
        </div>
      )}

      <div className="hud-state-banner">
        {telemetry.crashed && <span className="banner-crash">ACCIDENTE</span>}
        {telemetry.landed && !telemetry.crashed && <span className={missionProgress?.state === 'completed' ? 'banner-landed' : 'banner-objective-missed'}>
          {missionProgress?.state === 'completed' ? 'CONTRATO COMPLETADO' : 'ATERRIZAJE FUERA DE OBJETIVO'} — calidad {(telemetry.landingQuality * 100).toFixed(0)}%
        </span>}
      </div>

      <div className="hud-secondary-controls">
        <button className={engineOn ? 'active' : ''} onClick={toggleEngine}>
          <span className="control-code">PWR</span>{engineOn ? 'CORTAR' : 'MOTOR'}
        </button>
        <button
          className={brake ? 'active' : ''}
          onPointerDown={() => setBrake(true)}
          onPointerUp={() => setBrake(false)}
          onPointerLeave={() => setBrake(false)}
          onPointerCancel={() => setBrake(false)}
          onLostPointerCapture={() => setBrake(false)}
        >
          <span className="control-code">B</span> FRENO
        </button>
        <button className={flapsDown ? 'active' : ''} onClick={toggleFlaps}>
          <span className="control-code">FLP</span> {flapsDown ? 'RETRAER' : 'FLAPS'}
        </button>
      </div>

      <div className="hud-keyboard-hint" aria-hidden="true">
        Teclado: W/S potencia · ↑↓ cabeceo · ←→ alabeo · A/D timón · Espacio freno · E motor · F flaps · Mando: sticks + RT potencia
      </div>

      <div className="hud-sticks">
        <VirtualStick label="Throttle / Rudder" stickyY springX springY={false} initialY={-1} onChange={onLeftStick} />
        <VirtualStick label="Elevator / Aileron" springX springY onChange={onRightStick} />
      </div>
    </div>
  );
}
