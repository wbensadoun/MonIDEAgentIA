'use strict';

const { BrowserWindow, Menu, shell, session } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');

let cspInstalled = false;

const defaultIsDev =
  process.env.NODE_ENV === 'development' ||
  process.env.ELECTRON_IS_DEV === '1' ||
  process.defaultApp === true;

// Main-process view of projects currently opened by the desktop window. The
// renderer can display this state but cannot manufacture membership in it.
const createProjectWindowState = () => {
  const openProjects = new Set();
  let currentProject = null;
  const normalize = (value) => {
    const raw = String(value || '').trim();
    return raw ? path.resolve(raw) : null;
  };
  return Object.freeze({
    markOpened: (projectPath) => {
      const normalized = normalize(projectPath);
      if (!normalized) return null;
      openProjects.add(normalized);
      currentProject = normalized;
      return normalized;
    },
    markCurrent: (projectPath) => {
      const normalized = normalize(projectPath);
      if (!normalized || !openProjects.has(normalized)) return false;
      currentProject = normalized;
      return true;
    },
    markClosed: (projectPath) => {
      const normalized = normalize(projectPath);
      if (!normalized) return false;
      const deleted = openProjects.delete(normalized);
      if (currentProject === normalized) currentProject = null;
      return deleted;
    },
    isOpen: (projectPath) => {
      const normalized = normalize(projectPath);
      return !!normalized && openProjects.has(normalized);
    },
    getCurrent: () => currentProject,
    listOpen: () => [...openProjects]
  });
};

const callLogger = async (logger, level, message, payload) => {
  try {
    const fn = logger?.[level];
    if (typeof fn === 'function') {
      await fn.call(logger, message, payload);
    }
  } catch {
    // Logging must never block window creation.
  }
};

const getDefaultProjectsDir = (app) => {
  return path.join(app.getPath('userData'), 'IDE_Projects');
};

const buildElectronContentSecurityPolicy = (isDev = defaultIsDev) => {
  const scriptSrc = isDev
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net"
    : "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net";
  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net",
    "img-src 'self' data: blob: file: https://cdn.jsdelivr.net",
    "font-src 'self' data: https://fonts.gstatic.com https://cdn.jsdelivr.net",
    "connect-src 'self' https://generativelanguage.googleapis.com https://api.together.xyz https://api.anthropic.com http://localhost:* ws://localhost:* http://127.0.0.1:* ws://127.0.0.1:*",
    "frame-src 'self' data: blob: http://localhost:* http://127.0.0.1:*",
    "worker-src 'self' blob: https://cdn.jsdelivr.net",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'"
  ].join('; ');
};

const installContentSecurityPolicy = (isDev = defaultIsDev) => {
  if (cspInstalled) return;
  cspInstalled = true;
  const csp = buildElectronContentSecurityPolicy(isDev);
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp]
      }
    });
  });
};

const isAllowedAppNavigationUrl = (targetUrl, isDev = defaultIsDev) => {
  try {
    const parsed = new URL(String(targetUrl || ''));
    if (isDev) {
      return parsed.protocol === 'http:' &&
        (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') &&
        parsed.port === '3004';
    }
    return parsed.protocol === 'file:';
  } catch {
    return false;
  }
};

const createAppMenu = ({
  app,
  dialog,
  getMainWindow,
  getLogsDir,
  getLatestLogPath,
  isDev = defaultIsDev
}) => {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Folder',
          accelerator: 'CmdOrCtrl+O',
          click: () => {
            const win = typeof getMainWindow === 'function' ? getMainWindow() : null;
            if (win && !win.isDestroyed()) {
              win.webContents.send('menu-open-folder');
            }
          }
        },
        { type: 'separator' },
        { role: 'quit', label: 'Exit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'View Logs',
          click: async () => {
            try {
              const latest = await getLatestLogPath();
              if (!latest) {
                dialog.showMessageBox({ type: 'info', message: 'Aucun log trouve.' });
                return;
              }
              const content = await fs.readFile(latest, 'utf8');
              const logsWindow = new BrowserWindow({
                width: 900,
                height: 650,
                title: 'Logs',
                webPreferences: {
                  nodeIntegration: false,
                  contextIsolation: true,
                  sandbox: true
                }
              });

              const escaped = content
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');

              const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Logs</title>
    <style>
      body { margin: 0; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; background: #0b1220; color: #e5e7eb; }
      header { display:flex; justify-content: space-between; align-items:center; padding: 12px 14px; border-bottom: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.03); }
      button { background: rgba(56, 189, 248, 0.15); color: #7dd3fc; border: 1px solid rgba(56, 189, 248, 0.35); border-radius: 10px; padding: 8px 10px; cursor: pointer; }
      button:hover { background: rgba(56, 189, 248, 0.25); }
      pre { margin: 0; padding: 14px; white-space: pre-wrap; word-break: break-word; }
      .path { opacity: 0.75; font-size: 12px; }
    </style>
  </head>
  <body>
    <header>
      <div>
        <div><strong>Logs</strong></div>
        <div class="path">${latest}</div>
      </div>
      <div style="display:flex; gap:8px;">
        <button onclick="navigator.clipboard.writeText(document.getElementById('log').innerText)">Copier</button>
      </div>
    </header>
    <pre id="log">${escaped}</pre>
  </body>
</html>`;
              const tempHtmlPath = path.join(app.getPath('temp'), 'vibe-logs-viewer.html');
              await fs.writeFile(tempHtmlPath, html, 'utf-8');
              logsWindow.loadFile(tempHtmlPath);
            } catch (e) {
              dialog.showErrorBox('Erreur logs', e.message || String(e));
            }
          }
        },
        {
          label: 'Open Logs Folder',
          click: async () => {
            try {
              await fs.mkdir(getLogsDir(), { recursive: true });
              await shell.openPath(getLogsDir());
            } catch (e) {
              dialog.showErrorBox('Erreur', e.message || String(e));
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Toggle DevTools',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: () => {
            const win = typeof getMainWindow === 'function' ? getMainWindow() : null;
            if (win && !win.isDestroyed()) {
              win.webContents.toggleDevTools();
            }
          }
        },
        {
          label: 'Settings',
          click: () => {
            const win = typeof getMainWindow === 'function' ? getMainWindow() : null;
            if (win && !win.isDestroyed()) {
              win.webContents.send('menu-open-settings');
            }
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
};

const createSecondaryWindow = (name, route, options = {}) => {
  const {
    rootDir = process.cwd(),
    width = 1000,
    height = 700,
    preloadPath = path.join(rootDir, 'preload.js')
  } = options || {};

  const childWindow = new BrowserWindow({
    width,
    height,
    title: String(name || 'Fenetre'),
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  });

  const target = String(route || '').trim();
  if (/^https?:\/\//i.test(target) || /^file:\/\//i.test(target)) {
    childWindow.loadURL(target);
  } else if (target) {
    childWindow.loadFile(path.isAbsolute(target) ? target : path.join(rootDir, target));
  }

  childWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url).catch(() => { /* ignore */ });
    return { action: 'deny' };
  });

  return childWindow;
};

const createMainWindow = async ({
  app,
  dialog,
  logger,
  trustProjectPath,
  rootDir = process.cwd(),
  isDev = defaultIsDev,
  getLogsDir,
  getLatestLogPath,
  defaultProjectsDir = null
} = {}) => {
  if (!app) throw new Error('createMainWindow requires Electron app');
  if (!dialog) throw new Error('createMainWindow requires Electron dialog');

  await callLogger(logger, 'info', 'Debut de la creation de la fenetre principale');
  installContentSecurityPolicy(isDev);

  const preloadPath = path.join(rootDir, 'preload.js');
  await callLogger(logger, 'info', 'Chemin du script de prechargement:', { path: preloadPath });

  const preloadExists = fsSync.existsSync(preloadPath);
  await callLogger(logger, 'info', `Le fichier de prechargement existe: ${preloadExists}`);

  if (!preloadExists) {
    await callLogger(logger, 'error', 'Le fichier de prechargement est introuvable', { path: preloadPath });
    dialog.showErrorBox('Erreur de demarrage', "Le fichier preload.js est introuvable. L'application ne peut pas demarrer correctement.");
    app.quit();
    return null;
  }

  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    },
    icon: path.join(rootDir, 'assets', 'iconeDesktop.png')
  });

  createAppMenu({
    app,
    dialog,
    getMainWindow: () => mainWindow,
    getLogsDir,
    getLatestLogPath,
    isDev
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url).catch(() => { /* ignore */ });
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isAllowedAppNavigationUrl(url, isDev)) return;
    event.preventDefault();
    shell.openExternal(url).catch(() => { /* ignore */ });
  });

  const projectsDir = defaultProjectsDir || getDefaultProjectsDir(app);
  try {
    await fs.mkdir(projectsDir, { recursive: true });
    if (typeof trustProjectPath === 'function') {
      trustProjectPath(projectsDir);
    }
    await callLogger(logger, 'info', `Dossier des projets par defaut cree ou deja existant: ${projectsDir}`);
  } catch (error) {
    await callLogger(logger, 'error', 'Erreur lors de la creation du dossier des projets par defaut', { error: error.message });
    dialog.showErrorBox('Erreur de demarrage', `Impossible de creer le dossier des projets par defaut: ${error.message}`);
    app.quit();
    return null;
  }

  if (isDev) {
    const appUrl = process.env.ELECTRON_DEV_SERVER_URL || 'http://127.0.0.1:3004';
    console.log(`[Main] 4. Chargement de l'application depuis: ${appUrl}`);
    await callLogger(logger, 'info', "Chargement de l'application", { url: appUrl });
    mainWindow.loadURL(appUrl);
  } else {
    const indexPath = path.join(rootDir, 'client', 'build', 'index.html');
    const indexExists = fsSync.existsSync(indexPath);
    await callLogger(logger, 'info', "Chargement de l'application (prod)", { indexPath, indexExists });
    if (!indexExists) {
      dialog.showErrorBox('Erreur de chargement', `index.html introuvable: ${indexPath}`);
    } else {
      mainWindow.loadFile(indexPath);
    }
  }

  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.webContents.on('context-menu', (event, params) => {
    const contextMenuTemplate = [
      { role: 'cut', label: 'Couper' },
      { role: 'copy', label: 'Copier' },
      { role: 'paste', label: 'Coller' },
      { type: 'separator' },
      { role: 'selectAll', label: 'Tout selectionner' }
    ];

    if (isDev) {
      contextMenuTemplate.push({ type: 'separator' });
      contextMenuTemplate.push({
        label: "Inspecter l'element",
        click: () => {
          mainWindow.webContents.inspectElement(params.x, params.y);
        }
      });
    }

    const contextMenu = Menu.buildFromTemplate(contextMenuTemplate);
    contextMenu.popup({ window: mainWindow });
  });

  mainWindow.webContents.on('did-finish-load', async () => {
    await callLogger(logger, 'info', 'Contenu de la fenetre charge avec succes');

    const checkAPI = `
      try {
        const apiExists = typeof window.electronAPI !== 'undefined';
        const methods = apiExists ? Object.keys(window.electronAPI) : [];
        console.log('[RENDERER] API disponible:', apiExists, 'Methodes:', methods);
      } catch (e) {
        console.error('[RENDERER] Erreur verification API:', e);
      }
    `;

    mainWindow.webContents.executeJavaScript(checkAPI)
      .catch(err => {
        console.error("[Main] Erreur lors de l'execution du script de verification API dans le rendu:", err);
      });
  });

  mainWindow.webContents.on('console-message', (event, level, message) => {
    console.log(`[RENDERER CONSOLE ${level}] ${message}`);
  });

  mainWindow.webContents.on('render-process-gone', async (event, details) => {
    await callLogger(logger, 'error', 'Renderer process gone', details);
    dialog.showErrorBox('Erreur Renderer', `Le processus UI s'est arrete: ${details.reason}`);
  });

  mainWindow.webContents.on('unresponsive', async () => {
    await callLogger(logger, 'warn', 'Fenetre non responsive');
  });

  mainWindow.webContents.on('crashed', async () => {
    await callLogger(logger, 'error', 'Renderer crashed');
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    console.error(`[Main] Echec du chargement: ${errorCode} - ${errorDescription} pour ${validatedURL}`);
    if (!isMainFrame) return;
    dialog.showErrorBox('Erreur de chargement', `Impossible de charger la page: ${errorDescription}. Verifiez que le serveur React est lance (npm run start-react).`);
  });

  await callLogger(logger, 'info', 'Fenetre principale creee avec succes');
  return mainWindow;
};

module.exports = {
  createProjectWindowState,
  createMainWindow,
  createSecondaryWindow,
  createAppMenu,
  getDefaultProjectsDir,
  buildElectronContentSecurityPolicy,
  installContentSecurityPolicy,
  isAllowedAppNavigationUrl
};
