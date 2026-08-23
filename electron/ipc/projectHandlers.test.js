'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');

test('opening a folder preserves its local path but never passes it to Neven workspace context', async () => {
  const projectHandlersId = require.resolve('./projectHandlers');
  const handlers = {};
  const calls = [];
  const originalLoad = Module._load;
  Module._load = (request, parent, isMain) => request === 'electron'
    ? {
        app: { getPath: () => 'C:/documents' },
        ipcMain: { handle: (channel, handler) => { handlers[channel] = handler; } },
        dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: ['C:/local/project'] }) }
      }
    : originalLoad(request, parent, isMain);
  delete require.cache[projectHandlersId];
  try {
    const { registerProjectHandlers } = require('./projectHandlers');
    registerProjectHandlers({ getMainWindow: () => null, setWorkspaceContext: async (...args) => calls.push(args) });
    const result = await handlers['open-folder-dialog']({ sender: { id: 7, session: {} } });
    assert.deepEqual(result, { success: true, path: 'C:\\local\\project' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].length, 1);
    assert.equal(calls[0][0].sender.id, 7);
  } finally {
    Module._load = originalLoad;
    delete require.cache[projectHandlersId];
  }
});
