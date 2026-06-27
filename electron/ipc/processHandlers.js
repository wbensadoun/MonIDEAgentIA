'use strict';

const { ipcMain } = require('electron');

const registerProcessHandlers = (processService) => {
  ipcMain.handle('start-process', async (_event, payload) => {
    return processService.startProcess(payload);
  });

  ipcMain.handle('stop-process', async (_event, id) => {
    return processService.stopProcess(id);
  });
};

module.exports = { registerProcessHandlers };
