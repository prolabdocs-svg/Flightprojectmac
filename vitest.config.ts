import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

const packageVersion = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
).version as string;

// Separate from vite.config.ts (build config) to keep test-only concerns isolated.
export default defineConfig({
  plugins: [react()],
  define: {
    __PROJECT_FLIGHT_VERSION__: JSON.stringify(packageVersion),
  },
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
