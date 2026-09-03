'use strict';

const fs = require('fs').promises;
const path = require('path');
const { ipcMain } = require('electron');
const { ensureEditPermission } = require('../services/settings.service');
const {
  installSkillFromUrl,
  installAllSkills,
  getVoltagentCatalog,
  syncVoltagentSubagents,
} = require('../services/skill.service');
const { getGlobalSkillsDir } = require('../services/agent.service');
const {
  getCloudflareAgentsClient,
  isConfigured: isCloudflareAgentsConfigured,
  syncEnabled: isCloudflareAgentsSyncEnabled,
} = require('../services/cloudflare-agents.service');

// Best-effort : publie un skill global installe vers l'API Cloudflare (COD-52).
const cloudflarePushSkill = async (name) => {
  try {
    if (!isCloudflareAgentsSyncEnabled() || !isCloudflareAgentsConfigured()) return;
    const safeName = String(name || '').replace(/[<>:"/\\|?*]/g, '_').trim();
    if (!safeName) return;
    const content = await fs.readFile(path.join(getGlobalSkillsDir(), safeName, 'SKILL.md'), 'utf-8');
    await getCloudflareAgentsClient().put(`${safeName}.md`, content, 'skills');
  } catch { /* ignore */ }
};

const registerSkillHandlers = () => {
  ipcMain.handle('install-skill-from-url', async (_event, url, scope, projectPath, options = {}) => {
    try {
      await ensureEditPermission();
      const result = await installSkillFromUrl(url, scope, projectPath, options);
      if (result?.success && scope === 'global') {
        await cloudflarePushSkill(result.name || result.skill?.name || options.name);
      }
      return result;
    } catch (error) {
      console.error('[Skills] Error installing skill:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('install-all-skills', async (_event, catalogEntries) => {
    try {
      await ensureEditPermission();
      return await installAllSkills(catalogEntries);
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-voltagent-catalog', async (_event, catalogId) => {
    try {
      return await getVoltagentCatalog(catalogId);
    } catch (error) {
      console.error('[VoltCatalog] Error fetching catalog:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('sync-voltagent-subagents', async (_event, options = {}) => {
    try {
      await ensureEditPermission();
      return await syncVoltagentSubagents(options);
    } catch (error) {
      console.error('[VoltAgent] Error syncing subagents:', error);
      return { success: false, error: error.message };
    }
  });
};

module.exports = { registerSkillHandlers };
