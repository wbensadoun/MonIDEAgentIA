'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
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

test('open-folder-dialog rejects an internal .agent directory before trusting it', async () => {
  const internalRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'code-companion-project-handler-'));
  const selectedInternalRoot = path.join(internalRoot, '.agent');
  await fs.mkdir(selectedInternalRoot);

  const projectHandlersId = require.resolve('./projectHandlers');
  const handlers = {};
  const originalLoad = Module._load;
  Module._load = (request, parent, isMain) => request === 'electron'
    ? {
        app: { getPath: () => 'C:/documents' },
        ipcMain: { handle: (channel, handler) => { handlers[channel] = handler; } },
        dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [selectedInternalRoot] }) }
      }
    : originalLoad(request, parent, isMain);
  delete require.cache[projectHandlersId];
  let opened = false;
  try {
    const { registerProjectHandlers } = require('./projectHandlers');
    registerProjectHandlers({
      getMainWindow: () => null,
      projectState: { markOpened: () => { opened = true; } }
    });
    const result = await handlers['open-folder-dialog']();
    assert.equal(result.success, false);
    assert.match(result.error, /\.agent/);
    assert.equal(opened, false);
  } finally {
    Module._load = originalLoad;
    delete require.cache[projectHandlersId];
    await fs.rm(internalRoot, { recursive: true, force: true });
  }
});
