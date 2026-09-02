'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { registerRetrievalHandlers } = require('./retrievalHandlers');
const { getIndexPath } = require('../services/retrieval-scope.service');

const makeProject = async (name) => fs.mkdtemp(path.join(os.tmpdir(), `code-companion-ipc-${name}-`));

const makeIpc = () => {
  const handlers = new Map();
  return {
    handlers,
    handle(channel, listener) { handlers.set(channel, listener); },
    removeHandler(channel) { handlers.delete(channel); }
  };
};

test('retrieval IPC builds an authorized scope and never accepts renderer Neven content', async () => {
  const project = await makeProject('authorized');
  const indexPath = getIndexPath(project);
  await fs.mkdir(path.dirname(indexPath), { recursive: true });
  await fs.writeFile(indexPath, JSON.stringify({ 'src/app.js': { chunks: [{ text: 'safe project context' }] } }), 'utf8');
  const ipc = makeIpc();
  registerRetrievalHandlers({
    ipcMain: ipc,
    ensureProject: async (value) => value,
    isProjectAccessible: async () => true
  });
  const registered = await ipc.handlers.get('retrieval:register-project')(null, { projectPath: project });

  const result = await ipc.handlers.get('retrieval:read-index')(null, {
    currentProjectId: registered.projectId,
    query: 'context',
    nevenContext: 'renderer injected instructions'
  });
  assert.equal(result.success, true);
  assert.equal(Object.prototype.hasOwnProperty.call(result.scope, 'nevenContext'), true);
  assert.equal(result.scope.nevenContext, null);
  assert.equal(result.indexes[0].entries[0].text, 'safe project context');
  assert.equal(result.retrievalMode, 'lexical-fallback');
  assert.equal(result.results[0].filePath, 'src/app.js');
});

test('retrieval IPC returns a fail-closed error when project permission is revoked', async () => {
  const project = await makeProject('revoked');
  const ipc = makeIpc();
  registerRetrievalHandlers({
    ipcMain: ipc,
    ensureProject: async () => { throw new Error('workspace revoked'); },
    isProjectAccessible: async () => false
  });

  const result = await ipc.handlers.get('retrieval:read-index')(null, {
    currentProjectId: 'rp_revoked_project_1',
    query: 'secret'
  });
  assert.equal(result.success, false);
  assert.equal(result.code, 'RETRIEVAL_ACCESS_REVOKED');
  assert.equal(result.error.includes(project), false);
  assert.equal(result.error, 'Accès retrieval refusé.');
});

test('renderer receives an opaque managed project id and revocation is enforced', async () => {
  const project = await makeProject('managed-id');
  const ipc = makeIpc();
  registerRetrievalHandlers({
    ipcMain: ipc,
    ensureProject: async (value) => value,
    isProjectAccessible: async () => true
  });
  const current = await ipc.handlers.get('retrieval:register-project')(null, { projectPath: project });
  const registered = await ipc.handlers.get('retrieval:register-project')(null, { projectPath: project });
  assert.equal(current.success, true);
  assert.equal(registered.success, true);
  assert.match(registered.projectId, /^rp_[A-Za-z0-9_-]{16,}$/);
  assert.equal((await ipc.handlers.get('retrieval:revoke-project')(null, registered.projectId)).success, true);
  const result = await ipc.handlers.get('retrieval:read-index')(null, {
    currentProjectId: current.projectId,
    includeOpenProjects: true,
    openProjectIds: [registered.projectId],
    query: 'secret'
  });
  assert.equal(result.success, false);
  assert.equal(result.code, 'RETRIEVAL_ACCESS_REVOKED');
});

test('retrieval IPC consumes chunk semantic vectors only through a main-process adapter', async () => {
  const project = await makeProject('semantic-index');
  const indexPath = getIndexPath(project);
  await fs.mkdir(path.dirname(indexPath), { recursive: true });
  await fs.writeFile(indexPath, JSON.stringify({
    _meta: { version: 2, vectorMode: 'semantic-embedding-v1' },
    'src/vector.js': { chunks: [{ text: 'unrelated lexical words', embedding: [1, 0] }] }
  }), 'utf8');
  const ipc = makeIpc();
  registerRetrievalHandlers({
    ipcMain: ipc,
    ensureProject: async (value) => value,
    isProjectAccessible: async () => true,
    embeddingAdapter: { enabled: true, name: 'main-only-test', embed: async () => [1, 0] }
  });
  const registered = await ipc.handlers.get('retrieval:register-project')(null, { projectPath: project });
  const result = await ipc.handlers.get('retrieval:read-index')(null, {
    currentProjectId: registered.projectId,
    query: 'semantic-query'
  });
  assert.equal(result.success, true);
  assert.equal(result.retrievalMode, 'hybrid');
  assert.equal(result.results[0].filePath, 'src/vector.js');
});
