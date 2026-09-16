import { useRef, useState, useCallback } from 'react';
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
  const [pos, setPos] = useState({ x: 0, y: initialY });
  const posRef = useRef(pos);
  posRef.current = pos;

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
      // eslint-disable-next-line no-console
      console.log('[DEBUG-STICK]', { clientY, cy, dy, ny, label });
      setPos({ x: nx, y: ny });
      onChange(nx, ny);
    },
    [onChange],
  );

  const handlePointerDown = (e: React.PointerEvent) => {
    if (pointerIdRef.current !== null) return; // already tracking a finger
    pointerIdRef.current = e.pointerId;
    (e.target as Element).setPointerCapture(e.pointerId);
    updateFromClient(e.clientX, e.clientY);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (pointerIdRef.current !== e.pointerId) return;
    updateFromClient(e.clientX, e.clientY);
  };

  const endTouch = (e: React.PointerEvent) => {
    if (pointerIdRef.current !== e.pointerId) return;
    pointerIdRef.current = null;
    const next = {
      x: springX ? 0 : posRef.current.x,
      y: stickyY ? posRef.current.y : springY ? 0 : posRef.current.y,
    };
    setPos(next);
    onChange(next.x, next.y);
  };

  return (
    <div className="stick-wrapper">
      <div
        ref={baseRef}
        className="stick-base"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endTouch}
        onPointerCancel={endTouch}
        style={{ touchAction: 'none' }}
      >
        <div
          className="stick-knob"
          style={{ transform: `translate(${pos.x * RADIUS}px, ${-pos.y * RADIUS}px)` }}
        />
      </div>
      <span className="stick-label">{label}</span>
    </div>
  );
}
