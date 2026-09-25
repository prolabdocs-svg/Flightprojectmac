import { useCallback, useEffect, useRef, useState } from 'react';
import type { MissionDefinition } from '../../core/types';
import type { FlightTelemetry } from '../../flight/flightTypes';
import type { ContractState } from '../../mission/types';
import { useMode2Store } from '../../input/mode2Store';
import { audioService } from '../../audio/audioService';
import { getMissionProgress } from '../../content/missionProgress';
import { VirtualStick } from './VirtualStick';
import { guidanceVisibility, type Guidance, type GuidanceMode } from '../../nav/flightPlan';
import { formatDistance } from '../../map/mapPlan';
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
  fpv: boolean;
  onToggleCamera: () => void;
  /** Tank size in litres, so the fuel readout is the same magnitude the simulation burns and the save stores. */
  fuelCapacityL?: number;
  /** Current mission phase from the mission domain (RODAJE, DESPEGUE, ...). */
  phaseLabel?: string;
  /** Contract state from the mission domain; when present it decides the end-of-flight banner. */
  contractState?: ContractState;
  /** Live route guidance (src/nav) and how much of it the difficulty reveals. */
  nav?: Guidance | null;
  navMode?: GuidanceMode;
}

export function FlightHud({ telemetry, mission, freeFlightRegionName, freeFlightAirfieldName, paused, onPause, fpv, onToggleCamera, fuelCapacityL, phaseLabel, contractState, nav, navMode = 'standard' }: FlightHudProps) {
  const [impactPulse, setImpactPulse] = useState<'hard' | 'crash' | null>(null);
  const impactKey = `${telemetry.crashOutcome}:${telemetry.lastTouchdownVsMs}:${telemetry.crashed}`;
  useEffect(() => {
    if (telemetry.crashed) setImpactPulse('crash');
    else if (telemetry.crashOutcome === 'hardLanding' && telemetry.lastTouchdownVsMs !== null) setImpactPulse('hard');
    else return;
    const timeout = window.setTimeout(() => setImpactPulse(null), 620);
    return () => window.clearTimeout(timeout);
  }, [impactKey, telemetry.crashed, telemetry.crashOutcome, telemetry.lastTouchdownVsMs]);
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
  const navVis = guidanceVisibility(navMode);
  // Without a flight plan the legacy objective bearing still points the way (Minimal hides both).
  const bearingDeg = nav ? nav.deltaDeg : missionProgress?.bearingDeltaDeg;
  const bearingLabel = bearingDeg === undefined || !navVis.hudArrow
    ? null
    : `${bearingDeg < -8 ? '←' : bearingDeg > 8 ? '→' : '↑'} ${Math.abs(Math.round(bearingDeg))}°`;

  return (
    <div className="flight-hud">
      {impactPulse && <div key={impactKey} className={`hud-impact-flash is-${impactPulse}`} aria-hidden="true" />}
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
          <span className="hud-value" data-testid="hud-fuel">{fuelCapacityL ? (telemetry.fuelFraction * fuelCapacityL).toFixed(1) : `${fuelPct}%`}</span>
          <span className="hud-unit">{fuelCapacityL ? 'L FUEL' : 'FUEL'}</span>
        </div>
        <div className={`hud-readout hud-readout-${rpmStatus}`}>
          <span className="hud-value">{Math.round(telemetry.rpm)}</span>
          <span className="hud-unit">RPM</span>
        </div>
        <button className="hud-pause-btn" onClick={onToggleCamera} aria-pressed={fpv} title="Cámara (C)">
          <span aria-hidden="true">{fpv ? '3P' : 'FPV'}</span><span className="sr-only">Cambiar cámara</span>
        </button>
        <button className="hud-pause-btn" onClick={onPause} disabled={paused}>
          <span aria-hidden="true">Ⅱ</span><span className="sr-only">Pausar</span>
        </button>
      </div>

      {mission && (
        <div className="hud-mission-banner">
          <strong>{mission.name}</strong>
          <span className={`hud-objective hud-objective-${missionProgress?.state ?? 'active'}`}>{missionProgress?.primaryLabel}</span>
          {missionProgress?.secondaryLabel && !nav && <span>{missionProgress.secondaryLabel}</span>}
          {bearingLabel && navVis.hudName && <span className="hud-bearing" aria-label={`Rumbo al destino ${bearingLabel}`}>{bearingLabel}</span>}
          {nav && navVis.hudName && (
            <span className="hud-nav" data-testid="hud-nav">
              <b>{nav.phase === 'go-around' ? 'GO AROUND' : nav.phase === 'final' ? 'FINAL' : nav.phase === 'approach' ? 'APROX.' : nav.legCount > 1 ? `WP ${nav.legIndex}/${nav.legCount}` : 'DEST.'}</b>
              {' '}{nav.targetLabel} · {formatDistance(nav.distanceM)}
              {navVis.hudArrow && ` · RUMBO ${String(Math.round(nav.bearingDeg)).padStart(3, '0')}°`}
              {navVis.approachReadout && nav.runway && nav.thresholdDistanceM !== undefined && nav.alignmentErrorDeg !== undefined && nav.lateralDeviationM !== undefined && nav.verticalDeviationM !== undefined && (
                <em className="hud-nav-approach"> · PISTA {nav.runway.approachHeadingDeg.toFixed(0).padStart(3, '0')}° · UMBRAL {formatDistance(nav.thresholdDistanceM)} · EJE {Math.round(Math.abs(nav.lateralDeviationM))} m {nav.lateralDeviationM < 0 ? 'IZQ.' : 'DER.'} · ALINEA {Math.round(Math.abs(nav.alignmentErrorDeg))}° · SENDA {nav.verticalDeviationM > 0 ? '+' : ''}{Math.round(nav.verticalDeviationM)} m</em>
              )}
              {nav.goAroundRecommended && navVis.approachReadout && <strong className="hud-nav-go-around"> · GO AROUND</strong>}
              {navVis.hudAltitude && nav.targetAltM !== undefined && nav.climbNeededM !== undefined && nav.climbNeededM > 0 && (
                <em className="hud-nav-alt"> · SUBIR a {Math.round(nav.targetAltM * 3.281)} ft</em>
              )}
            </span>
          )}
          {phaseLabel && <span className="hud-phase" data-testid="hud-phase">{phaseLabel}</span>}
          <span>{telemetry.elapsedS.toFixed(1)} s</span>
        </div>
      )}
      {!mission && freeFlightRegionName && (
        <div className="hud-mission-banner hud-free-flight-banner">
          <strong>VUELO LIBRE — {freeFlightRegionName}</strong>
          <span>Salida: {freeFlightAirfieldName ?? 'pista local'} · Explora y aterriza donde quieras</span>
          {nav && navVis.hudName && (
            <span className="hud-nav" data-testid="hud-nav">
              <b>{nav.phase === 'go-around' ? 'GO AROUND' : nav.phase === 'final' ? 'FINAL' : nav.phase === 'approach' ? 'APROX.' : nav.legCount > 1 ? `WP ${nav.legIndex}/${nav.legCount}` : 'DEST.'}</b>
              {' '}{nav.targetLabel} · {formatDistance(nav.distanceM)}
              {navVis.hudArrow && ` · RUMBO ${String(Math.round(nav.bearingDeg)).padStart(3, '0')}°`}
            </span>
          )}
          <span>{telemetry.elapsedS.toFixed(1)} s</span>
        </div>
      )}

      <div className="hud-state-banner">
        {telemetry.outOfFuel && !telemetry.crashed && <span className="banner-objective-missed" data-testid="hud-out-of-fuel">SIN COMBUSTIBLE — recarga en un aeródromo</span>}
        {contractState === 'FAILED' && <span className="banner-crash">CONTRATO FALLIDO</span>}
        {contractState === 'OBJECTIVE_MET' && <span className="banner-landed">CONTRATO COMPLETADO — calidad {(telemetry.landingQuality * 100).toFixed(0)}%</span>}
        {contractState === 'ABORTED' && <span className="banner-objective-missed">CONTRATO ABORTADO</span>}
        {!contractState && telemetry.crashed && <span className="banner-crash">ACCIDENTE</span>}
        {!contractState && telemetry.landed && !telemetry.crashed && <span className={missionProgress?.state === 'completed' ? 'banner-landed' : 'banner-objective-missed'}>
          {missionProgress?.state === 'completed' ? 'CONTRATO COMPLETADO' : 'ATERRIZAJE FUERA DE OBJETIVO'} — calidad {(telemetry.landingQuality * 100).toFixed(0)}%
        </span>}
        {/* Detached parts change handling drastically and stay relevant for the rest of the
            flight — worth a persistent warning. Merely "damaged" (still attached) parts are
            not: the impact shake/stinger (FlightScreen) already covers that moment. */}
        {!telemetry.crashed && telemetry.detachedPartIds.length > 0 && (
          <span className="banner-objective-missed" data-testid="hud-detached-warning">PIEZA DESPRENDIDA — control degradado</span>
        )}
      </div>

      {telemetry.partIntegrity && Object.entries(telemetry.partIntegrity).some(([, value]) => value < 0.7) && (
        <aside className="hud-damage-readout" aria-label="Daños visibles en la estructura">
          <div><strong>DAÑO ESTRUCTURAL</strong><span>{telemetry.detachedPartIds.length ? 'FALLO' : 'DEGRADADO'}</span></div>
          {Object.entries(telemetry.partIntegrity).filter(([, value]) => value < 0.7).sort((a, b) => a[1] - b[1]).slice(0, 3).map(([id, value]) => (
            <section key={id}>
              <span>{({ __gear__: 'Tren', wing_root_main: 'Ala', wing_l: 'Ala izq.', wing_r: 'Ala der.', aileron_l: 'Alerón izq.', aileron_r: 'Alerón der.', elevator: 'Elevador', rudder: 'Timón', tail: 'Cola', nose: 'Morro', engine: 'Motor', propeller: 'Hélice', fuselage: 'Fuselaje' } as Record<string, string>)[id] ?? id.replaceAll('_', ' ')}</span>
              <i><b className={value < 0.4 ? 'is-critical' : ''} style={{ width: `${Math.round(value * 100)}%` }} /></i>
              <em>{Math.round(value * 100)}%</em>
            </section>
          ))}
        </aside>
      )}


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
        Teclado: W/S potencia (mantener; Mayús = fino) · ↑↓ cabeceo · ←→ alabeo · A/D timón · Espacio freno · E motor · F flaps · Mando: sticks + RT potencia
      </div>

      <div className="hud-sticks">
        <VirtualStick label="Throttle / Rudder" stickyY springX springY={false} initialY={-1} onChange={onLeftStick} />
        <VirtualStick label="Elevator / Aileron" springX springY onChange={onRightStick} />
      </div>
    </div>
  );
}
