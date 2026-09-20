import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const worker = readFileSync(resolve(__dirname, '../public/sw.js'), 'utf8');

describe('PWA update contract', () => {
  it('uses network-first navigation so a new deploy cannot strand cached HTML on removed Vite chunks', () => {
    expect(worker).toContain('async function handleNavigation(request)');
    expect(worker).toMatch(/if \(request\.mode === 'navigate'\) \{\s*event\.respondWith\(handleNavigation\(request\)\)/);
    expect(worker).toMatch(/const response = await fetch\(request\)/);
  });

  it('keeps an offline shell fallback and a versioned cache rotation path', () => {
    expect(worker).toContain("const CACHE_VERSION = 'v4'");
    expect(worker).toContain("shell.match('/offline.html')");
    expect(worker).toContain('self.skipWaiting()');
    expect(worker).toContain('self.clients.claim()');
  });
});
