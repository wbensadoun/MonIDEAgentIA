'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createOllamaEmbeddingAdapter } = require('./ollama-embedding-adapter.service');

test('Ollama embedding adapter stays disabled without explicit opt-in and model', () => {
  assert.equal(createOllamaEmbeddingAdapter({ enabled: false, model: 'nomic-embed-text', baseUrl: 'http://127.0.0.1:11434' }).enabled, false);
  assert.equal(createOllamaEmbeddingAdapter({ enabled: true, model: '', baseUrl: 'http://127.0.0.1:11434' }).enabled, false);
});

test('Ollama embedding adapter calls the real local embedding endpoint', async () => {
  const requests = [];
  const adapter = createOllamaEmbeddingAdapter({
    enabled: true,
    model: 'nomic-embed-text',
    baseUrl: 'http://127.0.0.1:11434/',
    httpClient: {
      post: async (...args) => {
        requests.push(args);
        return { data: { embeddings: [[0.25, -0.5]] } };
      }
    }
  });
  assert.equal(adapter.enabled, true);
  assert.equal(adapter.name, 'ollama:nomic-embed-text');
  assert.deepEqual(await adapter.embed('semantic query'), [0.25, -0.5]);
  assert.equal(requests[0][0], 'http://127.0.0.1:11434/api/embed');
  assert.deepEqual(requests[0][1], { model: 'nomic-embed-text', input: 'semantic query' });
});

test('Ollama embedding adapter rejects malformed provider output instead of synthesizing a vector', async () => {
  const adapter = createOllamaEmbeddingAdapter({
    enabled: true,
    model: 'nomic-embed-text',
    baseUrl: 'http://127.0.0.1:11434',
    httpClient: { post: async () => ({ data: { embeddings: ['not-a-vector'] } }) }
  });
  await assert.rejects(() => adapter.embed('query'), /response invalid/);
});
