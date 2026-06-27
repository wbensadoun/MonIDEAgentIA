'use strict';

const { ipcMain } = require('electron');
const { createAISnapshot, listAISnapshots, restoreAISnapshot } = require('../services/snapshot.service');

const registerSnapshotHandlers = () => {
  ipcMain.handle('create-ai-snapshot', (_event, projectPath, files, label) =>
    createAISnapshot(projectPath, files, label)
  );
  ipcMain.handle('list-ai-snapshots', (_event, projectPath) =>
    listAISnapshots(projectPath)
  );
  ipcMain.handle('restore-ai-snapshot', (_event, projectPath, snapshotId) =>
    restoreAISnapshot(projectPath, snapshotId)
  );
};

module.exports = { registerSnapshotHandlers };
