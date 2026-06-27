'use strict';

const { ipcMain } = require('electron');
const { readSettingsSafe, saveSettings, validateApiKey } = require('../services/settings.service');

const registerSettingsHandlers = () => {
  ipcMain.handle('save-settings', async (_event, settings) => {
    try {
      await saveSettings(settings);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('load-settings', async () => {
    try {
      const settings = await readSettingsSafe();
      return { success: true, settings };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('validate-api-key', async (_event, provider, apiKey) => {
    try {
      return await validateApiKey(provider, apiKey);
    } catch (error) {
      return { success: false, valid: false, error: error.message };
    }
  });
};

module.exports = { registerSettingsHandlers };
