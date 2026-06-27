'use strict';

const { ipcMain } = require('electron');
const { runQualityGates } = require('../services/quality.service');

const registerQualityHandlers = (processService) => {
  ipcMain.handle('run-quality-gates', async (_event, projectPath, options = {}) => {
    try {
      return await runQualityGates(projectPath, options, {
        runCommandForTask: processService.runCommandForTask
      });
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
};

module.exports = { registerQualityHandlers };
