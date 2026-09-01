'use strict';

const fs = require('fs');
const path = require('path');
const { app, ipcMain, dialog } = require('electron');
const {
  trustProjectPath,
  requestProjectPathApproval,
  revokeProjectPath,
} = require('../core/security');

const registerProjectHandlers = ({ getMainWindow, projectState = null, registerRetrievalPath = null, scheduleRagIndex = null, cancelRagIndex = null, revokeRetrievalPath = null }) => {
  const registerProjectIdentity = async (projectPath) => (
    typeof registerRetrievalPath === 'function'
      ? registerRetrievalPath(projectPath)
      : null
  );

  ipcMain.handle('open-folder-dialog', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(getMainWindow(), {
      properties: ['openDirectory']
    });
    if (canceled) {
      return { success: true, path: null };
    }

    const trustedPath = trustProjectPath(filePaths[0]);
    projectState?.markOpened?.(trustedPath);
    try {
      const projectId = await registerProjectIdentity(trustedPath);
      scheduleRagIndex?.(projectId, trustedPath);
      return { success: true, path: trustedPath, projectId };
    } catch {
      return { success: false, error: 'Identite projet indisponible.' };
    }
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
      const projectId = await registerProjectIdentity(trustedPath);
      scheduleRagIndex?.(projectId, trustedPath);
      return { success: true, path: trustedPath, projectId };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('authorize-project-path', async (_event, projectPath) => {
    try {
      const result = await requestProjectPathApproval(projectPath, { dialog, getMainWindow });
      if (result?.success) {
        projectState?.markOpened?.(result.path);
        try {
          const projectId = await registerProjectIdentity(result.path);
          scheduleRagIndex?.(projectId, result.path);
          return { ...result, projectId };
        } catch {
          return { success: false, error: 'Identite projet indisponible.' };
        }
      }
      return result;
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('close-project', async (_event, projectPath) => {
    const wasOpen = projectState?.isOpen?.(projectPath) === true;
    cancelRagIndex?.(projectPath);
    if (wasOpen) projectState.markClosed(projectPath);
    // A historical workspace may no longer be present in the window state,
    // but it can still have a registered retrieval identity. Revoke by path
    // regardless, then let the renderer remove its local history entry.
    revokeProjectPath(projectPath);
    revokeRetrievalPath?.(projectPath);
    return wasOpen
      ? { success: true }
      : { success: false, code: 'PROJECT_NOT_OPEN', error: 'Projet non ouvert.' };
  });
};

module.exports = { registerProjectHandlers };
