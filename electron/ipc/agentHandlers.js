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
  getGlobalSkillsDir, getGlobalWorkflowsDir,
} = require('../services/agent.service');
const {
  getCloudflareAgentsClient,
  isConfigured: isCloudflareAgentsConfigured,
  syncEnabled: isCloudflareAgentsSyncEnabled,
} = require('../services/cloudflare-agents.service');

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
    try {
      const result = await saveAgent(name, content, scope, projectPath);
      // Auto-push vers l'API Cloudflare (agents.md) si le sync est active.
      if (result?.success && scope === 'global' && isCloudflareAgentsSyncEnabled() && isCloudflareAgentsConfigured()) {
        getCloudflareAgentsClient().putAgent(result.name, String(content || '')).catch(() => { /* best effort */ });
      }
      return result;
    }
    catch (error) { return { success: false, error: error.message }; }
  });

  ipcMain.handle('delete-agent', async (_event, name, scope, projectPath) => {
    try {
      const result = await deleteAgent(name, scope, projectPath);
      if (result?.success && scope === 'global' && isCloudflareAgentsSyncEnabled() && isCloudflareAgentsConfigured()) {
        getCloudflareAgentsClient().deleteAgent(name).catch(() => { /* best effort */ });
      }
      return result;
    }
    catch (error) { return { success: false, error: error.message }; }
  });

  // --- Sync Cloudflare (stockage distant des agents.md) ---
  ipcMain.handle('cloudflare-agents:status', async () => {
    return { success: true, configured: isCloudflareAgentsConfigured(), enabled: isCloudflareAgentsSyncEnabled() };
  });

  ipcMain.handle('cloudflare-agents:list', async (_event, type = 'agents') => {
    try { return await getCloudflareAgentsClient().list(type); }
    catch (error) { return { success: false, error: error.message }; }
  });

  ipcMain.handle('cloudflare-agents:get', async (_event, name, type = 'agents') => {
    try { return await getCloudflareAgentsClient().get(name, type); }
    catch (error) { return { success: false, error: error.message }; }
  });

  ipcMain.handle('cloudflare-agents:push', async (_event, name, scope, projectPath) => {
    try {
      const local = await getAgent(name, scope, projectPath);
      if (!local?.success) return local;
      const result = await getCloudflareAgentsClient().putAgent(name, local.agent.content);
      return result;
    }
    catch (error) { return { success: false, error: error.message }; }
  });

  // Collecte les ressources globales locales par type (agents *.md,
  // skills <dir>/SKILL.md, workflows *.md) -> [{ name, content }].
  const collectGlobalLocalResources = async (type) => {
    if (type === 'skills') {
      const dir = getGlobalSkillsDir();
      const out = [];
      let entries = [];
      try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return out; }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        try {
          const content = await fs.readFile(path.join(dir, entry.name, 'SKILL.md'), 'utf-8');
          out.push({ name: `${entry.name}.md`, content });
        } catch { /* skill sans SKILL.md */ }
      }
      return out;
    }
    const dir = type === 'workflows' ? getGlobalWorkflowsDir() : null;
    if (type === 'workflows') {
      const out = [];
      let files = [];
      try { files = await fs.readdir(dir); } catch { return out; }
      for (const file of files) {
        if (!file.toLowerCase().endsWith('.md')) continue;
        try { out.push({ name: file, content: await fs.readFile(path.join(dir, file), 'utf-8') }); } catch { /* ignore */ }
      }
      return out;
    }
    // agents (defaut)
    const { agents } = await listAgents(null);
    const out = [];
    for (const agent of agents.filter((a) => a.scope === 'global')) {
      const local = await getAgent(agent.name, 'global', null);
      if (local?.success) out.push({ name: agent.name, content: local.agent.content });
    }
    return out;
  };

  const globalDirForType = (type) =>
    type === 'skills' ? getGlobalSkillsDir() : type === 'workflows' ? getGlobalWorkflowsDir() : null;

  // Push global : publie toutes les ressources globales locales vers Cloudflare.
  // type: 'agents' (defaut) | 'skills' | 'workflows'
  ipcMain.handle('cloudflare-agents:push-all', async (_event, type = 'agents') => {
    try {
      const resourceType = ['agents', 'skills', 'workflows'].includes(type) ? type : 'agents';
      const client = getCloudflareAgentsClient();
      if (!client.isConfigured()) return { success: false, code: 'not_configured', error: 'API Cloudflare agents non configuree (.env).' };
      const items = await collectGlobalLocalResources(resourceType);
      let pushed = 0; let failed = 0;
      for (const item of items) {
        const result = await client.put(item.name, item.content, resourceType);
        if (result?.success) pushed += 1; else failed += 1;
      }
      return { success: failed === 0, type: resourceType, pushed, failed, total: items.length };
    }
    catch (error) { return { success: false, error: error.message }; }
  });

  // Pull global : telecharge une ressource distante vers le cache global local.
  ipcMain.handle('cloudflare-agents:pull', async (_event, name, type = 'agents') => {
    try {
      const resourceType = ['agents', 'skills', 'workflows'].includes(type) ? type : 'agents';
      const client = getCloudflareAgentsClient();
      if (resourceType === 'agents') {
        const remote = await client.get(name, 'agents');
        if (!remote?.success) return remote;
        return await saveAgent(remote.agent.name, remote.agent.content, 'global', null);
      }
      const remote = await client.get(name, resourceType);
      if (!remote?.success) return remote;
      const content = remote.agent || remote.skill || remote.workflow;
      const dir = globalDirForType(resourceType);
      await fs.mkdir(dir, { recursive: true });
      const safeName = String(content.name || '').replace(/[<>:"/\\|?*]/g, '_');
      if (!safeName) return { success: false, error: 'Nom distant invalide' };
      if (resourceType === 'skills') {
        const skillDir = path.join(dir, safeName.replace(/\.md$/i, ''));
        await fs.mkdir(skillDir, { recursive: true });
        await fs.writeFile(path.join(skillDir, 'SKILL.md'), String(content.content || ''), 'utf-8');
      } else {
        await fs.writeFile(path.join(dir, safeName), String(content.content || ''), 'utf-8');
      }
      return { success: true, name: safeName, type: resourceType };
    }
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

      const pack = { version: 1, exportedAt: new Date().toISOString(), app: 'Code Companion', scope, sections: {} };

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
