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

  const result = await ipc.handlers.get('retrieval:read-index')(null, {
    currentProjectPath: project,
    query: 'context',
    nevenContext: 'renderer injected instructions'
  });
  assert.equal(result.success, true);
  assert.equal(Object.prototype.hasOwnProperty.call(result.scope, 'nevenContext'), true);
  assert.equal(result.scope.nevenContext, null);
  assert.equal(result.indexes[0].entries[0].text, 'safe project context');
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
    currentProjectPath: project,
    query: 'secret'
  });
  assert.equal(result.success, false);
  assert.equal(result.code, 'RETRIEVAL_ACCESS_REVOKED');
});
