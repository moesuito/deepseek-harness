const { app, BrowserWindow, Menu, shell, dialog, nativeImage } = require('electron');
const path = require('path');
const http = require('http');
const net = require('net');
const fs = require('fs');
const { spawn, execSync } = require('child_process');

// App identities for Desktop environments
app.setName('DeepSeek Harness');
if (process.platform === 'linux') {
  app.setDesktopName('deepseek-harness.desktop');
}

let mainWindow = null;
let backendProcess = null;
let isQuitting = false;
const DEFAULT_PORT = 3080;
let serverPort = DEFAULT_PORT;

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// Logs & State
function getLogPath() {
  const logDir = path.join(app.getPath('userData'), 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  return path.join(logDir, 'backend.log');
}

function appendLog(text) {
  try {
    fs.appendFileSync(getLogPath(), `[${new Date().toISOString()}] ${text}\n`);
  } catch (e) {}
}

function getWindowStatePath() {
  const userData = app.getPath('userData');
  return path.join(userData, 'window-state.json');
}

function loadWindowState() {
  try {
    const data = fs.readFileSync(getWindowStatePath(), 'utf8');
    return JSON.parse(data);
  } catch {
    return { width: 1280, height: 820 };
  }
}

function saveWindowState(window) {
  if (!window || window.isDestroyed()) return;
  try {
    const isMaximized = window.isMaximized();
    const bounds = window.getBounds();
    const state = {
      ...bounds,
      isMaximized
    };
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(getWindowStatePath(), JSON.stringify(state));
  } catch (err) {
    console.error('Failed to save window state:', err);
  }
}

// Check if a port is in use
function isPortInUse(port) {
  return new Promise((resolve) => {
    const client = new net.Socket();
    client.once('connect', () => {
      client.destroy();
      resolve(true);
    });
    client.once('error', () => {
      client.destroy();
      resolve(false);
    });
    client.connect(port, '127.0.0.1');
  });
}

// Wait for HTTP server to respond
function waitForHttpServer(port, timeoutMs = 45000) {
  const startTime = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const req = http.get(`http://127.0.0.1:${port}`, (res) => {
        req.destroy();
        resolve(true);
      });
      req.on('error', () => {
        req.destroy();
        if (Date.now() - startTime > timeoutMs) {
          reject(new Error(`Timeout waiting for server on port ${port}`));
        } else {
          setTimeout(check, 300);
        }
      });
      req.setTimeout(500, () => {
        req.destroy();
        if (Date.now() - startTime > timeoutMs) {
          reject(new Error(`Timeout waiting for server on port ${port}`));
        } else {
          setTimeout(check, 300);
        }
      });
    };
    check();
  });
}

// Find Node.js runtime executable
function findNodeExecutable() {
  if (process.platform === 'win32') {
    return 'node';
  }
  const candidatePaths = [
    '/usr/bin/node',
    '/usr/local/bin/node',
    '/home/alano/.nvm/versions/node/current/bin/node'
  ];

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  try {
    const fromWhich = execSync('which node', { encoding: 'utf8' }).trim();
    if (fromWhich && fs.existsSync(fromWhich)) return fromWhich;
  } catch (e) {}

  return 'node';
}

// Locate dsh script or executable
function findDshTarget() {
  const relativeCli = path.resolve(__dirname, '../../cli/lib/bin.js');
  const customPaths = [
    relativeCli,
    '/home/alano/Antigravity/deepseek-harness/apps/cli/lib/bin.js',
    '/home/alano/.local/bin/dsh',
    '/usr/local/bin/dsh',
    '/usr/bin/dsh'
  ];

  for (const p of customPaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return 'dsh';
}

// Start backend process
async function startBackend(port) {
  const inUse = await isPortInUse(port);
  if (inUse) {
    const msg = `Port ${port} is already active, connecting to existing instance...`;
    console.log(msg);
    appendLog(msg);
    return;
  }

  const nodeBin = findNodeExecutable();
  const dshTarget = findDshTarget();
  const msg = `Launching backend using Node [${nodeBin}] and target [${dshTarget}] on port ${port}...`;
  console.log(msg);
  appendLog(msg);

  let cmd, args;
  if (dshTarget.endsWith('.js')) {
    cmd = nodeBin;
    args = [dshTarget, 'web', '--no-open', '--port', String(port)];
  } else {
    cmd = dshTarget;
    args = ['web', '--no-open', '--port', String(port)];
  }

  const env = {
    ...process.env,
    PATH: `${process.env.PATH || ''}:/home/alano/.local/bin:/usr/local/bin:/usr/bin`,
    NODE_ENV: 'production'
  };

  backendProcess = spawn(cmd, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env
  });

  backendProcess.stdout.on('data', (data) => {
    const text = data.toString().trim();
    console.log(`[dsh backend]: ${text}`);
    appendLog(`[stdout] ${text}`);
  });

  backendProcess.stderr.on('data', (data) => {
    const text = data.toString().trim();
    console.error(`[dsh backend err]: ${text}`);
    appendLog(`[stderr] ${text}`);
  });

  backendProcess.on('exit', (code, signal) => {
    const exitMsg = `Backend process exited with code ${code}, signal ${signal}`;
    console.log(exitMsg);
    appendLog(exitMsg);
    backendProcess = null;
  });
}

function stopBackend() {
  if (backendProcess && !backendProcess.killed) {
    console.log('Terminating backend process...');
    appendLog('Terminating backend process...');
    try {
      backendProcess.kill('SIGTERM');
      setTimeout(() => {
        if (backendProcess && !backendProcess.killed) {
          backendProcess.kill('SIGKILL');
        }
      }, 1500);
    } catch (e) {
      console.error('Error stopping backend:', e);
    }
  }
}

// Create application menu
function createMenu() {
  const template = [
    {
      label: 'Arquivo',
      submenu: [
        {
          label: 'Recarregar',
          accelerator: 'CmdOrCtrl+R',
          click: () => {
            if (mainWindow) mainWindow.reload();
          }
        },
        {
          label: 'Forçar Recarregamento',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => {
            if (mainWindow) mainWindow.webContents.reloadIgnoringCache();
          }
        },
        { type: 'separator' },
        {
          label: 'Sair',
          accelerator: 'CmdOrCtrl+Q',
          click: () => {
            app.quit();
          }
        }
      ]
    },
    {
      label: 'Editar',
      submenu: [
        { label: 'Desfazer', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
        { label: 'Refazer', accelerator: 'Shift+CmdOrCtrl+Z', role: 'redo' },
        { type: 'separator' },
        { label: 'Recortar', accelerator: 'CmdOrCtrl+X', role: 'cut' },
        { label: 'Copiar', accelerator: 'CmdOrCtrl+C', role: 'copy' },
        { label: 'Colar', accelerator: 'CmdOrCtrl+V', role: 'paste' },
        { label: 'Selecionar Tudo', accelerator: 'CmdOrCtrl+A', role: 'selectAll' }
      ]
    },
    {
      label: 'Exibir',
      submenu: [
        { label: 'Aumentar Zoom', accelerator: 'CmdOrCtrl+Plus', role: 'zoomIn' },
        { label: 'Diminuir Zoom', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
        { label: 'Zoom Padrão', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' },
        { type: 'separator' },
        { label: 'Tela Cheia', accelerator: 'F11', role: 'togglefullscreen' },
        {
          label: 'Ferramentas do Desenvolvedor',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: () => {
            if (mainWindow) mainWindow.webContents.toggleDevTools();
          }
        }
      ]
    },
    {
      label: 'Ajuda',
      submenu: [
        {
          label: 'Documentação DeepSeek Harness',
          click: () => {
            shell.openExternal('https://github.com/deepseek-ai/deepseek-harness');
          }
        },
        {
          label: 'Sobre o DeepSeek Harness',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'Sobre o DeepSeek Harness',
              message: 'DeepSeek Harness Desktop',
              detail: `Versão: 0.1.1\nDeepSeek Harness Platform\nPowered by Electron & Cordis`,
              buttons: ['OK']
            });
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// Create main window
async function createMainWindow() {
  const windowState = loadWindowState();
  const iconPath = path.join(__dirname, '../build/icon.png');
  const appIcon = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : null;

  mainWindow = new BrowserWindow({
    title: 'DeepSeek Harness',
    icon: appIcon,
    width: windowState.width || 1280,
    height: windowState.height || 820,
    x: windowState.x,
    y: windowState.y,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#0d1117',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      spellcheck: true
    }
  });

  if (appIcon) {
    mainWindow.setIcon(appIcon);
  }

  if (windowState.isMaximized) {
    mainWindow.maximize();
  }

  createMenu();

  // Load splash screen first
  mainWindow.loadFile(path.join(__dirname, 'splash.html'));
  mainWindow.show();

  // Track window resizing and moving
  mainWindow.on('resize', () => saveWindowState(mainWindow));
  mainWindow.on('move', () => saveWindowState(mainWindow));
  mainWindow.on('close', () => saveWindowState(mainWindow));

  // Intercept navigation to external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://127.0.0.1') || url.startsWith('http://localhost')) {
      return { action: 'allow' };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Start backend & wait for it
  try {
    await startBackend(serverPort);
    await waitForHttpServer(serverPort, 35000);
    const readyMsg = `Backend server ready on port ${serverPort}, loading Web UI...`;
    console.log(readyMsg);
    appendLog(readyMsg);
    mainWindow.loadURL(`http://127.0.0.1:${serverPort}`);
  } catch (err) {
    const errMsg = `Failed to connect to backend: ${err.message}`;
    console.error(errMsg);
    appendLog(errMsg);
    dialog.showErrorBox(
      'Erro ao Iniciar DeepSeek Harness',
      `Não foi possível conectar ao servidor backend na porta ${serverPort}.\n\nDetalhes: ${err.message}\n\nConsulte os logs em: ${getLogPath()}`
    );
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// App lifecycle
app.whenReady().then(createMainWindow);

app.on('window-all-closed', () => {
  stopBackend();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  stopBackend();
});

process.on('SIGINT', () => {
  stopBackend();
  process.exit(0);
});

process.on('SIGTERM', () => {
  stopBackend();
  process.exit(0);
});
