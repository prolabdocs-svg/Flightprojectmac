// Spec section 23 / 53 / 150: Audio engine. Web Audio API based, bus-mixed
// (Master -> Music/SFX/Engine), mobile-safe unlock-on-gesture, and procedural
// synthesis for both UI stingers and the player engine loop.
//
// NOTE: every sound produced here is a procedurally generated oscillator tone,
// not a final art asset. Real recorded/produced SFX and music (spec 23.2-23.8,
// 92, 93) should replace these placeholders later; the bus/volume/unlock
// plumbing is meant to be final.

type Bus = 'music' | 'sfx' | 'engine';

export type UiToneKind = 'tap' | 'confirm' | 'back' | 'transition' | 'success' | 'fail';

interface EngineNodes {
  osc1: OscillatorNode;
  osc2: OscillatorNode;
  gain1: GainNode;
  gain2: GainNode;
  filter: BiquadFilterNode;
}

const TONE_SPECS: Record<UiToneKind, { freqs: number[]; dur: number; type: OscillatorType; gain: number }> = {
  tap: { freqs: [660], dur: 0.05, type: 'sine', gain: 0.25 },
  back: { freqs: [440], dur: 0.06, type: 'sine', gain: 0.25 },
  confirm: { freqs: [520, 780], dur: 0.09, type: 'triangle', gain: 0.3 },
  transition: { freqs: [300, 480], dur: 0.12, type: 'sine', gain: 0.25 },
  success: { freqs: [523.25, 659.25, 783.99], dur: 0.55, type: 'triangle', gain: 0.3 },
  fail: { freqs: [220, 160], dur: 0.55, type: 'sawtooth', gain: 0.22 },
};

class AudioService {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private busGains: Partial<Record<Bus, GainNode>> = {};
  private volumes: { master: number; music: number; sfx: number } = { master: 1, music: 0.7, sfx: 0.8 };
  private engineNodes: EngineNodes | null = null;
  private unlockCleanup: (() => void) | null = null;

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (this.ctx) return this.ctx;
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    const ctx = new Ctor();
    const master = ctx.createGain();
    master.gain.value = this.volumes.master;
    master.connect(ctx.destination);

    (['music', 'sfx', 'engine'] as Bus[]).forEach((name) => {
      const g = ctx.createGain();
      g.gain.value = name === 'music' ? this.volumes.music : this.volumes.sfx;
      g.connect(master);
      this.busGains[name] = g;
    });

    this.ctx = ctx;
    this.masterGain = master;
    return ctx;
  }

  /** Mobile/browser autoplay policies require a user gesture before audio can play.
   *  Call once at app boot; resumes the (suspended) context on the first valid gesture. */
  installUnlockListener(): void {
    if (typeof window === 'undefined' || this.unlockCleanup) return;
    const events: Array<keyof WindowEventMap> = ['pointerdown', 'touchstart', 'keydown'];
    const tryUnlock = () => {
      const ctx = this.ensureContext();
      if (!ctx) return;
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      if (ctx.state === 'running') {
        cleanup();
      }
    };
    const cleanup = () => {
      events.forEach((e) => window.removeEventListener(e, tryUnlock));
      this.unlockCleanup = null;
    };
    events.forEach((e) => window.addEventListener(e, tryUnlock, { passive: true }));
    this.unlockCleanup = cleanup;
  }

  setVolume(bus: 'master' | Bus, value: number): void {
    const v = Math.max(0, Math.min(1, value));
    if (bus === 'master') {
      this.volumes.master = v;
      if (this.masterGain) this.masterGain.gain.value = v;
      return;
    }
    if (bus === 'music' || bus === 'sfx') this.volumes[bus] = v;
    const g = this.busGains[bus];
    if (g) g.gain.value = v;
  }

  /** Short procedurally-generated UI tone (placeholder — see file header). */
  playTone(kind: UiToneKind): void {
    const ctx = this.ensureContext();
    const bus = this.busGains.sfx;
    if (!ctx || !bus || ctx.state !== 'running') return; // silently no-op until unlocked
    const spec = TONE_SPECS[kind];
    const now = ctx.currentTime;
    spec.freqs.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = spec.type;
      osc.frequency.value = freq;
      const start = now + i * (spec.dur / spec.freqs.length) * 0.9;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(spec.gain, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, start + spec.dur);
      osc.connect(gain);
      gain.connect(bus);
      osc.start(start);
      osc.stop(start + spec.dur + 0.02);
    });
  }

  /** Starts the (silent-until-updateEngine) procedural engine loop. Idempotent. */
  startEngine(): void {
    const ctx = this.ensureContext();
    const bus = this.busGains.engine;
    if (!ctx || !bus || this.engineNodes) return;
    const osc1 = ctx.createOscillator();
    osc1.type = 'sawtooth';
    osc1.frequency.value = 40;
    const osc2 = ctx.createOscillator();
    osc2.type = 'square';
    osc2.frequency.value = 80;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 600;
    const gain1 = ctx.createGain();
    gain1.gain.value = 0.0001;
    const gain2 = ctx.createGain();
    gain2.gain.value = 0.0001;
    osc1.connect(gain1);
    gain1.connect(filter);
    osc2.connect(gain2);
    gain2.connect(filter);
    filter.connect(bus);
    osc1.start();
    osc2.start();
    this.engineNodes = { osc1, osc2, gain1, gain2, filter };
  }

  /** Feeds live throttle/RPM state (0..1 normalized) into the procedural engine loop. */
  updateEngine(rpmFrac: number, running: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.engineNodes) return;
    const { osc1, osc2, gain1, gain2, filter } = this.engineNodes;
    const t = ctx.currentTime;
    const clamped = Math.max(0, Math.min(1, rpmFrac));
    const baseFreq = 40 + clamped * 150;
    osc1.frequency.setTargetAtTime(baseFreq, t, 0.05);
    osc2.frequency.setTargetAtTime(baseFreq * 2.01, t, 0.05);
    filter.frequency.setTargetAtTime(400 + clamped * 2600, t, 0.08);
    const targetGain = running ? 0.05 + clamped * 0.18 : 0.0001;
    gain1.gain.setTargetAtTime(targetGain, t, 0.12);
    gain2.gain.setTargetAtTime(targetGain * 0.6, t, 0.12);
  }

  stopEngine(): void {
    if (!this.engineNodes) return;
    const { osc1, osc2 } = this.engineNodes;
    try {
      osc1.stop();
      osc2.stop();
    } catch {
      // already stopped
    }
    this.engineNodes = null;
  }
}

export const audioService = new AudioService();
