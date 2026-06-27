'use strict';

const { BrowserWindow } = require('electron');
const { createMainWindow } = require('./windowManager');

const registerAppLifecycle = ({
  app,
  dialog,
  logger,
  trustProjectPath,
  rootDir,
  isDev,
  getLogsDir,
  getLatestLogPath,
  setMainWindow
} = {}) => {
  if (!app) throw new Error('registerAppLifecycle requires Electron app');
  if (!dialog) throw new Error('registerAppLifecycle requires Electron dialog');
  if (typeof setMainWindow !== 'function') {
    throw new Error('registerAppLifecycle requires setMainWindow');
  }

  const createAndStoreMainWindow = async () => {
    const window = await createMainWindow({
      app,
      dialog,
      logger,
      trustProjectPath,
      rootDir,
      isDev,
      getLogsDir,
      getLatestLogPath
    });
    setMainWindow(window);
    return window;
  };

  app.whenReady().then(async () => {
    await logger?.init?.();
    await createAndStoreMainWindow();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createAndStoreMainWindow().catch((error) => {
        console.error('[Main] Impossible de recreer la fenetre principale:', error);
      });
    }
  });
};

module.exports = { registerAppLifecycle };
