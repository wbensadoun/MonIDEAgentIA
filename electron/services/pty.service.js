'use strict';

const os = require('os');
const { ensureTrustedProjectPath } = require('../core/security');
const { ensureTerminalPermission } = require('./settings.service');

// node-pty (Microsoft, meme paquet que VS Code) est base sur node-addon-api
// (N-API) : ABI-stable, aucune recompilation necessaire par version d'Electron.
// Verifie en chargeant le module directement dans le vrai runtime Electron de
// ce projet (process.versions.electron), pas seulement sous Node.
//
// Le require reste neanmoins protege : si le binaire natif venait a manquer
// (install partiel, plateforme non couverte), l'app ne doit pas planter au
// demarrage — seule la fonctionnalite terminal doit se degrader proprement.
let pty = null;
let ptyLoadError = null;
try {
  // eslint-disable-next-line global-require
  pty = require('node-pty');
} catch (error) {
  ptyLoadError = error;
}

// Tampon glissant par session, pour donner a l'agent IA un acces en LECTURE a
// ce qui s'est passe dans le terminal partage — sans jamais le pousser dans le
// prompt systeme par defaut (cf. l'audit sur le cout en tokens du contexte
// Ollama). Le contenu n'est exploite que si quelque chose le demande
// explicitement via readBuffer().
const MAX_BUFFER_CHARS = 20000;

const createPtyService = ({ getMainWindow } = {}) => {
  const sessions = new Map(); // id -> { term, buffer, projectPath }

  const sendToRenderer = (channel, payload) => {
    const win = typeof getMainWindow === 'function' ? getMainWindow() : null;
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  };

  const appendToBuffer = (session, chunk) => {
    session.buffer += chunk;
    if (session.buffer.length > MAX_BUFFER_CHARS) {
      session.buffer = session.buffer.slice(session.buffer.length - MAX_BUFFER_CHARS);
    }
  };

  const create = async ({ id, projectPath, cols, rows } = {}) => {
    if (!pty) {
      return {
        success: false,
        error: `Terminal interactif indisponible : module natif node-pty non charge (${ptyLoadError?.message || 'raison inconnue'}). Reessayez apres "npm install".`
      };
    }
    if (!id) return { success: false, error: 'Identifiant de session manquant.' };

    await ensureTerminalPermission();
    const trustedCwd = projectPath
      ? await ensureTrustedProjectPath(projectPath)
      : os.homedir();

    // Une session par id : relancer avec le meme id ferme proprement l'ancienne
    // plutot que de laisser un shell orphelin tourner en arriere-plan.
    if (sessions.has(id)) {
      try { sessions.get(id).term.kill(); } catch { /* deja mort */ }
      sessions.delete(id);
    }

    // PowerShell est le shell par defaut de VS Code sur Windows depuis
    // plusieurs annees (pas cmd.exe) ; COMSPEC pointe presque toujours vers
    // cmd.exe et existe sur toute machine Windows, donc le prendre en premier
    // choix aurait TOUJOURS elimine PowerShell silencieusement. On tente
    // PowerShell d'abord, COMSPEC seulement s'il echoue vraiment a spawn.
    const shell = process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL || 'bash');
    const fallbackShell = process.platform === 'win32' ? (process.env.COMSPEC || 'cmd.exe') : null;

    const spawnOpts = {
      name: 'xterm-color',
      cols: Number.isInteger(cols) && cols > 0 ? cols : 80,
      rows: Number.isInteger(rows) && rows > 0 ? rows : 24,
      cwd: trustedCwd,
      env: process.env
    };

    let term;
    let shellUsed = shell;
    try {
      term = pty.spawn(shell, [], spawnOpts);
    } catch (error) {
      if (!fallbackShell || fallbackShell === shell) {
        return { success: false, error: `Impossible de demarrer le shell: ${error.message}` };
      }
      try {
        term = pty.spawn(fallbackShell, [], spawnOpts);
        shellUsed = fallbackShell;
      } catch (fallbackError) {
        return {
          success: false,
          error: `Impossible de demarrer le shell (${shell}: ${error.message} ; repli ${fallbackShell}: ${fallbackError.message})`
        };
      }
    }

    const session = { term, buffer: '', projectPath: trustedCwd };
    sessions.set(id, session);

    term.onData((chunk) => {
      appendToBuffer(session, chunk);
      sendToRenderer('pty-data', { id, chunk });
    });

    term.onExit(({ exitCode, signal }) => {
      sessions.delete(id);
      sendToRenderer('pty-exit', { id, exitCode, signal });
    });

    return { success: true, pid: term.pid, shell: shellUsed };
  };

  const write = (id, data) => {
    const session = sessions.get(id);
    if (!session) return { success: false, error: 'Session introuvable.' };
    // L'utilisateur tape directement dans un vrai shell : contrairement au
    // canal <run_command> de l'IA, il n'y a NI allowlist NI blocage
    // d'operateurs ici. C'est le comportement attendu d'un terminal (comme
    // celui de VS Code) — la protection reste sur ensureTerminalPermission()
    // a l'ouverture de session, pas sur chaque frappe.
    session.term.write(String(data ?? ''));
    return { success: true };
  };

  const resize = (id, cols, rows) => {
    const session = sessions.get(id);
    if (!session) return { success: false, error: 'Session introuvable.' };
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols <= 0 || rows <= 0) {
      return { success: false, error: 'Dimensions invalides.' };
    }
    try {
      session.term.resize(cols, rows);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  };

  const kill = (id) => {
    const session = sessions.get(id);
    if (!session) return { success: true }; // deja absente : idempotent
    try { session.term.kill(); } catch { /* deja mort */ }
    sessions.delete(id);
    return { success: true };
  };

  const readBuffer = (id) => {
    const session = sessions.get(id);
    if (!session) return { success: false, error: 'Session introuvable.' };
    return { success: true, buffer: session.buffer };
  };

  const readLatestBuffer = () => {
    let lastId = null;
    let lastSession = null;
    for (const [id, session] of sessions) { lastId = id; lastSession = session; }
    if (!lastSession) {
      return { success: false, error: 'Aucune session de terminal interactif ouverte.' };
    }
    return { success: true, id: lastId, buffer: lastSession.buffer };
  };

  const killAll = () => {
    for (const session of sessions.values()) {
      try { session.term.kill(); } catch { /* deja mort */ }
    }
    sessions.clear();
  };

  const isAvailable = () => !!pty;

  return { create, write, resize, kill, readBuffer, readLatestBuffer, killAll, isAvailable };
};

module.exports = { createPtyService };
