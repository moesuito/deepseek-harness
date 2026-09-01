const { app, BrowserWindow, Menu, shell, dialog, nativeImage } = require('electron');
const path = require('path');
const http = require('http');
const net = require('net');
const fs = require('fs');
const os = require('os');
const { spawn, execSync } = require('child_process');
 const { checkForUpdates, downloadFile, applyUpdate } = require('./updater.js');

// Uncaught exceptions (e.g. a stray EPIPE when the backend closes its stdout
// pipe mid-drain) must not tear down the whole window: log and keep running.
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception in main process:', err);
  try {
    appendLog(`[uncaughtException] ${(err && err.stack) || err}`);
  } catch {}
});

// App identities for Desktop environments

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
  const isWin = process.platform === 'win32';
  const homeDir = os.homedir();

  const candidatePaths = [
    ...(isWin ? [
      'C:\\Program Files\\nodejs\\node.exe',
      'C:\\Program Files (x86)\\nodejs\\node.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'nodejs', 'node.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'node', 'node.exe'),
      path.join(process.env.APPDATA || '', 'nvm', 'current', 'node.exe'),
      path.join(homeDir, '.nvm', 'versions', 'node', 'current', 'node.exe'),
      path.join(homeDir, '.fnm', 'current', 'node.exe'),
      path.join(homeDir, '.volta', 'bin', 'node.exe')
    ] : [
      '/usr/bin/node',
      '/usr/local/bin/node',
      path.join(homeDir, '.nvm/versions/node/current/bin/node'),
      path.join(homeDir, '.fnm/current/bin/node'),
      path.join(homeDir, '.volta/bin/node'),
      path.join(homeDir, '.local/bin/node')
    ])
  ].filter(Boolean);

  for (const p of candidatePaths) {
    try {
      if (fs.existsSync(p)) {
        return p;
      }
    } catch {}
  }

  try {
    const lookupCmd = isWin ? 'where.exe node' : 'which node';
    const fromWhich = execSync(lookupCmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split(/\r?\n/)[0];
    if (fromWhich && fs.existsSync(fromWhich)) return fromWhich;
  } catch {}

  return isWin ? 'node.exe' : 'node';
}

// Locate dsh script or executable
function findDshTarget() {
  const homeDir = os.homedir();
  const isWin = process.platform === 'win32';

  const candidatePaths = [
    // Relative to current directory in dev mode
    path.resolve(__dirname, '../../cli/lib/bin.js'),
    path.resolve(__dirname, '../../apps/cli/lib/bin.js'),
    path.resolve(__dirname, '../../../apps/cli/lib/bin.js'),
    path.resolve(process.cwd(), 'apps/cli/lib/bin.js'),
    path.resolve(process.cwd(), 'lib/bin.js'),

    // App resources path
    process.resourcesPath ? path.join(process.resourcesPath, 'apps/cli/lib/bin.js') : null,
    process.resourcesPath ? path.join(process.resourcesPath, 'cli/lib/bin.js') : null,
    process.resourcesPath ? path.join(process.resourcesPath, 'app/apps/cli/lib/bin.js') : null,

    // Common repo locations
    isWin ? 'C:\\Antigravity\\deepseek-harness\\apps\\cli\\lib\\bin.js' : null,
    path.join(homeDir, 'Antigravity', 'deepseek-harness', 'apps', 'cli', 'lib', 'bin.js'),
    path.join(homeDir, 'deepseek-harness', 'apps', 'cli', 'lib', 'bin.js'),
    path.join(homeDir, 'Projects', 'deepseek-harness', 'apps', 'cli', 'lib', 'bin.js'),
    '/home/alano/Antigravity/deepseek-harness/apps/cli/lib/bin.js',

    // Global / user binaries
    ...(isWin ? [
      path.join(process.env.APPDATA || '', 'npm', 'dsh.cmd'),
      path.join(process.env.LOCALAPPDATA || '', 'pnpm', 'dsh.cmd'),
      path.join(process.env.LOCALAPPDATA || '', 'pnpm', 'dsh.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'nodejs', 'dsh.cmd'),
      path.join(homeDir, 'AppData', 'Roaming', 'npm', 'dsh.cmd'),
      path.join(homeDir, 'AppData', 'Local', 'pnpm', 'dsh.cmd'),
      path.join(homeDir, '.local', 'bin', 'dsh.cmd'),
      path.join(homeDir, '.local', 'bin', 'dsh.exe')
    ] : [
      path.join(homeDir, '.local', 'bin', 'dsh'),
      path.join(homeDir, '.pnpm-global', 'bin', 'dsh'),
      '/usr/local/bin/dsh',
      '/usr/bin/dsh'
    ])
  ].filter(Boolean);

  for (const p of candidatePaths) {
    try {
      if (fs.existsSync(p)) {
        return p;
      }
    } catch {}
  }

  try {
    const lookupCmd = isWin ? 'where.exe dsh' : 'which dsh';
    const found = execSync(lookupCmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split(/\r?\n/)[0];
    if (found && fs.existsSync(found)) {
      return found;
    }
  } catch {}

  return isWin ? 'dsh.cmd' : 'dsh';
}

function getEnhancedEnv() {
  const isWin = process.platform === 'win32';
  const homeDir = os.homedir();
  const delimiter = path.delimiter;

  const extraPaths = isWin ? [
    'C:\\Program Files\\nodejs',
    'C:\\Program Files (x86)\\nodejs',
    path.join(process.env.APPDATA || '', 'npm'),
    path.join(process.env.LOCALAPPDATA || '', 'pnpm'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'nodejs'),
    path.join(homeDir, 'AppData', 'Roaming', 'npm'),
    path.join(homeDir, 'AppData', 'Local', 'pnpm'),
    path.join(homeDir, '.local', 'bin')
  ] : [
    path.join(homeDir, '.local', 'bin'),
    path.join(homeDir, '.pnpm-global', 'bin'),
    path.join(homeDir, '.nvm', 'versions', 'node', 'current', 'bin'),
    '/usr/local/bin',
    '/usr/bin',
    '/bin'
  ];

  const currentPath = process.env.PATH || '';
  const mergedPath = [
    ...extraPaths.filter(p => {
      try { return fs.existsSync(p); } catch { return false; }
    }),
    currentPath
  ].join(delimiter);

  return {
    ...process.env,
    PATH: mergedPath,
    NODE_ENV: 'production'
  };
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
  const isWin = process.platform === 'win32';

  if (dshTarget.endsWith('.js') || dshTarget.endsWith('.ts') || dshTarget.endsWith('.mjs')) {
    cmd = nodeBin;
    args = [dshTarget, 'web', '--no-open', '--port', String(port)];
  } else {
    cmd = dshTarget;
    args = ['web', '--no-open', '--port', String(port)];
  }

  const env = getEnhancedEnv();
  const useShell = isWin && !cmd.toLowerCase().endsWith('.exe');

  backendProcess = spawn(cmd, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
    shell: useShell,
    windowsHide: true
  });

  backendProcess.on('error', (err) => {
    const errMsg = `Backend process spawn error: ${err.message}`;
    console.error(errMsg);
    appendLog(errMsg);
  });

  backendProcess.stdout?.on('data', (data) => {
    try {
      const text = data.toString().trim();
      console.log(`[dsh backend]: ${text}`);
      appendLog(`[stdout] ${text}`);
    } catch {
      /* stdout write stream is closed once the backend exits */
    }
  });

  backendProcess.stderr?.on('data', (data) => {
    try {
      const text = data.toString().trim();
      console.error(`[dsh backend err]: ${text}`);
      appendLog(`[stderr] ${text}`);
    } catch {
      /* stderr write stream is closed once the backend exits */
    }
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
      if (process.platform === 'win32' && backendProcess.pid) {
        try {
          execSync(`taskkill /pid ${backendProcess.pid} /T /F`, { stdio: 'ignore' });
        } catch {}
      } else {
        backendProcess.kill('SIGTERM');
        setTimeout(() => {
          if (backendProcess && !backendProcess.killed) {
            backendProcess.kill('SIGKILL');
          }
        }, 1500);
      }
    } catch (e) {
      console.error('Error stopping backend:', e);
    }
  }
}


// Create application menu
function createMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Reload',
          accelerator: 'CmdOrCtrl+R',
          click: () => {
            if (mainWindow) mainWindow.reload();
          }
        },
        {
          label: 'Force Reload',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => {
            if (mainWindow) mainWindow.webContents.reloadIgnoringCache();
          }
        },
        { type: 'separator' },
        {
          label: 'Quit',
          accelerator: 'CmdOrCtrl+Q',
          click: () => {
            app.quit();
          }
        }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
        { label: 'Redo', accelerator: 'Shift+CmdOrCtrl+Z', role: 'redo' },
        { type: 'separator' },
        { label: 'Cut', accelerator: 'CmdOrCtrl+X', role: 'cut' },
        { label: 'Copy', accelerator: 'CmdOrCtrl+C', role: 'copy' },
        { label: 'Paste', accelerator: 'CmdOrCtrl+V', role: 'paste' },
        { label: 'Select All', accelerator: 'CmdOrCtrl+A', role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus', role: 'zoomIn' },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
        { label: 'Reset Zoom', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' },
        { type: 'separator' },
        { label: 'Toggle Full Screen', accelerator: 'F11', role: 'togglefullscreen' },
        {
          label: 'Toggle Developer Tools',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: () => {
            if (mainWindow) mainWindow.webContents.toggleDevTools();
          }
        }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Check for Updates...',
          click: async () => {
            const currentVer = app.getVersion() || '0.2.0';
            const update = await checkForUpdates(currentVer);
            if (update && update.hasUpdate) {
              const { response } = await dialog.showMessageBox(mainWindow, {
                type: 'question',
                buttons: ['Update Now', 'Later'],
                defaultId: 0,
                cancelId: 1,
                title: 'Update Available',
                message: `A new version of DeepSeek Harness is available (v${update.version})!`,
                detail: `Release: ${update.releaseName}\n\nWould you like to download and install it now?`
              });
              if (response === 0 && update.asset) {
                const ext = path.extname(update.asset.name);
                const tempInstallerPath = path.join(os.tmpdir(), `deepseek-harness-update-${update.version}${ext}`);
                dialog.showMessageBox(mainWindow, {
                  type: 'info',
                  title: 'Downloading Update',
                  message: 'Downloading update in the background...',
                  buttons: ['OK']
                });
                await downloadFile(update.asset.browser_download_url, tempInstallerPath);
                await applyUpdate(tempInstallerPath);
              }
            } else {
              dialog.showMessageBox(mainWindow, {
                type: 'info',
                title: 'No Updates',
                message: 'You are using the latest version of DeepSeek Harness!',
                buttons: ['OK']
              });
            }
          }
        },
        { type: 'separator' },
        {
          label: 'DeepSeek Harness Documentation',
          click: () => {
            shell.openExternal('https://github.com/deepseek-ai/deepseek-harness');
          }
        },
        {
          label: 'About DeepSeek Harness',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About DeepSeek Harness',
              message: 'DeepSeek Harness Desktop',
              detail: `Version: ${app.getVersion() || '0.2.0'}\nDeepSeek Harness Platform\nPowered by Electron & Cordis`,
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
    backgroundColor: '#0b0d13',
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

  // Helper to update splash status text
  const setSplashStatus = (text) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.executeJavaScript(`
        const el = document.getElementById('status-text');
        if (el) el.textContent = ${JSON.stringify(text)};
      `).catch(() => {});
    }
  };

  // Check for updates before booting backend
  try {
    const currentVer = app.getVersion() || '0.2.0';
    const update = await checkForUpdates(currentVer);

    if (update && update.hasUpdate && update.asset) {
      const { response } = await dialog.showMessageBox(mainWindow, {
        type: 'question',
        buttons: ['Update Now', 'Later'],
        defaultId: 0,
        cancelId: 1,
        title: 'Update Available',
        message: `A new version of DeepSeek Harness is available (v${update.version})!`,
        detail: `Would you like to download and install the update now?\n\nCurrent: v${currentVer}  →  New: v${update.version}`
      });

      if (response === 0) {
        // User agreed to update: download and install without starting the server
        const ext = path.extname(update.asset.name);
        const tempInstallerPath = path.join(os.tmpdir(), `deepseek-harness-update-${update.version}${ext}`);

        setSplashStatus(`Downloading update v${update.version}...`);

        await downloadFile(update.asset.browser_download_url, tempInstallerPath, (percent) => {
          setSplashStatus(`Downloading update v${update.version} (${percent}%)...`);
        });

        setSplashStatus('Installing update and restarting...');
        await applyUpdate(tempInstallerPath);
        return; // Exit here
      }
    }
  } catch (updateErr) {
    console.warn('Auto-update check bypassed:', updateErr.message);
  }

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
      'Error Starting DeepSeek Harness',
      `Could not connect to the backend server on port ${serverPort}.\n\nDetails: ${err.message}\n\nCheck logs at: ${getLogPath()}`
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
