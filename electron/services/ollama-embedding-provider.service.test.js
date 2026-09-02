'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  assertLocalBaseUrl,
  createOllamaEmbeddingProvider
} = require('./ollama-embedding-provider.service');
const { createEmbeddingCapability } = require('./embedding-capability.service');

test('Ollama provider is local-only and requires a real model and dimension', () => {
  assert.throws(() => assertLocalBaseUrl('https://example.com'), /doit rester local/);
  assert.throws(() => createOllamaEmbeddingProvider({ model: 'nomic-embed-text' }), /Dimensions/);
  const provider = createOllamaEmbeddingProvider({ model: 'nomic-embed-text', dimensions: 2 });
  assert.equal(provider.enabled, false);
});

test('Ollama provider sends a real batch request and preserves dimensions', async () => {
  const requests = [];
  const provider = createOllamaEmbeddingProvider({
    enabled: true,
    model: 'nomic-embed-text',
    dimensions: 2,
    baseUrl: 'http://127.0.0.1:11434/',
    httpClient: {
      post: async (...args) => {
        requests.push(args);
        return { data: { embeddings: [[0.25, -0.5], [0.1, 0.2]] } };
      }
    }
  });
  const capability = createEmbeddingCapability({ provider });
  assert.deepEqual(await capability.embed(['one', 'two']), [[0.25, -0.5], [0.1, 0.2]]);
  assert.equal(requests[0][0], 'http://127.0.0.1:11434/api/embed');
  assert.deepEqual(requests[0][1], { model: 'nomic-embed-text', input: ['one', 'two'] });
  assert.equal(requests[0][2].signal instanceof AbortSignal, true);
});

test('malformed Ollama output fails closed instead of synthesizing a vector', async () => {
  const provider = createOllamaEmbeddingProvider({
    enabled: true, model: 'nomic-embed-text', dimensions: 2,
    httpClient: { post: async () => ({ data: { embeddings: ['not-a-vector'] } }) }
  });
  const capability = createEmbeddingCapability({ provider });
  await assert.rejects(() => capability.embed(['query']), (error) => error.code === 'EMBEDDING_INVALID_RESPONSE');
});
