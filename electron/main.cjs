const { app, BrowserWindow, Menu, net, protocol, shell, ipcMain } = require('electron');
const fs = require('node:fs');
const http = require('node:http');
const crypto = require('node:crypto');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const isMac = process.platform === 'darwin';
const distRoot = path.join(__dirname, '..', 'dist');
let controllerServer;
let controllerToken;
let controllerSocket;
let lastAxes = null;
const peerSequences = new WeakMap();
let watchdog;

function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat().filter((item) => item && item.family === 'IPv4' && !item.internal).map((item) => item.address);
}

function stopController() {
  clearTimeout(watchdog);
  controllerSocket?.close(1000, 'host stopped');
  controllerSocket = null;
  if (controllerServer) controllerServer.close();
  controllerServer = null;
  controllerToken = null;
  lastAxes = null;
}

function startController() {
  stopController();
  controllerToken = crypto.randomBytes(24).toString('hex');
  const WebSocketServer = require('ws').WebSocketServer;
  const WebSocket = require('ws');
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2048 });
  controllerServer = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/controller') {
      if (!controllerToken || url.searchParams.get('token') !== controllerToken) { res.writeHead(403).end('Invalid or expired pairing link.'); return; }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      const html = fs.readFileSync(path.join(distRoot, 'controller.html'), 'utf8');
      res.end(html.replace('</head>', `<script>window.CONTROLLER_TOKEN=${JSON.stringify(controllerToken)}</script></head>`));
      return;
    }
    if (url.pathname === '/controller.js' || url.pathname === '/controller.css') {
      const file = path.join(distRoot, path.basename(url.pathname));
      res.writeHead(200, { 'content-type': url.pathname.endsWith('.js') ? 'text/javascript' : 'text/css', 'cache-control': 'no-store' });
      fs.createReadStream(file).pipe(res);
      return;
    }
    res.writeHead(404).end('Not found');
  });
  controllerServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/control' && url.pathname !== '/__mobile/control') return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
  wss.on('connection', (ws) => {
    if (controllerSocket && controllerSocket.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'busy' })); ws.close(1013, 'controller already connected'); return;
    }
    controllerSocket = ws;
    let authenticated = false;
    peerSequences.set(ws, -1);
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return ws.close(1003, 'invalid JSON'); }
      if (!authenticated) {
        if (msg.type !== 'hello' || msg.token !== controllerToken || msg.version !== 1) return ws.close(1008, 'unauthorized');
        authenticated = true;
        for (const win of BrowserWindow.getAllWindows()) win.webContents.send('mobile-status', { type: 'connected' });
        ws.send(JSON.stringify({ type: 'ready', version: 1 }));
        return;
      }
      if (msg.type === 'axes' && Number.isSafeInteger(msg.seq) && msg.seq > (peerSequences.get(ws) ?? -1) && ['throttle', 'pitch', 'roll', 'yaw'].every((k) => Number.isFinite(msg[k])) && [msg.throttle].every((v) => v >= 0 && v <= 1) && ['pitch', 'roll', 'yaw'].every((k) => msg[k] >= -1 && msg[k] <= 1) && typeof msg.brake === 'boolean') {
        peerSequences.set(ws, msg.seq);
        lastAxes = { throttle: msg.throttle, pitch: msg.pitch, roll: msg.roll, yaw: msg.yaw, brake: msg.brake };
        for (const win of BrowserWindow.getAllWindows()) win.webContents.send('mobile-axes', lastAxes);
        ws.send(JSON.stringify({ type: 'ack', seq: msg.seq }));
        clearTimeout(watchdog);
        watchdog = setTimeout(() => { lastAxes = null; for (const win of BrowserWindow.getAllWindows()) win.webContents.send('mobile-lost'); controllerSocket?.close(4000, 'input timeout'); }, 500);
      } else if (msg.type === 'ping') ws.send(JSON.stringify({ type: 'pong', sentAt: msg.sentAt }));
      else if (msg.type === 'command' && Number.isSafeInteger(msg.seq) && msg.seq > (peerSequences.get(ws) ?? -1) && ['flaps', 'engine'].includes(msg.command)) {
        peerSequences.set(ws, msg.seq);
        for (const win of BrowserWindow.getAllWindows()) win.webContents.send('mobile-command', { command: msg.command, seq: msg.seq });
        ws.send(JSON.stringify({ type: 'ack', seq: msg.seq }));
      } else if (msg.type === 'heartbeat') ws.send(JSON.stringify({ type: 'heartbeat-ack', at: Date.now() }));
    });
    ws.on('close', () => { if (controllerSocket === ws) { controllerSocket = null; lastAxes = null; clearTimeout(watchdog); for (const win of BrowserWindow.getAllWindows()) { win.webContents.send('mobile-lost'); win.webContents.send('mobile-status', { type: 'disconnected' }); } } });
  });
  controllerServer.listen(0, '0.0.0.0');
  return new Promise((resolve, reject) => {
    controllerServer.once('error', reject);
    controllerServer.once('listening', () => resolve({ port: controllerServer.address().port, token: controllerToken, addresses: lanAddresses() }));
  });
}

ipcMain.handle('mobile:start', () => startController());
ipcMain.handle('mobile:stop', () => { stopController(); return true; });
ipcMain.handle('mobile:status', () => ({ active: Boolean(controllerServer), port: controllerServer?.address()?.port, token: controllerToken, addresses: lanAddresses() }));

function isAllowedExternalUrl(value) {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

// A standard + secure custom protocol gives the game a stable origin across launches.
// That is essential for IndexedDB saves and avoids exposing a localhost port in a shipped
// single-player game. It is registered before Electron becomes ready, per its API contract.
protocol.registerSchemesAsPrivileged([{
  scheme: 'project-flight',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, allowServiceWorkers: true },
}]);

function registerGameProtocol() {
  protocol.handle('project-flight', (request) => {
    const url = new URL(request.url);
    const relativePath = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const requested = path.resolve(distRoot, relativePath);
    const isInsideDist = requested === distRoot || requested.startsWith(`${distRoot}${path.sep}`);
    const fallback = path.join(distRoot, 'index.html');
    const filePath = isInsideDist && fs.existsSync(requested) && fs.statSync(requested).isFile() ? requested : fallback;
    return net.fetch(pathToFileURL(filePath).toString());
  });
}

async function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#17191a',
    title: 'PROJECT FLIGHT',
    autoHideMenuBar: true,
    webPreferences: {
      // The game is a static, local-first build. Keep the renderer sandboxed so a
      // malformed web asset cannot gain desktop filesystem or Node.js access.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
      webSecurity: true,
    },
  });

  // This game never needs browser permissions or embedded third-party web content.
  // Explicit denial keeps a compromised renderer from prompting for device access.
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== 'project-flight://game/' && !url.startsWith('project-flight://game/')) event.preventDefault();
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    // Never open arbitrary content inside the game shell. The only permitted escape
    // is a normal HTTPS link in the user's default browser.
    if (isAllowedExternalUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  // Register every renderer guard before the initial document is allowed to execute.
  await window.loadURL('project-flight://game/');

  window.webContents.on('before-input-event', (_event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11' || (input.alt && input.key === 'Enter')) {
      window.setFullScreen(!window.isFullScreen());
    }
  });

  return window;
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  registerGameProtocol();
  await createWindow();
  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow();
  });
});

app.on('before-quit', stopController);

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});
