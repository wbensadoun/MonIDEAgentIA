'use strict';

const { ipcMain, shell } = require('electron');
const {
  listOllamaModels,
  resolveOllamaFamily,
  fetchOllamaLibrarySizes,
  recommendOllamaSizeForRequest,
  startOllamaServerIfPossible,
  installOllama,
  checkOllamaUpdates,
  pullOllamaModel,
  OLLAMA_DOWNLOAD_URL,
} = require('../services/ollama.service');

const registerOllamaHandlers = (getMainWindow) => {
  ipcMain.handle('list-ollama-models', async () => {
    try { return await listOllamaModels(); }
    catch (error) {
      return { success: false, error: `Ollama non disponible: ${error.message}. Installez Ollama depuis l'app ou via ${OLLAMA_DOWNLOAD_URL}` };
    }
  });

  ipcMain.handle('resolve-ollama-family', async (_event, payload = {}) => {
    try { return await resolveOllamaFamily(payload?.vendor, payload?.force); }
    catch (error) { return { success: false, error: `Detection famille Ollama impossible: ${error.message}` }; }
  });

  ipcMain.handle('fetch-ollama-library-sizes', async (_event, payload = {}) => {
    try { return await fetchOllamaLibrarySizes(payload?.family, payload?.force); }
    catch (error) { return { success: false, error: `Recuperation tailles Ollama impossible: ${error.message}` }; }
  });

  ipcMain.handle('recommend-ollama-size', async (_event, payload = {}) => {
    try { return await recommendOllamaSizeForRequest(payload); }
    catch (error) { return { success: false, error: `Recommandation taille impossible: ${error.message}` }; }
  });

  ipcMain.handle('start-ollama', async () => {
    try { return await startOllamaServerIfPossible(); }
    catch (error) { return { success: false, error: error.message }; }
  });

  ipcMain.handle('install-ollama', async () => {
    try { return await installOllama({ openExternalFn: (url) => shell.openExternal(url) }); }
    catch (error) { return { success: false, error: error.message }; }
  });

  ipcMain.handle('check-ollama-updates', async (_event, modelNames = []) => {
    try { return await checkOllamaUpdates(modelNames); }
    catch (error) { return { success: false, error: error.message }; }
  });

  ipcMain.handle('pull-ollama-model', async (_event, modelName) => {
    const sendProgress = (payload) => {
      const win = typeof getMainWindow === 'function' ? getMainWindow() : null;
      if (win && !win.isDestroyed()) {
        win.webContents.send('ollama-pull-progress', { model: String(modelName || '').trim(), ...payload });
      }
    };
    try { return await pullOllamaModel(modelName, sendProgress); }
    catch (error) { return { success: false, error: error.message }; }
  });
};

module.exports = { registerOllamaHandlers };
