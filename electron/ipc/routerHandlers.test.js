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
    trustedRouterConfiguration: { provider: 'claude' },
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

test('forged renderer BYOK routing fields cannot select a provider or inject a credential', async () => {
  const handlers = {};
  let completionRequest;
  registerRouterHandlers({
    ipcMain: { handle: (channel, handler) => { handlers[channel] = handler; } },
    resolveWorkspaceContext: async () => ({ workspaceId: 'main-workspace' }),
    resolveTrustedRouterConfiguration: async () => ({
      provider: 'claude',
      settings: {
        defaultProvider: 'claude',
        routerClassifierProvider: 'claude',
        routerClassifierModel: 'trusted-router-model',
        routerComplexityThreshold: 0.5
      }
    }),
    listAgents: async () => ({ agents: [{ name: 'neven-coder' }] }),
    listSkills: async () => ({ skills: [{ name: 'implementation' }] }),
    runSingleCompletionProvider: async (request) => {
      completionRequest = request;
      return { success: false, error: 'unavailable' };
    }
  });

  await handlers['route-request'](
    { sender: { id: 42 } },
    null,
    'explique précisément comment corriger ce défaut complexe dans plusieurs modules avec une stratégie de test complète',
    {
      provider: 'openai',
      apiKey: 'renderer-forged-key',
      settings: {
        routerClassifierProvider: 'ollama',
        routerClassifierModel: 'renderer-forged-model',
        claudeApiKey: 'renderer-forged-key'
      }
    }
  );

  assert.equal(completionRequest.provider, 'claude');
  assert.equal(completionRequest.options.model, 'trusted-router-model');
  assert.equal(Object.hasOwn(completionRequest.options, 'apiKey'), false);
  assert.equal(Object.values(completionRequest.options).includes('renderer-forged-key'), false);
});
