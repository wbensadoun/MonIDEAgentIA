'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createEmbeddingProviderCatalogue, createEmbeddingAdapterFromCapability } = require('./embedding-provider-catalogue.service');

test('embedding catalogue is disabled by default and exposes no secret or endpoint', () => {
  const catalogue = createEmbeddingProviderCatalogue({ env: {} });
  assert.equal(catalogue.capability, null);
  assert.deepEqual(catalogue.list(), [{
    providerId: 'ollama', kind: 'local', enabled: false, model: null,
    dimensions: null, tokenizerVersion: null, providerVersion: null, reason: 'disabled-by-default'
  }]);
});

test('explicit Ollama configuration creates a main-only semantic adapter', async () => {
  const catalogue = createEmbeddingProviderCatalogue({
    env: {
      CODE_COMPANION_OLLAMA_EMBEDDINGS_ENABLED: 'true',
      CODE_COMPANION_OLLAMA_EMBEDDING_MODEL: 'embed-local',
      CODE_COMPANION_OLLAMA_EMBEDDING_DIMENSIONS: '2'
    },
    createOllama: (options) => ({
      contract: 'embedding-provider-v1', capabilityVersion: 1, providerId: 'ollama',
      model: options.model, dimensions: options.dimensions, tokenizerVersion: options.tokenizerVersion,
      version: options.version, kind: 'local', enabled: true,
      embedBatch: async (texts) => texts.map(() => [1, 0])
    })
  });
  const adapter = createEmbeddingAdapterFromCapability(catalogue.capability);
  assert.equal(catalogue.list()[0].enabled, true);
  assert.equal(Object.hasOwn(catalogue.list()[0], 'baseUrl'), false);
  assert.deepEqual(await adapter.embed('query'), [1, 0]);
});
