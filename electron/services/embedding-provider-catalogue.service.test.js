'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createEmbeddingProviderCatalogue, createEmbeddingAdapterFromCapability } = require('./embedding-provider-catalogue.service');

test('embedding catalogue is disabled by default and exposes no secret or endpoint', () => {
  const catalogue = createEmbeddingProviderCatalogue({ env: {} });
  assert.equal(catalogue.capability, null);
  assert.deepEqual(catalogue.list(), [
    {
      providerId: 'openai', kind: 'byok', enabled: false, model: null,
      dimensions: null, tokenizerVersion: null, providerVersion: null, reason: 'disabled-by-default'
    },
    {
      providerId: 'ollama', kind: 'local', enabled: false, model: null,
      dimensions: null, tokenizerVersion: null, providerVersion: null, reason: 'disabled-by-default'
    }
  ]);
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
  assert.equal(catalogue.list()[1].enabled, true);
  assert.equal(Object.hasOwn(catalogue.list()[1], 'baseUrl'), false);
  assert.deepEqual(await adapter.embed('query'), [1, 0]);
});

test('BYOK requires explicit user policy and only exposes safe provider metadata', async () => {
  const optionsSeen = [];
  const catalogue = createEmbeddingProviderCatalogue({
    env: {
      CODE_COMPANION_BYOK_EMBEDDINGS_ENABLED: 'true',
      CODE_COMPANION_BYOK_EMBEDDING_WORKSPACE_ID: 'workspace-a',
      CODE_COMPANION_BYOK_EMBEDDING_MODEL: 'text-embedding-3-small',
      CODE_COMPANION_BYOK_EMBEDDING_DIMENSIONS: '2',
      CODE_COMPANION_BYOK_EMBEDDING_TOKENIZER: 'cl100k_base'
    },
    vault: { get: async (id) => id ? 'vault-only-secret' : null },
    userPolicy: { prioritizeUserKeys: true },
    createOpenAIByok: (options) => {
      optionsSeen.push(options);
      return {
        contract: 'embedding-provider-v1', capabilityVersion: 1, providerId: 'openai',
        model: options.model, dimensions: options.dimensions, tokenizerVersion: options.tokenizerVersion,
        version: options.version, kind: 'byok', enabled: true,
        embedBatch: async (texts) => texts.map(() => [0.5, 0.5])
      };
    }
  });
  const [byok] = catalogue.list();
  assert.equal(byok.enabled, true);
  assert.equal(Object.hasOwn(byok, 'secretId'), false);
  assert.equal(Object.hasOwn(byok, 'baseUrl'), false);
  assert.equal(Object.hasOwn(optionsSeen[0], 'apiKey'), false);
  assert.deepEqual(await createEmbeddingAdapterFromCapability(catalogue.capability).embed('query'), [0.5, 0.5]);

  const denied = createEmbeddingProviderCatalogue({
    env: {
      CODE_COMPANION_BYOK_EMBEDDINGS_ENABLED: 'true',
      CODE_COMPANION_BYOK_EMBEDDING_WORKSPACE_ID: 'workspace-a',
      CODE_COMPANION_BYOK_EMBEDDING_MODEL: 'text-embedding-3-small',
      CODE_COMPANION_BYOK_EMBEDDING_DIMENSIONS: '2',
      CODE_COMPANION_BYOK_EMBEDDING_TOKENIZER: 'cl100k_base'
    },
    vault: { get: async () => 'must-not-be-used' }
  });
  assert.equal(denied.capability, null);
  assert.equal(denied.list()[0].reason, 'user-policy-disabled');
});
