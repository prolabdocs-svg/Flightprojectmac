import { describe, expect, it } from 'vitest';
import { MusicDirector } from './musicDirector';

function seeded(seed = 7) {
  return () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
}

describe('MusicDirector', () => {
  it('long session (2 h flight): breathes, never thrashes, never repeats a cue back-to-back', () => {
    const d = new MusicDirector(seeded());
    d.setBase('CALM_FLIGHT');
    const dt = 0.25;
    let silentS = 0;
    let changes = 0;
    let lastCue: string | null = null;
    let lastChangeT = 0;
    let minGap = Infinity;
    const played: string[] = [];
    for (let t = 0; t < 7200; t += dt) {
      // Event spam far denser than real gameplay: every 5 s something happens.
      if (Math.round(t * 4) % 20 === 0) d.trigger((['takeoff', 'landmarkDiscovered', 'regionEnter'] as const)[Math.floor(t / 5) % 3]);
      const o = d.update(dt);
      if (!o.cue) silentS += dt;
      if (o.cue !== lastCue) {
        changes++;
        if (lastCue && o.cue) minGap = Math.min(minGap, t - lastChangeT);
        lastChangeT = t;
        if (o.cue) played.push(o.cue);
        lastCue = o.cue;
      }
    }
    expect(silentS / 7200).toBeGreaterThan(0.25); // silence is part of the design
    expect(changes).toBeLessThan(7200 / 25); // transitions incl. fades to silence
    expect(played.length).toBeLessThan(7200 / 45); // a new cue starts at most every ~45 s on average
    expect(minGap).toBeGreaterThanOrEqual(10);
    for (let i = 1; i < played.length; i++) expect(played[i]).not.toBe(played[i - 1]);
  });

  it('starts in silence when taking a flight, and events respect priority + cooldown', () => {
    const d = new MusicDirector(seeded());
    d.setBase('CALM_FLIGHT');
    expect(d.update(1).cue).toBeNull();
    expect(d.trigger('landmarkDiscovered')).toBe(true);
    expect(d.update(0.1).state).toBe('DISCOVERY');
    expect(d.trigger('takeoff')).toBe(false); // lower priority cannot interrupt discovery
    expect(d.trigger('emergency')).toBe(true); // higher priority interrupts
    expect(d.update(0.1).state).toBe('DANGER');
    expect(d.trigger('crash')).toBe(true);
    expect(d.update(0.1).state).toBe('CRASH_AFTERMATH');
    expect(d.update(0.1).cue).toBeNull(); // a beat of silence after impact
    expect(d.update(3).cue).toBe('aftermath_a');
    for (let i = 0; i < 50; i++) d.update(1);
    expect(d.update(0.1).state).toBe('CALM_FLIGHT'); // resumes the base context
    expect(d.trigger('landmarkDiscovered')).toBe(false); // breathing window after a big moment
    for (let i = 0; i < 90; i++) d.update(1);
    expect(d.trigger('landmarkDiscovered')).toBe(true);
    for (let i = 0; i < 20; i++) d.update(1);
    expect(d.trigger('landmarkDiscovered')).toBe(false); // cooldown (45 s)
  });

  it('re-setting the same base never restarts the cue', () => {
    const d = new MusicDirector(seeded());
    d.setBase('MENU');
    const cue = (d.update(2), d.update(0.1).cue);
    d.setBase('MENU');
    expect(d.update(0.1).cue).toBe(cue);
  });
});
