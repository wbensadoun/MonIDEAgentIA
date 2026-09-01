'use strict';

const {
  sanitizeRetrievalRequest,
  buildRetrievalScope,
  readScopedIndexes,
  RETRIEVAL_SCOPE_ERRORS
} = require('../services/retrieval-scope.service');

const registerRetrievalHandlers = ({
  ipcMain,
  ensureProject,
  isProjectAccessible,
  resolveNevenContext
} = {}) => {
  if (!ipcMain || typeof ipcMain.handle !== 'function') throw new Error('ipcMain requis');
  if (typeof ensureProject !== 'function') throw new Error('Autorisation projet requise');

  const handle = (channel, listener) => {
    if (typeof ipcMain.removeHandler === 'function') ipcMain.removeHandler(channel);
    ipcMain.handle(channel, listener);
  };

  handle('retrieval:read-index', async (_event, payload = {}) => {
    try {
      const request = sanitizeRetrievalRequest(payload);
      const scope = await buildRetrievalScope(request, {
        ensureProject,
        isProjectAccessible,
        resolveNevenContext
      });
      const indexes = await readScopedIndexes(scope, { ensureProject, isProjectAccessible });
      return { success: true, scope, ...indexes };
    } catch (error) {
      const code = error?.code || RETRIEVAL_SCOPE_ERRORS.INVALID_REQUEST;
      return { success: false, code, error: error?.message || 'Retrieval refuse.' };
    }
  });
};

module.exports = { registerRetrievalHandlers };
