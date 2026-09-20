const { app, BrowserWindow, Menu, net, protocol, shell } = require('electron');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const isMac = process.platform === 'darwin';
const distRoot = path.join(__dirname, '..', 'dist');

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

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});
