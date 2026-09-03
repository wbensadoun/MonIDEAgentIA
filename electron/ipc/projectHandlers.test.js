'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const handlers = new Map();
const electronId = require.resolve('electron');
require.cache[electronId] = {
  id: electronId,
  filename: electronId,
  loaded: true,
  exports: {
    app: { getPath: () => path.join(os.tmpdir(), 'code-companion-project-handler-data') },
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    dialog: {
      showOpenDialog: async () => ({ canceled: false, filePaths: [] })
    }
  }
};

const { registerProjectHandlers } = require('./projectHandlers');

test('open-folder-dialog rejects .agent before trusting or opening it', async () => {
  const internalRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'code-companion-project-handler-'));
  const selectedInternalRoot = path.join(internalRoot, '.agent');
  await fs.mkdir(selectedInternalRoot);

  const electron = require('electron');
  electron.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedInternalRoot] });
  let opened = false;
  registerProjectHandlers({
    getMainWindow: () => null,
    projectState: { markOpened: () => { opened = true; } }
  });

  try {
    const result = await handlers.get('open-folder-dialog')();
    assert.equal(result.success, false);
    assert.match(result.error, /\.agent/);
    assert.equal(opened, false);
  } finally {
    await fs.rm(internalRoot, { recursive: true, force: true });
  }
});
