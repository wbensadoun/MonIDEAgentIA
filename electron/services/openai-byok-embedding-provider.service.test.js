'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  OPENAI_EMBEDDINGS_URL,
  createOpenAIByokEmbeddingProvider
} = require('./openai-byok-embedding-provider.service');
const { createEmbeddingCapability } = require('./embedding-capability.service');

test('BYOK embedding resolves the vault secret only in the main-process request', async () => {
  let url = null;
  let headers = null;
  const provider = createOpenAIByokEmbeddingProvider({
    vault: { get: async (id) => id === 'vault-id' ? 'test-secret' : null },
    secretId: 'vault-id', model: 'text-embedding-3-small', dimensions: 2, tokenizerVersion: 'cl100k',
    fetchImpl: async (requestUrl, options) => {
      url = requestUrl;
      headers = options.headers;
      return { ok: true, headers: { get: () => null }, json: async () => ({
        data: [{ index: 0, embedding: [1, 0] }]
      }) };
    }
  });
  const capability = createEmbeddingCapability({ provider });
  assert.equal(Object.hasOwn(provider, 'apiKey'), false);
  assert.deepEqual(await capability.embed(['hello']), [[1, 0]]);
  assert.equal(url, OPENAI_EMBEDDINGS_URL);
  assert.equal(headers.authorization, 'Bearer test-secret');
});

test('BYOK refuses an unavailable vault secret without a lexical fallback', async () => {
  const provider = createOpenAIByokEmbeddingProvider({
    vault: { get: async () => null }, secretId: 'missing', model: 'text-embedding-3-small',
    dimensions: 2, tokenizerVersion: 'cl100k', fetchImpl: async () => { throw new Error('unreachable'); }
  });
  await assert.rejects(
    () => createEmbeddingCapability({ provider }).embed(['hello']),
    (error) => error.code === 'EMBEDDING_SECRET_UNAVAILABLE'
  );
});
