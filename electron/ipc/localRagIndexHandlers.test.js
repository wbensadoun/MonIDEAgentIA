'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { registerLocalRagIndexHandlers } = require('./localRagIndexHandlers');

const makeIpc = () => {
  const handlers = new Map();
  return {
    handlers,
    removeHandler: (channel) => handlers.delete(channel),
    handle: (channel, listener) => handlers.set(channel, listener)
  };
};

test('index IPC accepts only active opaque project IDs and never renderer paths', async () => {
  const ipc = makeIpc();
  let receivedPath = null;
  const projectRegistry = {
    resolve: (projectId) => projectId === 'rp_current_project_id' ? 'C:/trusted' : null,
    isActive: async (projectId, projectPath) => projectId === 'rp_current_project_id' && projectPath === 'C:/trusted'
  };
  const jobManager = {
    enqueue: (projectId, projectPath) => {
      receivedPath = projectPath;
      return { jobId: 'rag_job_id', projectId, status: 'queued' };
    },
    get: () => null
  };
  registerLocalRagIndexHandlers({ ipcMain: ipc, projectRegistry, jobManager });
  const handler = ipc.handlers.get('rag:index-project');
  const accepted = await handler(null, {
    projectId: 'rp_current_project_id',
    projectPath: 'C:/renderer-forged',
  });
  assert.equal(accepted.success, true);
  assert.equal(receivedPath, 'C:/trusted');

  const refused = await handler(null, { projectId: 'rp_revoked_project_id', projectPath: 'C:/trusted' });
  assert.equal(refused.success, false);
  assert.equal(refused.code, 'RETRIEVAL_ACCESS_REVOKED');
});

test('index status is bound to the opaque project identity', async () => {
  const ipc = makeIpc();
  registerLocalRagIndexHandlers({
    ipcMain: ipc,
    projectRegistry: {
      resolve: (projectId) => projectId === 'rp_current_project_id' ? 'C:/trusted' : null,
      isActive: async () => true
    },
    jobManager: {
      enqueue: () => ({ jobId: 'rag_job_id', projectId: 'rp_current_project_id', status: 'queued' }),
      get: (jobId) => jobId === 'rag_job_id' ? { jobId, projectId: 'rp_current_project_id', status: 'completed' } : null
    }
  });
  const handler = ipc.handlers.get('rag:index-status');
  assert.equal((await handler(null, { projectId: 'rp_current_project_id', jobId: 'rag_job_id' })).success, true);
  assert.equal((await handler(null, { projectId: 'rp_other_project_id', jobId: 'rag_job_id' })).success, false);
});
