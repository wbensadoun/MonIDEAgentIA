'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { registerRouterHandlers } = require('./routerHandlers');
const { routeToDecision } = require('../services/router.service');

test('route IPC derives workspace context from event sender and never from renderer options', async () => {
  const handlers = {};
  let received;
  const senderContext = { workspaceId: 'main-workspace' };
  registerRouterHandlers({
    ipcMain: { handle: (channel, handler) => { handlers[channel] = handler; } },
    resolveWorkspaceContext: async (event) => {
      assert.equal(event.sender.id, 42);
      return senderContext;
    },
    routeToDecision: async (request) => { received = request; return { success: true }; }
  });

  const result = await handlers['route-request'](
    { sender: { id: 42 } },
    'C:/untrusted-renderer-path',
    'route this',
    { workspaceContext: { workspaceId: 'forged-renderer-workspace' } }
  );
  assert.deepEqual(result, { success: true });
  assert.equal(received.workspaceContext, senderContext);
  assert.notDeepEqual(received.workspaceContext, { workspaceId: 'forged-renderer-workspace' });
});

test('router forwards its main-derived workspace context to the classifier completion', async () => {
  let completionRequest;
  await routeToDecision({
    projectPath: null,
    userPrompt: 'explique précisément comment les modules du projet doivent coopérer pour corriger ce défaut complexe',
    provider: 'claude',
    workspaceContext: { workspaceId: 'main-workspace' },
    listAgents: async () => ({ agents: [{ name: 'neven-coder' }] }),
    listSkills: async () => ({ skills: [{ name: 'implementation' }] }),
    runSingleCompletionProvider: async (request) => {
      completionRequest = request;
      return { success: false, error: 'unavailable' };
    }
  });
  assert.deepEqual(completionRequest.workspaceContext, { workspaceId: 'main-workspace' });
});
