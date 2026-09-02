'use strict';

const { RETRIEVAL_SCOPE_ERRORS } = require('../services/retrieval-scope.service');

const registerLocalRagIndexHandlers = ({
  ipcMain,
  projectRegistry,
  jobManager
} = {}) => {
  if (!ipcMain || typeof ipcMain.handle !== 'function') throw new Error('ipcMain requis');
  if (!projectRegistry || typeof projectRegistry.resolve !== 'function') throw new Error('Registre projet requis');
  if (!jobManager || typeof jobManager.enqueue !== 'function') throw new Error('Gestionnaire index requis');
  const handle = (channel, listener) => {
    if (typeof ipcMain.removeHandler === 'function') ipcMain.removeHandler(channel);
    ipcMain.handle(channel, listener);
  };
  const invalid = () => ({ success: false, code: RETRIEVAL_SCOPE_ERRORS.ACCESS_REVOKED, error: 'Index retrieval refuse.' });

  handle('rag:index-project', async (_event, payload = {}) => {
    const projectId = payload && typeof payload === 'object' && !Array.isArray(payload)
      ? payload.projectId
      : null;
    if (typeof projectId !== 'string') return invalid();
    const projectPath = projectRegistry.resolve(projectId);
    if (!projectPath || !(await projectRegistry.isActive(projectId, projectPath))) return invalid();
    const job = jobManager.enqueue(projectId, projectPath);
    return { success: true, ...job };
  });

  handle('rag:index-status', async (_event, payload = {}) => {
    const projectId = payload && typeof payload === 'object' && !Array.isArray(payload)
      ? payload.projectId
      : null;
    const jobId = payload && typeof payload === 'object' && !Array.isArray(payload)
      ? payload.jobId
      : null;
    if (typeof projectId !== 'string' || typeof jobId !== 'string') return invalid();
    const job = jobManager.get(jobId);
    const associatedProjectIds = Array.isArray(job?.projectIds)
      ? job.projectIds
      : [job?.projectId];
    if (!job || !associatedProjectIds.includes(projectId)) return invalid();
    const projectPath = projectRegistry.resolve(projectId);
    if (!projectPath || !(await projectRegistry.isActive(projectId, projectPath))) return invalid();
    return { success: true, job };
  });
};

module.exports = { registerLocalRagIndexHandlers };
