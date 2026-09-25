import { useEffect, useState } from 'react';
import type { AircraftPerformance } from '../../sim/performance';

/** Compact capability model (spec §15): six bars, each scaled against an end-game ceiling so the bar
 * itself shows how far the aircraft has come. `score` maps a raw value to 0..1, higher = better. */
export const CAPABILITIES: Array<{ key: string; label: string; score: (p: AircraftPerformance) => number; value: (p: AircraftPerformance) => number; unit: string; lowerIsBetter?: boolean; digits?: number }> = [
  { key: 'speed', label: 'Velocidad', value: (p) => p.topSpeedKmh, unit: 'km/h', score: (p) => p.topSpeedKmh / 160 },
  { key: 'climb', label: 'Ascenso', value: (p) => p.climbRateMs, unit: 'm/s', digits: 1, score: (p) => p.climbRateMs / 8 },
  { key: 'range', label: 'Alcance', value: (p) => p.rangeKm, unit: 'km', digits: 1, score: (p) => p.rangeKm / 10 },
  { key: 'field', label: 'Pista corta', value: (p) => p.takeoffRollM, unit: 'm', lowerIsBetter: true, score: (p) => 1 - p.takeoffRollM / 150 },
  { key: 'slow', label: 'Vuelo lento', value: (p) => p.stallSpeedKmh, unit: 'km/h', lowerIsBetter: true, score: (p) => (80 - p.stallSpeedKmh) / 50 },
  { key: 'gear', label: 'Tren', value: (p) => p.gearToleranceMs, unit: 'm/s', digits: 1, score: (p) => p.gearToleranceMs / 6 },
];

const clamp01 = (x: number) => Math.max(0.03, Math.min(1, x));

/** Before → after bars. With no `after`, it is a plain capability readout. Gains are solid green, losses striped red
 * with ▲/▼ glyphs, so the trade-off never depends on colour alone. */
export function StatCompare({ before, after }: { before: AircraftPerformance; after?: AircraftPerformance }) {
  return (
    <div className="stat-compare" data-testid="stat-compare">
      {CAPABILITIES.map((c) => {
        const b = clamp01(c.score(before));
        const a = after ? clamp01(c.score(after)) : b;
        const vb = c.value(before);
        const va = after ? c.value(after) : vb;
        const fmt = (v: number) => v.toFixed(c.digits ?? 0);
        const changed = after && fmt(va) !== fmt(vb);
        const better = a > b;
        return (
          <div key={c.key} className="stat-row">
            <span>{c.label}</span>
            <div className="stat-bar" aria-hidden="true">
              <i className="stat-base" style={{ width: `${Math.min(a, b) * 100}%` }} />
              {changed && <i className={better ? 'stat-gain' : 'stat-loss'} style={{ left: `${Math.min(a, b) * 100}%`, width: `${Math.abs(a - b) * 100}%` }} />}
            </div>
            <b>
              {changed ? <><small style={{ opacity: 0.6 }}>{fmt(vb)}→</small><span className={better ? 'up' : 'down'}>{fmt(va)}</span></> : fmt(vb)}
              <small style={{ opacity: 0.6 }}> {c.unit}</small>
            </b>
          </div>
        );
      })}
    </div>
  );
}

export const usd = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString('es-MX')}`;

/** Money in context (spec §29): price, balance, and what's left after — the decision, not just a number. */
export function PurchaseBox({ price, balance, label, disabledReason, onBuy, testId }: {
  price: number; balance: number; label: string; disabledReason?: string; onBuy: () => void; testId?: string;
}) {
  const after = balance - price;
  const short = after < 0;
  return (
    <div className="purchase-box">
      {price > 0 && (
        <div className="purchase-ledger">
          <span>Precio</span><b>{usd(price)}</b>
          <span>Saldo actual</span><b>{usd(balance)}</b>
          <span className="after">Tras la compra</span><b className={`after${short ? ' is-short' : ''}`}>{usd(after)}</b>
        </div>
      )}
      <button className="primary-btn" data-testid={testId} disabled={short || !!disabledReason} onClick={onBuy}>
        {disabledReason ?? (short ? `Faltan ${usd(-after)}` : label)}
      </button>
    </div>
  );
}

/** Eased count-up for rewards; jumps straight to the value under reduced motion. */
export function CountUp({ value, format = (n) => String(Math.round(n)), durationMs = 900 }: { value: number; format?: (n: number) => string; durationMs?: number }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (document.documentElement.dataset.reduceMotion === 'true' || (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)) { setShown(value); return; }
    let raf = 0;
    const t0 = performance.now();
    const tick = () => {
      const k = Math.min(1, (performance.now() - t0) / durationMs);
      setShown(value * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, durationMs]);
  return <>{format(shown)}</>;
}
