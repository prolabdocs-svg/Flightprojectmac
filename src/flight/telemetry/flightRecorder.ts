// Flight recorder (spec section 31): fixed-capacity column store (Float32Array ring, no
// allocation while recording) that exports CSV/JSON for plotting or analytic replay.

import type { FlightModel } from '../flightModel';
import type { ResolvedControls } from '../flightTypes';
import { readExtendedTelemetry, newExtendedTelemetry } from './flightTelemetry';

export const RECORDER_COLUMNS = [
  't', 'x', 'y', 'z', 'vx', 'vy', 'vz', 'qx', 'qy', 'qz', 'qw', 'pDegS', 'qDegS', 'rDegS', 'alphaDeg', 'betaDeg', 'iasMs', 'aglM', 'vsMs',
  'cmdPitch', 'cmdRoll', 'cmdYaw', 'cmdThrottle', 'elevatorDeg', 'aileronLeftDeg', 'aileronRightDeg', 'rudderDeg',
  'rpm', 'thrustN', 'liftN', 'dragN', 'gLoad', 'windX', 'windY', 'windZ', 'stallMarginDeg', 'wheels',
] as const;

export type RecorderColumn = (typeof RECORDER_COLUMNS)[number];

export class FlightRecorder {
  private readonly data: Float32Array;
  private readonly cols = RECORDER_COLUMNS.length;
  private count = 0;
  private head = 0;
  private acc = 0;
  private readonly period: number;
  private readonly ext = newExtendedTelemetry();

  /** @param hz sample rate (decimated from the physics rate), @param capacity samples kept (ring) */
  private readonly capacity: number;

  constructor(hz = 25, capacity = 30_000) {
    this.capacity = capacity;
    this.data = new Float32Array(capacity * this.cols);
    this.period = 1 / hz;
  }

  get length(): number {
    return this.count;
  }

  clear(): void {
    this.count = this.head = 0;
    this.acc = 0;
  }

  /** Call once per physics tick. */
  tick(model: FlightModel, controls: ResolvedControls, dtS: number): void {
    this.acc += dtS;
    if (this.acc < this.period) return;
    this.acc -= this.period;
    const e = readExtendedTelemetry(model, this.ext);
    const phys = model.sim.physics;
    const p = phys.pos;
    const v = phys.velWorld;
    const q = phys.frame.q;
    const row = [
      model.sim.timeS, p.x, p.y, p.z, v.x, v.y, v.z, q.x, q.y, q.z, q.w, e.pDegS, e.qDegS, e.rDegS, e.alphaDeg, e.betaDeg, e.iasMs, e.aglM, e.vsMs,
      controls.pitch, controls.roll, controls.rudder, controls.throttle, e.elevatorDeg, e.aileronLeftDeg, e.aileronRightDeg, e.rudderDeg,
      e.rpm, e.thrustN, e.liftN, e.dragN, e.gLoad, phys.windBody.x, phys.windBody.y, phys.windBody.z, e.stallMarginDeg, model.sim.gear.summary.wheelsOnGround,
    ];
    const base = this.head * this.cols;
    for (let i = 0; i < this.cols; i++) this.data[base + i] = row[i];
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  /** Rows oldest -> newest. */
  rows(): number[][] {
    const out: number[][] = [];
    const start = this.count < this.capacity ? 0 : this.head;
    for (let n = 0; n < this.count; n++) {
      const idx = ((start + n) % this.capacity) * this.cols;
      out.push(Array.from(this.data.subarray(idx, idx + this.cols)));
    }
    return out;
  }

  toCSV(): string {
    return [RECORDER_COLUMNS.join(','), ...this.rows().map((r) => r.map((v) => (Number.isInteger(v) ? v : Number(v.toPrecision(7)))).join(','))].join('\n');
  }

  toJSON(): { columns: readonly string[]; rows: number[][] } {
    return { columns: RECORDER_COLUMNS, rows: this.rows() };
  }
}
