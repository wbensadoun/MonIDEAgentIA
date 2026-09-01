'use strict';

const fs = require('fs');
const path = require('path');
const { app, ipcMain, dialog } = require('electron');
const {
  trustProjectPath,
  requestProjectPathApproval,
  revokeProjectPath,
} = require('../core/security');

const registerProjectHandlers = ({ getMainWindow, projectState = null, revokeRetrievalPath = null }) => {
  ipcMain.handle('open-folder-dialog', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(getMainWindow(), {
      properties: ['openDirectory']
    });
    if (canceled) {
      return { success: true, path: null };
    }

    const trustedPath = trustProjectPath(filePaths[0]);
    projectState?.markOpened?.(trustedPath);
    return { success: true, path: trustedPath };
  });

  // Espace de travail scratch créé/réutilisé quand l'utilisateur envoie un
  // message sans avoir ouvert de dossier — évite de bloquer le chat sur un
  // dialogue natif pour une simple question. Toujours le même dossier
  // (pas d'horodatage) : les sessions "sans projet" successives réutilisent
  // le même espace au lieu d'accumuler des dossiers vides.
  ipcMain.handle('create-default-project', async () => {
    try {
      const defaultRoot = path.join(app.getPath('documents'), 'Code Companion', 'Sans-titre');
      fs.mkdirSync(defaultRoot, { recursive: true });
      const trustedPath = trustProjectPath(defaultRoot);
      projectState?.markOpened?.(trustedPath);
      return { success: true, path: trustedPath };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('authorize-project-path', async (_event, projectPath) => {
    try {
      const result = await requestProjectPathApproval(projectPath, { dialog, getMainWindow });
      if (result?.success) projectState?.markOpened?.(result.path);
      return result;
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('close-project', async (_event, projectPath) => {
    if (!projectState?.isOpen?.(projectPath)) {
      return { success: false, error: 'Projet non ouvert.' };
    }
    projectState.markClosed(projectPath);
    revokeProjectPath(projectPath);
    revokeRetrievalPath?.(projectPath);
    return { success: true };
  });
};

module.exports = { registerProjectHandlers };
