'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { registerWansiaRetrievalHandlers } = require('./wansiaRetrievalHandlers');
const { createWansiaRetrievalCapability } = require('../services/wansia-retrieval-capability.service');

const makeIpc = () => {
  const handlers = new Map();
  return { handlers, removeHandler: (channel) => handlers.delete(channel), handle: (channel, fn) => handlers.set(channel, fn) };
};

test('Wansia retrieval IPC exposes negotiation and safe public errors', async () => {
  const ipc = makeIpc();
  registerWansiaRetrievalHandlers({ ipcMain: ipc, capability: createWansiaRetrievalCapability() });
  const metadata = await ipc.handlers.get('wansia:retrieval:metadata')(null);
  assert.equal(metadata.success, true);
  assert.equal(metadata.enabled, false);
  const negotiated = await ipc.handlers.get('wansia:retrieval:negotiate')(null, { peerVersions: [1] });
  assert.equal(negotiated.selectedVersion, 1);
  const refused = await ipc.handlers.get('wansia:retrieval:query')(null, {
    protocolVersion: 1,
    requestId: 'wan21-request-1',
    query: 'x'
  });
  assert.equal(refused.success, false);
  assert.equal(refused.code, 'WANSIA_RETRIEVAL_UNAVAILABLE');
  assert.equal(refused.error.includes('Transport'), false);
});
