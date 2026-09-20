import { useId, useRef, useState, useCallback } from 'react';
import './VirtualStick.css';

interface VirtualStickProps {
  label: string;
  /** If true, Y sticks at last position on release (throttle behaviour). */
  stickyY?: boolean;
  /** If true, X springs back to 0 on release. */
  springX?: boolean;
  springY?: boolean;
  initialY?: number;
  onChange: (x: number, y: number) => void;
}

// Implements the Mode 2 gimbal behaviour from spec section 7.2 / 38:
// independent pointerId per stick, spring-center per axis, sticky throttle.
export function VirtualStick({ label, stickyY = false, springX = true, springY = true, initialY = 0, onChange }: VirtualStickProps) {
  const baseRef = useRef<HTMLDivElement>(null);
  const pointerIdRef = useRef<number | null>(null);
  const controlsId = useId();
  const [pos, setPos] = useState({ x: 0, y: initialY });
  // Pointer-up can arrive before React commits state; this ref is maintained by
  // input handlers so sticky throttle still reads the last physical stick position.
  const posRef = useRef({ x: 0, y: initialY });

  const RADIUS = 55;

  const updateFromClient = useCallback(
    (clientX: number, clientY: number) => {
      const base = baseRef.current;
      if (!base) return;
      const rect = base.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      let dx = clientX - cx;
      let dy = clientY - cy;
      const dist = Math.hypot(dx, dy);
      if (dist > RADIUS) {
        dx = (dx / dist) * RADIUS;
        dy = (dy / dist) * RADIUS;
      }
      const nx = dx / RADIUS;
      const ny = -dy / RADIUS; // up = positive
      const next = { x: nx, y: ny };
      posRef.current = next;
      setPos(next);
      onChange(nx, ny);
    },
    [onChange],
  );

  const handlePointerDown = (e: React.PointerEvent) => {
    if (pointerIdRef.current !== null) return; // already tracking a finger
    pointerIdRef.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    updateFromClient(e.clientX, e.clientY);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (pointerIdRef.current !== e.pointerId) return;
    updateFromClient(e.clientX, e.clientY);
  };

  const endTouch = (e: React.PointerEvent) => {
    if (pointerIdRef.current !== e.pointerId) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    pointerIdRef.current = null;
    const next = {
      x: springX ? 0 : posRef.current.x,
      y: stickyY ? posRef.current.y : springY ? 0 : posRef.current.y,
    };
    posRef.current = next;
    setPos(next);
    onChange(next.x, next.y);
  };

  /** Screen readers and keyboard users need the same two-axis control surface as touch.
   * Native ranges provide robust arrow-key semantics without trying to emulate a pointer
   * gimbal through a custom ARIA role. */
  const setAxis = (axis: 'x' | 'y', value: number) => {
    const next = { ...posRef.current, [axis]: value };
    posRef.current = next;
    setPos(next);
    onChange(next.x, next.y);
  };

  const [verticalLabel, horizontalLabel] = label.split(' / ');

  return (
    <div className="stick-wrapper" role="group" aria-label={`${label} controles táctiles`}>
      <div
        ref={baseRef}
        className="stick-base"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endTouch}
        onPointerCancel={endTouch}
        style={{ touchAction: 'none' }}
        aria-hidden="true"
      >
        <div
          className="stick-knob"
          style={{ transform: `translate(${pos.x * RADIUS}px, ${-pos.y * RADIUS}px)` }}
        />
      </div>
      <span className="stick-label">{label}</span>
      <div className="sr-only" id={controlsId}>
        Ajusta {verticalLabel} y {horizontalLabel} con las flechas. Los atajos de vuelo del teclado siguen disponibles.
      </div>
      <label className="sr-only">
        {verticalLabel}
        <input
          type="range"
          min="-1"
          max="1"
          step="0.05"
          value={pos.y}
          aria-describedby={controlsId}
          aria-valuetext={`${verticalLabel} ${Math.round(((pos.y + 1) / 2) * 100)}%`}
          onChange={(event) => setAxis('y', Number(event.target.value))}
        />
      </label>
      <label className="sr-only">
        {horizontalLabel}
        <input
          type="range"
          min="-1"
          max="1"
          step="0.05"
          value={pos.x}
          aria-describedby={controlsId}
          aria-valuetext={`${horizontalLabel} ${Math.round(pos.x * 100)}%`}
          onChange={(event) => setAxis('x', Number(event.target.value))}
        />
      </label>
    </div>
  );
}
