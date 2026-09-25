import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { randomBytes } from 'node:crypto'
import os from 'node:os'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createServer } from 'node:http'
import { WebSocketServer, WebSocket } from 'ws'

const packageVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version as string

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), {
    name: 'mobile-controller-dev-host',
    configureServer(server) {
      const tokens = new Set<string>()
      let currentToken = ''
      const clients = new Set<WebSocket>()
      let active: WebSocket | undefined
      const gameClients = new Set<WebSocket>()
      let mobileWatchdog: ReturnType<typeof setTimeout> | undefined
      const wss = new WebSocketServer({ noServer: true, maxPayload: 2048 })
      wss.on('connection', (socket) => {
        clients.add(socket)
        let authenticated = false
        let seq = -1
        socket.on('message', (raw) => {
          let message: Record<string, unknown>
          try { message = JSON.parse(raw.toString()) as Record<string, unknown> } catch { socket.close(1003); return }
          if (!authenticated) {
            if (message.type === 'hello' && message.token === 'game-renderer') { authenticated = true; gameClients.add(socket); socket.send(JSON.stringify({ type: 'ready', version: 1 })); if (active?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'connected' })); return }
            if (message.type !== 'hello' || message.version !== 1 || typeof message.token !== 'string' || !tokens.has(message.token)) { socket.close(1008); return }
            if (active && active !== socket && active.readyState === WebSocket.OPEN) { socket.send(JSON.stringify({ type: 'busy' })); socket.close(1013, 'controller already connected'); return }
            authenticated = true
            active = socket
            for (const game of gameClients) if (game.readyState === WebSocket.OPEN) game.send(JSON.stringify({ type: 'connected' }))
            socket.send(JSON.stringify({ type: 'connected' }))
            socket.send(JSON.stringify({ type: 'ready', version: 1 }))
            return
          }
          if (message.type === 'axes' && Number.isSafeInteger(message.seq) && Number(message.seq) > seq && ['throttle', 'pitch', 'roll', 'yaw'].every((key) => typeof message[key] === 'number' && Number.isFinite(message[key])) && Number(message.throttle) >= 0 && Number(message.throttle) <= 1 && ['pitch', 'roll', 'yaw'].every((key) => Number(message[key]) >= -1 && Number(message[key]) <= 1) && typeof message.brake === 'boolean') {
            seq = Number(message.seq)
            for (const game of gameClients) if (game.readyState === WebSocket.OPEN) game.send(JSON.stringify({ type: 'axes', axes: message }))
            socket.send(JSON.stringify({ type: 'ack', seq }))
            clearTimeout(mobileWatchdog)
            mobileWatchdog = setTimeout(() => {
              if (active === socket) {
                active = undefined
                for (const game of gameClients) if (game.readyState === WebSocket.OPEN) game.send(JSON.stringify({ type: 'lost' }))
                socket.close(4000, 'input timeout')
              }
            }, 500)
          } else if (message.type === 'command' && Number.isSafeInteger(message.seq) && Number(message.seq) > seq && ['engine', 'flaps'].includes(String(message.command))) {
            seq = Number(message.seq)
            for (const game of gameClients) if (game.readyState === WebSocket.OPEN) game.send(JSON.stringify({ type: 'command', command: message.command, seq }))
            socket.send(JSON.stringify({ type: 'ack', seq }))
          }
        })
        socket.on('close', () => { clients.delete(socket); if (active === socket) { active = undefined; clearTimeout(mobileWatchdog); for (const game of gameClients) if (game.readyState === WebSocket.OPEN) game.send(JSON.stringify({ type: 'lost' })) }; gameClients.delete(socket) })
      })
      const lan = createServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        if (url.pathname === '/controller') {
          const token = url.searchParams.get('token')
          if (!token || !tokens.has(token)) { res.writeHead(403).end('Invalid pairing link'); return }
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
          res.end(`<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover"><title>PROJECT FLIGHT RC</title><link rel="stylesheet" href="/controller.css"></head><body><main class="remote"><header><strong>PROJECT FLIGHT <small>RC · MODE 2</small></strong><span id="status">Conectando…</span></header><section class="flight-controls"><div class="gimbal" id="left"><label>THROTTLE <b id="throttle-value">0%</b></label><div class="well"><div class="knob"></div></div><small>YAW</small></div><div class="gimbal" id="right"><label>PITCH <b id="pitch-value">0</b></label><div class="well"><div class="knob"></div></div><small>ROLL</small></div></section><footer><button id="brake" class="brake">FRENO</button><button id="flaps">FLAPS</button><button id="engine">MOTOR</button></footer></main><script>window.CONTROLLER_TOKEN=${JSON.stringify(token)}</script><script src="/controller.js"></script></body></html>`)
          return
        }
        if (url.pathname === '/controller.js' || url.pathname === '/controller.css') {
          const file = url.pathname.endsWith('.js') ? 'controller.js' : 'controller.css'
          res.writeHead(200, { 'content-type': file.endsWith('.js') ? 'text/javascript' : 'text/css' })
          res.end(readFileSync(new URL(`./public/${file}`, import.meta.url)))
          return
        }
        res.writeHead(404).end()
      })
      lan.on('upgrade', (req, socket, head) => { if (new URL(req.url ?? '/', 'http://localhost').pathname !== '/__mobile/control') { socket.destroy(); return }; wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req)) })
      lan.listen(0, '0.0.0.0')
      server.middlewares.use('/__mobile/start', (req: IncomingMessage, res: ServerResponse) => {
        const renew = new URL(req.url ?? '/', 'http://localhost').searchParams.has('renew')
        if (!currentToken || renew) {
          if (active?.readyState === WebSocket.OPEN) active.close(1000, 'session renewed')
          tokens.clear()
          currentToken = randomBytes(24).toString('hex')
          tokens.add(currentToken)
        }
        const addresses = Object.values(os.networkInterfaces()).flat().filter((entry) => entry?.family === 'IPv4' && !entry.internal).map((entry) => entry!.address)
        const serverAddress = server.httpServer?.address()
        res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ token: currentToken, port: serverAddress && typeof serverAddress !== 'string' ? serverAddress.port : 0, relayPort: (lan.address() as import('node:net').AddressInfo).port, addresses }))
      })
      server.middlewares.use('/__mobile/stop', (_req: IncomingMessage, res: ServerResponse) => { tokens.clear(); currentToken = ''; if (active?.readyState === WebSocket.OPEN) active.close(1000); res.end('ok') })
    },
  }],
  define: {
    __PROJECT_FLIGHT_VERSION__: JSON.stringify(packageVersion),
  },
  build: {
    // Rapier's WASM glue chunk is inherently large and only loads once the player
    // reaches the Flight screen (see manualChunks below and the lazy-loaded
    // FlightScreen in App.tsx), so it no longer blocks initial page load.
    chunkSizeWarningLimit: 3000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('@dimforge/rapier3d-compat')) return 'rapier'
            if (id.includes('/three/')) return 'three'
            if (id.includes('/react-dom/') || id.includes('/react/')) return 'react-vendor'
          }
        },
      },
    },
  },
})
