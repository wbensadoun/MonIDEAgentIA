'use strict';

const { createEmbeddingCapability } = require('./embedding-capability.service');
const { createOllamaEmbeddingProvider } = require('./ollama-embedding-provider.service');

const readPositiveInteger = (value) => {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

/**
 * Main-process-only catalogue. The renderer receives only metadata through
 * the IPC status handler; it never selects a URL, a credential, or a secret.
 * Ollama is deliberately disabled until all required local configuration is
 * explicit. Remote/BYOK descriptors remain unavailable unless a future
 * main-process provider factory supplies its own vault-bound transport.
 */
const createEmbeddingProviderCatalogue = ({ env = process.env, createOllama = createOllamaEmbeddingProvider } = {}) => {
  const enabled = env.CODE_COMPANION_OLLAMA_EMBEDDINGS_ENABLED === 'true';
  const model = String(env.CODE_COMPANION_OLLAMA_EMBEDDING_MODEL || '').trim();
  const dimensions = readPositiveInteger(env.CODE_COMPANION_OLLAMA_EMBEDDING_DIMENSIONS);
  const tokenizerVersion = String(env.CODE_COMPANION_OLLAMA_EMBEDDING_TOKENIZER || 'ollama-tokenizer-unknown').trim();
  const version = readPositiveInteger(env.CODE_COMPANION_OLLAMA_EMBEDDING_VERSION) || 1;
  let capability = null;
  let unavailableReason = 'disabled-by-default';
  if (enabled && model && dimensions) {
    try {
      capability = createEmbeddingCapability({
        provider: createOllama({
          enabled: true,
          model,
          dimensions,
          tokenizerVersion,
          version,
          baseUrl: env.CODE_COMPANION_OLLAMA_EMBEDDING_BASE_URL
        })
      });
      unavailableReason = null;
    } catch {
      // Invalid local configuration must not degrade to a fake embedding.
      capability = null;
      unavailableReason = 'invalid-local-configuration';
    }
  } else if (enabled) {
    unavailableReason = 'missing-required-local-configuration';
  }
  const metadata = capability?.metadata?.() || null;
  return Object.freeze({
    capability,
    metadata: () => metadata,
    list: () => Object.freeze([Object.freeze({
      providerId: 'ollama',
      kind: 'local',
      enabled: metadata?.enabled === true,
      model: metadata?.model || null,
      dimensions: metadata?.dimensions || null,
      tokenizerVersion: metadata?.tokenizerVersion || null,
      providerVersion: metadata?.providerVersion || null,
      reason: unavailableReason
    })])
  });
};

const createEmbeddingAdapterFromCapability = (capability) => {
  const metadata = capability?.metadata?.();
  if (!metadata || metadata.enabled !== true || typeof capability.embed !== 'function') return null;
  return Object.freeze({
    enabled: true,
    name: `${metadata.providerId}:${metadata.model}`,
    embed: async (query) => {
      const vectors = await capability.embed([query]);
      return vectors[0];
    }
  });
};

module.exports = { createEmbeddingProviderCatalogue, createEmbeddingAdapterFromCapability };
