'use strict';

const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const { ipcMain, dialog } = require('electron');
const { ensureTrustedProjectPath, assertSafePath } = require('../core/security');
const { ensureEditPermission } = require('../services/settings.service');
const {
  agentListRuns, agentGetRun, agentCreateRun, agentUpdateRun,
  agentAppendLog, agentUpdateChangeStatus, agentApplyChange,
  agentRejectChange, agentRestoreRun,
  listAgents, getAgent, saveAgent, deleteAgent,
  listSkills, getSkill,
  getPackTargets, collectFilesRecursive, sanitizePackPath,
} = require('../services/agent.service');

// Builds the IPC notification callback that sends agent:action events to the renderer.
const makeNotifyFn = (getMainWindow) => (type, run) => {
  const win = typeof getMainWindow === 'function' ? getMainWindow() : null;
  if (win && !win.isDestroyed()) {
    win.webContents.send('agent:action', {
      type,
      runId: run.id,
      status: run.status,
      at: new Date().toISOString()
    });
  }
};

const registerAgentHandlers = (getMainWindow) => {
  const notify = makeNotifyFn(getMainWindow);

  // --- Agent run CRUD ---
  ipcMain.handle('agent:listRuns', async (_event, projectPath) => {
    try { return await agentListRuns(projectPath); }
    catch (error) { return { success: false, error: error.message, runs: [] }; }
  });

  ipcMain.handle('agent:getRun', async (_event, projectPath, runId) => {
    try { return await agentGetRun(projectPath, runId); }
    catch (error) { return { success: false, error: error.message }; }
  });

  ipcMain.handle('agent:createRun', async (_event, projectPath, payload) => {
    try { return await agentCreateRun(projectPath, payload, notify); }
    catch (error) { return { success: false, error: error.message }; }
  });

  ipcMain.handle('agent:updateRun', async (_event, projectPath, runId, patch) => {
    try { return await agentUpdateRun(projectPath, runId, patch, notify); }
    catch (error) { return { success: false, error: error.message }; }
  });

  ipcMain.handle('agent:appendLog', async (_event, projectPath, runId, log) => {
    try { return await agentAppendLog(projectPath, runId, log, notify); }
    catch (error) { return { success: false, error: error.message }; }
  });

  ipcMain.handle('agent:updateChangeStatus', async (_event, projectPath, runId, changeId, status, extra) => {
    try { return await agentUpdateChangeStatus(projectPath, runId, changeId, status, extra, notify); }
    catch (error) { return { success: false, error: error.message }; }
  });

  ipcMain.handle('agent:applyChange', async (_event, projectPath, runId, changeId) => {
    try { return await agentApplyChange(projectPath, runId, changeId, notify); }
    catch (error) { return { success: false, error: error.message }; }
  });

  ipcMain.handle('agent:rejectChange', async (_event, projectPath, runId, changeId) => {
    try { return await agentRejectChange(projectPath, runId, changeId, notify); }
    catch (error) { return { success: false, error: error.message }; }
  });

  ipcMain.handle('agent:restoreRun', async (_event, projectPath, runId) => {
    try { return await agentRestoreRun(projectPath, runId, notify); }
    catch (error) { return { success: false, error: error.message }; }
  });

  // --- Agents library ---
  ipcMain.handle('list-agents', async (_event, projectPath) => {
    try { return await listAgents(projectPath); }
    catch (error) { return { success: false, error: error.message }; }
  });

  ipcMain.handle('get-agent', async (_event, name, scope, projectPath) => {
    try { return await getAgent(name, scope, projectPath); }
    catch (error) { return { success: false, error: error.message }; }
  });

  ipcMain.handle('save-agent', async (_event, name, content, scope, projectPath) => {
    try { return await saveAgent(name, content, scope, projectPath); }
    catch (error) { return { success: false, error: error.message }; }
  });

  ipcMain.handle('delete-agent', async (_event, name, scope, projectPath) => {
    try { return await deleteAgent(name, scope, projectPath); }
    catch (error) { return { success: false, error: error.message }; }
  });

  // --- Skills library ---
  ipcMain.handle('list-skills', async (_event, projectPath) => {
    try { return await listSkills(projectPath); }
    catch (error) { return { success: false, error: error.message }; }
  });

  ipcMain.handle('get-skill', async (_event, name, scope, projectPath) => {
    try { return await getSkill(name, scope, projectPath); }
    catch (error) { return { success: false, error: error.message }; }
  });

  // --- Library pack export/import (need dialog) ---
  ipcMain.handle('export-library-pack', async (_event, projectPath, options = {}) => {
    try {
      const safeOptions = options && typeof options === 'object' ? options : {};
      const scope = safeOptions.scope === 'global' || safeOptions.scope === 'both' ? safeOptions.scope : 'workspace';
      const trustedProjectPath = scope === 'global' ? null : await ensureTrustedProjectPath(projectPath);

      const targets = getPackTargets(trustedProjectPath);
      const includeTarget = (key) => {
        if (scope === 'both') return true;
        if (scope === 'global') return key.startsWith('global');
        return key.startsWith('workspace');
      };

      const pack = { version: 1, exportedAt: new Date().toISOString(), app: 'MonIDEAgentIA', scope, sections: {} };

      for (const [section, dirPath] of Object.entries(targets)) {
        if (!dirPath || !includeTarget(section)) continue;
        const fileList = await collectFilesRecursive(dirPath, dirPath, []);
        const files = [];
        for (const relPath of fileList) {
          const safeRelPath = sanitizePackPath(relPath);
          if (!safeRelPath) continue;
          const fullPath = path.join(dirPath, safeRelPath);
          try { files.push({ path: safeRelPath, content: await fs.readFile(fullPath, 'utf-8') }); } catch { /* ignore */ }
        }
        if (files.length > 0) pack.sections[section] = files;
      }

      const win = typeof getMainWindow === 'function' ? getMainWindow() : null;
      const defaultName = `vibe-library-pack-${Date.now()}.json`;
      const saveResult = safeOptions.outputPath
        ? { canceled: false, filePath: safeOptions.outputPath }
        : await dialog.showSaveDialog(win, {
          title: 'Exporter pack bibliotheque', defaultPath: defaultName,
          filters: [{ name: 'Vibe Pack', extensions: ['json'] }]
        });

      if (saveResult.canceled || !saveResult.filePath) return { success: false, canceled: true, error: 'Export annule' };
      await fs.writeFile(saveResult.filePath, JSON.stringify(pack, null, 2), 'utf-8');
      const sectionCount = Object.values(pack.sections).reduce((sum, arr) => sum + arr.length, 0);
      return { success: true, path: saveResult.filePath, entries: sectionCount };
    } catch (error) { return { success: false, error: error.message }; }
  });

  ipcMain.handle('import-library-pack', async (_event, projectPath, options = {}) => {
    try {
      await ensureEditPermission();
      const safeOptions = options && typeof options === 'object' ? options : {};
      const overwrite = !!safeOptions.overwrite;
      const trustedProjectPath = projectPath ? await ensureTrustedProjectPath(projectPath) : null;
      const win = typeof getMainWindow === 'function' ? getMainWindow() : null;

      const openResult = safeOptions.inputPath
        ? { canceled: false, filePaths: [safeOptions.inputPath] }
        : await dialog.showOpenDialog(win, {
          title: 'Importer pack bibliotheque', properties: ['openFile'],
          filters: [{ name: 'Vibe Pack', extensions: ['json'] }]
        });

      if (openResult.canceled || !Array.isArray(openResult.filePaths) || !openResult.filePaths[0]) {
        return { success: false, canceled: true, error: 'Import annule' };
      }

      const sourcePath = openResult.filePaths[0];
      const raw = await fs.readFile(sourcePath, 'utf-8');
      const parsed = JSON.parse(raw);
      const sections = parsed && typeof parsed === 'object' ? parsed.sections : null;
      if (!sections || typeof sections !== 'object') return { success: false, error: 'Pack invalide: sections manquantes' };

      const targets = getPackTargets(trustedProjectPath);
      let imported = 0;
      let skipped = 0;

      for (const [section, files] of Object.entries(sections)) {
        const targetRoot = targets[section];
        if (!targetRoot || !Array.isArray(files)) continue;
        await fs.mkdir(targetRoot, { recursive: true });
        for (const fileEntry of files) {
          const relPath = sanitizePackPath(fileEntry?.path);
          if (!relPath) { skipped += 1; continue; }
          const fullPath = path.join(targetRoot, relPath);
          assertSafePath(targetRoot, fullPath);
          const exists = fsSync.existsSync(fullPath);
          if (exists && !overwrite) { skipped += 1; continue; }
          await fs.mkdir(path.dirname(fullPath), { recursive: true });
          await fs.writeFile(fullPath, String(fileEntry?.content || ''), 'utf-8');
          imported += 1;
        }
      }
      return { success: true, imported, skipped, sourcePath };
    } catch (error) { return { success: false, error: error.message }; }
  });
};

module.exports = { registerAgentHandlers };
