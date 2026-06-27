'use strict';

const { spawn } = require('child_process');

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

module.exports = { runGit };
