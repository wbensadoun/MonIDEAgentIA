'use strict';

const { ipcMain } = require('electron');

const registerPtyHandlers = (ptyService) => {
  ipcMain.handle('pty-create', async (_event, payload) => {
    try {
      return await ptyService.create(payload || {});
    } catch (error) {
      return { success: false, error: error?.message || String(error) };
    }
  });

  ipcMain.handle('pty-write', (_event, id, data) => {
    try {
      return ptyService.write(id, data);
    } catch (error) {
      return { success: false, error: error?.message || String(error) };
    }
  });

  ipcMain.handle('pty-resize', (_event, id, cols, rows) => {
    try {
      return ptyService.resize(id, cols, rows);
    } catch (error) {
      return { success: false, error: error?.message || String(error) };
    }
  });

  ipcMain.handle('pty-kill', (_event, id) => {
    try {
      return ptyService.kill(id);
    } catch (error) {
      return { success: false, error: error?.message || String(error) };
    }
  });

  ipcMain.handle('pty-read-buffer', (_event, id) => {
    try {
      return ptyService.readBuffer(id);
    } catch (error) {
      return { success: false, error: error?.message || String(error) };
    }
  });

  ipcMain.handle('pty-is-available', () => ({ available: ptyService.isAvailable() }));
};

module.exports = { registerPtyHandlers };
