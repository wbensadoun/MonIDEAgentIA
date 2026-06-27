'use strict';

const { ipcMain, dialog } = require('electron');
const {
  trustProjectPath,
  requestProjectPathApproval,
} = require('../core/security');

const registerProjectHandlers = ({ getMainWindow }) => {
  ipcMain.handle('open-folder-dialog', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(getMainWindow(), {
      properties: ['openDirectory']
    });
    if (canceled) {
      return { success: true, path: null };
    }

    const trustedPath = trustProjectPath(filePaths[0]);
    return { success: true, path: trustedPath };
  });

  ipcMain.handle('authorize-project-path', async (_event, projectPath) => {
    try {
      return await requestProjectPathApproval(projectPath, { dialog, getMainWindow });
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
};

module.exports = { registerProjectHandlers };
