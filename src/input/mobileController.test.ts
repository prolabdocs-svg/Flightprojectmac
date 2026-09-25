import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('mobile controller contract', () => {
  const client = readFileSync(resolve(process.cwd(), 'public/controller.js'), 'utf8');
  it('sends absolute sticky throttle and recenters spring axes on release', () => {
    expect(client).toContain('throttle: sticks.left.throttle');
    expect(client).toContain('sticks.right.pitch = 0');
    expect(client).toContain('sticks.right.roll = 0');
    expect(client).toContain('sticks.left.yaw = 0');
    expect(client).toContain('setInterval(send, 1000 / 30)');
  });
});
