'use strict';

const net = require('net');
const { spawn } = require('child_process');
const { ensureTrustedProjectPath } = require('../core/security');
const { ensureTerminalPermission, buildSafeSpawnRequest } = require('./settings.service');
const {
  requestTerminalApproval,
  validateCommandArgsWithinWorkspace,
} = require('./ai.service');

const DEFAULT_PORT_ENV_KEYS = ['PORT', 'VITE_PORT', 'NUXT_PORT', 'WEB_PORT'];

const toPortNumber = (value, fallback = 3004) => {
  const raw = Number.parseInt(String(value ?? ''), 10);
  if (Number.isInteger(raw) && raw >= 1 && raw <= 65535) return raw;
  return fallback;
};

const isPortAvailable = (port) =>
  new Promise((resolve) => {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      resolve(false);
      return;
    }

    const server = net.createServer();
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    server.once('error', () => finish(false));
    server.once('listening', () => {
      server.close(() => finish(true));
    });

    try {
      server.listen(port, '127.0.0.1');
    } catch {
      finish(false);
    }
  });

const findAvailablePort = async (preferredPort, maxAttempts = 200, reservedPorts = new Set()) => {
  const startPort = toPortNumber(preferredPort, 3004);
  for (let offset = 0; offset < maxAttempts; offset += 1) {
    const candidate = startPort + offset;
    if (candidate > 65535) break;
    if (reservedPorts.has(candidate)) continue;
    // eslint-disable-next-line no-await-in-loop
    const available = await isPortAvailable(candidate);
    if (available) return candidate;
  }
  return null;
};

const createProcessService = ({ getMainWindow } = {}) => {
  const processes = {};
  const processMeta = {};

  const getReservedPorts = () => {
    const reserved = new Set();
    Object.values(processMeta).forEach((meta) => {
      if (Number.isInteger(meta?.allocatedPort)) {
        reserved.add(meta.allocatedPort);
      }
    });
    return reserved;
  };

  const sendToRenderer = (channel, payload) => {
    const win = typeof getMainWindow === 'function' ? getMainWindow() : null;
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  };

  const startProcess = async (payload) => {
    try {
      await ensureTerminalPermission();

      const {
        id,
        command,
        args = [],
        cwd,
        env: customEnv,
        autoSelectPort = false,
        preferredPort,
        portEnvVars,
        requireApproval = false
      } = payload || {};

      if (!id || !command) {
        return { success: false, error: 'Identifiant ou commande manquant' };
      }

      if (processes[id]) {
        try { processes[id].kill(); } catch { /* ignore */ }
        delete processes[id];
        delete processMeta[id];
      }

      const safeCwd = await ensureTrustedProjectPath(cwd);
      const spawnRequest = buildSafeSpawnRequest(command, args);
      validateCommandArgsWithinWorkspace(spawnRequest, safeCwd);

      if (requireApproval) {
        const approved = await requestTerminalApproval(spawnRequest.normalizedCommandLine);
        if (!approved) {
          return { success: false, error: 'Commande refusee par l utilisateur' };
        }
      }

      const options = {
        cwd: safeCwd,
        shell: false,
        windowsHide: true,
        env: { ...process.env }
      };

      if (customEnv && typeof customEnv === 'object' && !Array.isArray(customEnv)) {
        Object.entries(customEnv).forEach(([key, value]) => {
          if (typeof key !== 'string' || !key.trim()) return;
          if (value === undefined || value === null) return;
          options.env[key] = String(value);
        });
      }

      let allocatedPort = null;
      if (autoSelectPort) {
        const preferred = toPortNumber(preferredPort, 3004);
        const requestedKeys = Array.isArray(portEnvVars)
          ? portEnvVars.filter((key) => typeof key === 'string' && key.trim())
          : [];
        const keys = requestedKeys.length > 0 ? requestedKeys : DEFAULT_PORT_ENV_KEYS;
        allocatedPort = await findAvailablePort(preferred, 200, getReservedPorts());
        if (!allocatedPort) {
          return { success: false, error: 'Aucun port libre disponible.' };
        }
        keys.forEach((key) => {
          options.env[key] = String(allocatedPort);
        });
      }

      const child = spawn(spawnRequest.executable, spawnRequest.args, options);
      processes[id] = child;
      if (allocatedPort) {
        processMeta[id] = { allocatedPort };
      } else {
        delete processMeta[id];
      }

      child.stdout?.on('data', (data) => {
        sendToRenderer('process-output', { id, type: 'stdout', data: data.toString() });
      });

      child.stderr?.on('data', (data) => {
        sendToRenderer('process-output', { id, type: 'stderr', data: data.toString() });
      });

      child.on('close', (code) => {
        sendToRenderer('process-exit', { id, code });
        delete processes[id];
        delete processMeta[id];
      });

      child.on('error', (error) => {
        sendToRenderer('process-output', {
          id,
          type: 'stderr',
          data: `Erreur de processus: ${error.message || String(error)}`
        });
      });

      return { success: true, allocatedPort };
    } catch (error) {
      return { success: false, error: error.message };
    }
  };

  const stopProcess = async (id) => {
    try {
      if (!id || !processes[id]) {
        return { success: false, error: 'Processus introuvable' };
      }

      processes[id].kill();
      delete processes[id];
      delete processMeta[id];
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  };

  const runCommandForTask = async (command, cwd, timeoutMs = 180000) => {
    try {
      const trustedCwd = await ensureTrustedProjectPath(cwd);
      const spawnRequest = buildSafeSpawnRequest(command, []);
      validateCommandArgsWithinWorkspace(spawnRequest, trustedCwd);

      return await new Promise((resolve) => {
        const child = spawn(spawnRequest.executable, spawnRequest.args, {
          cwd: trustedCwd,
          shell: false,
          windowsHide: true
        });
        let stdout = '';
        let stderr = '';
        let finished = false;

        const done = (payload) => {
          if (finished) return;
          finished = true;
          resolve(payload);
        };

        const timer = setTimeout(() => {
          try { child.kill(); } catch { /* ignore */ }
          done({
            ok: false,
            code: -1,
            timedOut: true,
            stdout: stdout.slice(0, 6000),
            stderr: stderr.slice(0, 6000)
          });
        }, timeoutMs);

        child.stdout?.on('data', (data) => { stdout += String(data); });
        child.stderr?.on('data', (data) => { stderr += String(data); });
        child.on('error', (error) => {
          clearTimeout(timer);
          done({
            ok: false,
            code: -1,
            timedOut: false,
            stdout: stdout.slice(0, 6000),
            stderr: `${stderr}\n${error.message}`.slice(0, 6000)
          });
        });
        child.on('close', (code) => {
          clearTimeout(timer);
          done({
            ok: code === 0,
            code: Number(code),
            timedOut: false,
            stdout: stdout.slice(0, 6000),
            stderr: stderr.slice(0, 6000)
          });
        });
      });
    } catch (error) {
      return {
        ok: false,
        code: -1,
        timedOut: false,
        stdout: '',
        stderr: error.message
      };
    }
  };

  return {
    startProcess,
    stopProcess,
    runCommandForTask
  };
};

module.exports = {
  createProcessService,
  toPortNumber,
  isPortAvailable,
  findAvailablePort
};
