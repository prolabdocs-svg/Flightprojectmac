// Adaptive music director (pure logic, no Web Audio). Decides WHAT should play and
// WHEN; audioService.ts only renders the decision (crossfades between cues).
//
// Model:
//  - one BASE context set by the screen/flight (MENU, HANGAR, CALM_FLIGHT, MISSION);
//  - OVERLAY states raised by gameplay (EXPLORATION, DISCOVERY, DANGER, CRASH_AFTERMATH,
//    VICTORY), each with a priority, a lifetime and a per-event cooldown;
//  - every state alternates "phrase" (music) and "rest" (silence) windows, so music
//    breathes instead of looping forever. Silence is a first-class output (cue = null).
// Rules: a higher-priority overlay interrupts at once (short fade); an equal/lower one is
// dropped while a stronger one plays; when an overlay ends the base context resumes
// with its remaining rest honoured, never restarting a cue abruptly.

export type MusicState =
  | 'MENU'
  | 'HANGAR'
  | 'CALM_FLIGHT'
  | 'EXPLORATION'
  | 'DISCOVERY'
  | 'MISSION'
  | 'DANGER'
  | 'CRASH_AFTERMATH'
  | 'VICTORY';

export type BaseMusicState = 'MENU' | 'HANGAR' | 'CALM_FLIGHT' | 'MISSION';

export type MusicEvent =
  | 'takeoff'
  | 'regionEnter'
  | 'landmarkDiscovered'
  | 'dangerousWeather'
  | 'emergency'
  | 'hardApproach'
  | 'missionComplete'
  | 'crash';

interface StateSpec {
  priority: number;
  /** Placeholder cue ids (see MUSIC_CUES in audioService). Rotated, never the same twice in a row. */
  cues: string[];
  /** Music window length range, seconds. */
  phraseS: [number, number];
  /** Silence after each phrase, seconds. 0 = continuous (used by short stingers). */
  restS: [number, number];
  /** Rest before the very first phrase when the state is entered. */
  entryRestS: [number, number];
  fadeInS: number;
  fadeOutS: number;
  /** Overlays only: how long the overlay lasts before the base resumes (keep phraseS >= this: one cue per overlay). */
  lifetimeS?: number;
}

export const MUSIC_STATES: Record<MusicState, StateSpec> = {
  MENU: { priority: 0, cues: ['menu_a', 'menu_b'], phraseS: [70, 110], restS: [20, 40], entryRestS: [0.5, 1], fadeInS: 3, fadeOutS: 4 },
  HANGAR: { priority: 0, cues: ['hangar_a', 'hangar_b'], phraseS: [60, 100], restS: [30, 60], entryRestS: [2, 5], fadeInS: 4, fadeOutS: 4 },
  // In flight the engine and wind ARE the soundtrack most of the time: long rests.
  CALM_FLIGHT: { priority: 0, cues: ['calm_a', 'calm_b', 'calm_c'], phraseS: [60, 100], restS: [90, 180], entryRestS: [25, 45], fadeInS: 8, fadeOutS: 8 },
  MISSION: { priority: 0, cues: ['mission_a', 'mission_b'], phraseS: [50, 90], restS: [60, 120], entryRestS: [20, 35], fadeInS: 6, fadeOutS: 6 },
  EXPLORATION: { priority: 1, cues: ['explore_a', 'explore_b'], phraseS: [80, 80], restS: [0, 0], entryRestS: [1, 2], fadeInS: 6, fadeOutS: 8, lifetimeS: 80 },
  DISCOVERY: { priority: 2, cues: ['discovery_a', 'discovery_b'], phraseS: [18, 18], restS: [0, 0], entryRestS: [0, 0], fadeInS: 1.5, fadeOutS: 5, lifetimeS: 18 },
  DANGER: { priority: 3, cues: ['danger_a', 'danger_b'], phraseS: [600, 600], restS: [0, 0], entryRestS: [0, 0], fadeInS: 2, fadeOutS: 5, lifetimeS: 20 },
  VICTORY: { priority: 4, cues: ['victory_a'], phraseS: [12, 12], restS: [0, 0], entryRestS: [0, 0], fadeInS: 0.8, fadeOutS: 4, lifetimeS: 14 },
  CRASH_AFTERMATH: { priority: 5, cues: ['aftermath_a'], phraseS: [20, 20], restS: [0, 0], entryRestS: [2.5, 2.5], fadeInS: 4, fadeOutS: 6, lifetimeS: 26 },
};

const EVENT_RULES: Record<MusicEvent, { state: MusicState; cooldownS: number }> = {
  takeoff: { state: 'EXPLORATION', cooldownS: 240 },
  regionEnter: { state: 'EXPLORATION', cooldownS: 180 },
  landmarkDiscovered: { state: 'DISCOVERY', cooldownS: 45 },
  dangerousWeather: { state: 'DANGER', cooldownS: 30 },
  emergency: { state: 'DANGER', cooldownS: 10 },
  hardApproach: { state: 'DANGER', cooldownS: 60 },
  missionComplete: { state: 'VICTORY', cooldownS: 5 },
  crash: { state: 'CRASH_AFTERMATH', cooldownS: 5 },
};

/** After a non-urgent overlay ends, only urgent ones (priority >= this) may start for BREATHE_S. */
const URGENT_PRIORITY = 3;
const BREATHE_S = 90;
/** A playing overlay can't be pre-empted by a non-urgent one before this. */
const MIN_DWELL_S = 20;

export interface MusicOutput {
  cue: string | null;
  fadeS: number;
  state: MusicState;
}

interface Track {
  state: MusicState;
  /** true while inside a phrase, false while resting. */
  playing: boolean;
  /** Seconds left in the current phrase/rest window. */
  windowLeftS: number;
  cue: string | null;
}

export class MusicDirector {
  private t = 0;
  private base: Track;
  private overlay: (Track & { expiresAt: number; startedAt: number }) | null = null;
  private lastCue: Partial<Record<MusicState, string>> = {};
  private cooldownUntil: Partial<Record<MusicEvent, number>> = {};
  private breatheUntil = 0;
  private out: MusicOutput;
  private readonly rand: () => number;

  constructor(rand: () => number = Math.random) {
    this.rand = rand;
    this.base = this.enter('MENU');
    this.out = { cue: null, fadeS: 0, state: 'MENU' };
  }

  private range([a, b]: [number, number]) {
    return a + (b - a) * this.rand();
  }

  private pickCue(state: MusicState): string {
    const cues = MUSIC_STATES[state].cues;
    const options = cues.length > 1 ? cues.filter((c) => c !== this.lastCue[state]) : cues;
    const cue = options[Math.floor(this.rand() * options.length) % options.length];
    this.lastCue[state] = cue;
    return cue;
  }

  private enter(state: MusicState): Track {
    const entry = this.range(MUSIC_STATES[state].entryRestS);
    return entry > 0
      ? { state, playing: false, windowLeftS: entry, cue: null }
      : { state, playing: true, windowLeftS: this.range(MUSIC_STATES[state].phraseS), cue: this.pickCue(state) };
  }

  private advance(track: Track, dt: number) {
    track.windowLeftS -= dt;
    if (track.windowLeftS > 0) return;
    const spec = MUSIC_STATES[track.state];
    const rest = track.playing ? this.range(spec.restS) : 0;
    if (rest > 0) Object.assign(track, { playing: false, windowLeftS: rest, cue: null });
    else Object.assign(track, { playing: true, windowLeftS: this.range(spec.phraseS), cue: this.pickCue(track.state) });
  }

  /** Screen / flight context. Re-setting the same context is a no-op (no restart). */
  setBase(state: BaseMusicState) {
    if (this.base.state !== state) this.base = this.enter(state);
  }

  /** Clears overlays (e.g. leaving a flight), keeping cooldowns. */
  clearOverlay() {
    this.overlay = null;
  }

  /** Returns true when the event changed the music. */
  trigger(event: MusicEvent): boolean {
    const rule = EVENT_RULES[event];
    if ((this.cooldownUntil[event] ?? -Infinity) > this.t) return false;
    const spec = MUSIC_STATES[rule.state];
    const current = this.overlay ? MUSIC_STATES[this.overlay.state].priority : MUSIC_STATES[this.base.state].priority;
    if (this.overlay?.state === rule.state) {
      // Same overlay again: urgent ones (danger persists) extend instead of restarting the cue;
      // calm ones are never extended, so exploration music cannot run forever.
      if (spec.priority < URGENT_PRIORITY) return false;
      this.overlay.expiresAt = this.t + (spec.lifetimeS ?? 0);
      this.cooldownUntil[event] = this.t + rule.cooldownS;
      return false;
    }
    if (spec.priority <= current) return false;
    if (spec.priority < URGENT_PRIORITY && (this.t < this.breatheUntil || (this.overlay && this.t - this.overlay.startedAt < MIN_DWELL_S))) return false;
    this.overlay = { ...this.enter(rule.state), expiresAt: this.t + (spec.lifetimeS ?? 0), startedAt: this.t };
    this.cooldownUntil[event] = this.t + rule.cooldownS;
    return true;
  }

  update(dt: number): MusicOutput {
    this.t += dt;
    if (this.overlay && this.t >= this.overlay.expiresAt) {
      const ended = this.overlay.state;
      this.overlay = null;
      this.breatheUntil = this.t + BREATHE_S;
      // Resumption: the base keeps its own clock; after a big moment, give it at least a rest.
      if (this.base.playing === false) this.base.windowLeftS = Math.max(this.base.windowLeftS, 8);
      else if (ended === 'CRASH_AFTERMATH' || ended === 'VICTORY') Object.assign(this.base, { playing: false, windowLeftS: 15, cue: null });
    }
    this.advance(this.base, dt);
    if (this.overlay) this.advance(this.overlay, dt);
    const active = this.overlay ?? this.base;
    const cue = active.cue;
    if (cue !== this.out.cue) {
      const spec = MUSIC_STATES[active.state];
      const outgoing = this.out.cue ? MUSIC_STATES[this.out.state] : null;
      // Fade length: incoming cue's fade-in when starting, outgoing cue's fade-out when resting.
      const fadeS = cue ? spec.fadeInS : outgoing?.fadeOutS ?? spec.fadeOutS;
      this.out = { cue, fadeS, state: active.state };
    } else {
      this.out = { ...this.out, state: active.state };
    }
    return this.out;
  }
}
