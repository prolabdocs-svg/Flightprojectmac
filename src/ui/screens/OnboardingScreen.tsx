import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useGameStore } from '../../state/gameStore';
import { useProfileStore } from '../../state/profileStore';
import { useMode2Store } from '../../input/mode2Store';
import './Screens.css';

// Spec 82.2 First-run onboarding: Mode 2 explanation, minimal steps to first mission.
// Spec 16.1/16.2: let the player feel the gimbals respond before their first real flight.
const STEP_COUNT = 4;

/** A single draggable Mode 2 practice gimbal. Left = throttle(sticky)/rudder(spring).
 * Right = elevator/aileron (both spring back to center on release). This is a self-contained
 * practice widget — it does not reuse the in-flight HUD gimbal component, to avoid touching
 * files owned by the flight-input work happening in parallel. */
function PracticePad({ side }: { side: 'left' | 'right' }) {
  const padRef = useRef<HTMLDivElement>(null);
  const [dot, setDot] = useState({ x: 0, y: 0 }); // -1..1 each axis, for rendering only
  const throttle = useMode2Store((s) => s.throttle);
  const setThrottle = useMode2Store((s) => s.setThrottle);
  const setRudder = useMode2Store((s) => s.setRudder);
  const setElevator = useMode2Store((s) => s.setElevator);
  const setAileron = useMode2Store((s) => s.setAileron);

  const applyFromPointer = (clientX: number, clientY: number) => {
    const el = padRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const nx = Math.max(-1, Math.min(1, ((clientX - rect.left) / rect.width) * 2 - 1));
    const ny = Math.max(-1, Math.min(1, ((clientY - rect.top) / rect.height) * 2 - 1));
    setDot({ x: nx, y: ny });
    if (side === 'left') {
      setThrottle((1 - (ny + 1) / 2)); // up = more throttle, sticky
      setRudder(nx);
    } else {
      setElevator(-ny);
      setAileron(nx);
    }
  };

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    applyFromPointer(e.clientX, e.clientY);
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.buttons === 0) return;
    applyFromPointer(e.clientX, e.clientY);
  };
  const onUp = () => {
    if (side === 'left') {
      // Throttle stays where it was released (sticky); rudder springs back.
      setRudder(0);
      setDot((d) => ({ x: 0, y: d.y }));
    } else {
      setElevator(0);
      setAileron(0);
      setDot({ x: 0, y: 0 });
    }
  };

  return (
    <div className="practice-pad-wrap">
      <div
        ref={padRef}
        className="practice-pad"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <div className="practice-pad-cross-v" />
        <div className="practice-pad-cross-h" />
        <div
          className="practice-pad-dot"
          style={{ left: `${((dot.x + 1) / 2) * 100}%`, top: `${((dot.y + 1) / 2) * 100}%` }}
        />
      </div>
      <p className="practice-pad-label">
        {side === 'left' ? `Throttle: ${Math.round(throttle * 100)}% · Rudder` : 'Elevator / Aileron'}
      </p>
    </div>
  );
}

export function OnboardingScreen() {
  const goTo = useGameStore((s) => s.goTo);
  const updateSettings = useProfileStore((s) => s.updateSettings);
  const resetControls = useMode2Store((s) => s.reset);
  const stickSize = useProfileStore((s) => s.profile.settings.stickSize);
  const [step, setStep] = useState(0);

  // Never leave practice-stick input bleeding into the first real flight.
  useEffect(() => resetControls, [resetControls]);

  const finish = () => {
    resetControls();
    localStorage.setItem('project-flight/onboarded', '1');
    updateSettings({ hasSeenOnboarding: true });
    goTo('hangar');
  };

  const next = () => setStep((s) => Math.min(STEP_COUNT - 1, s + 1));
  const back = () => setStep((s) => Math.max(0, s - 1));

  return (
    <div className="screen onboarding-screen">
      <div className="onboarding-progress">
        {Array.from({ length: STEP_COUNT }).map((_, i) => (
          <span key={i} className={`onboarding-dot ${i === step ? 'active' : ''}`} />
        ))}
        <button className="skip-btn" onClick={finish}>
          Saltar tutorial
        </button>
      </div>

      {step === 0 && (
        <>
          <h2>Bienvenido al taller</h2>
          <p>
            Construyes tu propia aeronave y la vuelas con un transmisor RC virtual en <strong>Mode 2</strong>. Sugerencia:
            juega en horizontal (landscape) para más espacio de vuelo.
          </p>
          <div className="mode2-diagram">
            <div className="mode2-col">
              <strong>Stick izquierdo</strong>
              <p>Vertical: Throttle (se queda donde lo sueltes)</p>
              <p>Horizontal: Rudder / Yaw</p>
            </div>
            <div className="mode2-col">
              <strong>Stick derecho</strong>
              <p>Vertical: Elevator / Pitch</p>
              <p>Horizontal: Aileron / Roll</p>
            </div>
          </div>
        </>
      )}

      {step === 1 && (
        <>
          <h2>Pruébalo</h2>
          <p className="onboarding-tip">
            Arrastra los sticks abajo para sentir cómo responden antes de tu primer vuelo. El throttle se queda donde lo
            sueltas; los demás ejes vuelven al centro.
          </p>
          <div className="practice-pads-row">
            <PracticePad side="left" />
            <PracticePad side="right" />
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <h2>Tamaño de los sticks</h2>
          <p className="onboarding-tip">Ajusta el tamaño de los sticks táctiles a lo que te resulte más cómodo. Puedes cambiarlo luego en Ajustes.</p>
          <div className="stick-size-row">
            <input
              type="range"
              min={0.75}
              max={1.5}
              step={0.05}
              value={stickSize}
              onChange={(e) => updateSettings({ stickSize: Number(e.target.value) })}
              aria-label="Tamaño de los sticks"
            />
            <span>{Math.round(stickSize * 100)}%</span>
          </div>
        </>
      )}

      {step === 3 && (
        <>
          <h2>Listo para volar</h2>
          <p>
            Tu primer vuelo es en un campo tranquilo, sin viento y sin castigo por practicar. Puedes repetir este
            tutorial cuando quieras desde Ajustes.
          </p>
        </>
      )}

      <div className="onboarding-nav">
        {step > 0 && (
          <button className="secondary-btn" onClick={back}>
            Atrás
          </button>
        )}
        {step < STEP_COUNT - 1 ? (
          <button className="primary-btn" onClick={next}>
            Siguiente
          </button>
        ) : (
          <button className="primary-btn" onClick={finish}>
            Entrar al taller
          </button>
        )}
      </div>
    </div>
  );
}
