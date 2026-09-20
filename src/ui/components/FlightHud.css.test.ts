import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('FlightHud.css keyboard hint', () => {
  const css = readFileSync(resolve(__dirname, './FlightHud.css'), 'utf-8');

  it('hides the keyboard hint on narrow portrait (touch-first) layouts, not just coarse pointers', () => {
    const narrowPortraitBlock = css.match(
      /@media \(max-width: 600px\) and \(orientation: portrait\)\s*{([\s\S]*?)\n}/
    )?.[1];
    expect(narrowPortraitBlock).toContain('.hud-keyboard-hint { display: none; }');
  });
});
