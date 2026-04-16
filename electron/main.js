'use strict';
const { app, BrowserWindow, Menu, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const net = require('net');

let mainWindow;
let backendPort;

// Find a free TCP port starting from `start`
function findFreePort(start) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', () => findFreePort(start + 1).then(resolve, reject));
    server.listen(start, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

// Poll /api/health until the backend responds 200
function waitForBackend(port, attempts) {
  attempts = attempts === undefined ? 40 : attempts;
  return new Promise((resolve, reject) => {
    function try_() {
      const req = http.get(`http://127.0.0.1:${port}/api/health`, (res) => {
        if (res.statusCode === 200) return resolve();
        setTimeout(try_, 200);
      });
      req.on('error', () => {
        if (--attempts <= 0) return reject(new Error('Backend did not start in time'));
        setTimeout(try_, 200);
      });
      req.end();
    }
    try_();
  });
}

function startBackend(port) {
  // Writable uploads dir in user data (survives updates, outside the app bundle)
  const uploadsDir = path.join(app.getPath('userData'), 'uploads');
  fs.mkdirSync(uploadsDir, { recursive: true });

  // Frontend dist is bundled alongside the electron/ dir
  const frontendDist = path.join(__dirname, '..', 'frontend', 'dist');

  // Pass config to backend via env vars (read before any require())
  process.env.PORT = String(port);
  process.env.HOST = '127.0.0.1';
  process.env.UPLOADS_DIR = uploadsDir;
  process.env.FRONTEND_DIST = frontendDist;

  // Run backend in-process — no separate Node.js binary needed
  require(path.join(__dirname, '..', 'backend', 'src', 'index.js'));
}

async function createWindow(port) {
  // Remove the native menu bar
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    title: 'NetTools',
    show: false,
  });

  mainWindow.loadURL(`http://127.0.0.1:${port}`);
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(async () => {
  try {
    backendPort = await findFreePort(3001);
    startBackend(backendPort);
    await waitForBackend(backendPort);
    await createWindow(backendPort);
  } catch (err) {
    console.error('Startup failed:', err);
    dialog.showErrorBox('NetTools 启动失败', err.message);
    app.quit();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(backendPort);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
