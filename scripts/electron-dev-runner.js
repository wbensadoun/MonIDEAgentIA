const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');
const electronBinary = require('electron');

const rootDir = path.resolve(__dirname, '..');
const watchFiles = ['main.js', 'preload.js', 'logger.js'].map((file) => path.join(rootDir, file));
const rendererUrl = process.env.ELECTRON_DEV_SERVER_URL || 'http://127.0.0.1:3004';

let electronProcess = null;
let restartRequested = false;
let shuttingDown = false;

const log = (message) => {
  process.stdout.write(`[electron-dev] ${message}\n`);
};

const unwatchAll = () => {
  watchFiles.forEach((file) => fs.unwatchFile(file));
};

const killElectron = () => {
  if (!electronProcess) return;
  try {
    electronProcess.kill();
  } catch {
    // ignore
  }
};

const startElectron = () => {
  if (shuttingDown) return;

  electronProcess = spawn(electronBinary, ['.'], {
    cwd: rootDir,
    stdio: 'inherit',
    env: process.env
  });

  electronProcess.once('exit', (code, signal) => {
    const restartNow = restartRequested && !shuttingDown;
    const exitCode = typeof code === 'number' ? code : 0;
    const exitSignal = signal ? ` (${signal})` : '';
    electronProcess = null;

    if (restartNow) {
      restartRequested = false;
      log(`Redemarrage d'Electron${exitSignal}...`);
      startElectron();
      return;
    }

    if (!shuttingDown) {
      process.exit(exitCode);
    }
  });
};

const scheduleRestart = (filePath) => {
  if (shuttingDown) return;
  log(`Changement detecte dans ${path.basename(filePath)}. Redemarrage du process Electron...`);

  if (!electronProcess) {
    startElectron();
    return;
  }

  restartRequested = true;
  killElectron();
};

const watchElectronFiles = () => {
  watchFiles.forEach((filePath) => {
    fs.watchFile(filePath, { interval: 250 }, (current, previous) => {
      if (current.mtimeMs === previous.mtimeMs) return;
      scheduleRestart(filePath);
    });
  });
};

const shutdown = (exitCode = 0) => {
  shuttingDown = true;
  unwatchAll();
  if (electronProcess) {
    electronProcess.once('exit', () => process.exit(exitCode));
    killElectron();
    return;
  }
  process.exit(exitCode);
};

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

const pollRenderer = (url, timeout = 120000) => {
  const startTime = Date.now();
  const parsed = new URL(url);

  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(
        { hostname: parsed.hostname, port: parsed.port, path: parsed.pathname, method: 'HEAD' },
        (res) => {
          if (res.statusCode >= 200 && res.statusCode < 500) {
            resolve();
          } else {
            reschedule();
          }
        }
      );
      req.on('error', () => reschedule());
      req.setTimeout(2000, () => { req.destroy(); reschedule(); });
    };

    const reschedule = () => {
      if (Date.now() - startTime > timeout) {
        reject(new Error(`Timed out waiting for: ${url}`));
        return;
      }
      setTimeout(attempt, 500);
    };

    attempt();
  });
};

const main = async () => {
  log(`Attente du renderer sur ${rendererUrl}...`);
  await pollRenderer(rendererUrl, 120000);
  log('Renderer detecte, demarrage d\'Electron...');

  watchElectronFiles();
  startElectron();
};

main().catch((error) => {
  log(`Impossible de demarrer Electron: ${error.message}`);
  shutdown(1);
});
