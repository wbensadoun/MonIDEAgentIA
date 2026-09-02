'use strict';

const { createEmbeddingCapability } = require('./embedding-capability.service');
const { createOllamaEmbeddingProvider } = require('./ollama-embedding-provider.service');
const { createOpenAIByokEmbeddingProvider } = require('./openai-byok-embedding-provider.service');
const { getCredentialId } = require('./provider-policy.service');

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
const createEmbeddingProviderCatalogue = ({
  env = process.env,
  vault = null,
  // This is a main-process policy object. A renderer cannot pass it through
  // retrieval IPC, and an enabled completion key never implicitly enables
  // remote indexing.
  userPolicy = {},
  createOllama = createOllamaEmbeddingProvider,
  createOpenAIByok = createOpenAIByokEmbeddingProvider
} = {}) => {
  const enabled = env.CODE_COMPANION_OLLAMA_EMBEDDINGS_ENABLED === 'true';
  const model = String(env.CODE_COMPANION_OLLAMA_EMBEDDING_MODEL || '').trim();
  const dimensions = readPositiveInteger(env.CODE_COMPANION_OLLAMA_EMBEDDING_DIMENSIONS);
  const tokenizerVersion = String(env.CODE_COMPANION_OLLAMA_EMBEDDING_TOKENIZER || 'ollama-tokenizer-unknown').trim();
  const version = readPositiveInteger(env.CODE_COMPANION_OLLAMA_EMBEDDING_VERSION) || 1;
  let capability = null;
  let unavailableReason = 'disabled-by-default';
  const byokEnabled = env.CODE_COMPANION_BYOK_EMBEDDINGS_ENABLED === 'true';
  const byokWorkspaceId = String(env.CODE_COMPANION_BYOK_EMBEDDING_WORKSPACE_ID || '').trim();
  const byokModel = String(env.CODE_COMPANION_BYOK_EMBEDDING_MODEL || '').trim();
  const byokDimensions = readPositiveInteger(env.CODE_COMPANION_BYOK_EMBEDDING_DIMENSIONS);
  const byokTokenizerVersion = String(env.CODE_COMPANION_BYOK_EMBEDDING_TOKENIZER || '').trim();
  const byokVersion = readPositiveInteger(env.CODE_COMPANION_BYOK_EMBEDDING_VERSION) || 1;
  const allowByok = userPolicy.prioritizeUserKeys === true;
  let byokReason = 'disabled-by-default';
  let byokMetadata = null;
  if (byokEnabled && !allowByok) byokReason = 'user-policy-disabled';
  else if (byokEnabled && (!vault || !byokWorkspaceId || !byokModel || !byokDimensions || !byokTokenizerVersion)) {
    byokReason = 'missing-required-byok-configuration';
  } else if (byokEnabled) {
    try {
      const secretId = getCredentialId({ workspaceId: byokWorkspaceId, provider: 'openai' });
      capability = createEmbeddingCapability({
        provider: createOpenAIByok({
          vault,
          secretId,
          model: byokModel,
          dimensions: byokDimensions,
          tokenizerVersion: byokTokenizerVersion,
          version: byokVersion
        })
      });
      byokMetadata = capability.metadata();
      byokReason = null;
    } catch {
      capability = null;
      byokReason = 'invalid-byok-configuration';
    }
  }
  // A user-opted BYOK embedding provider wins. Local Ollama remains an
  // explicit opt-in fallback when BYOK is absent or policy-disabled.
  if (capability) {
    unavailableReason = null;
  } else
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
    list: () => Object.freeze([
      Object.freeze({
        providerId: 'openai', kind: 'byok', enabled: byokMetadata?.enabled === true,
        model: byokMetadata?.model || null, dimensions: byokMetadata?.dimensions || null,
        tokenizerVersion: byokMetadata?.tokenizerVersion || null,
        providerVersion: byokMetadata?.providerVersion || null, reason: byokReason
      }),
      Object.freeze({
        providerId: 'ollama', kind: 'local', enabled: metadata?.providerId === 'ollama' && metadata.enabled === true,
        model: metadata?.providerId === 'ollama' ? metadata.model : null,
        dimensions: metadata?.providerId === 'ollama' ? metadata.dimensions : null,
        tokenizerVersion: metadata?.providerId === 'ollama' ? metadata.tokenizerVersion : null,
        providerVersion: metadata?.providerId === 'ollama' ? metadata.providerVersion : null,
        reason: metadata?.providerId === 'ollama' ? unavailableReason : (enabled ? unavailableReason : 'disabled-by-default')
      })
    ])
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
