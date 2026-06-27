'use strict';

const { ensureTrustedProjectPath } = require('../core/security');
const { ensureTerminalPermission, readSettingsSafe } = require('./settings.service');

const runQualityGates = async (projectPath, options = {}, deps = {}) => {
  if (!projectPath) return { success: false, error: 'Chemin projet manquant' };
  if (typeof deps.runCommandForTask !== 'function') {
    return { success: false, error: 'Execution terminal indisponible' };
  }

  const trustedProjectPath = await ensureTrustedProjectPath(projectPath);
  await ensureTerminalPermission();

  const settings = await readSettingsSafe();
  const safeOptions = options && typeof options === 'object' ? options : {};

  const enabled = {
    lint: safeOptions.lint ?? settings.qualityGateLint,
    test: safeOptions.test ?? settings.qualityGateTest,
    build: safeOptions.build ?? settings.qualityGateBuild
  };
  const blockOnFail = safeOptions.blockOnFail ?? settings.qualityGateBlockOnFail;
  const timeoutMs = Math.min(900000, Math.max(30000, Number(safeOptions.timeoutMs) || 180000));

  const gates = [];
  if (enabled.lint) gates.push({ id: 'lint', command: safeOptions.lintCommand || 'npm run lint --if-present' });
  if (enabled.test) gates.push({ id: 'test', command: safeOptions.testCommand || 'npm test -- --watchAll=false --runInBand' });
  if (enabled.build) gates.push({ id: 'build', command: safeOptions.buildCommand || 'npm run build --if-present' });

  if (gates.length === 0) {
    return { success: true, passed: true, skipped: true, results: [] };
  }

  const results = [];
  let passed = true;

  for (const gate of gates) {
    // eslint-disable-next-line no-await-in-loop
    const runResult = await deps.runCommandForTask(gate.command, trustedProjectPath, timeoutMs);
    const entry = {
      id: gate.id,
      command: gate.command,
      ok: runResult.ok,
      code: runResult.code,
      timedOut: runResult.timedOut,
      stdout: runResult.stdout,
      stderr: runResult.stderr
    };
    results.push(entry);

    if (!entry.ok) {
      passed = false;
      if (blockOnFail) break;
    }
  }

  return { success: true, passed, results, blockOnFail };
};

module.exports = { runQualityGates };
