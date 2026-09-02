'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  EMBEDDING_PROVIDER_CONTRACT,
  EmbeddingCache,
  EmbeddingQuota,
  createEmbeddingProvider,
  createLocalEmbeddingProvider,
  createByokEmbeddingProvider,
  createEmbeddingCapability
} = require('./embedding-capability.service');

const descriptor = (options = {}) => createLocalEmbeddingProvider({
  providerId: 'local.test',
  model: 'test-embed-v1',
  dimensions: 3,
  tokenizerVersion: 'tokenizer-v1',
  enabled: true,
  embedBatch: async (texts) => texts.map((text) => [text.length, 1, 0]),
  ...options
});

test('embedding contract is versioned and disabled by default', async () => {
  const provider = createLocalEmbeddingProvider({
    providerId: 'local.disabled', model: 'model', dimensions: 2,
    tokenizerVersion: 'tok-v1', embedBatch: async () => [[1, 0]]
  });
  const capability = createEmbeddingCapability({ provider });
  assert.equal(capability.metadata().contract, EMBEDDING_PROVIDER_CONTRACT);
  assert.equal(capability.metadata().enabled, false);
  await assert.rejects(() => capability.embed(['text']), (error) => error.code === 'EMBEDDING_DISABLED');
});

test('renderer cannot provide a secret or an invalid provider identity', () => {
  assert.throws(() => createEmbeddingProvider({
    providerId: 'byok.test', model: 'model', dimensions: 2, tokenizerVersion: 'v1',
    kind: 'byok', apiKey: 'plaintext', embedBatch: async () => []
  }), (error) => error.code === 'EMBEDDING_SECRET_BOUNDARY');
  assert.throws(() => createEmbeddingProvider({
    providerId: 'bad provider', model: 'model', dimensions: 2,
    tokenizerVersion: 'v1', embedBatch: async () => []
  }), (error) => error.code === 'EMBEDDING_PROVIDER_INVALID');
});

test('batching, deduplication and cache identity include model metadata', async () => {
  const calls = [];
  const provider = descriptor({ embedBatch: async (texts) => {
    calls.push(texts);
    return texts.map((text) => [text.length, 1, 0]);
  } });
  const capability = createEmbeddingCapability({ provider, cache: new EmbeddingCache({ maxEntries: 10 }) });
  const first = await capability.embed(['alpha', 'beta', 'alpha']);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ['alpha', 'beta']);
  assert.deepEqual(first[0], first[2]);
  await capability.embed(['alpha', 'beta']);
  assert.equal(calls.length, 1);
  assert.equal(capability.cache().entries, 2);
});

test('quota counts only uncached inputs and resets at the configured window', async () => {
  let now = 1000;
  const quota = new EmbeddingQuota({ maxItems: 2, maxChars: 20, windowMs: 100, now: () => now });
  const capability = createEmbeddingCapability({ provider: descriptor(), quota, cache: new EmbeddingCache({ maxEntries: 2 }) });
  await capability.embed(['one', 'two']);
  assert.equal(capability.quota().usedItems, 2);
  await capability.embed(['one']);
  assert.equal(capability.quota().usedItems, 2);
  await assert.rejects(() => capability.embed(['three']), (error) => error.code === 'EMBEDDING_QUOTA_EXCEEDED');
  now += 100;
  await capability.embed(['three']);
  assert.equal(capability.quota().usedItems, 1);
});

test('transient failures retry with bounded backoff', async () => {
  let attempts = 0;
  const provider = descriptor({ embedBatch: async () => {
    attempts += 1;
    if (attempts < 3) throw Object.assign(new Error('busy'), { retryable: true });
    return [[1, 0, 0]];
  } });
  const capability = createEmbeddingCapability({ provider, retries: 2, sleep: async () => {} });
  assert.deepEqual(await capability.embed(['retry']), [[1, 0, 0]]);
  assert.equal(attempts, 3);
});

test('timeout and cancellation fail closed', async () => {
  const timeoutCapability = createEmbeddingCapability({
    provider: descriptor({ embedBatch: async () => new Promise(() => {}) }),
    timeoutMs: 10, retries: 0
  });
  await assert.rejects(() => timeoutCapability.embed(['timeout']), (error) => error.code === 'EMBEDDING_TIMEOUT');

  const controller = new AbortController();
  const cancelCapability = createEmbeddingCapability({
    provider: descriptor({ embedBatch: async (_texts, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { retryable: false })), { once: true });
    }) }),
    timeoutMs: 1000, retries: 0
  });
  const pending = cancelCapability.embed(['cancel'], { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, (error) => error.code === 'EMBEDDING_CANCELLED');
  assert.equal(Object.hasOwn(cancelCapability.metadata(), 'apiKey'), false);
});

test('BYOK secret exists only inside the main-process request closure', async () => {
  let observedKey = null;
  const provider = createByokEmbeddingProvider({
    providerId: 'byok.test', model: 'remote-embed-v1', dimensions: 2,
    tokenizerVersion: 'tok-v1', enabled: true,
    vault: { get: async (id) => id === 'credential-id' ? 'plaintext-secret' : null },
    secretId: 'credential-id',
    requestBatch: async (texts, { apiKey }) => {
      observedKey = apiKey;
      return texts.map(() => [1, 0]);
    }
  });
  const capability = createEmbeddingCapability({ provider });
  assert.equal(Object.hasOwn(provider, 'apiKey'), false);
  assert.deepEqual(await capability.embed(['safe']), [[1, 0]]);
  assert.equal(observedKey, 'plaintext-secret');
  assert.equal(Object.hasOwn(capability.metadata(), 'apiKey'), false);
});

test('wrong vector dimensions are rejected; no synthetic fallback is generated', async () => {
  const capability = createEmbeddingCapability({
    provider: descriptor({ embedBatch: async () => [[1, 0]] })
  });
  await assert.rejects(() => capability.embed(['bad']), (error) => error.code === 'EMBEDDING_INVALID_RESPONSE');
});
