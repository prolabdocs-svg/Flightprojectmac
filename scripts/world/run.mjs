// Runs a TS script through Vite SSR so repo-style extensionless imports resolve: node scripts/world/run.mjs <script.ts>
import { createServer } from 'vite';
const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error', optimizeDeps: { noDiscovery: true } });
try { await server.ssrLoadModule(process.argv[2]); } finally { await server.close(); }
