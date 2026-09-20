import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Content-Security-Policy', () => {
  const html = readFileSync(resolve(__dirname, '../index.html'), 'utf-8');
  const csp = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)?.[1];
  const scriptSrc = csp?.split(';').find((d) => d.trim().startsWith('script-src')) ?? '';

  it('allows WASM compilation via wasm-unsafe-eval (required by Rapier physics)', () => {
    expect(scriptSrc).toContain("'wasm-unsafe-eval'");
  });

  it('does not weaken policy with unsafe-eval', () => {
    expect(scriptSrc).not.toContain("'unsafe-eval'");
  });

  it('keeps browser zoom available for mobile accessibility', () => {
    const viewport = html.match(/<meta\s+name="viewport"\s+content="([^"]+)"/i)?.[1] ?? '';
    expect(viewport).not.toMatch(/user-scalable\s*=\s*no/i);
    expect(viewport).not.toMatch(/maximum-scale\s*=\s*[0-4](?:\.\d+)?/i);
  });
});
