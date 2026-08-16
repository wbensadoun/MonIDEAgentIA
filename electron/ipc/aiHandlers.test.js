'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { registerAIHandlers } = require('./aiHandlers');

const createIpcMain = () => {
  const handlers = new Map();
  return { handlers, handle: (channel, handler) => handlers.set(channel, handler) };
};
const flush = () => new Promise((resolve) => setImmediate(resolve));

test('chat, inline and ghost publish bounded usage without completion content', async () => {
  const ipcMain = createIpcMain();
  const events = [];
  const signals = [];
  const runIds = [];
  registerAIHandlers({
    ipcMain,
    dialog: {},
    executeCommandForAI: async () => ({}),
    runSingleCompletion: async () => ({ success: true }),
    providers: Object.fromEntries(['gemini', 'claude', 'kimi', 'ollama'].map((provider) => [provider,
      async () => ({ success: true, text: 'chat response', usage: { inputTokens: 3, outputTokens: 2 } })
    ])),
    runSingleCompletion: async ({ options }) => {
      signals.push(options.signal);
      runIds.push(options.runId);
      return { success: true, text: 'completion content', usage: { promptTokens: 4, completionTokens: 1 } };
    },
    publishUsageEvent: async (event) => { events.push(event); return { success: true }; }
  });

  assert.equal((await ipcMain.handlers.get('get-gemini-completion')(null, [], '', null, { runId: 'chat-1' })).success, true);
  assert.equal((await ipcMain.handlers.get('get-inline-completion')(null, 'secret prompt', 'secret code', { provider: 'gemini', runId: 'inline-1' })).success, true);
  assert.equal((await ipcMain.handlers.get('get-ghost-completion')(null, 'secret prefix', 'secret suffix', { provider: 'gemini', runId: 'ghost-1' })).success, true);
  await flush();

  assert.equal(events.length, 3);
  assert.equal(signals.length, 2);
  assert.deepEqual(runIds, ['inline-1', 'ghost-1']);
  assert.ok(signals.every((signal) => signal instanceof AbortSignal));
  for (const event of events) {
    assert.deepEqual(Object.keys(event).sort(), ['durationMs', 'inputTokens', 'outputTokens', 'providerId', 'success']);
    assert.equal(event.success, true);
  }
});

test('telemetry publication is deferred and never delays a completion result', async () => {
  const ipcMain = createIpcMain();
  let finishTelemetry;
  let telemetryFinished = false;
  registerAIHandlers({
    ipcMain,
    dialog: {},
    executeCommandForAI: async () => ({}),
    providers: Object.fromEntries(['gemini', 'claude', 'kimi', 'ollama'].map((provider) => [provider,
      async () => ({ success: true, usage: {} })
    ])),
    runSingleCompletion: async () => ({ success: true, usage: {} }),
    publishUsageEvent: () => new Promise((resolve) => {
      finishTelemetry = () => { telemetryFinished = true; resolve(); };
    })
  });

  const result = await ipcMain.handlers.get('get-gemini-completion')(null, [], '', null, { runId: 'deferred-1' });
  assert.equal(result.success, true);
  assert.equal(telemetryFinished, false);
  finishTelemetry();
  await flush();
  assert.equal(telemetryFinished, true);
});

test('failures and cancellations are published without delaying the IPC result', async () => {
  const ipcMain = createIpcMain();
  const events = [];
  registerAIHandlers({
    ipcMain,
    dialog: {},
    executeCommandForAI: async () => ({}),
    providers: Object.fromEntries(['gemini', 'claude', 'kimi', 'ollama'].map((provider) => [provider,
      async ({ options }) => new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new Error('cancelled'))))
    ])),
    runSingleCompletion: async () => { throw new Error('provider failure'); },
    publishUsageEvent: async (event) => {
      events.push(event);
      throw new Error('telemetry failure');
    }
  });

  const pending = ipcMain.handlers.get('get-gemini-completion')(null, [], '', null, { runId: 'run-1' });
  assert.deepEqual(await ipcMain.handlers.get('cancel-ai-generation')(null, 'run-1'), { success: true });
  assert.equal((await pending).aborted, true);
  assert.equal((await ipcMain.handlers.get('get-inline-completion')(null, 'prompt', 'code', { provider: 'gemini' })).success, false);
  await flush();

  assert.equal(events.length, 2);
  assert.ok(events.every((event) => event.success === false));
});

test('late provider success is reclassified after cancellation', async () => {
  const ipcMain = createIpcMain();
  let resolveProvider;
  registerAIHandlers({
    ipcMain,
    dialog: {},
    executeCommandForAI: async () => ({}),
    runSingleCompletion: async () => ({ success: true }),
    providers: {
      gemini: async () => new Promise((resolve) => { resolveProvider = resolve; }),
      claude: async () => ({ success: true }),
      kimi: async () => ({ success: true }),
      ollama: async () => ({ success: true })
    },
    publishUsageEvent: async () => ({ success: true })
  });

  const pending = ipcMain.handlers.get('get-gemini-completion')(null, [], '', null, { runId: 'late-1' });
  assert.deepEqual(await ipcMain.handlers.get('cancel-ai-generation')(null, 'late-1'), { success: true });
  resolveProvider({ success: true, text: 'late success' });

  const result = await pending;
  assert.equal(result.success, false);
  assert.equal(result.aborted, true);
});

test('all provider handlers receive the cancellable signal', async () => {
  for (const provider of ['gemini', 'claude', 'kimi', 'ollama']) {
    const ipcMain = createIpcMain();
    let receivedSignal;
    let resolveProvider;
    registerAIHandlers({
      ipcMain,
      dialog: {},
      executeCommandForAI: async () => ({}),
      providers: Object.fromEntries(['gemini', 'claude', 'kimi', 'ollama'].map((name) => [name,
        async ({ options }) => {
          if (name !== provider) return { success: true };
          receivedSignal = options.signal;
          return new Promise((resolve) => { resolveProvider = resolve; });
        }
      ])),
      runSingleCompletion: async () => ({ success: true }),
      publishUsageEvent: async () => ({ success: true })
    });

    const runId = `provider-cancel-${provider}`;
    const pending = ipcMain.handlers.get(`get-${provider}-completion`)(null, [], '', null, { runId });
    await flush();
    assert.ok(receivedSignal instanceof AbortSignal, `${provider} did not receive an AbortSignal`);
    assert.equal(receivedSignal.aborted, false);
    assert.deepEqual(await ipcMain.handlers.get('cancel-ai-generation')(null, runId), { success: true });
    assert.equal(receivedSignal.aborted, true);
    resolveProvider({ success: true });
    assert.equal((await pending).aborted, true);
  }
});
