'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createProviderContract } = require('./provider-contract.service');

const providerIds = ['gemini', 'claude', 'kimi', 'ollama', 'dashscope'];

test('provider contract normalizes completion, capabilities and health for every adapter', async () => {
  const adapters = Object.fromEntries(providerIds.map((id) => [id, {
    capabilities: { streaming: id === 'kimi' || id === 'ollama', vision: id === 'gemini' },
    complete: async () => ({ success: true, text: `${id} ok`, usage: { prompt_tokens: 3, completion_tokens: 2 } }),
    health: async () => ({ healthy: true })
  }]));
  const contract = createProviderContract({ adapters, now: (() => { let now = 0; return () => ++now; })() });

  for (const provider of providerIds) {
    const result = await contract.complete({ provider, request: {} });
    assert.equal(result.provider, provider);
    assert.deepEqual(result.usage, { inputTokens: 3, outputTokens: 2, cost: null });
    assert.equal(contract.capabilities(provider).completion, true);
    assert.equal(contract.capabilities(provider).health, true);
    assert.equal((await contract.health(provider)).healthy, true);
  }
});

test('provider contract rejects unknown providers and only retries controlled retryable failures', async () => {
  let attempts = 0;
  const contract = createProviderContract({ adapters: {
    gemini: { complete: async () => ({ success: false, error: 'transient', retryable: true }) },
    claude: { complete: async () => ({ success: true, text: 'ok' }) },
    kimi: { complete: async () => ({ success: true, text: 'ok' }) },
    ollama: { complete: async () => ({ success: true, text: 'ok' }) },
    dashscope: { complete: async () => { attempts += 1; if (attempts === 1) return { success: false, error: 'retry', retryable: true }; return { success: true, text: 'ok' }; } }
  } });
  await assert.rejects(() => contract.complete({ provider: 'unknown', request: {} }), { code: 'PROVIDER_UNSUPPORTED' });
  const result = await contract.complete({ provider: 'dashscope', request: {}, options: { retryAttempts: 1 } });
  assert.equal(result.success, true);
  assert.equal(attempts, 2);
  const noFallback = await contract.complete({ provider: 'gemini', request: {} });
  assert.equal(noFallback.provider, 'gemini');
  const controlledFallback = await contract.complete({ provider: 'gemini', request: {}, options: { allowProviderFallback: true, fallbackProvider: 'claude' } });
  assert.equal(controlledFallback.provider, 'claude');
});

test('provider contract handles timeout, cancellation and renderer-safe streaming', async () => {
  const adapters = Object.fromEntries(providerIds.map((id) => [id, { complete: async () => ({ success: true, text: id }) }]));
  adapters.ollama.complete = async ({ options }) => new Promise((resolve) => options.signal.addEventListener('abort', () => resolve({ success: false, aborted: true, error: 'cancelled' }), { once: true }));
  adapters.ollama.stream = async function* () { yield { token: 'first' }; yield { token: 'late-chunk', done: true }; };
  adapters.kimi.stream = async function* () { yield { token: 'a', provider: 'kimi' }; yield { token: 'b', done: true, model: 'hidden' }; };
  const contract = createProviderContract({ adapters });
  const timeout = await contract.complete({ provider: 'ollama', request: {}, options: { timeoutMs: 5 } });
  assert.equal(timeout.success, false);
  assert.equal(timeout.errorCode, 'PROVIDER_TIMEOUT');
  const controller = new AbortController();
  controller.abort();
  const cancelled = await contract.complete({ provider: 'ollama', request: {}, options: { signal: controller.signal } });
  assert.equal(cancelled.aborted, true);
  const events = [];
  for await (const event of contract.stream({ provider: 'kimi', request: {} })) events.push(event);
  assert.deepEqual(events, [{ token: 'a', done: false }, { token: 'b', done: true }]);

  const streamAbort = new AbortController();
  const lateEvents = [];
  const iterator = contract.stream({ provider: 'kimi', request: {}, options: { signal: streamAbort.signal } })[Symbol.asyncIterator]();
  lateEvents.push((await iterator.next()).value);
  streamAbort.abort();
  lateEvents.push((await iterator.next()).value);
  assert.deepEqual(lateEvents, [{ token: 'a', done: false }, { token: '', done: true, aborted: true }]);
  const ollamaAbort = new AbortController();
  const ollamaIterator = contract.stream({ provider: 'ollama', request: {}, options: { signal: ollamaAbort.signal } })[Symbol.asyncIterator]();
  assert.deepEqual((await ollamaIterator.next()).value, { token: 'first', done: false });
  ollamaAbort.abort();
  assert.deepEqual((await ollamaIterator.next()).value, { token: '', done: true, aborted: true });
  assert.deepEqual(await contract.health('gemini'), { provider: 'gemini', healthy: false, reason: 'health-not-implemented' });
});
