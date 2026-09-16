import { useCallback, useEffect, useRef } from 'react';
import type { MissionDefinition } from '../../core/types';
import type { FlightTelemetry } from '../../sim/flightController';
import { useMode2Store } from '../../input/mode2Store';
import { audioService } from '../../audio/audioService';
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
  paused: boolean;
  onPause: () => void;
}

export function FlightHud({ telemetry, mission, paused, onPause }: FlightHudProps) {
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
  const deployChute = useMode2Store((s) => s.deployChute);

  // Spec 23.2/150.2: procedural engine sound driven by live RPM/throttle
  // telemetry. Lives here (not in FlightScreen/flightController, which are
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
  const altFt = Math.round(telemetry.altitudeM * 3.281);
  const fuelPct = Math.round(telemetry.fuelFraction * 100);
  const rpmFrac = telemetry.rpm / ENGINE_RPM_REDLINE;

  // Functional color coding only (spec 83.2): green nominal / amber caution / red
  // critical, never relying on color alone — the unit label + numeric value are
  // always present alongside the tint.
  const fuelStatus = fuelPct <= 12 ? 'critical' : fuelPct <= 28 ? 'caution' : 'nominal';
  const rpmStatus = rpmFrac >= 0.97 ? 'critical' : rpmFrac >= 0.88 ? 'caution' : 'nominal';

  return (
    <div className="flight-hud">
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
          II
        </button>
      </div>

      {mission && (
        <div className="hud-mission-banner">
          <strong>{mission.name}</strong>
          <span>{telemetry.distanceM.toFixed(0)} m recorridos</span>
        </div>
      )}

      <div className="hud-state-banner">
        {telemetry.crashed && <span className="banner-crash">ACCIDENTE</span>}
        {telemetry.landed && !telemetry.crashed && <span className="banner-landed">ATERRIZADO — calidad {(telemetry.landingQuality * 100).toFixed(0)}%</span>}
      </div>

      <div className="hud-secondary-controls">
        <button className={engineOn ? 'active' : ''} onClick={toggleEngine}>
          {engineOn ? 'ENGINE STOP' : 'ENGINE START'}
        </button>
        <button
          className={brake ? 'active' : ''}
          onPointerDown={() => setBrake(true)}
          onPointerUp={() => setBrake(false)}
          onPointerLeave={() => setBrake(false)}
        >
          BRAKE
        </button>
        <button className={flapsDown ? 'active' : ''} onClick={toggleFlaps}>
          FLAPS {flapsDown ? 'UP' : 'DOWN'}
        </button>
        <button onClick={deployChute}>CHUTE</button>
      </div>

      <div className="hud-sticks">
        <VirtualStick label="Throttle / Rudder" stickyY springX springY={false} initialY={-1} onChange={onLeftStick} />
        <VirtualStick label="Elevator / Aileron" springX springY onChange={onRightStick} />
      </div>
    </div>
  );
}
