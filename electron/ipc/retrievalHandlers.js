'use strict';

const {
  sanitizeRetrievalRequest,
  buildRetrievalScope,
  readScopedIndexes,
  RETRIEVAL_SCOPE_ERRORS,
  createRetrievalProjectRegistry
} = require('../services/retrieval-scope.service');

const registerRetrievalHandlers = ({
  ipcMain,
  ensureProject,
  isProjectAccessible,
  resolveNevenContext,
  onProjectRevoked = null,
  projectRegistry = createRetrievalProjectRegistry({ ensureProject, isProjectAccessible })
} = {}) => {
  if (!ipcMain || typeof ipcMain.handle !== 'function') throw new Error('ipcMain requis');
  if (typeof ensureProject !== 'function') throw new Error('Autorisation projet requise');

  const handle = (channel, listener) => {
    if (typeof ipcMain.removeHandler === 'function') ipcMain.removeHandler(channel);
    ipcMain.handle(channel, listener);
  };

  const publicError = (error) => {
    const code = error?.code || RETRIEVAL_SCOPE_ERRORS.INVALID_REQUEST;
    const messages = {
      [RETRIEVAL_SCOPE_ERRORS.INVALID_REQUEST]: 'Requête retrieval invalide.',
      [RETRIEVAL_SCOPE_ERRORS.NO_AUTHORIZED_PROJECT]: 'Aucun projet autorisé.',
      [RETRIEVAL_SCOPE_ERRORS.ACCESS_REVOKED]: 'Accès retrieval refusé.',
      [RETRIEVAL_SCOPE_ERRORS.INDEX_UNAVAILABLE]: 'Index retrieval indisponible.'
    };
    return { code, error: messages[code] || 'Retrieval refusé.' };
  };

  handle('retrieval:register-project', async (_event, payload = {}) => {
    try {
      const projectPath = payload && typeof payload === 'object' && !Array.isArray(payload)
        ? payload.projectPath
        : null;
      const id = await projectRegistry.register(projectPath);
      return { success: true, projectId: id };
    } catch (error) {
      const safe = publicError(error);
      console.error('[Retrieval] register refused:', safe.code);
      return { success: false, ...safe };
    }
  });

  handle('retrieval:revoke-project', async (_event, projectId) => {
    const revoked = typeof projectId === 'string' && projectRegistry.revoke(projectId);
    if (revoked) onProjectRevoked?.(projectId);
    return revoked
      ? { success: true }
      : { success: false, ...publicError({ code: RETRIEVAL_SCOPE_ERRORS.ACCESS_REVOKED }) };
  });

  const resolveRetrievalContext = createRetrievalContextResolver({
    ensureProject,
    isProjectAccessible,
    resolveNevenContext,
    projectRegistry
  });

  handle('retrieval:read-index', async (_event, payload = {}) => {
    try {
      return await resolveRetrievalContext(payload);
    } catch (error) {
      const safe = publicError(error);
      console.error('[Retrieval] read refused:', safe.code);
      return { success: false, ...safe };
    }
  });
};

const createRetrievalContextResolver = ({
  ensureProject,
  isProjectAccessible,
  resolveNevenContext,
  projectRegistry
} = {}) => {
  const publicError = (error) => {
    const code = error?.code || RETRIEVAL_SCOPE_ERRORS.INVALID_REQUEST;
    const messages = {
      [RETRIEVAL_SCOPE_ERRORS.INVALID_REQUEST]: 'Requête retrieval invalide.',
      [RETRIEVAL_SCOPE_ERRORS.NO_AUTHORIZED_PROJECT]: 'Aucun projet autorisé.',
      [RETRIEVAL_SCOPE_ERRORS.ACCESS_REVOKED]: 'Accès retrieval refusé.',
      [RETRIEVAL_SCOPE_ERRORS.INDEX_UNAVAILABLE]: 'Index retrieval indisponible.'
    };
    return { code, error: messages[code] || 'Retrieval refusé.' };
  };
  return async (payload = {}) => {
    try {
      const request = sanitizeRetrievalRequest(payload);
      const scope = await buildRetrievalScope(request, {
        ensureProject,
        isProjectAccessible,
        resolveNevenContext,
        resolveProjectId: projectRegistry.resolve
      });
      const indexes = await readScopedIndexes(scope, {
        ensureProject,
        isProjectAccessible,
        verifyScopeProject: async (project) => !project.projectId || projectRegistry.isActive(project.projectId, project.projectPath)
      });
      return { success: true, scope, ...indexes };
    } catch (error) {
      const safe = publicError(error);
      console.error('[Retrieval] resolve refused:', safe.code);
      return { success: false, ...safe };
    }
  };
};

module.exports = { registerRetrievalHandlers, createRetrievalContextResolver };
