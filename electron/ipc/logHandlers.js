'use strict';

const fs = require('fs').promises;
const { ipcMain, shell } = require('electron');

const registerLogHandlers = ({ getLogsDir, getLatestLogPath }) => {
  ipcMain.handle('get-latest-log', async () => {
    try {
      const latest = await getLatestLogPath();
      if (!latest) return { success: true, path: null, content: '' };
      const content = await fs.readFile(latest, 'utf8');
      return { success: true, path: latest, content };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('open-logs-folder', async () => {
    try {
      await fs.mkdir(getLogsDir(), { recursive: true });
      await shell.openPath(getLogsDir());
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
};

module.exports = { registerLogHandlers };
