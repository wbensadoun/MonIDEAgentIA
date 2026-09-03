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

test('embedding providers are versioned and disabled by default', async () => {
  const provider = createLocalEmbeddingProvider({
    providerId: 'local.disabled',
    model: 'model',
    dimensions: 2,
    tokenizerVersion: 'tok-v1',
    embedBatch: async () => [[1, 0]]
  });
  const capability = createEmbeddingCapability({ provider });
  assert.equal(capability.metadata().contract, EMBEDDING_PROVIDER_CONTRACT);
  assert.equal(capability.metadata().enabled, false);
  await assert.rejects(() => capability.embed(['text']), (error) => error.code === 'EMBEDDING_DISABLED');
});

test('provider contract rejects renderer secret fields and invalid descriptors', () => {
  assert.throws(() => createEmbeddingProvider({
    providerId: 'byok.test', model: 'model', dimensions: 2, tokenizerVersion: 'v1', kind: 'byok',
    apiKey: 'plaintext', embedBatch: async () => []
  }), (error) => error.code === 'EMBEDDING_SECRET_BOUNDARY');
  assert.throws(() => createEmbeddingProvider({
    providerId: 'bad provider', model: 'model', dimensions: 2, tokenizerVersion: 'v1', embedBatch: async () => []
  }), (error) => error.code === 'EMBEDDING_PROVIDER_INVALID');
});

test('embedding batches, deduplicates request texts, and caches by model contract identity', async () => {
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

test('embedding cache is bounded and quota counts only uncached inputs', async () => {
  const quota = new EmbeddingQuota({ maxItems: 2, maxChars: 20 });
  const capability = createEmbeddingCapability({ provider: descriptor(), quota, cache: new EmbeddingCache({ maxEntries: 2 }) });
  await capability.embed(['one', 'two']);
  assert.equal(capability.quota().usedItems, 2);
  await capability.embed(['one']);
  assert.equal(capability.quota().usedItems, 2);
  await assert.rejects(() => capability.embed(['three']), (error) => error.code === 'EMBEDDING_QUOTA_EXCEEDED');
  assert.equal(capability.cache().entries, 2);
});

test('transient provider failures retry with bounded backoff', async () => {
  let attempts = 0;
  const provider = descriptor({ embedBatch: async () => {
    attempts += 1;
    if (attempts < 3) throw Object.assign(new Error('busy'), { retryable: true });
    return [[1, 0, 0]];
  } });
  const capability = createEmbeddingCapability({ provider, retries: 2, sleep: async () => {} });
  const result = await capability.embed(['retry']);
  assert.deepEqual(result, [[1, 0, 0]]);
  assert.equal(attempts, 3);
});

test('timeouts and cancellation fail closed without leaking a provider secret', async () => {
  const timeoutProvider = descriptor({ embedBatch: async () => new Promise(() => {}) });
  const timeoutCapability = createEmbeddingCapability({ provider: timeoutProvider, timeoutMs: 10, retries: 0 });
  await assert.rejects(() => timeoutCapability.embed(['timeout']), (error) => error.code === 'EMBEDDING_TIMEOUT');

  const controller = new AbortController();
  const cancelProvider = descriptor({ embedBatch: async (_texts, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { retryable: false })), { once: true });
  }) });
  const cancelCapability = createEmbeddingCapability({ provider: cancelProvider, timeoutMs: 1000, retries: 0 });
  const pending = cancelCapability.embed(['cancel'], { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, (error) => error.code === 'EMBEDDING_CANCELLED');
  assert.equal(Object.prototype.hasOwnProperty.call(cancelCapability.metadata(), 'apiKey'), false);
});

test('BYOK resolves the encrypted secret only inside the main-process request closure', async () => {
  let observedKey = null;
  const provider = createByokEmbeddingProvider({
    providerId: 'byok.test',
    model: 'remote-embed-v1',
    dimensions: 2,
    tokenizerVersion: 'tok-v1',
    enabled: true,
    vault: { get: async (secretId) => secretId === 'credential-id' ? 'plaintext-secret' : null },
    secretId: 'credential-id',
    requestBatch: async (texts, { apiKey }) => {
      observedKey = apiKey;
      return texts.map(() => [1, 0]);
    }
  });
  const capability = createEmbeddingCapability({ provider });
  assert.equal(Object.prototype.hasOwnProperty.call(provider, 'apiKey'), false);
  assert.deepEqual(await capability.embed(['safe']), [[1, 0]]);
  assert.equal(observedKey, 'plaintext-secret');
  assert.equal(Object.prototype.hasOwnProperty.call(capability.metadata(), 'apiKey'), false);
});

test('invalid provider vectors never become semantic embeddings', async () => {
  const provider = descriptor({ embedBatch: async () => [[1, 0]] });
  const capability = createEmbeddingCapability({ provider });
  await assert.rejects(() => capability.embed(['bad']), (error) => error.code === 'EMBEDDING_INVALID_RESPONSE');
});
