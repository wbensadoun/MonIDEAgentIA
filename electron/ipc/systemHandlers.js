'use strict';

const { ipcMain } = require('electron');
const { getSystemAIProfile } = require('../services/system.service');

const registerSystemHandlers = () => {
  ipcMain.handle('get-system-ai-profile', async (_event, options = {}) => {
    try {
      return await getSystemAIProfile(options);
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
};

module.exports = { registerSystemHandlers };
