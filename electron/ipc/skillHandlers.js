'use strict';

const { ipcMain } = require('electron');
const { ensureEditPermission } = require('../services/settings.service');
const {
  installSkillFromUrl,
  installAllSkills,
  getVoltagentCatalog,
  syncVoltagentSubagents,
} = require('../services/skill.service');

const registerSkillHandlers = () => {
  ipcMain.handle('install-skill-from-url', async (_event, url, scope, projectPath, options = {}) => {
    try {
      await ensureEditPermission();
      return await installSkillFromUrl(url, scope, projectPath, options);
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
