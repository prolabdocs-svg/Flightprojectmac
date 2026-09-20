import { useEffect, useRef, useState } from 'react';
import type { FlightModel } from '../../flight/flightModel';
import { newExtendedTelemetry, readExtendedTelemetry, type FlightTelemetryExt } from '../../flight/telemetry/flightTelemetry';
import type { FlightRecorder } from '../../flight/telemetry/flightRecorder';

interface Props {
  /** Getter, because the model only exists after the async physics boot. */
  getModel: () => FlightModel | null;
  recorder: FlightRecorder;
  showGizmos: boolean;
  onToggleGizmos: () => void;
}

const f = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '—');

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** Development overlay (spec section 29). Enable with ?flightDebug=1 or F3. Reads at 8 Hz. */
export function FlightDebugOverlay({ getModel, recorder, showGizmos, onToggleGizmos }: Props) {
  const [t, setT] = useState<FlightTelemetryExt | null>(null);
  const scratch = useRef(newExtendedTelemetry());
  const [showElements, setShowElements] = useState(false);

  useEffect(() => {
    const id = window.setInterval(() => {
      const m = getModel();
      if (m) setT({ ...readExtendedTelemetry(m, scratch.current), elements: scratch.current.elements.map((e) => ({ ...e })) });
    }, 125);
    return () => window.clearInterval(id);
  }, [getModel]);

  if (!t) return null;
  const rows: Array<[string, string]> = [
    ['IAS / TAS', `${f(t.iasMs * 3.6, 0)} / ${f(t.tasMs * 3.6, 0)} km/h`],
    ['GS', `${f(t.groundSpeedMs * 3.6, 0)} km/h`],
    ['AGL / MSL', `${f(t.aglM)} / ${f(t.mslM, 0)} m`],
    ['VS', `${f(t.vsMs)} m/s`],
    ['α / β', `${f(t.alphaDeg)}° / ${f(t.betaDeg)}°  (stall margin ${f(t.stallMarginDeg)}°)`],
    ['pitch/roll/hdg', `${f(t.pitchDeg)}° / ${f(t.rollDeg)}° / ${f(t.headingDeg, 0)}°`],
    ['P Q R', `${f(t.pDegS, 0)} ${f(t.qDegS, 0)} ${f(t.rDegS, 0)} °/s`],
    ['G', f(t.gLoad, 2)],
    ['mass / CG z', `${f(t.massKg, 0)} kg / ${f(t.cg[2], 3)} m`],
    ['RPM / thr / thrust', `${f(t.rpm, 0)} / ${f(t.throttle, 2)} / ${f(t.thrustN, 0)} N`],
    ['CL / CD', `${f(t.cl, 2)} / ${f(t.cd, 3)}   L ${f(t.liftN, 0)} D ${f(t.dragN, 0)} N`],
    ['elev/ailL/ailR/rud', `${f(t.elevatorDeg)} ${f(t.aileronLeftDeg)} ${f(t.aileronRightDeg)} ${f(t.rudderDeg)} °`],
    ['wind', `${f(t.wind[0])} ${f(t.wind[1])} ${f(t.wind[2])} m/s`],
    ['assist', t.assistLevel],
    ['physics', `${f(t.physicsMsPerStep, 3)} ms/step (~${f(t.physicsHzCapacity, 0)} Hz cap)  guards ${t.guardEvents}`],
  ];
  return (
    <div style={{ position: 'absolute', top: 64, right: 8, zIndex: 20, font: '11px/1.35 ui-monospace, Menlo, monospace', color: '#dfe', background: 'rgba(0,0,0,0.62)', padding: 8, borderRadius: 6, maxWidth: 360, pointerEvents: 'auto' }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>FLIGHT DEBUG</div>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><span style={{ opacity: 0.7 }}>{k}</span><span>{v}</span></div>
      ))}
      <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button type="button" onClick={onToggleGizmos}>{showGizmos ? 'Hide' : 'Show'} gizmos</button>
        <button type="button" onClick={() => setShowElements((v) => !v)}>Elements</button>
        <button type="button" onClick={() => download('flight.csv', recorder.toCSV(), 'text/csv')}>CSV ({recorder.length})</button>
        <button type="button" onClick={() => download('flight.json', JSON.stringify(recorder.toJSON()), 'application/json')}>JSON</button>
        <button type="button" onClick={() => recorder.clear()}>Clear</button>
      </div>
      {showElements && (
        <table style={{ marginTop: 6, width: '100%', fontSize: 10 }}>
          <thead><tr><th align="left">el</th><th>α°</th><th>V</th><th>CL</th><th>CD</th><th>L N</th><th>stall%</th></tr></thead>
          <tbody>
            {t.elements.map((e) => (
              <tr key={e.id}><td>{e.id}</td><td>{f(e.alphaDeg)}</td><td>{f(e.airspeedMs, 0)}</td><td>{f(e.cl, 2)}</td><td>{f(e.cd, 3)}</td><td>{f(e.liftN, 0)}</td><td>{f(e.stallPct, 0)}</td></tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
