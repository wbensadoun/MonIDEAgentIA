// main.js
require('dotenv').config();
const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const readline = require('readline');
const { spawn } = require('child_process');
const isDev = require('electron-is-dev');
const axios = require('axios');
const logger = require('./logger');

let mainWindow;
const processes = {};

const getLogsDir = () => {
  return path.join(app.getPath('userData'), 'logs');
};

const getLatestLogPath = async () => {
  const logDir = getLogsDir();
  const files = await fs.readdir(logDir);
  const logFiles = files.filter(f => f.startsWith('app-') && f.endsWith('.log'));
  if (logFiles.length === 0) return null;

  // Trier par date/nom (app-YYYY-MM-DD.log)
  logFiles.sort();
  return path.join(logDir, logFiles[logFiles.length - 1]);
};

const normalizeContextPath = (filePath) => String(filePath || '').replace(/\\/g, '/');

const scoreFileForContext = (filePath, fileData) => {
  const normalized = normalizeContextPath(filePath).toLowerCase();
  const base = normalized.split('/').pop() || normalized;
  const depth = normalized.split('/').length;
  const size = typeof fileData?.size === 'number' ? fileData.size : 0;

  const basePriority = {
    'package.json': 0,
    'readme.md': 1,
    'readme': 2,
    'tsconfig.json': 3,
    '.gitignore': 4,
    '.gitattributes': 5,
    '.editorconfig': 6,
    '.prettierrc': 7,
    '.eslintrc': 8,
    '.npmrc': 9,
    '.env.example': 12,
    'next.config.js': 4,
    'vite.config.ts': 4,
    'vite.config.js': 4,
  };

  let score = basePriority[base] ?? 100;

  if (normalized.startsWith('src/')) score = Math.min(score, 10);
  if (normalized.startsWith('client/src/')) score = Math.min(score, 11);

  if (/\.(ts|tsx|js|jsx)$/.test(base)) score = Math.min(score, 30);
  if (/\.(md|json|yml|yaml|html|css|scss)$/.test(base)) score = Math.min(score, 50);

  score += Math.min(50, depth);
  score += Math.min(100, Math.floor(size / 2000));

  return score;
};

const pickFilesForContext = (files, maxFiles) => {
  const entries = Object.entries(files || {});
  const candidates = entries.filter(([, data]) =>
    data && typeof data.content === 'string' && !String(data.content).startsWith('[')
  );

  candidates.sort((a, b) => {
    const scoreA = scoreFileForContext(a[0], a[1]);
    const scoreB = scoreFileForContext(b[0], b[1]);
    if (scoreA !== scoreB) return scoreA - scoreB;
    return String(a[0]).localeCompare(String(b[0]));
  });

  return candidates.slice(0, maxFiles);
};

const createAppMenu = () => {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Folder',
          accelerator: 'CmdOrCtrl+O',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('menu-open-folder');
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
                dialog.showMessageBox({ type: 'info', message: 'Aucun log trouvé.' });
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
              logsWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
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
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.toggleDevTools();
            }
          }
        },
        {
          label: 'Settings',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('menu-open-settings');
            }
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
};

// Initialize logger when app is ready
app.whenReady().then(async () => {
  await logger.init();
  createWindow();
});

ipcMain.handle('get-latest-log', async () => {
  try {
    const latest = await getLatestLogPath();
    if (!latest) return { success: true, path: null, content: '' };
    const content = await fs.readFile(latest, 'utf8');
    return { success: true, path: latest, content };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// --- Validation des clés API par ping ---
ipcMain.handle('validate-api-key', async (event, provider, apiKey) => {
  try {
    if (!provider || !apiKey) {
      return { success: false, valid: false, error: 'Provider ou clé manquant' };
    }

    if (provider === 'gemini') {
      // Ping léger: lister les modèles Gemini
      const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
      try {
        const resp = await axios.get(url, { timeout: 15000 });
        const ok = resp && resp.status === 200;
        return { success: true, valid: !!ok };
      } catch (err) {
        const status = err.response?.status;
        // 401/403/400 => invalide
        return { success: true, valid: false, status, error: err.message };
      }
    }

    if (provider === 'kimi') {
      // Ping Together: lister les modèles
      try {
        const resp = await axios.get('https://api.together.xyz/v1/models', {
          headers: { Authorization: `Bearer ${apiKey}` },
          timeout: 15000
        });
        const ok = resp && resp.status === 200;
        return { success: true, valid: !!ok };
      } catch (err) {
        const status = err.response?.status;
        return { success: true, valid: false, status, error: err.message };
      }
    }

    return { success: false, valid: false, error: 'Provider inconnu' };
  } catch (error) {
    return { success: false, valid: false, error: error.message };
  }
});

ipcMain.handle('open-logs-folder', async () => {
  try {
    await fs.mkdir(getLogsDir(), { recursive: true });
    await shell.openPath(getLogsDir());
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Process Runner (Terminal intégré)
ipcMain.handle('start-process', async (event, payload) => {
  try {
    const { id, command, args = [], cwd } = payload || {};
    if (!id || !command) {
      return { success: false, error: 'Identifiant ou commande manquant' };
    }

    // Arrêter un éventuel processus existant avec le même id
    if (processes[id]) {
      try {
        processes[id].kill();
      } catch (e) {
        // ignore
      }
      delete processes[id];
    }

    const options = {};
    if (cwd && typeof cwd === 'string') {
      options.cwd = cwd;
    }
    options.shell = true;

    const child = spawn(command, args, options);
    processes[id] = child;

    child.stdout.on('data', (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('process-output', {
          id,
          type: 'stdout',
          data: data.toString()
        });
      }
    });

    child.stderr.on('data', (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('process-output', {
          id,
          type: 'stderr',
          data: data.toString()
        });
      }
    });

    child.on('close', (code) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('process-exit', { id, code });
      }
      delete processes[id];
    });

    child.on('error', (error) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('process-output', {
          id,
          type: 'stderr',
          data: `Erreur de processus: ${error.message || String(error)}`
        });
      }
    });

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('stop-process', async (event, id) => {
  try {
    if (!id || !processes[id]) {
      return { success: false, error: 'Processus introuvable' };
    }

    processes[id].kill();
    delete processes[id];
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Settings
const getSettingsPath = () => path.join(app.getPath('userData'), 'settings.json');

ipcMain.handle('save-settings', async (event, settings) => {
  try {
    await fs.mkdir(app.getPath('userData'), { recursive: true });
    await fs.writeFile(getSettingsPath(), JSON.stringify(settings, null, 2), 'utf8');
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('load-settings', async () => {
  try {
    const settingsPath = getSettingsPath();
    const exists = fsSync.existsSync(settingsPath);
    if (!exists) {
      return { success: true, settings: {} };
    }
    const content = await fs.readFile(settingsPath, 'utf8');
    const settings = JSON.parse(content);
    return { success: true, settings };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Chemin de base pour les projets de l'IDE (utilisé par défaut si aucun dossier n'est ouvert)
const getDefaultProjectsDir = () => {
  return path.join(app.getPath('userData'), 'IDE_Projects');
};

async function createWindow() {
  await logger.info('Début de la création de la fenêtre principale');

  // Chemin correct pour preload.js
  const preloadPath = path.join(__dirname, 'preload.js');
  await logger.info('Chemin du script de préchargement:', { path: preloadPath });

  // Vérifier si le fichier de préchargement existe
  const preloadExists = fsSync.existsSync(preloadPath);
  await logger.info(`Le fichier de préchargement existe: ${preloadExists}`);

  if (!preloadExists) {
    await logger.error('Le fichier de préchargement est introuvable', { path: preloadPath });
    dialog.showErrorBox('Erreur de démarrage', 'Le fichier preload.js est introuvable. L\'application ne peut pas démarrer correctement.');
    app.quit();
    return;
  }

  mainWindow = new BrowserWindow({
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
      allowRunningInsecureContent: false,
      additionalArguments: [`--content-security-policy=${"default-src 'self'; " +
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
        "style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data: blob:; " +
        "font-src 'self'; " +
        "connect-src 'self' https://generativelanguage.googleapis.com https://api.together.xyz http://localhost:*; " +
        "frame-src 'self' data: blob: http://localhost:*; " +
        "frame-ancestors 'none';"
        }`]
    },
    icon: path.join(__dirname, 'assets', 'iconeDesktop.png')
  });

  createAppMenu();

  // Crée le dossier des projets par défaut s'il n'existe pas
  try {
    await fs.mkdir(getDefaultProjectsDir(), { recursive: true });
    await logger.info(`Dossier des projets par défaut créé ou déjà existant: ${getDefaultProjectsDir()}`);
  } catch (error) {
    await logger.error('Erreur lors de la création du dossier des projets par défaut', { error: error.message });
    dialog.showErrorBox('Erreur de démarrage', `Impossible de créer le dossier des projets par défaut: ${error.message}`);
    app.quit();
    return;
  }

  // Charge l'application React
  if (isDev) {
    const appUrl = 'http://localhost:3004';
    console.log(`[Main] 4. Chargement de l'application depuis: ${appUrl}`);
    await logger.info('Chargement de l\'application', { url: appUrl });
    mainWindow.loadURL(appUrl);
  } else {
    const indexPath = path.join(__dirname, 'client', 'build', 'index.html');
    const indexExists = fsSync.existsSync(indexPath);
    await logger.info('Chargement de l\'application (prod)', { indexPath, indexExists });
    if (!indexExists) {
      dialog.showErrorBox('Erreur de chargement', `index.html introuvable: ${indexPath}`);
    } else {
      mainWindow.loadFile(indexPath);
    }
  }

  // Ouvre les outils de développement (DevTools).
  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  // Événements de débogage
  mainWindow.webContents.on('did-finish-load', async () => {
    await logger.info('Contenu de la fenêtre chargé avec succès');

    // Vérification simplifiée de l'API
    // Suppression du "return" direct pour éviter "Illegal return statement"
    const checkAPI = `
      try {
        const apiExists = typeof window.electronAPI !== 'undefined';
        const methods = apiExists ? Object.keys(window.electronAPI) : [];
        console.log('[RENDERER] API disponible:', apiExists, 'Méthodes:', methods);
      } catch (e) {
        console.error('[RENDERER] Erreur vérification API:', e);
      }
    `;

    // Exécuter la vérification
    mainWindow.webContents.executeJavaScript(checkAPI)
      .catch(err => {
        console.error('[Main] Erreur lors de l\'exécution du script de vérification API dans le rendu:', err);
      });
  });

  mainWindow.webContents.on('console-message', (event, level, message) => {
    // Redirige les messages console du processus de rendu vers le processus principal
    console.log(`[RENDERER CONSOLE ${level}] ${message}`);
  });

  mainWindow.webContents.on('render-process-gone', async (event, details) => {
    await logger.error('Renderer process gone', details);
    dialog.showErrorBox('Erreur Renderer', `Le processus UI s'est arrêté: ${details.reason}`);
  });

  mainWindow.webContents.on('unresponsive', async () => {
    await logger.warn('Fenêtre non responsive');
  });

  mainWindow.webContents.on('crashed', async () => {
    await logger.error('Renderer crashed');
  });

  // N'affiche une boîte d'erreur que si l'échec concerne le frame principal
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    console.error(`[Main] Échec du chargement: ${errorCode} - ${errorDescription} pour ${validatedURL}`);
    if (!isMainFrame) {
      // Évite d'alerter l'utilisateur pour les iframes (ex: Live Preview)
      return;
    }
    dialog.showErrorBox('Erreur de chargement', `Impossible de charger la page: ${errorDescription}. Vérifiez que le serveur React est lancé (npm run start-react).`);
  });

  await logger.info('Fenêtre principale créée avec succès');
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// --- IPC Handlers pour les opérations sur les fichiers ---

// Ouvre un dialogue de sélection de dossier
ipcMain.handle('open-folder-dialog', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  if (canceled) {
    return { success: true, path: null }; // Annulé
  } else {
    return { success: true, path: filePaths[0] }; // Retourne le chemin du dossier sélectionné
  }
});

// Lister tous les fichiers et dossiers dans un répertoire donné avec structure hiérarchique
ipcMain.handle('get-all-files', async (event, folderPath) => {
  try {
    async function buildFileTree(dirPath, relativePath = '') {
      const items = await fs.readdir(dirPath, { withFileTypes: true });
      const treeItems = [];

      for (const item of items) {
        const itemPath = path.join(dirPath, item.name);
        const relativeItemPath = relativePath ? path.join(relativePath, item.name) : item.name;

        if (item.isDirectory()) {
          // Pour les dossiers, on crée la structure sans charger les enfants immédiatement
          treeItems.push({
            name: item.name,
            type: 'directory',
            path: relativeItemPath,
            fullPath: itemPath,
            children: [], // Sera chargé à la demande
            hasChildren: true // Indicateur qu'il peut avoir des enfants
          });
        } else {
          treeItems.push({
            name: item.name,
            type: 'file',
            path: relativeItemPath,
            fullPath: itemPath
          });
        }
      }

      return treeItems;
    }

    const projectItems = await buildFileTree(folderPath);
    return { success: true, items: projectItems };
  } catch (error) {
    console.error('Erreur lors de la lecture du dossier:', error);
    return { success: false, error: error.message };
  }
});

// Nouvelle fonction pour charger les enfants d'un dossier spécifique
ipcMain.handle('get-folder-children', async (event, projectPath, folderPath) => {
  try {
    if (!folderPath || typeof folderPath !== 'string') {
      return { success: false, error: 'Chemin du dossier manquant' };
    }

    const basePath = projectPath && typeof projectPath === 'string' ? projectPath : folderPath;
    const resolvedFolderPath = path.isAbsolute(folderPath)
      ? folderPath
      : (projectPath ? path.join(projectPath, folderPath) : folderPath);

    async function getChildren(dirPath) {
      const items = await fs.readdir(dirPath, { withFileTypes: true });
      const children = [];

      for (const item of items) {
        const itemPath = path.join(dirPath, item.name);
        const relativeItemPath = basePath ? path.relative(basePath, itemPath) : item.name;

        if (item.isDirectory()) {
          children.push({
            name: item.name,
            type: 'directory',
            path: relativeItemPath,
            fullPath: itemPath,
            children: [],
            hasChildren: true
          });
        } else {
          children.push({
            name: item.name,
            type: 'file',
            path: relativeItemPath,
            fullPath: itemPath
          });
        }
      }

      return children;
    }

    const children = await getChildren(resolvedFolderPath);
    return { success: true, children };
  } catch (error) {
    console.error('Erreur lors de la lecture des enfants du dossier:', error);
    return { success: false, error: error.message };
  }
});

// Lister les fichiers d'un projet (liste plate) - utile pour Ctrl+P / index
ipcMain.handle('list-project-files', async (event, projectPath, options = {}) => {
  try {
    if (!projectPath) {
      return { success: false, error: 'Chemin du projet non fourni' };
    }

    const safeOptions = options && typeof options === 'object' ? options : {};
    const includeHidden = !!safeOptions.includeHidden;
    const includeSecrets = !!safeOptions.includeSecrets;
    const includeGit = !!safeOptions.includeGit;
    const includeNodeModules = !!safeOptions.includeNodeModules;
    const includeBuild = !!safeOptions.includeBuild;

    const clampNumber = (value, min, max, fallback) => {
      const n = Number(value);
      if (!Number.isFinite(n)) return fallback;
      return Math.min(max, Math.max(min, n));
    };

    const maxFiles = clampNumber(safeOptions.maxFiles, 200, 500000, 30000);
    const maxDepth = clampNumber(safeOptions.maxDepth, 2, 60, 40);

    const files = [];
    let skippedCount = 0;
    let hitLimit = false;

    const textExtensions = new Set([
      '.js', '.jsx', '.ts', '.tsx',
      '.html', '.css', '.scss', '.sass', '.less',
      '.json', '.md', '.txt',
      '.py', '.java', '.cpp', '.c', '.h', '.hpp', '.php', '.rb', '.go', '.rs',
      '.xml', '.yml', '.yaml', '.sql',
      '.sh', '.bat', '.ps1',
      '.vue', '.svelte', '.astro',
      '.toml', '.ini', '.conf', '.config'
    ]);

    const textFileNames = new Set([
      'readme', 'readme.md', 'license', 'licence',
      'dockerfile', 'makefile',
      '.gitignore', '.gitattributes', '.editorconfig', '.npmrc', '.nvmrc',
      '.prettierrc', '.eslintrc', '.babelrc',
      '.env.example', '.env.sample', '.env.template', '.env.dist'
    ]);

    const isSensitiveFileName = (name) => {
      const lower = String(name || '').toLowerCase();
      if (lower === '.env') return true;
      if (lower.startsWith('.env.')) {
        if (lower === '.env.example') return false;
        if (lower === '.env.sample') return false;
        if (lower === '.env.template') return false;
        if (lower === '.env.dist') return false;
        return true;
      }
      if (lower.endsWith('.pem')) return true;
      if (lower.endsWith('.key')) return true;
      if (lower.endsWith('.pfx')) return true;
      if (lower.endsWith('.p12')) return true;
      if (lower.endsWith('.jks')) return true;
      if (lower.endsWith('.keystore')) return true;
      if (lower.includes('id_rsa')) return true;
      if (lower.includes('id_ed25519')) return true;
      return false;
    };

    const shouldSkipDirectory = (name) => {
      if (!name) return true;
      if (!includeGit && name === '.git') return true;
      if (!includeNodeModules && name === 'node_modules') return true;
      if (
        !includeBuild &&
        (name === 'dist' ||
          name === 'build' ||
          name === 'out' ||
          name === '.next' ||
          name === 'coverage' ||
          name === '.turbo' ||
          name === '.cache' ||
          name === '.parcel-cache')
      ) {
        return true;
      }
      return false;
    };

    const shouldReadAsText = (name) => {
      const lower = String(name || '').toLowerCase();
      if (textFileNames.has(lower)) return true;
      const ext = path.extname(lower);
      if (textExtensions.has(ext)) return true;
      return false;
    };

    async function walk(dirPath, relativePath = '', depth = 0) {
      if (hitLimit) return;
      if (depth > maxDepth) return;

      let items;
      try {
        items = await fs.readdir(dirPath, { withFileTypes: true });
      } catch {
        skippedCount += 1;
        return;
      }

      for (const item of items) {
        if (hitLimit) return;

        if (item.isSymbolicLink && item.isSymbolicLink()) {
          skippedCount += 1;
          continue;
        }

        const itemName = item.name;
        if (!itemName) continue;

        if (!includeHidden && itemName.startsWith('.')) {
          skippedCount += 1;
          continue;
        }

        if (!includeSecrets && isSensitiveFileName(itemName)) {
          skippedCount += 1;
          continue;
        }

        if (itemName.endsWith('.log') || itemName.endsWith('.tmp')) {
          skippedCount += 1;
          continue;
        }

        const fullPath = path.join(dirPath, itemName);
        const relativeFilePath = path.join(relativePath, itemName);

        if (item.isDirectory()) {
          if (shouldSkipDirectory(itemName)) {
            skippedCount += 1;
            continue;
          }
          await walk(fullPath, relativeFilePath, depth + 1);
          continue;
        }

        if (!item.isFile()) {
          skippedCount += 1;
          continue;
        }

        if (!shouldReadAsText(itemName)) {
          continue;
        }

        files.push(relativeFilePath);
        if (files.length >= maxFiles) {
          hitLimit = true;
          return;
        }
      }
    }

    await walk(projectPath);

    return {
      success: true,
      files,
      stats: {
        fileCount: files.length,
        skippedCount,
        hitLimit,
        options: {
          includeHidden,
          includeSecrets,
          includeGit,
          includeNodeModules,
          includeBuild,
          maxFiles,
          maxDepth
        }
      }
    };
  } catch (error) {
    console.error('Erreur list-project-files:', error);
    return { success: false, error: error.message };
  }
});

// Recherche globale dans le projet
ipcMain.handle('search-in-project', async (event, projectPath, query, options = {}) => {
  try {
    if (!projectPath) {
      return { success: false, error: 'Chemin du projet non fourni' };
    }

    const q = String(query || '');
    if (!q.trim()) {
      return { success: true, results: [], stats: { matches: 0, scannedFiles: 0, hitLimit: false } };
    }

    const safeOptions = options && typeof options === 'object' ? options : {};
    const includeHidden = !!safeOptions.includeHidden;
    const includeSecrets = !!safeOptions.includeSecrets;
    const includeGit = !!safeOptions.includeGit;
    const includeNodeModules = !!safeOptions.includeNodeModules;
    const includeBuild = !!safeOptions.includeBuild;
    const caseSensitive = !!safeOptions.caseSensitive;

    const clampNumber = (value, min, max, fallback) => {
      const n = Number(value);
      if (!Number.isFinite(n)) return fallback;
      return Math.min(max, Math.max(min, n));
    };

    const maxMatches = clampNumber(safeOptions.maxMatches, 50, 50000, 800);
    const maxFileSize = clampNumber(safeOptions.maxFileSize, 5000, 5000000, 800000);
    const maxDepth = clampNumber(safeOptions.maxDepth, 2, 60, 40);

    const results = [];
    let scannedFiles = 0;
    let matches = 0;
    let hitLimit = false;

    const needle = caseSensitive ? q : q.toLowerCase();

    const textExtensions = new Set([
      '.js', '.jsx', '.ts', '.tsx',
      '.html', '.css', '.scss', '.sass', '.less',
      '.json', '.md', '.txt',
      '.py', '.java', '.cpp', '.c', '.h', '.hpp', '.php', '.rb', '.go', '.rs',
      '.xml', '.yml', '.yaml', '.sql',
      '.sh', '.bat', '.ps1',
      '.vue', '.svelte', '.astro',
      '.toml', '.ini', '.conf', '.config'
    ]);

    const textFileNames = new Set([
      'readme', 'readme.md', 'license', 'licence',
      'dockerfile', 'makefile',
      '.gitignore', '.gitattributes', '.editorconfig', '.npmrc', '.nvmrc',
      '.prettierrc', '.eslintrc', '.babelrc',
      '.env.example', '.env.sample', '.env.template', '.env.dist'
    ]);

    const isSensitiveFileName = (name) => {
      const lower = String(name || '').toLowerCase();
      if (lower === '.env') return true;
      if (lower.startsWith('.env.')) {
        if (lower === '.env.example') return false;
        if (lower === '.env.sample') return false;
        if (lower === '.env.template') return false;
        if (lower === '.env.dist') return false;
        return true;
      }
      if (lower.endsWith('.pem')) return true;
      if (lower.endsWith('.key')) return true;
      if (lower.endsWith('.pfx')) return true;
      if (lower.endsWith('.p12')) return true;
      if (lower.endsWith('.jks')) return true;
      if (lower.endsWith('.keystore')) return true;
      if (lower.includes('id_rsa')) return true;
      if (lower.includes('id_ed25519')) return true;
      return false;
    };

    const shouldSkipDirectory = (name) => {
      if (!name) return true;
      if (!includeGit && name === '.git') return true;
      if (!includeNodeModules && name === 'node_modules') return true;
      if (
        !includeBuild &&
        (name === 'dist' ||
          name === 'build' ||
          name === 'out' ||
          name === '.next' ||
          name === 'coverage' ||
          name === '.turbo' ||
          name === '.cache' ||
          name === '.parcel-cache')
      ) {
        return true;
      }
      return false;
    };

    const shouldReadAsText = (name) => {
      const lower = String(name || '').toLowerCase();
      if (textFileNames.has(lower)) return true;
      const ext = path.extname(lower);
      if (textExtensions.has(ext)) return true;
      return false;
    };

    const addResult = (relativeFilePath, lineNumber, column, lineText) => {
      results.push({
        file: relativeFilePath,
        line: lineNumber,
        column,
        text: String(lineText || '').slice(0, 400)
      });
      matches += 1;
      if (matches >= maxMatches) {
        hitLimit = true;
      }
    };

    async function searchFile(fullPath, relativeFilePath) {
      if (hitLimit) return;

      let stats;
      try {
        stats = await fs.stat(fullPath);
      } catch {
        return;
      }

      if (stats.size > maxFileSize) {
        return;
      }

      scannedFiles += 1;

      const stream = fsSync.createReadStream(fullPath, { encoding: 'utf8' });
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

      try {
        let lineNumber = 0;
        for await (const line of rl) {
          if (hitLimit) break;
          lineNumber += 1;
          const hay = caseSensitive ? String(line) : String(line).toLowerCase();
          const idx = hay.indexOf(needle);
          if (idx !== -1) {
            addResult(relativeFilePath, lineNumber, idx + 1, line);
          }
        }
      } catch {
        // ignore
      } finally {
        try {
          rl.close();
        } catch {
          // ignore
        }
        try {
          stream.destroy();
        } catch {
          // ignore
        }
      }
    }

    async function walk(dirPath, relativePath = '', depth = 0) {
      if (hitLimit) return;
      if (depth > maxDepth) return;

      let items;
      try {
        items = await fs.readdir(dirPath, { withFileTypes: true });
      } catch {
        return;
      }

      for (const item of items) {
        if (hitLimit) return;

        if (item.isSymbolicLink && item.isSymbolicLink()) {
          continue;
        }

        const itemName = item.name;
        if (!itemName) continue;

        if (!includeHidden && itemName.startsWith('.')) {
          continue;
        }

        if (!includeSecrets && isSensitiveFileName(itemName)) {
          continue;
        }

        if (itemName.endsWith('.log') || itemName.endsWith('.tmp')) {
          continue;
        }

        const fullPath = path.join(dirPath, itemName);
        const relativeFilePath = path.join(relativePath, itemName);

        if (item.isDirectory()) {
          if (shouldSkipDirectory(itemName)) {
            continue;
          }
          await walk(fullPath, relativeFilePath, depth + 1);
          continue;
        }

        if (!item.isFile()) {
          continue;
        }

        if (!shouldReadAsText(itemName)) {
          continue;
        }

        await searchFile(fullPath, relativeFilePath);
      }
    }

    await walk(projectPath);

    return {
      success: true,
      results,
      stats: {
        matches,
        scannedFiles,
        hitLimit,
        options: {
          includeHidden,
          includeSecrets,
          includeGit,
          includeNodeModules,
          includeBuild,
          caseSensitive,
          maxMatches,
          maxFileSize,
          maxDepth
        }
      }
    };
  } catch (error) {
    console.error('Erreur search-in-project:', error);
    return { success: false, error: error.message };
  }
});

// Lire le contenu d'un fichier
ipcMain.handle('read-file', async (event, projectPath, filename) => {
  try {
    const filePath = path.join(projectPath, filename);

    // Vérifier si le fichier existe avant de le lire
    await fs.access(filePath);

    const content = await fs.readFile(filePath, 'utf-8');
    return { success: true, content };
  } catch (error) {
    console.error(`Erreur de lecture du fichier ${filename} dans ${projectPath}:`, error);
    return { success: false, error: error.message };
  }
});

// Écrire/créer un fichier
ipcMain.handle('write-file', async (event, projectPath, filename, content) => {
  try {
    const filePath = path.join(projectPath, filename);

    // Créer les dossiers parents si nécessaire
    const dirPath = path.dirname(filePath);
    try {
      await fs.mkdir(dirPath, { recursive: true });
    } catch (dirError) {
      // Dossier existe déjà
    }

    await fs.writeFile(filePath, content, 'utf-8');
    console.log(`Fichier écrit: ${filePath}`);
    return { success: true };
  } catch (error) {
    console.error(`Erreur d'écriture du fichier ${filename} dans ${projectPath}:`, error);
    return { success: false, error: error.message };
  }
});

// Supprimer un fichier
ipcMain.handle('delete-file', async (event, projectPath, filename) => {
  try {
    const filePath = path.join(projectPath, filename);
    await fs.unlink(filePath);
    return { success: true };
  } catch (error) {
    console.error(`Erreur de suppression du fichier ${filename} dans ${projectPath}:`, error);
    return { success: false, error: error.message };
  }
});

// Créer un nouveau fichier (vide ou avec contenu initial)
ipcMain.handle('createNewFile', async (event, projectPath, filename, initialContent = '') => {
  try {
    const filePath = path.join(projectPath, filename);

    console.log(`Tentative de création du fichier: ${filePath}`);

    // Créer les dossiers parents automatiquement
    const dirPath = path.dirname(filePath);
    try {
      await fs.mkdir(dirPath, { recursive: true });
      console.log(`Dossiers parents créés: ${dirPath}`);
    } catch (dirError) {
      console.log(`Dossiers déjà existants: ${dirPath}`);
    }

    // Vérifier si le fichier existe pour éviter de l'écraser
    try {
      await fs.access(filePath);
      console.log(`Le fichier existe déjà: ${filePath}`);
      return {
        success: false,
        error: `Le fichier "${filename}" existe déjà`
      };
    } catch (e) {
      // Si fs.access échoue, le fichier n'existe pas, on peut le créer
      await fs.writeFile(filePath, initialContent, 'utf-8');
      console.log(`Fichier créé avec succès: ${filePath}`);
      return {
        success: true,
        message: `Fichier "${filename}" créé avec succès`
      };
    }
  } catch (error) {
    console.error(`Erreur lors de la création du fichier ${filename} dans ${projectPath}:`, error);
    return {
      success: false,
      error: `Erreur de création: ${error.message}`
    };
  }
});

// Créer un nouveau dossier
ipcMain.handle('createDirectory', async (event, projectPath, dirname) => {
  try {
    const dirPath = path.join(projectPath, dirname);
    // Vérifier si le dossier existe
    try {
      await fs.access(dirPath);
      return { success: false, error: 'Le dossier existe déjà' };
    } catch (e) {
      await fs.mkdir(dirPath, { recursive: true });
      return { success: true };
    }
  } catch (error) {
    console.error(`Erreur lors de la création du dossier ${dirname} dans ${projectPath}:`, error);
    return { success: false, error: error.message };
  }
});

// Supprimer un dossier (vide ou non vide)
ipcMain.handle('deleteDirectory', async (event, projectPath, dirname) => {
  try {
    const dirPath = path.join(projectPath, dirname);
    await fs.rm(dirPath, { recursive: true, force: true }); // fs.rm est plus moderne que fs.rmdir
    return { success: true };
  } catch (error) {
    console.error(`Erreur lors de la suppression du dossier ${dirname} dans ${projectPath}:`, error);
    return { success: false, error: error.message };
  }
});

// Modifier partiellement un fichier (remplacer une section)
ipcMain.handle('editFile', async (event, projectPath, filename, searchText, replaceText) => {
  try {
    const filePath = path.join(projectPath, filename);

    // Lire le contenu actuel
    const currentContent = await fs.readFile(filePath, 'utf-8');

    // Vérifier si le texte à remplacer existe
    if (!currentContent.includes(searchText)) {
      return {
        success: false,
        error: `Le texte à remplacer n'a pas été trouvé dans "${filename}"`
      };
    }

    // Remplacer le texte
    const newContent = currentContent.replace(searchText, replaceText);

    // Écrire le nouveau contenu
    await fs.writeFile(filePath, newContent, 'utf-8');

    console.log(`Fichier modifié: ${filePath}`);
    return {
      success: true,
      message: `Section modifiée dans "${filename}"`
    };
  } catch (error) {
    console.error('Erreur lors de la modification du fichier:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

// Renommer un fichier
ipcMain.handle('renameFile', async (event, projectPath, oldFilename, newFilename) => {
  try {
    const oldPath = path.join(projectPath, oldFilename);
    const newPath = path.join(projectPath, newFilename);

    // Vérifier si le fichier source existe
    try {
      await fs.access(oldPath);
    } catch {
      return {
        success: false,
        error: `Le fichier "${oldFilename}" n'existe pas`
      };
    }

    // Vérifier si le nouveau nom n'existe pas déjà
    try {
      await fs.access(newPath);
      return {
        success: false,
        error: `Un fichier nommé "${newFilename}" existe déjà`
      };
    } catch {
      // C'est bon, le nouveau nom n'existe pas
    }

    // Renommer le fichier
    await fs.rename(oldPath, newPath);

    console.log(`Fichier renommé: ${oldPath} -> ${newPath}`);
    return {
      success: true,
      message: `Fichier renommé de "${oldFilename}" vers "${newFilename}"`
    };
  } catch (error) {
    console.error('Erreur lors du renommage:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

// Copier un fichier
ipcMain.handle('copyFile', async (event, projectPath, sourceFilename, destFilename) => {
  try {
    const sourcePath = path.join(projectPath, sourceFilename);
    const destPath = path.join(projectPath, destFilename);

    // Vérifier si le fichier source existe
    try {
      await fs.access(sourcePath);
    } catch {
      return {
        success: false,
        error: `Le fichier source "${sourceFilename}" n'existe pas`
      };
    }

    // Vérifier si la destination n'existe pas déjà
    try {
      await fs.access(destPath);
      return {
        success: false,
        error: `Le fichier de destination "${destFilename}" existe déjà`
      };
    } catch {
      // C'est bon, la destination n'existe pas
    }

    // Créer les dossiers parents si nécessaire
    const destDir = path.dirname(destPath);
    await fs.mkdir(destDir, { recursive: true });

    // Copier le fichier
    await fs.copyFile(sourcePath, destPath);

    console.log(`Fichier copié: ${sourcePath} -> ${destPath}`);
    return {
      success: true,
      message: `Fichier "${sourceFilename}" copié vers "${destFilename}"`
    };
  } catch (error) {
    console.error('Erreur lors de la copie:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

// Déplacer un fichier
ipcMain.handle('moveFile', async (event, projectPath, sourceFilename, destFilename) => {
  try {
    const sourcePath = path.join(projectPath, sourceFilename);
    const destPath = path.join(projectPath, destFilename);

    // Vérifier si le fichier source existe
    try {
      await fs.access(sourcePath);
    } catch {
      return {
        success: false,
        error: `Le fichier source "${sourceFilename}" n'existe pas`
      };
    }

    // Vérifier si la destination n'existe pas déjà
    try {
      await fs.access(destPath);
      return {
        success: false,
        error: `Le fichier de destination "${destFilename}" existe déjà`
      };
    } catch {
      // C'est bon, la destination n'existe pas
    }

    // Créer les dossiers parents si nécessaire
    const destDir = path.dirname(destPath);
    await fs.mkdir(destDir, { recursive: true });

    // Déplacer le fichier
    await fs.rename(sourcePath, destPath);

    console.log(`Fichier déplacé: ${sourcePath} -> ${destPath}`);
    return {
      success: true,
      message: `Fichier "${sourceFilename}" déplacé vers "${destFilename}"`
    };
  } catch (error) {
    console.error('Erreur lors du déplacement:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

// Lire tous les fichiers du projet pour fournir le contexte complet à l'IA
ipcMain.handle('getAllProjectFiles', async (event, projectPath, options = {}) => {
  console.log('[Main] getAllProjectFiles appelé avec projectPath:', projectPath);
  try {
    if (!projectPath) {
      const error = "Chemin du projet non fourni";
      console.error('[Main] Erreur:', error);
      return { success: false, error };
    }

    const safeOptions = options && typeof options === 'object' ? options : {};
    const includeHidden = !!safeOptions.includeHidden;
    const includeSecrets = !!safeOptions.includeSecrets;
    const includeGit = !!safeOptions.includeGit;
    const includeNodeModules = !!safeOptions.includeNodeModules;
    const includeBuild = !!safeOptions.includeBuild;
    const largeFileStrategy = safeOptions.largeFileStrategy === 'truncate' ? 'truncate' : 'skip';

    const clampNumber = (value, min, max, fallback) => {
      const n = Number(value);
      if (!Number.isFinite(n)) return fallback;
      return Math.min(max, Math.max(min, n));
    };

    const maxFileSize = clampNumber(safeOptions.maxFileSize, 5000, 2000000, 50000); // 5KB..2MB, défaut 50KB
    const maxFiles = clampNumber(safeOptions.maxFiles, 200, 50000, 8000);
    const maxTotalBytes = clampNumber(safeOptions.maxTotalBytes, 200000, 200000000, 25000000); // 0.2MB..200MB
    const maxDepth = clampNumber(safeOptions.maxDepth, 2, 60, 30);

    const projectFiles = {};
    let totalBytes = 0;
    let hitLimit = false;
    let truncatedCount = 0;
    let skippedCount = 0;

    const textExtensions = new Set([
      '.js', '.jsx', '.ts', '.tsx',
      '.html', '.css', '.scss', '.sass', '.less',
      '.json', '.md', '.txt',
      '.py', '.java', '.cpp', '.c', '.h', '.hpp', '.php', '.rb', '.go', '.rs',
      '.xml', '.yml', '.yaml', '.sql',
      '.sh', '.bat', '.ps1',
      '.vue', '.svelte', '.astro',
      '.toml', '.ini', '.conf', '.config'
    ]);

    const textFileNames = new Set([
      'readme', 'readme.md', 'license', 'licence',
      'dockerfile', 'makefile',
      '.gitignore', '.gitattributes', '.editorconfig', '.npmrc', '.nvmrc',
      '.prettierrc', '.eslintrc', '.babelrc',
      '.env.example', '.env.sample', '.env.template', '.env.dist'
    ]);

    const isSensitiveFileName = (name) => {
      const lower = String(name || '').toLowerCase();
      if (lower === '.env') return true;
      if (lower.startsWith('.env.')) {
        if (lower === '.env.example') return false;
        if (lower === '.env.sample') return false;
        if (lower === '.env.template') return false;
        if (lower === '.env.dist') return false;
        return true;
      }
      if (lower.endsWith('.pem')) return true;
      if (lower.endsWith('.key')) return true;
      if (lower.endsWith('.pfx')) return true;
      if (lower.endsWith('.p12')) return true;
      if (lower.endsWith('.jks')) return true;
      if (lower.endsWith('.keystore')) return true;
      if (lower.includes('id_rsa')) return true;
      if (lower.includes('id_ed25519')) return true;
      return false;
    };

    const shouldSkipName = (name) => {
      if (!name) return true;
      if (name.endsWith('.log') || name.endsWith('.tmp')) return true;
      return false;
    };

    const shouldSkipDirectory = (name) => {
      if (!name) return true;
      if (!includeGit && name === '.git') return true;
      if (!includeNodeModules && name === 'node_modules') return true;
      if (
        !includeBuild &&
        (name === 'dist' ||
          name === 'build' ||
          name === 'out' ||
          name === '.next' ||
          name === 'coverage' ||
          name === '.turbo' ||
          name === '.cache' ||
          name === '.parcel-cache')
      ) {
        return true;
      }
      return false;
    };

    const shouldReadAsText = (name) => {
      const lower = String(name || '').toLowerCase();
      if (textFileNames.has(lower)) return true;
      const ext = path.extname(lower);
      if (textExtensions.has(ext)) return true;
      return false;
    };

    const recordFile = (relativeFilePath, payload, approxBytes = 0) => {
      const currentCount = Object.keys(projectFiles).length;
      if (currentCount >= maxFiles || totalBytes >= maxTotalBytes) {
        hitLimit = true;
        return false;
      }
      projectFiles[relativeFilePath] = payload;
      totalBytes += Math.max(0, Number(approxBytes) || 0);
      return true;
    };

    async function readFileTruncated(fullPath, bytesToRead) {
      const handle = await fs.open(fullPath, 'r');
      try {
        const buffer = Buffer.alloc(bytesToRead);
        const { bytesRead } = await handle.read(buffer, 0, bytesToRead, 0);
        return buffer.subarray(0, bytesRead).toString('utf-8');
      } finally {
        try {
          await handle.close();
        } catch {
          // ignore
        }
      }
    }

    async function readDirectory(dirPath, relativePath = '', depth = 0) {
      if (depth > maxDepth || hitLimit) return;

      let items;
      try {
        items = await fs.readdir(dirPath, { withFileTypes: true });
      } catch {
        skippedCount += 1;
        return;
      }

      for (const item of items) {
        if (hitLimit) return;

        if (item.isSymbolicLink && item.isSymbolicLink()) {
          skippedCount += 1;
          continue;
        }

        const itemName = item.name;
        if (!itemName) continue;

        if (!includeHidden && itemName.startsWith('.')) {
          skippedCount += 1;
          continue;
        }

        if (!includeSecrets && isSensitiveFileName(itemName)) {
          skippedCount += 1;
          continue;
        }

        if (shouldSkipName(itemName)) {
          skippedCount += 1;
          continue;
        }

        const fullPath = path.join(dirPath, itemName);
        const relativeFilePath = path.join(relativePath, itemName);

        if (item.isDirectory()) {
          if (shouldSkipDirectory(itemName)) {
            skippedCount += 1;
            continue;
          }
          await readDirectory(fullPath, relativeFilePath, depth + 1);
          continue;
        }

        if (!item.isFile()) {
          skippedCount += 1;
          continue;
        }

        try {
          const stats = await fs.stat(fullPath);

          const treatAsText = shouldReadAsText(itemName);
          if (!treatAsText) {
            recordFile(relativeFilePath, {
              type: 'file',
              content: '[FICHIER BINAIRE - Non lu]',
              size: stats.size
            }, 0);
            continue;
          }

          if (stats.size > maxFileSize) {
            if (largeFileStrategy === 'truncate') {
              const content = await readFileTruncated(fullPath, maxFileSize);
              truncatedCount += 1;
              recordFile(relativeFilePath, {
                type: 'file',
                content,
                size: stats.size,
                truncated: true
              }, Math.min(maxFileSize, stats.size));
            } else {
              recordFile(relativeFilePath, {
                type: 'file',
                content: '[FICHIER TROP VOLUMINEUX - Non lu]',
                size: stats.size
              }, 0);
            }
            continue;
          }

          const content = await fs.readFile(fullPath, 'utf-8');
          recordFile(relativeFilePath, {
            type: 'file',
            content,
            size: stats.size
          }, stats.size);
        } catch (readError) {
          recordFile(relativeFilePath, {
            type: 'file',
            content: '[ERREUR DE LECTURE]',
            error: readError.message
          }, 0);
        }
      }
    }

    await readDirectory(projectPath);

    const fileCount = Object.keys(projectFiles).length;
    console.log(`[Main] Succès: ${fileCount} fichiers lus pour le projet (octets=${totalBytes}, limite=${hitLimit})`);

    return {
      success: true,
      files: projectFiles,
      projectPath: projectPath,
      stats: {
        fileCount,
        totalBytes,
        hitLimit,
        truncatedCount,
        skippedCount,
        options: {
          includeHidden,
          includeSecrets,
          includeGit,
          includeNodeModules,
          includeBuild,
          maxFileSize,
          maxFiles,
          maxTotalBytes,
          maxDepth,
          largeFileStrategy
        }
      }
    };
  } catch (error) {
    console.error('Erreur lors de la lecture du projet:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

// Fonction createNewFile déjà définie plus haut - duplication supprimée

// Sauvegarder une conversation dans un fichier TXT
ipcMain.handle('saveConversation', async (event, projectPath, conversationHistory) => {
  try {
    // Générer un nom de fichier intelligent basé sur le contenu
    const conversationTitle = generateConversationTitle(conversationHistory);
    const timestamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-');
    const fileName = `${timestamp}_${conversationTitle}.txt`;
    const filePath = path.join(projectPath, 'conversations', fileName);

    // Créer le dossier conversations s'il n'existe pas
    const conversationsDir = path.join(projectPath, 'conversations');
    try {
      await fs.mkdir(conversationsDir, { recursive: true });
    } catch (err) {
      // Le dossier existe déjà
    }

    // Formater la conversation
    let conversationText = `CONVERSATION AVEC L'AGENT IA\n`;
    conversationText += `Date: ${new Date().toLocaleString('fr-FR')}\n`;
    conversationText += `Projet: ${path.basename(projectPath)}\n`;
    conversationText += `${'='.repeat(60)}\n\n`;

    conversationHistory.forEach((msg, index) => {
      const role = msg.role === 'user' ? 'UTILISATEUR' :
        msg.role === 'model' ? 'AGENT IA' : 'SYSTÈME';
      conversationText += `[${role}]\n${msg.text}\n\n`;
      conversationText += `${'-'.repeat(40)}\n\n`;
    });

    await fs.writeFile(filePath, conversationText, 'utf-8');

    return {
      success: true,
      fileName: fileName,
      filePath: filePath
    };
  } catch (error) {
    console.error('Erreur lors de la sauvegarde de la conversation:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

// Lister les conversations existantes pour un projet
ipcMain.handle('listConversations', async (event, projectPath) => {
  try {
    if (!projectPath) {
      return { success: false, error: 'Aucun chemin de projet fourni.' };
    }

    const conversationsDir = path.join(projectPath, 'conversations');
    let entries;

    try {
      entries = await fs.readdir(conversationsDir, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') {
        // Pas encore de dossier de conversations : retourner une liste vide
        return { success: true, conversations: [] };
      }
      throw error;
    }

    const conversations = [];

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!entry.name.toLowerCase().endsWith('.txt')) continue;

      const filePath = path.join(conversationsDir, entry.name);
      const stats = await fs.stat(filePath);
      const createdAt = stats.mtime.toISOString();

      let title = entry.name.replace(/\.txt$/i, '');
      const underscoreIndex = title.indexOf('_');
      if (underscoreIndex !== -1) {
        title = title.slice(underscoreIndex + 1);
      }

      conversations.push({
        fileName: entry.name,
        filePath,
        createdAt,
        title,
      });
    }

    conversations.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

    return { success: true, conversations };
  } catch (error) {
    console.error('Erreur lors du listing des conversations :', error);
    return { success: false, error: error.message };
  }
});

// Charger une conversation existante et la retransformer en historique exploitable par l'IA
ipcMain.handle('loadConversation', async (event, projectPath, fileName) => {
  try {
    if (!projectPath || !fileName) {
      return { success: false, error: 'Chemin de projet ou fichier de conversation manquant.' };
    }

    const filePath = path.join(projectPath, 'conversations', fileName);
    const content = await fs.readFile(filePath, 'utf-8');

    const history = [];
    const blockRegex = /\[(UTILISATEUR|AGENT IA|SYSTÈME)\]\n([\s\S]*?)(?:\n-{40,}\n\n|$)/g;
    let match;

    while ((match = blockRegex.exec(content)) !== null) {
      const rawRole = match[1];
      const text = (match[2] || '').trim();
      if (!text) continue;

      let role = 'system';
      if (rawRole === 'UTILISATEUR') role = 'user';
      else if (rawRole === 'AGENT IA') role = 'model';

      history.push({ role, text });
    }

    return { success: true, history, fileName };
  } catch (error) {
    console.error('Erreur lors du chargement de la conversation :', error);
    return { success: false, error: error.message };
  }
});

// Fonction pour générer un titre intelligent pour la conversation
function generateConversationTitle(conversationHistory) {
  // Analyser les messages pour extraire des mots-clés
  const allText = conversationHistory
    .filter(msg => msg.role === 'user')
    .map(msg => msg.text)
    .join(' ')
    .toLowerCase();

  // Mots-clés techniques courants
  const keywords = {
    'react': 'React',
    'javascript': 'JavaScript',
    'css': 'CSS',
    'html': 'HTML',
    'api': 'API',
    'bug': 'Correction Bug',
    'erreur': 'Correction Erreur',
    'optimisation': 'Optimisation',
    'amélioration': 'Amélioration',
    'création': 'Création',
    'modification': 'Modification',
    'interface': 'Interface UI',
    'design': 'Design',
    'fonction': 'Fonctionnalité',
    'agent': 'Agent IA',
    'gemini': 'Gemini API',
    'electron': 'Electron',
    'fichier': 'Gestion Fichiers',
    'projet': 'Structure Projet'
  };

  const foundKeywords = [];
  for (const [key, value] of Object.entries(keywords)) {
    if (allText.includes(key)) {
      foundKeywords.push(value);
    }
  }

  // Générer un titre basé sur les mots-clés trouvés
  if (foundKeywords.length > 0) {
    return foundKeywords.slice(0, 3).join(' - ').replace(/[^a-zA-Z0-9\s-]/g, '');
  } else {
    // Titre par défaut
    return 'Conversation Agent IA';
  }
}

// --- IPC Handler pour l'API Kimi K2.5 via Together ---
ipcMain.handle('get-kimi-completion', async (event, history, currentCode, allProjectFiles = null, options = {}) => {
  const apiKey = options.apiKey || process.env.KIMI_API_KEY || process.env.TOGETHER_API_KEY;
  const modelFromEnv = process.env.KIMI_MODEL;
  const model = options.model || modelFromEnv || 'moonshotai/Kimi-K2.5';
  const thinkingMode = !!options.thinkingMode;
  const images = Array.isArray(options.images) ? options.images : [];

  console.log('[Main] Appel Kimi: vérification de la clé API Kimi/Together...');

  if (!apiKey) {
    const errorMsg = "La clé API Together/Kimi n'est pas configurée. Définissez KIMI_API_KEY (ou TOGETHER_API_KEY) ou renseignez-la dans les Paramètres.";
    console.error('[Main][Kimi] Erreur:', errorMsg);
    dialog.showErrorBox('Erreur API Kimi', errorMsg);
    return { success: false, error: errorMsg };
  }

  if (!history || !Array.isArray(history) || history.length === 0) {
    const errorMsg = "Aucun historique de conversation n'a été fourni pour Kimi.";
    console.error('[Main][Kimi] Erreur:', errorMsg);
    return { success: false, error: errorMsg };
  }

  try {
    const validHistory = history.filter(msg =>
      msg &&
      typeof msg === 'object' &&
      msg.text !== undefined
    );

    if (validHistory.length === 0) {
      const errorMsg = "Aucun message valide trouvé dans l'historique pour Kimi.";
      console.error('[Main][Kimi] Erreur:', errorMsg);
      return { success: false, error: errorMsg };
    }

    const lastMessage = validHistory[validHistory.length - 1];

    // Construire le contexte du projet si disponible (similaire à Gemini)
    let projectContext = '';
    if (allProjectFiles && allProjectFiles.files) {
      projectContext = '\n--- CONTEXTE COMPLET DU PROJET ---\n';
      const fileEntries = Object.entries(allProjectFiles.files);

      const maxFiles = 20;
      const filesToShow = pickFilesForContext(allProjectFiles.files, maxFiles);

      for (const [filePath, fileData] of filesToShow) {
        projectContext += `\n=== FICHIER: ${filePath} ===\n`;
        if (fileData.content && !String(fileData.content).startsWith('[')) {
          const maxContentLength = 2000;
          const content = fileData.content.length > maxContentLength
            ? fileData.content.substring(0, maxContentLength) + '\n[...CONTENU TRONQUÉ...]'
            : fileData.content;
          projectContext += content;
        } else {
          projectContext += fileData.content || '[Contenu non disponible]';
        }
        projectContext += '\n=== FIN FICHIER ===\n';
      }

      if (fileEntries.length > maxFiles) {
        projectContext += `\n[...ET ${fileEntries.length - maxFiles} AUTRES FICHIERS]\n`;
      }
      projectContext += '--- FIN CONTEXTE PROJET ---\n';
    }

    const projectPath = options.projectPath || null;
    const agentPrompt = await loadAgentForCompletion(options.agent, projectPath);
    const skillPrompt = await loadSkillForCompletion(options.skill, projectPath);

    const agentContext = agentPrompt
      ? `\n--- AGENT PERSONA (${agentPrompt.name}) ---\n${agentPrompt.body}\n--- FIN AGENT ---\n`
      : '';

    const skillContext = skillPrompt
      ? `\n--- SKILL (${skillPrompt.name}) ---\n${skillPrompt.content}\n--- FIN SKILL ---\n`
      : '';

    const thinkingInstructionsKimi = thinkingMode
      ? `\nMODE THINKING ACTIVÉ : détaillez explicitement votre raisonnement étape par étape avant de proposer le code final.\n`
      : '';

    const prompt = `
      Vous êtes un assistant de développement expert et autonome.
      ${agentContext}
      ${skillContext}
      ${projectContext}

      FICHIER ACTUELLEMENT OUVERT :
      --- CODE ACTUEL ---
      ${currentCode || 'Aucun code fourni'}
      ---

      DERNIÈRE DEMANDE DE L'UTILISATEUR :
      ${String(lastMessage.text)}

      ${thinkingInstructionsKimi}

      INSTRUCTIONS :
      - Analysez le contexte du projet et la demande.
      - Proposez des modifications de code complètes.
      - Pour chaque fichier modifié, renvoyez le contenu complet au format :
        **FICHIER: nom_du_fichier.ext**
        \`\`\`langage
        // code complet
        \`\`\`
    `;

    const baseMessages = validHistory.slice(0, -1).map(msg => {
      let role = 'user';
      if (msg.role === 'model') role = 'assistant';
      else if (msg.role === 'system') role = 'system';
      else if (msg.role === 'user') role = 'user';

      return {
        role,
        content: String(msg.text)
      };
    });

    let userContent;
    if (images.length > 0) {
      const imageContents = images.map(img => ({
        type: 'image_url',
        image_url: {
          url: img.dataUrl || img.url || ''
        }
      }));

      userContent = [
        { type: 'text', text: prompt },
        ...imageContents
      ];
    } else {
      userContent = prompt;
    }

    const messages = [
      ...baseMessages,
      {
        role: 'user',
        content: userContent
      }
    ];

    const url = 'https://api.together.xyz/v1/chat/completions';
    console.log('[Main][Kimi] Envoi de la requête à Together avec clé Kimi...');

    try {
      const requestBody = {
        model: model,
        messages: messages,
        max_tokens: options.maxTokens || 16384,
        temperature: options.temperature || 0.7,
      };

      const response = await axios.post(url, requestBody, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 180000,
      });

      if (
        !response.data ||
        !response.data.choices ||
        !response.data.choices[0] ||
        !response.data.choices[0].message ||
        response.data.choices[0].message.content === undefined
      ) {
        throw new Error("Réponse de l'API Kimi mal formatée");
      }

      const aiText = response.data.choices[0].message.content;
      return { success: true, text: aiText };
    } catch (error) {
      console.error("[Main][Kimi] Erreur lors de l'appel à l'API Together:", error.response ? error.response.data : error.message);
      if (error.response) {
        console.error('[Main][Kimi] Statut:', error.response.status);
        console.error('[Main][Kimi] Données:', error.response.data);
      } else if (error.request) {
        console.error('[Main][Kimi] Requête sans réponse:', error.request);
      }

      dialog.showErrorBox('Erreur API Kimi', `Erreur lors de l'appel à l'API Kimi: ${error.message}. Voir la console pour plus de détails.`);
      return { success: false, error: error.message };
    }
  } catch (error) {
    const errorMsg = `Erreur inattendue Kimi: ${error.message || 'Erreur inconnue'}`;
    console.error('[Main][Kimi]', errorMsg, error);
    dialog.showErrorBox('Erreur Kimi', errorMsg);
    return { success: false, error: errorMsg };
  }
});

// --- IPC Handler pour lister les modèles Gemini disponibles ---
ipcMain.handle('list-gemini-models', async (event, apiKey) => {
  const key = apiKey || process.env.GEMINI_API_KEY;

  if (!key) {
    return { success: false, error: "Clé API Gemini non fournie" };
  }

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;
    const response = await axios.get(url);

    if (response.data && response.data.models) {
      // Filtrer les modèles qui supportent generateContent
      const generateModels = response.data.models.filter(model =>
        model.supportedGenerationMethods &&
        model.supportedGenerationMethods.includes('generateContent')
      );

      return {
        success: true,
        models: generateModels.map(model => ({
          name: model.name.split('/').pop(),
          fullName: model.name,
          displayName: model.displayName,
          description: model.description,
          methods: model.supportedGenerationMethods
        }))
      };
    } else {
      return { success: false, error: "Aucun modèle trouvé" };
    }
  } catch (error) {
    console.error('Erreur lors de la liste des modèles Gemini:', error);
    return {
      success: false,
      error: error.response?.data?.message || error.message
    };
  }
});

// --- IPC Handler pour l'API Gemini ---
ipcMain.handle('get-gemini-completion', async (event, history, currentCode, allProjectFiles = null, options = {}) => {
  const apiKey = options.apiKey || process.env.GEMINI_API_KEY; // Clé prioritaire depuis les Settings côté renderer
  const modelFromEnv = process.env.GEMINI_MODEL;
  const modelFromOptions = options.model;
  const model = modelFromOptions || modelFromEnv || 'gemini-2.5-flash';
  const thinkingMode = !!options.thinkingMode;
  const images = Array.isArray(options.images) ? options.images : [];

  console.log('[Main] Appel Gemini: Vérification de la clé API...');
  console.log('[Main] Options reçues:', {
    hasApiKeyOption: !!options.apiKey,
    hasEnvApiKey: !!process.env.GEMINI_API_KEY,
    model,
    thinkingMode,
    hasHistory: !!history,
    historyLength: history?.length
  });

  // Vérification de la clé API
  if (!apiKey) {
    const errorMsg = "La clé API Gemini n'est pas configurée. Veuillez définir GEMINI_API_KEY dans votre environnement.";
    console.error('[Main] Erreur:', errorMsg);
    dialog.showErrorBox('Erreur API Gemini', errorMsg);
    return { success: false, error: errorMsg };
  }

  console.log('[Main] Clé API Gemini détectée.');

  // Vérification de l'historique
  if (!history || !Array.isArray(history) || history.length === 0) {
    const errorMsg = "Aucun historique de conversation n'a été fourni. Impossible de traiter la requête.";
    console.error('[Main] Erreur:', errorMsg);
    return { success: false, error: errorMsg };
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  console.log(`[Main] Appel à l'URL Gemini: ${url}`);

  try {
    // Filtrer l'historique pour ne garder que les rôles valides pour l'API Gemini
    const validHistory = history.filter(msg =>
      msg &&
      typeof msg === 'object' &&
      (msg.role === 'user' || msg.role === 'model') &&
      msg.text !== undefined
    );

    if (validHistory.length === 0) {
      const errorMsg = "Aucun message valide avec les rôles 'user' ou 'model' trouvé dans l'historique.";
      console.error('[Main] Erreur:', errorMsg);
      return { success: false, error: errorMsg };
    }

    // Formatage de l'historique pour l'API Gemini
    // L'historique reçu de App.js est de la forme { role: 'user', text: '...', images?: [...] }
    // L'API Gemini attend { role: 'user', parts: [{ text: '...' }, { inline_data: { ... } }, ...] }
    const formattedHistory = validHistory.map(msg => {
      const parts = [{ text: String(msg.text) }];

      if (Array.isArray(msg.images)) {
        msg.images.forEach(img => {
          if (!img || !img.dataUrl) return;
          const match = String(img.dataUrl).match(/^data:(.+);base64,(.+)$/);
          if (!match) return;
          const mimeType = img.mimeType || match[1];
          const data = match[2];
          parts.push({
            inline_data: {
              mime_type: mimeType,
              data
            }
          });
        });
      }

      return {
        role: msg.role,
        parts
      };
    });

    // Vérifier que le dernier message est bien formaté
    const lastMessage = formattedHistory[formattedHistory.length - 1];
    if (!lastMessage || !lastMessage.parts || !lastMessage.parts[0] || !lastMessage.parts[0].text) {
      const errorMsg = "Le dernier message de l'historique est mal formaté.";
      console.error('[Main] Erreur:', errorMsg, 'Dernier message:', lastMessage);
      return { success: false, error: errorMsg };
    }

    // Construire le contexte du projet si disponible
    let projectContext = '';
    if (allProjectFiles && allProjectFiles.files) {
      projectContext = '\n--- CONTEXTE COMPLET DU PROJET ---\n';
      const fileEntries = Object.entries(allProjectFiles.files);

      // Limiter le nombre de fichiers pour éviter de dépasser les limites de l'API
      const maxFiles = 20;
      const filesToShow = pickFilesForContext(allProjectFiles.files, maxFiles);

      for (const [filePath, fileData] of filesToShow) {
        projectContext += `\n=== FICHIER: ${filePath} ===\n`;
        if (fileData.content && !fileData.content.startsWith('[')) {
          // Limiter la taille du contenu pour chaque fichier
          const maxContentLength = 2000;
          const content = fileData.content.length > maxContentLength
            ? fileData.content.substring(0, maxContentLength) + '\n[...CONTENU TRONQUÉ...]'
            : fileData.content;
          projectContext += content;
        } else {
          projectContext += fileData.content || '[Contenu non disponible]';
        }
        projectContext += '\n=== FIN FICHIER ===\n';
      }

      if (fileEntries.length > maxFiles) {
        projectContext += `\n[...ET ${fileEntries.length - maxFiles} AUTRES FICHIERS]\n`;
      }
      projectContext += '--- FIN CONTEXTE PROJET ---\n';
    }

    const projectPath = options.projectPath || null;
    const agentPrompt = await loadAgentForCompletion(options.agent, projectPath);
    const skillPrompt = await loadSkillForCompletion(options.skill, projectPath);

    const agentContext = agentPrompt
      ? `\n--- AGENT PERSONA (${agentPrompt.name}) ---\n${agentPrompt.body}\n--- FIN AGENT ---\n`
      : '';

    const skillContext = skillPrompt
      ? `\n--- SKILL (${skillPrompt.name}) ---\n${skillPrompt.content}\n--- FIN SKILL ---\n`
      : '';

    const thinkingInstructionsGemini = thinkingMode
      ? `
      MODE THINKING ACTIVÉ :
      - Détaillez explicitement votre raisonnement étape par étape.
      - Justifiez les choix techniques avant de montrer le code final.
      `
      : '';

    // Le prompt est construit ici dans le processus principal
    const prompt = `
      Vous êtes un assistant de développement expert et autonome, comme Cascade AI.
      ${agentContext}
      ${skillContext}
      ${projectContext}
      
      FICHIER ACTUELLEMENT OUVERT :
      --- CODE ACTUEL ---
      ${currentCode || 'Aucun code fourni'}
      ---
      
      DEMANDE DE L'UTILISATEUR :
      ${lastMessage.parts[0].text}

      ${thinkingInstructionsGemini}

      INSTRUCTIONS POUR AGIR COMME UN AGENT AUTONOME :
      
      1. **ANALYSE COMPLÈTE** :
         - Analysez le contexte complet du projet
         - Identifiez les patterns, l'architecture, et les dépendances
         - Comprenez l'intention derrière la demande
      
      2. **MODIFICATIONS PRÉCISES** :
         - Pour chaque fichier à modifier, utilisez ce format :
         
         **FICHIER: nom_du_fichier.ext**
         \`\`\`langage
         // Code complet du fichier avec vos modifications
         // Incluez TOUT le contenu, pas seulement les changements
         \`\`\`
         
      3. **ACTIONS AUTONOMES** :
         - Corrigez automatiquement les erreurs détectées
         - Ajoutez les imports/dépendances nécessaires
         - Optimisez le code selon les meilleures pratiques
         - Créez de nouveaux fichiers si nécessaire
      
      4. **COMMUNICATION CLAIRE** :
         - Expliquez brièvement ce que vous faites
         - Mentionnez les améliorations apportées
         - Signalez les points d'attention
      
      5. **FORMATS SUPPORTÉS** :
         - JavaScript/TypeScript: \`\`\`javascript ou \`\`\`typescript
         - HTML: \`\`\`html
         - CSS: \`\`\`css
         - Python: \`\`\`python
         - JSON: \`\`\`json
         - Markdown: \`\`\`markdown
      
      AGISSEZ COMME UN DÉVELOPPEUR EXPERT QUI COMPREND LE CONTEXTE ET FAIT DES MODIFICATIONS INTELLIGENTES.
    `;

    // Les contenus à envoyer à l'API incluent l'historique formaté (sauf la dernière requête qui est dans le prompt)
    const inlineImageParts = (Array.isArray(images) ? images : [])
      .map(img => {
        if (!img || !img.dataUrl) return null;
        const match = String(img.dataUrl).match(/^data:(.+);base64,(.+)$/);
        if (!match) return null;
        const mimeType = img.mimeType || match[1];
        const data = match[2];
        return {
          inline_data: {
            mime_type: mimeType,
            data
          }
        };
      })
      .filter(Boolean);

    const finalUserParts = [
      { text: prompt },
      ...inlineImageParts
    ];

    const contents = [
      ...formattedHistory.slice(0, -1),
      { role: 'user', parts: finalUserParts }
    ];
    console.log('[Main] Envoi de la requête à Gemini...');

    try {
      const response = await axios.post(url, { contents });
      console.log('[Main] Réponse de Gemini reçue.');

      // Vérifier que la réponse est bien formatée
      if (!response.data || !response.data.candidates || !response.data.candidates[0] ||
        !response.data.candidates[0].content || !response.data.candidates[0].content.parts ||
        !response.data.candidates[0].content.parts[0] || response.data.candidates[0].content.parts[0].text === undefined) {
        throw new Error('Réponse de l\'API Gemini mal formatée');
      }

      const aiText = response.data.candidates[0].content.parts[0].text;
      return { success: true, text: aiText };
    } catch (error) {
      console.error("[Main] Erreur lors de l'appel à l'API Gemini:", error.response ? error.response.data : error.message);
      // Log plus détaillé de l'erreur Axios si disponible
      if (error.response) {
        console.error("[Main] Statut de l'erreur Axios:", error.response.status);
        console.error("[Main] Données de l'erreur Axios:", error.response.data);
        console.error("[Main] En-têtes de l'erreur Axios:", error.response.headers);
      } else if (error.request) {
        // La requête a été faite mais aucune réponse n'a été reçue
        console.error("[Main] Requête Axios sans réponse:", error.request);
      } else {
        // Quelque chose s'est passé lors de la configuration de la requête
        console.error("[Main] Erreur de configuration Axios:", error.message);
      }

      dialog.showErrorBox('Erreur API Gemini', `Erreur lors de l'appel à l'API Gemini: ${error.message}. Voir la console pour plus de détails.`);
      return { success: false, error: error.message };
    }
  } catch (error) {
    // Gestion des erreurs globales de la fonction
    const errorMsg = `Erreur inattendue: ${error.message || 'Erreur inconnue'}`;
    console.error('[Main]', errorMsg, error);
    dialog.showErrorBox('Erreur', errorMsg);
    return { success: false, error: errorMsg };
  }
});

// ==================== WORKFLOW SYSTEM ====================

// Get the global workflows directory
const getGlobalWorkflowsDir = () => {
  return path.join(app.getPath('userData'), 'workflows');
};

// Get the workspace workflows directory
const getWorkspaceWorkflowsDir = (projectPath) => {
  return path.join(projectPath, '.agent', 'workflows');
};

// Parse workflow file content
const parseWorkflowFile = (content) => {
  const lines = content.split('\n');
  let description = '';
  let body = content;

  // Check for YAML frontmatter
  if (lines[0] && lines[0].trim() === '---') {
    let endIndex = -1;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === '---') {
        endIndex = i;
        break;
      }
      // Parse description from frontmatter
      const match = lines[i].match(/^description:\s*(.+)$/i);
      if (match) {
        description = match[1].trim();
      }
    }
    if (endIndex > 0) {
      body = lines.slice(endIndex + 1).join('\n').trim();
    }
  }

  return { description, body };
};

// List all workflows (global + workspace)
ipcMain.handle('list-workflows', async (event, projectPath) => {
  try {
    const workflows = [];

    // List global workflows
    const globalDir = getGlobalWorkflowsDir();
    try {
      await fs.mkdir(globalDir, { recursive: true });
      const globalFiles = await fs.readdir(globalDir);
      for (const file of globalFiles) {
        if (file.endsWith('.md')) {
          const name = file.replace('.md', '');
          const content = await fs.readFile(path.join(globalDir, file), 'utf-8');
          const { description } = parseWorkflowFile(content);
          workflows.push({
            name,
            scope: 'global',
            description,
            path: path.join(globalDir, file)
          });
        }
      }
    } catch (e) {
      // Global dir doesn't exist yet, that's ok
    }

    // List workspace workflows if projectPath provided
    if (projectPath) {
      const workspaceDir = getWorkspaceWorkflowsDir(projectPath);
      try {
        const workspaceFiles = await fs.readdir(workspaceDir);
        for (const file of workspaceFiles) {
          if (file.endsWith('.md')) {
            const name = file.replace('.md', '');
            const content = await fs.readFile(path.join(workspaceDir, file), 'utf-8');
            const { description } = parseWorkflowFile(content);
            workflows.push({
              name,
              scope: 'workspace',
              description,
              path: path.join(workspaceDir, file)
            });
          }
        }
      } catch (e) {
        // Workspace dir doesn't exist yet, that's ok
      }
    }

    return { success: true, workflows };
  } catch (error) {
    console.error('[Workflows] Error listing workflows:', error);
    return { success: false, error: error.message };
  }
});

// Get a specific workflow
ipcMain.handle('get-workflow', async (event, name, scope, projectPath) => {
  try {
    let filePath;
    if (scope === 'global') {
      filePath = path.join(getGlobalWorkflowsDir(), `${name}.md`);
    } else if (scope === 'workspace' && projectPath) {
      filePath = path.join(getWorkspaceWorkflowsDir(projectPath), `${name}.md`);
    } else {
      return { success: false, error: 'Invalid scope or missing project path' };
    }

    const content = await fs.readFile(filePath, 'utf-8');
    const { description, body } = parseWorkflowFile(content);

    return {
      success: true,
      workflow: { name, scope, description, body, content, path: filePath }
    };
  } catch (error) {
    console.error('[Workflows] Error getting workflow:', error);
    return { success: false, error: error.message };
  }
});

// Save a workflow
ipcMain.handle('save-workflow', async (event, name, content, scope, projectPath) => {
  try {
    let dir;
    if (scope === 'global') {
      dir = getGlobalWorkflowsDir();
    } else if (scope === 'workspace' && projectPath) {
      dir = getWorkspaceWorkflowsDir(projectPath);
    } else {
      return { success: false, error: 'Invalid scope or missing project path' };
    }

    // Sanitize filename
    const safeName = name.replace(/[<>:"/\\|?*]/g, '_').trim();
    if (!safeName) {
      return { success: false, error: 'Invalid workflow name' };
    }

    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `${safeName}.md`);
    await fs.writeFile(filePath, content, 'utf-8');

    console.log(`[Workflows] Saved workflow: ${filePath}`);
    return { success: true, path: filePath, name: safeName };
  } catch (error) {
    console.error('[Workflows] Error saving workflow:', error);
    return { success: false, error: error.message };
  }
});

// Delete a workflow
ipcMain.handle('delete-workflow', async (event, name, scope, projectPath) => {
  try {
    let filePath;
    if (scope === 'global') {
      filePath = path.join(getGlobalWorkflowsDir(), `${name}.md`);
    } else if (scope === 'workspace' && projectPath) {
      filePath = path.join(getWorkspaceWorkflowsDir(projectPath), `${name}.md`);
    } else {
      return { success: false, error: 'Invalid scope or missing project path' };
    }

    await fs.unlink(filePath);
    console.log(`[Workflows] Deleted workflow: ${filePath}`);
    return { success: true };
  } catch (error) {
    console.error('[Workflows] Error deleting workflow:', error);
    return { success: false, error: error.message };
  }
});

// ==================== AGENTS & SKILLS LIBRARY ====================

const getGlobalAgentsDir = () => path.join(app.getPath('userData'), 'agents');
const getWorkspaceAgentsDir = (projectPath) => path.join(projectPath, '.agent', 'agents');

const getGlobalSkillsDir = () => path.join(app.getPath('userData'), 'skills');
const getWorkspaceSkillsDir = (projectPath) => path.join(projectPath, '.agent', 'skills');

const parseSimpleFrontMatter = (content) => {
  const raw = String(content || '');
  const lines = raw.split('\n');
  if (!lines[0] || lines[0].trim() !== '---') {
    return { meta: {}, body: raw };
  }

  const meta = {};
  let endIndex = -1;
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (String(line || '').trim() === '---') {
      endIndex = i;
      break;
    }

    const match = String(line || '').match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;

    const key = match[1];
    let value = match[2].trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    meta[key] = value;
  }

  const body = endIndex >= 0 ? lines.slice(endIndex + 1).join('\n').trim() : raw;
  return { meta, body };
};

const safeFileBase = (value) => {
  return String(value || '')
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, '-')
    .trim();
};

const truncateTextForPrompt = (text, maxChars, suffix = '\n[...TRUNCATED...]') => {
  const raw = String(text || '');
  const limit = Math.max(0, Number(maxChars) || 0);
  if (!limit || raw.length <= limit) return raw;
  return raw.slice(0, limit) + suffix;
};

const loadAgentForCompletion = async (agentSpec, projectPath) => {
  try {
    if (!agentSpec) return null;

    const scope = agentSpec.scope === 'workspace' ? 'workspace' : 'global';
    const rawName = typeof agentSpec === 'string' ? agentSpec : agentSpec.name;
    const safeName = safeFileBase(rawName);
    if (!safeName) return null;

    let filePath;
    if (scope === 'global') {
      filePath = path.join(getGlobalAgentsDir(), `${safeName}.md`);
    } else {
      if (!projectPath) return null;
      filePath = path.join(getWorkspaceAgentsDir(projectPath), `${safeName}.md`);
    }

    if (!fsSync.existsSync(filePath)) return null;
    const content = await fs.readFile(filePath, 'utf-8');
    const { meta, body } = parseSimpleFrontMatter(content);

    return {
      name: meta.name ? String(meta.name).trim() : safeName,
      description: meta.description ? String(meta.description).trim() : '',
      scope,
      body: truncateTextForPrompt(body, 12000, '\n[...TRUNCATED AGENT...]'),
      path: filePath
    };
  } catch {
    return null;
  }
};

const loadSkillForCompletion = async (skillSpec, projectPath) => {
  try {
    if (!skillSpec) return null;

    const scope = skillSpec.scope === 'workspace' ? 'workspace' : 'global';
    const rawName = typeof skillSpec === 'string' ? skillSpec : skillSpec.name;
    const safeName = safeFileBase(rawName);
    if (!safeName) return null;

    let dir;
    if (scope === 'global') dir = getGlobalSkillsDir();
    else {
      if (!projectPath) return null;
      dir = getWorkspaceSkillsDir(projectPath);
    }

    const skillDir = path.join(dir, safeName);
    const skillFile = path.join(skillDir, 'SKILL.md');
    if (!fsSync.existsSync(skillFile)) return null;

    const content = await fs.readFile(skillFile, 'utf-8');
    return {
      name: safeName,
      scope,
      content: truncateTextForPrompt(content, 16000, '\n[...TRUNCATED SKILL...]'),
      path: skillDir
    };
  } catch {
    return null;
  }
};

ipcMain.handle('list-agents', async (event, projectPath) => {
  try {
    const agents = [];

    const readAgentsFromDir = async (dir, scope) => {
      try {
        await fs.mkdir(dir, { recursive: true });
        const entries = await fs.readdir(dir);
        for (const file of entries) {
          if (!file.toLowerCase().endsWith('.md')) continue;
          const filePath = path.join(dir, file);
          let content = '';
          try {
            content = await fs.readFile(filePath, 'utf-8');
          } catch {
            continue;
          }

          const { meta } = parseSimpleFrontMatter(content);
          const name = meta.name ? String(meta.name).trim() : file.replace(/\.md$/i, '');
          const description = meta.description ? String(meta.description).trim() : '';

          agents.push({
            name,
            scope,
            description: description ? description.slice(0, 220) : '',
            path: filePath
          });
        }
      } catch {
        // ignore
      }
    };

    await readAgentsFromDir(getGlobalAgentsDir(), 'global');
    if (projectPath) {
      await readAgentsFromDir(getWorkspaceAgentsDir(projectPath), 'workspace');
    }

    // Workspace first
    agents.sort((a, b) => {
      if (a.scope !== b.scope) return a.scope === 'workspace' ? -1 : 1;
      return String(a.name).localeCompare(String(b.name));
    });

    return { success: true, agents };
  } catch (error) {
    console.error('[Agents] Error listing agents:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-agent', async (event, name, scope, projectPath) => {
  try {
    const safeName = safeFileBase(name);
    if (!safeName) return { success: false, error: 'Nom agent invalide' };

    let filePath;
    if (scope === 'global') {
      filePath = path.join(getGlobalAgentsDir(), `${safeName}.md`);
    } else if (scope === 'workspace' && projectPath) {
      filePath = path.join(getWorkspaceAgentsDir(projectPath), `${safeName}.md`);
    } else {
      return { success: false, error: 'Invalid scope or missing project path' };
    }

    const content = await fs.readFile(filePath, 'utf-8');
    const { meta, body } = parseSimpleFrontMatter(content);

    return {
      success: true,
      agent: {
        name: meta.name ? String(meta.name).trim() : safeName,
        scope,
        description: meta.description ? String(meta.description).trim() : '',
        body,
        content,
        path: filePath
      }
    };
  } catch (error) {
    console.error('[Agents] Error getting agent:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('save-agent', async (event, name, content, scope, projectPath) => {
  try {
    let dir;
    if (scope === 'global') {
      dir = getGlobalAgentsDir();
    } else if (scope === 'workspace' && projectPath) {
      dir = getWorkspaceAgentsDir(projectPath);
    } else {
      return { success: false, error: 'Invalid scope or missing project path' };
    }

    const safeName = safeFileBase(name);
    if (!safeName) return { success: false, error: 'Nom agent invalide' };

    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `${safeName}.md`);
    await fs.writeFile(filePath, String(content || ''), 'utf-8');

    return { success: true, name: safeName, path: filePath };
  } catch (error) {
    console.error('[Agents] Error saving agent:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('delete-agent', async (event, name, scope, projectPath) => {
  try {
    const safeName = safeFileBase(name);
    if (!safeName) return { success: false, error: 'Nom agent invalide' };

    let filePath;
    if (scope === 'global') {
      filePath = path.join(getGlobalAgentsDir(), `${safeName}.md`);
    } else if (scope === 'workspace' && projectPath) {
      filePath = path.join(getWorkspaceAgentsDir(projectPath), `${safeName}.md`);
    } else {
      return { success: false, error: 'Invalid scope or missing project path' };
    }

    await fs.unlink(filePath);
    return { success: true };
  } catch (error) {
    console.error('[Agents] Error deleting agent:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('list-skills', async (event, projectPath) => {
  try {
    const skills = [];

    const readSkillsFromDir = async (dir, scope) => {
      try {
        await fs.mkdir(dir, { recursive: true });
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const name = entry.name;
          const skillDir = path.join(dir, name);
          const skillFile = path.join(skillDir, 'SKILL.md');
          const exists = fsSync.existsSync(skillFile);
          skills.push({
            name,
            scope,
            hasSkillMd: exists,
            path: skillDir
          });
        }
      } catch {
        // ignore
      }
    };

    await readSkillsFromDir(getGlobalSkillsDir(), 'global');
    if (projectPath) {
      await readSkillsFromDir(getWorkspaceSkillsDir(projectPath), 'workspace');
    }

    skills.sort((a, b) => {
      if (a.scope !== b.scope) return a.scope === 'workspace' ? -1 : 1;
      return String(a.name).localeCompare(String(b.name));
    });

    return { success: true, skills };
  } catch (error) {
    console.error('[Skills] Error listing skills:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-skill', async (event, name, scope, projectPath) => {
  try {
    const safeName = safeFileBase(name);
    if (!safeName) return { success: false, error: 'Nom skill invalide' };

    let dir;
    if (scope === 'global') dir = getGlobalSkillsDir();
    else if (scope === 'workspace' && projectPath) dir = getWorkspaceSkillsDir(projectPath);
    else return { success: false, error: 'Invalid scope or missing project path' };

    const skillDir = path.join(dir, safeName);
    const skillFile = path.join(skillDir, 'SKILL.md');
    const content = await fs.readFile(skillFile, 'utf-8');

    return {
      success: true,
      skill: {
        name: safeName,
        scope,
        content,
        path: skillDir
      }
    };
  } catch (error) {
    console.error('[Skills] Error getting skill:', error);
    return { success: false, error: error.message };
  }
});

const parseGitHubTreeUrl = (inputUrl) => {
  const rawUrl = String(inputUrl || '').trim();
  if (!rawUrl) return null;

  // Strip query/hash + trailing slashes.
  const url = rawUrl.replace(/[?#].*$/, '').replace(/\/+$/, '');

  // tree/<ref>/<path?> or tree/<ref>
  let match = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)(?:\/(.+))?$/i);
  if (match) {
    const owner = match[1];
    const repo = match[2];
    const ref = match[3];
    let repoPath = match[4] ? String(match[4]) : '';

    repoPath = repoPath.replace(/^\/+/, '').replace(/\/+$/, '');
    if (repoPath.toLowerCase().endsWith('/skill.md')) {
      repoPath = repoPath.slice(0, -('/SKILL.md'.length));
    }

    const repoUrl = `https://github.com/${owner}/${repo}.git`;
    return { repoUrl, ref, repoPath, owner, repo, kind: 'tree' };
  }

  // blob/<ref>/<path>
  match = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/i);
  if (match) {
    const owner = match[1];
    const repo = match[2];
    const ref = match[3];
    let repoPath = String(match[4] || '');

    repoPath = repoPath.replace(/^\/+/, '').replace(/\/+$/, '');
    if (repoPath.toLowerCase().endsWith('/skill.md')) {
      repoPath = repoPath.slice(0, -('/SKILL.md'.length));
    } else {
      // Fall back to the parent folder of the blob path.
      repoPath = repoPath.replace(/\/[^/]+$/, '');
    }

    const repoUrl = `https://github.com/${owner}/${repo}.git`;
    return { repoUrl, ref, repoPath, owner, repo, kind: 'blob' };
  }

  // Repo root
  match = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)$/i);
  if (match) {
    const owner = match[1];
    const repo = match[2].replace(/\.git$/i, '');
    const repoUrl = `https://github.com/${owner}/${repo}.git`;
    return { repoUrl, ref: null, repoPath: '', owner, repo, kind: 'repo' };
  }

  return null;
};

const runGit = (args, cwd) => {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, windowsHide: true });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => { stdout += String(data); });
    child.stderr.on('data', (data) => { stderr += String(data); });

    child.on('error', (error) => {
      reject(new Error(`Git error: ${error.message}`));
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`Git failed (${code}): ${stderr || stdout}`));
      }
    });
  });
};

const ensureEmptyDirSync = (dirPath) => {
  try {
    fsSync.rmSync(dirPath, { recursive: true, force: true });
  } catch {
    // ignore
  }
  fsSync.mkdirSync(dirPath, { recursive: true });
};

const copyDirSync = (fromDir, toDir, overwrite = false) => {
  if (!fsSync.existsSync(fromDir)) {
    throw new Error(`Source introuvable: ${fromDir}`);
  }
  if (fsSync.existsSync(toDir)) {
    if (!overwrite) {
      throw new Error(`Destination existe déjà: ${toDir}`);
    }
    fsSync.rmSync(toDir, { recursive: true, force: true });
  }
  fsSync.mkdirSync(path.dirname(toDir), { recursive: true });
  fsSync.cpSync(fromDir, toDir, {
    recursive: true,
    filter: (src) => path.basename(src) !== '.git'
  });
};

const collectSkillMdFilesRecursive = async (dirPath) => {
  const results = [];
  let items;
  try {
    items = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const item of items) {
    const fullPath = path.join(dirPath, item.name);

    if (item.isDirectory()) {
      const lower = String(item.name || '').toLowerCase();
      if (
        lower === '.git' ||
        lower === 'node_modules' ||
        lower === 'dist' ||
        lower === 'build' ||
        lower === 'out' ||
        lower === '.next' ||
        lower === 'coverage' ||
        lower === '.turbo' ||
        lower === '.cache' ||
        lower === '.parcel-cache'
      ) {
        continue;
      }

      const nested = await collectSkillMdFilesRecursive(fullPath);
      results.push(...nested);
      continue;
    }

    if (!item.isFile()) continue;
    if (String(item.name || '').toLowerCase() === 'skill.md') {
      results.push(fullPath);
    }
  }

  return results;
};

const pickBestSkillRepoPath = (repoRoot, skillMdFiles) => {
  const uniqueFolders = new Set();
  for (const filePath of Array.isArray(skillMdFiles) ? skillMdFiles : []) {
    uniqueFolders.add(path.dirname(filePath));
  }

  const candidates = Array.from(uniqueFolders).map((folderPath) => {
    const relative = path.relative(repoRoot, folderPath);
    const posix = relative.split(path.sep).join('/');
    const depth = posix ? posix.split('/').length : 0;
    return { posix, depth };
  });

  candidates.sort((a, b) => a.depth - b.depth || a.posix.localeCompare(b.posix));
  return candidates[0]?.posix ?? null;
};

ipcMain.handle('install-skill-from-url', async (event, url, scope, projectPath, options = {}) => {
  try {
    const parsed = parseGitHubTreeUrl(url);
    if (!parsed) {
      return { success: false, error: 'URL GitHub non supportee' };
    }

    const safeOptions = options && typeof options === 'object' ? options : {};
    const overwrite = !!safeOptions.overwrite;

    let destBaseDir;
    if (scope === 'global') destBaseDir = getGlobalSkillsDir();
    else if (scope === 'workspace' && projectPath) destBaseDir = getWorkspaceSkillsDir(projectPath);
    else return { success: false, error: 'Invalid scope or missing project path' };

    await fs.mkdir(destBaseDir, { recursive: true });

    const tempRoot = path.join(app.getPath('userData'), 'tmp');
    const tempDir = path.join(tempRoot, `skill-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    ensureEmptyDirSync(tempDir);

    try {
      let repoPathToInstall = String(parsed.repoPath || '');
      const wantsSparse = !!parsed.ref && !!repoPathToInstall;

      const cloneRepo = async ({ sparse }) => {
        const args = ['clone', '--depth', '1'];
        if (sparse) args.push('--filter=blob:none', '--sparse');
        if (parsed.ref) args.push('--branch', parsed.ref);
        args.push(parsed.repoUrl, tempDir);
        await runGit(args, tempRoot);

        if (sparse) {
          await runGit(['-C', tempDir, 'sparse-checkout', 'set', repoPathToInstall], tempRoot);
        }
      };

      try {
        await cloneRepo({ sparse: wantsSparse });
      } catch (cloneError) {
        if (!wantsSparse) throw cloneError;
        ensureEmptyDirSync(tempDir);
        await cloneRepo({ sparse: false });
      }

      if (!repoPathToInstall) {
        const skillMdFiles = await collectSkillMdFilesRecursive(tempDir);
        const bestRepoPath = pickBestSkillRepoPath(tempDir, skillMdFiles);
        if (bestRepoPath === null) {
          return { success: false, error: 'Aucun SKILL.md trouve dans ce repo (utilisez un lien /tree/... vers une skill)' };
        }
        repoPathToInstall = bestRepoPath || '';
      }

      const derivedNameBase =
        safeOptions.name ||
        (repoPathToInstall ? path.basename(repoPathToInstall) : `${parsed.owner}-${parsed.repo}`);
      const derivedName = safeFileBase(derivedNameBase);
      if (!derivedName) return { success: false, error: 'Nom skill invalide' };

      const destDir = path.join(destBaseDir, derivedName);
      const fromDir = repoPathToInstall
        ? path.join(tempDir, ...String(repoPathToInstall).split('/'))
        : tempDir;
      copyDirSync(fromDir, destDir, overwrite);

      const skillMd = path.join(destDir, 'SKILL.md');
      const hasSkillMd = fsSync.existsSync(skillMd);

      return {
        success: true,
        name: derivedName,
        scope,
        path: destDir,
        hasSkillMd
      };
    } finally {
      try {
        fsSync.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  } catch (error) {
    console.error('[Skills] Error installing skill:', error);
    return { success: false, error: error.message };
  }
});

const voltCatalogCache = new Map();

const fetchRawText = async (rawUrl) => {
  const response = await axios.get(rawUrl, {
    timeout: 120000,
    maxBodyLength: 50 * 1024 * 1024,
    maxContentLength: 50 * 1024 * 1024
  });
  return String(response.data || '');
};

const parseAwesomeListCatalog = (readmeText) => {
  const lines = String(readmeText || '').split('\n');
  const entries = [];

  for (const line of lines) {
    const trimmed = String(line || '').trim();
    if (!trimmed.startsWith('-') && !trimmed.startsWith('*')) continue;

    // Matches:
    // - **[label](url)** - description
    // - [label](url) - description
    const match = trimmed.match(/^[-*]\s+(?:\*\*)?\[([^\]]+)\]\((https?:\/\/[^)]+)\)(?:\*\*)?\s+-\s+(.+)$/);
    if (!match) continue;

    const label = match[1].trim();
    const url = match[2].trim();
    const description = match[3].trim();

    if (!label || !url) continue;

    entries.push({
      label,
      url,
      description: description.slice(0, 260)
    });
  }

  return entries;
};

ipcMain.handle('get-voltagent-catalog', async (event, catalogId) => {
  try {
    const id = String(catalogId || '').trim();
    if (!id) return { success: false, error: 'catalogId manquant' };

    const cached = voltCatalogCache.get(id);
    const now = Date.now();
    if (cached && cached.fetchedAt && now - cached.fetchedAt < 15 * 60 * 1000) {
      return { success: true, catalogId: id, entries: cached.entries, cached: true };
    }

    const urls = {
      'agent-skills': 'https://raw.githubusercontent.com/VoltAgent/awesome-agent-skills/main/README.md',
      'openclaw-skills': 'https://raw.githubusercontent.com/VoltAgent/awesome-openclaw-skills/main/README.md',
    };

    const rawUrl = urls[id];
    if (!rawUrl) return { success: false, error: `catalogId inconnu: ${id}` };

    const readme = await fetchRawText(rawUrl);
    const entries = parseAwesomeListCatalog(readme);

    voltCatalogCache.set(id, { fetchedAt: now, entries });
    return { success: true, catalogId: id, entries, cached: false };
  } catch (error) {
    console.error('[VoltCatalog] Error fetching catalog:', error);
    return { success: false, error: error.message };
  }
});

const collectMarkdownFilesRecursive = async (dirPath) => {
  const results = [];
  let items;
  try {
    items = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const item of items) {
    const fullPath = path.join(dirPath, item.name);
    if (item.isDirectory()) {
      const nested = await collectMarkdownFilesRecursive(fullPath);
      results.push(...nested);
      continue;
    }

    if (!item.isFile()) continue;
    if (!item.name.toLowerCase().endsWith('.md')) continue;
    if (item.name.toLowerCase() === 'readme.md') continue;
    results.push(fullPath);
  }

  return results;
};

ipcMain.handle('sync-voltagent-subagents', async (event, options = {}) => {
  try {
    const safeOptions = options && typeof options === 'object' ? options : {};
    const overwrite = !!safeOptions.overwrite;

    const cacheRoot = path.join(app.getPath('userData'), 'voltagent-cache');
    const repoDir = path.join(cacheRoot, 'awesome-claude-code-subagents');
    await fs.mkdir(cacheRoot, { recursive: true });

    // Fresh clone (simple & reliable)
    try {
      fsSync.rmSync(repoDir, { recursive: true, force: true });
    } catch {
      // ignore
    }

    await runGit(['clone', '--depth', '1', 'https://github.com/VoltAgent/awesome-claude-code-subagents', repoDir], cacheRoot);

    const agentsDir = getGlobalAgentsDir();
    await fs.mkdir(agentsDir, { recursive: true });

    const sourceAgents = await collectMarkdownFilesRecursive(path.join(repoDir, 'categories'));

    let imported = 0;
    let skipped = 0;
    let errors = 0;

    for (const filePath of sourceAgents) {
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const { meta } = parseSimpleFrontMatter(content);
        const rawName = meta.name ? String(meta.name).trim() : path.basename(filePath, '.md');
        const name = safeFileBase(rawName);
        if (!name) {
          skipped += 1;
          continue;
        }

        const dest = path.join(agentsDir, `${name}.md`);
        if (!overwrite && fsSync.existsSync(dest)) {
          skipped += 1;
          continue;
        }

        await fs.writeFile(dest, content, 'utf-8');
        imported += 1;
      } catch (e) {
        errors += 1;
      }
    }

    return { success: true, imported, skipped, errors };
  } catch (error) {
    console.error('[VoltAgent] Error syncing subagents:', error);
    return { success: false, error: error.message };
  }
});
