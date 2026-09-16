import { useCallback } from 'react';
import type { MissionDefinition } from '../../core/types';
import type { FlightTelemetry } from '../../sim/flightController';
import { useMode2Store } from '../../input/mode2Store';
import { VirtualStick } from './VirtualStick';
import './FlightHud.css';

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

  return (
    <div className="flight-hud">
      <div className="hud-top">
        <div className="hud-readout">
          <span className="hud-value">{speedKmh}</span>
          <span className="hud-unit">km/h</span>
        </div>
        <div className="hud-readout">
          <span className="hud-value">{altFt}</span>
          <span className="hud-unit">ft ALT</span>
        </div>
        <div className="hud-readout">
          <span className="hud-value">{Math.round(telemetry.fuelFraction * 100)}%</span>
          <span className="hud-unit">FUEL</span>
        </div>
        <div className="hud-readout">
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
