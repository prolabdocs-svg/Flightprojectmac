// Spec section 23 / 53 / 150: Audio engine. Web Audio API based, bus-mixed
// (Master -> Music/SFX/Engine), mobile-safe unlock-on-gesture, and procedural
// synthesis for both UI stingers and the live flight loop (engine, propeller,
// wind, ground rumble, stall horn) plus one-shot flight events.
//
// NOTE: every sound produced here is a procedurally generated oscillator/noise
// tone, not a final art asset. Real recorded/produced SFX and music (spec
// 23.2-23.8, 92, 93) should replace these placeholders later; the bus/volume/
// unlock/flight-graph plumbing is meant to be final.

import {
  engineFilterCutoffHz,
  engineFundamentalHz,
  engineGain,
  propWhooshGain,
  propWhooshHz,
  rpmFraction,
  rumbleGain,
  stallHornGain,
  windFilterCutoffHz,
  windGain,
} from './flightAudioMappings';

type Bus = 'music' | 'sfx' | 'engine';

export type UiToneKind = 'tap' | 'confirm' | 'back' | 'transition' | 'success' | 'fail';

export type FlightAudioEvent =
  | 'touchdown'
  | 'hardLanding'
  | 'crash'
  | 'missionComplete'
  | 'missionFailed'
  | 'engineStart'
  | 'engineStop'
  | 'stallBreak';

export interface FlightAudioState {
  rpm: number;
  idleRpm: number;
  redlineRpm: number;
  throttle: number; // 0..1 applied
  airspeedMs: number;
  groundSpeedMs: number;
  onGround: boolean;
  stallWarning: boolean;
  engineOn: boolean;
  paused: boolean;
}

/** Old two-oscillator engine drone, kept driveable by both the legacy
 * updateEngine(rpmFrac, running) call and the new updateFlight(state) call —
 * whichever caller is active owns these params for that frame. */
interface EngineNodes {
  osc1: OscillatorNode;
  osc2: OscillatorNode;
  gain1: GainNode;
  gain2: GainNode;
  filter: BiquadFilterNode;
}

/** Everything the live flight loop needs, built lazily once per flight and
 * torn down by stopFlight()/stopEngine(). All noise loops share one
 * pre-generated buffer; only their filters/gains differ. */
interface FlightGraph extends EngineNodes {
  propSrc: AudioBufferSourceNode;
  propFilter: BiquadFilterNode;
  propGain: GainNode;
  windSrc: AudioBufferSourceNode;
  windFilter: BiquadFilterNode;
  windGain: GainNode;
  rumbleSrc: AudioBufferSourceNode;
  rumbleFilter: BiquadFilterNode;
  rumbleGain: GainNode;
  stallOsc: OscillatorNode;
  stallGain: GainNode;
  /** Ducks the whole flight loop mix (not the bus itself, so bus volume
   * settings stay independent) when paused or the tab is hidden. */
  duckGain: GainNode;
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
  private flightGraph: FlightGraph | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private unlockCleanup: (() => void) | null = null;
  private visibilityListenerInstalled = false;
  private documentHidden = false;
  private lastPaused = false;

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

  private ensureNoiseBuffer(ctx: AudioContext): AudioBuffer {
    if (this.noiseBuffer) return this.noiseBuffer;
    const length = ctx.sampleRate * 2; // 2s, looped for continuous layers, sliced for bursts
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buffer;
    return buffer;
  }

  private ensureVisibilityListener(): void {
    if (this.visibilityListenerInstalled || typeof document === 'undefined') return;
    this.documentHidden = document.hidden;
    document.addEventListener('visibilitychange', () => {
      this.documentHidden = document.hidden;
      this.applyDuck();
    });
    this.visibilityListenerInstalled = true;
  }

  /** document.hidden must silence flight loops even if the game loop (and so
   * updateFlight) is paused by the browser while the tab is backgrounded. */
  private applyDuck(): void {
    const ctx = this.ctx;
    const g = this.flightGraph;
    if (!ctx || !g) return;
    const target = this.documentHidden || this.lastPaused ? 0 : 1;
    g.duckGain.gain.setTargetAtTime(target, ctx.currentTime, 0.05);
  }

  /** Builds the whole flight sound graph (engine drone, prop whoosh, wind,
   * ground rumble, stall horn) once and starts every source running at ~0
   * gain. Cheap to leave running; updateFlight only ever touches params. */
  private ensureFlightGraph(): FlightGraph | null {
    const ctx = this.ensureContext();
    const bus = this.busGains.engine;
    if (!ctx || !bus) return null;
    if (this.flightGraph) return this.flightGraph;
    this.ensureVisibilityListener();

    const osc1 = ctx.createOscillator();
    osc1.type = 'sawtooth';
    osc1.frequency.value = 20;
    const osc2 = ctx.createOscillator();
    osc2.type = 'square';
    osc2.frequency.value = 40;
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

    const noise = this.ensureNoiseBuffer(ctx);

    const propSrc = ctx.createBufferSource();
    propSrc.buffer = noise;
    propSrc.loop = true;
    const propFilter = ctx.createBiquadFilter();
    propFilter.type = 'bandpass';
    propFilter.Q.value = 3.5;
    propFilter.frequency.value = 150;
    const propGain = ctx.createGain();
    propGain.gain.value = 0;
    propSrc.connect(propFilter);
    propFilter.connect(propGain);

    const windSrc = ctx.createBufferSource();
    windSrc.buffer = noise;
    windSrc.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.value = 500;
    const windGainNode = ctx.createGain();
    windGainNode.gain.value = 0;
    windSrc.connect(windFilter);
    windFilter.connect(windGainNode);

    const rumbleSrc = ctx.createBufferSource();
    rumbleSrc.buffer = noise;
    rumbleSrc.loop = true;
    const rumbleFilter = ctx.createBiquadFilter();
    rumbleFilter.type = 'lowpass';
    rumbleFilter.frequency.value = 200;
    const rumbleGainNode = ctx.createGain();
    rumbleGainNode.gain.value = 0;
    rumbleSrc.connect(rumbleFilter);
    rumbleFilter.connect(rumbleGainNode);

    const stallOsc = ctx.createOscillator();
    stallOsc.type = 'square';
    stallOsc.frequency.value = 720;
    const stallGain = ctx.createGain();
    stallGain.gain.value = 0;
    stallOsc.connect(stallGain);

    const duckGain = ctx.createGain();
    duckGain.gain.value = 1;

    filter.connect(duckGain);
    propGain.connect(duckGain);
    windGainNode.connect(duckGain);
    rumbleGainNode.connect(duckGain);
    stallGain.connect(duckGain);
    duckGain.connect(bus);

    osc1.start();
    osc2.start();
    propSrc.start();
    windSrc.start();
    rumbleSrc.start();
    stallOsc.start();

    this.flightGraph = {
      osc1,
      osc2,
      gain1,
      gain2,
      filter,
      propSrc,
      propFilter,
      propGain,
      windSrc,
      windFilter,
      windGain: windGainNode,
      rumbleSrc,
      rumbleFilter,
      rumbleGain: rumbleGainNode,
      stallOsc,
      stallGain,
      duckGain,
    };
    return this.flightGraph;
  }

  /** Starts the (silent-until-updateEngine/updateFlight) procedural flight
   * loop. Idempotent. */
  startEngine(): void {
    this.ensureFlightGraph();
  }

  /** Legacy entry point: the flight loop is now driven solely by updateFlight(). */
  updateEngine(rpmFrac: number, running: boolean): void {
    void rpmFrac;
    void running;
  }

  /** Full procedural flight loop driven by live sim state: engine (rpm/load),
   * propeller whoosh, wind, ground rumble, and the stall horn. Called every
   * animation frame — only sets AudioParam targets, never allocates nodes. */
  updateFlight(state: FlightAudioState): void {
    const g = this.ensureFlightGraph();
    const ctx = this.ctx;
    if (!ctx || !g) return;
    const t = ctx.currentTime;
    const rpmFrac = rpmFraction(state.rpm, state.idleRpm, state.redlineRpm);
    // Fast rise when running, slow spin-down when the engine cuts — a single
    // asymmetric time constant gives a natural spin-down with no extra state.
    const engineTau = state.engineOn ? 0.06 : 1.1;

    const fundamentalHz = engineFundamentalHz(state.rpm);
    g.osc1.frequency.setTargetAtTime(fundamentalHz, t, engineTau);
    g.osc2.frequency.setTargetAtTime(fundamentalHz * 2.01, t, engineTau);
    g.filter.frequency.setTargetAtTime(engineFilterCutoffHz(rpmFrac), t, 0.1);
    const eGain = engineGain(state.throttle, state.engineOn);
    g.gain1.gain.setTargetAtTime(eGain, t, engineTau);
    g.gain2.gain.setTargetAtTime(eGain * 0.55, t, engineTau);

    g.propFilter.frequency.setTargetAtTime(propWhooshHz(state.rpm), t, 0.1);
    g.propGain.gain.setTargetAtTime(propWhooshGain(rpmFrac, state.engineOn), t, 0.15);

    g.windFilter.frequency.setTargetAtTime(windFilterCutoffHz(state.airspeedMs), t, 0.2);
    g.windGain.gain.setTargetAtTime(windGain(state.airspeedMs), t, 0.2);

    g.rumbleGain.gain.setTargetAtTime(rumbleGain(state.onGround, state.groundSpeedMs), t, 0.15);

    g.stallGain.gain.setTargetAtTime(stallHornGain(state.stallWarning, t), t, 0.02);

    this.lastPaused = state.paused;
    this.applyDuck();
  }

  private playThump(ctx: AudioContext, bus: GainNode, t: number, gainAmt: number, startHz: number, dur: number): void {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const gain = ctx.createGain();
    osc.frequency.setValueAtTime(startHz * 1.6, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, startHz * 0.5), t + dur);
    gain.gain.setValueAtTime(gainAmt, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain);
    gain.connect(bus);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private playNoiseBurst(ctx: AudioContext, bus: GainNode, t: number, gainAmt: number, filterHz: number, dur: number): void {
    const src = ctx.createBufferSource();
    src.buffer = this.ensureNoiseBuffer(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = filterHz;
    filter.Q.value = 0.8;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainAmt, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(bus);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  private playEngineCough(ctx: AudioContext, bus: GainNode, t: number): void {
    this.playNoiseBurst(ctx, bus, t, 0.12, 400, 0.25); // starter grind
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    const gain = ctx.createGain();
    osc.frequency.setValueAtTime(30, t);
    osc.frequency.linearRampToValueAtTime(65, t + 0.35);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.22, t + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    osc.connect(gain);
    gain.connect(bus);
    osc.start(t);
    osc.stop(t + 0.45);
  }

  /** One-shot flight event stingers (crash, touchdown, mission result, engine
   * starter/spin-down flavor, stall buffet). `intensity` (0..1, default a
   * middling 0.6) scales loudness/harshness — e.g. touchdown sink rate via
   * sinkRateToIntensity() from flightAudioMappings. */
  playEvent(event: FlightAudioEvent, intensity = 0.6): void {
    const ctx = this.ensureContext();
    const bus = this.busGains.sfx;
    if (!ctx || !bus || ctx.state !== 'running') return;
    const amt = Math.max(0, Math.min(1, intensity));
    const t = ctx.currentTime;

    switch (event) {
      case 'missionComplete':
        this.playTone('success');
        return;
      case 'missionFailed':
        this.playTone('fail');
        return;
      case 'touchdown':
        this.playThump(ctx, bus, t, 0.15 + amt * 0.25, 90, 0.18);
        this.playNoiseBurst(ctx, bus, t, 0.05 + amt * 0.1, 1800, 0.1); // tire chirp
        return;
      case 'hardLanding':
        this.playThump(ctx, bus, t, 0.3 + amt * 0.4, 65, 0.3);
        this.playNoiseBurst(ctx, bus, t, 0.15 + amt * 0.25, 1200, 0.22);
        return;
      case 'crash':
        this.playThump(ctx, bus, t, 0.5 + amt * 0.4, 45, 0.5);
        this.playNoiseBurst(ctx, bus, t, 0.35 + amt * 0.3, 700, 0.6);
        return;
      case 'stallBreak':
        this.playNoiseBurst(ctx, bus, t, 0.1 + amt * 0.2, 350, 0.35);
        return;
      case 'engineStart':
        this.playEngineCough(ctx, bus, t);
        return;
      case 'engineStop':
        this.playNoiseBurst(ctx, bus, t, 0.08, 250, 0.15); // mechanical clunk tail
        return;
    }
  }

  /** Silences and releases all flight loops (flight exit). Safe to call
   * whether or not a flight was ever started. */
  stopFlight(): void {
    const g = this.flightGraph;
    if (!g) return;
    [g.osc1, g.osc2, g.propSrc, g.windSrc, g.rumbleSrc, g.stallOsc].forEach((n) => {
      try {
        n.stop();
      } catch {
        // already stopped
      }
    });
    this.flightGraph = null;
  }

  stopEngine(): void {
    this.stopFlight();
  }

  /** Legacy wind API: wind is now part of updateFlight(); kept so old callers compile. */
  updateWind(speedMs: number): void {
    void speedMs;
  }

  stopWind(): void {
    this.stopFlight();
  }
}

export const audioService = new AudioService();
