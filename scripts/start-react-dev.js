const { spawn } = require('child_process');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const clientDir = path.join(rootDir, 'client');
const rendererUrl = process.env.ELECTRON_DEV_SERVER_URL || 'http://127.0.0.1:3004';
const rendererPort = new URL(rendererUrl).port || '3004';

const childEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key, value]) => value != null && !key.startsWith('='))
);

const command = process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : 'npm';
const args = process.platform === 'win32' ? ['/d', '/s', '/c', 'npm start'] : ['start'];

const child = spawn(command, args, {
  cwd: clientDir,
  stdio: 'inherit',
  env: {
    ...childEnv,
    BROWSER: 'none',
    HOST: '127.0.0.1',
    PORT: process.env.PORT || rendererPort
  }
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(typeof code === 'number' ? code : 0);
});
