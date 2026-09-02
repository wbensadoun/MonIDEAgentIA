'use strict';

const crypto = require('node:crypto');

// Embeddings are a separate capability from completion providers.  This
// prevents a chat provider (or a lexical fingerprint) from being silently
// treated as a semantic indexer.
const EMBEDDING_CAPABILITY_VERSION = 1;
const EMBEDDING_PROVIDER_CONTRACT = 'embedding-provider-v1';
const MAX_DIMENSIONS = 4096;
const MAX_TEXT_LENGTH = 12000;
const MAX_INPUTS = 10000;
const MAX_BATCH_SIZE = 32;
const MAX_CACHE_ENTRIES = 5000;
const DEFAULT_TIMEOUT_MS = 15000;
const MAX_TIMEOUT_MS = 60000;
const DEFAULT_RETRIES = 2;
const MAX_RETRIES = 4;
const DEFAULT_QUOTA_ITEMS = 10000;
const DEFAULT_QUOTA_CHARS = 20 * 1024 * 1024;
const DEFAULT_QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000;

const embeddingError = (code, message) => {
  const error = new Error(message);
  error.code = code;
  return error;
};

const assertNoRendererSecret = (provider) => {
  for (const key of ['apiKey', 'secret', 'token', 'accessToken', 'ciphertext']) {
    if (Object.prototype.hasOwnProperty.call(provider, key)) {
      throw embeddingError('EMBEDDING_SECRET_BOUNDARY', 'Les secrets embedding restent dans le processus principal.');
    }
  }
};

const validateProviderIdentity = ({ providerId, model, dimensions, tokenizerVersion, version, kind }) => {
  if (typeof providerId !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(providerId)) {
    throw embeddingError('EMBEDDING_PROVIDER_INVALID', 'Provider embedding invalide.');
  }
  if (typeof model !== 'string' || !model.trim() || model.length > 256) {
    throw embeddingError('EMBEDDING_PROVIDER_INVALID', 'Modele embedding invalide.');
  }
  if (!Number.isInteger(dimensions) || dimensions < 1 || dimensions > MAX_DIMENSIONS) {
    throw embeddingError('EMBEDDING_PROVIDER_INVALID', 'Dimensions embedding invalides.');
  }
  if (typeof tokenizerVersion !== 'string' || !tokenizerVersion.trim() || tokenizerVersion.length > 128) {
    throw embeddingError('EMBEDDING_PROVIDER_INVALID', 'Version tokenizer embedding invalide.');
  }
  if (!Number.isInteger(version) || version < 1) {
    throw embeddingError('EMBEDDING_PROVIDER_INVALID', 'Version provider embedding invalide.');
  }
  if (kind !== 'local' && kind !== 'byok') {
    throw embeddingError('EMBEDDING_PROVIDER_INVALID', 'Type provider embedding invalide.');
  }
};

const createEmbeddingProvider = (options = {}) => {
  const {
    providerId,
    model,
    dimensions,
    tokenizerVersion,
    version = EMBEDDING_CAPABILITY_VERSION,
    kind = 'local',
    enabled = false,
    embedBatch
  } = options;
  assertNoRendererSecret(options);
  validateProviderIdentity({ providerId, model, dimensions, tokenizerVersion, version, kind });
  if (typeof embedBatch !== 'function') {
    throw embeddingError('EMBEDDING_PROVIDER_INVALID', 'Le provider embedding ne fournit pas de batch runner.');
  }
  return Object.freeze({
    contract: EMBEDDING_PROVIDER_CONTRACT,
    capabilityVersion: EMBEDDING_CAPABILITY_VERSION,
    providerId,
    model,
    dimensions,
    tokenizerVersion,
    version,
    kind,
    enabled: enabled === true,
    // This function stays in the main process. It is intentionally not
    // exposed as part of public metadata.
    embedBatch
  });
};

const createLocalEmbeddingProvider = (options = {}) => createEmbeddingProvider({ ...options, kind: 'local' });

/**
 * Resolve BYOK credentials only while making a request. `vault` and
 * `requestBatch` must be main-process dependencies; no credential is stored
 * on the returned descriptor or returned by metadata().
 */
const createByokEmbeddingProvider = ({ vault, secretId, requestBatch, ...options } = {}) => {
  if (!vault || typeof vault.get !== 'function' || typeof requestBatch !== 'function') {
    throw embeddingError('EMBEDDING_PROVIDER_INVALID', 'Le provider BYOK embedding est incomplet.');
  }
  const safeSecretId = String(secretId || '').trim();
  if (!safeSecretId || safeSecretId.length > 512 || /[\r\n]/.test(safeSecretId)) {
    throw embeddingError('EMBEDDING_PROVIDER_INVALID', 'Identifiant de secret embedding invalide.');
  }
  return createEmbeddingProvider({
    ...options,
    kind: 'byok',
    embedBatch: async (texts, requestOptions = {}) => {
      const secret = await vault.get(safeSecretId);
      if (!secret) throw embeddingError('EMBEDDING_SECRET_UNAVAILABLE', 'Secret embedding indisponible.');
      return requestBatch(texts, { ...requestOptions, apiKey: secret });
    }
  });
};

class EmbeddingCache {
  constructor({ maxEntries = MAX_CACHE_ENTRIES } = {}) {
    this.maxEntries = Math.max(1, Math.min(MAX_CACHE_ENTRIES, Number(maxEntries) || MAX_CACHE_ENTRIES));
    this.entries = new Map();
  }

  get(key) {
    if (!this.entries.has(key)) return null;
    const value = this.entries.get(key);
    this.entries.delete(key);
    this.entries.set(key, value);
    return value.slice();
  }

  set(key, vector) {
    if (this.entries.has(key)) this.entries.delete(key);
    this.entries.set(key, vector.slice());
    while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value);
  }

  clear() { this.entries.clear(); }
  get size() { return this.entries.size; }
}

class EmbeddingQuota {
  constructor({
    maxItems = DEFAULT_QUOTA_ITEMS,
    maxChars = DEFAULT_QUOTA_CHARS,
    windowMs = DEFAULT_QUOTA_WINDOW_MS,
    now = () => Date.now()
  } = {}) {
    this.maxItems = Math.max(1, Number(maxItems) || DEFAULT_QUOTA_ITEMS);
    this.maxChars = Math.max(1, Number(maxChars) || DEFAULT_QUOTA_CHARS);
    this.windowMs = Math.max(0, Number(windowMs) || DEFAULT_QUOTA_WINDOW_MS);
    this.now = now;
    this.windowStartedAt = this.now();
    this.usedItems = 0;
    this.usedChars = 0;
  }

  _resetIfNeeded() {
    const current = this.now();
    if (this.windowMs > 0 && current - this.windowStartedAt >= this.windowMs) {
      this.windowStartedAt = current;
      this.usedItems = 0;
      this.usedChars = 0;
    }
  }

  consume(items, chars) {
    this._resetIfNeeded();
    if (this.usedItems + items > this.maxItems || this.usedChars + chars > this.maxChars) {
      throw embeddingError('EMBEDDING_QUOTA_EXCEEDED', 'Quota embedding depasse.');
    }
    this.usedItems += items;
    this.usedChars += chars;
  }

  snapshot() {
    this._resetIfNeeded();
    return Object.freeze({
      usedItems: this.usedItems,
      usedChars: this.usedChars,
      maxItems: this.maxItems,
      maxChars: this.maxChars,
      windowStartedAt: this.windowStartedAt,
      capturedAt: this.now()
    });
  }
}

const cacheKey = (provider, text) => crypto.createHash('sha256')
  .update(JSON.stringify({
    capabilityVersion: EMBEDDING_CAPABILITY_VERSION,
    contract: provider.contract,
    providerId: provider.providerId,
    model: provider.model,
    dimensions: provider.dimensions,
    tokenizerVersion: provider.tokenizerVersion,
    providerVersion: provider.version,
    // The digest is content-addressed and prevents stale vectors after model
    // or parser changes without retaining raw text in the cache key.
    inputHash: crypto.createHash('sha256').update(text).digest('hex')
  }))
  .digest('hex');

const normalizeTexts = (texts) => {
  if (!Array.isArray(texts) || texts.length === 0 || texts.length > MAX_INPUTS) {
    throw embeddingError('EMBEDDING_INPUT_INVALID', 'Batch embedding invalide.');
  }
  return texts.map((text) => {
    if (typeof text !== 'string') throw embeddingError('EMBEDDING_INPUT_INVALID', 'Texte embedding invalide.');
    const normalized = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ').trim();
    if (!normalized || normalized.length > MAX_TEXT_LENGTH) {
      throw embeddingError('EMBEDDING_INPUT_INVALID', 'Texte embedding invalide.');
    }
    return normalized;
  });
};

const validateVectors = (vectors, provider, expectedCount) => {
  if (!Array.isArray(vectors) || vectors.length !== expectedCount) {
    throw embeddingError('EMBEDDING_INVALID_RESPONSE', 'Reponse embedding invalide.');
  }
  return vectors.map((vector) => {
    if (!Array.isArray(vector) || vector.length !== provider.dimensions
      || !vector.every((component) => Number.isFinite(component))) {
      throw embeddingError('EMBEDDING_INVALID_RESPONSE', 'Dimensions embedding invalides.');
    }
    return vector.slice();
  });
};

const sleepWithSignal = (delayMs, signal, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))) => {
  if (signal?.aborted) return Promise.reject(embeddingError('EMBEDDING_CANCELLED', 'Embedding annule.'));
  return new Promise((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      reject(embeddingError('EMBEDDING_CANCELLED', 'Embedding annule.'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(sleep(delayMs)).then(() => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, reject);
  });
};

const runWithTimeout = async (operation, timeoutMs, signal) => {
  if (signal?.aborted) throw embeddingError('EMBEDDING_CANCELLED', 'Embedding annule.');
  const controller = new AbortController();
  let timer;
  let rejectAbort;
  const onAbort = () => {
    controller.abort();
    rejectAbort?.();
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  const aborted = new Promise((_, reject) => {
    rejectAbort = () => reject(embeddingError('EMBEDDING_CANCELLED', 'Embedding annule.'));
  });
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(embeddingError('EMBEDDING_TIMEOUT', 'Timeout embedding.'));
    }, timeoutMs);
  });
  try {
    const result = await Promise.race([Promise.resolve().then(() => operation(controller.signal)), timeout, aborted]);
    if (signal?.aborted) throw embeddingError('EMBEDDING_CANCELLED', 'Embedding annule.');
    return result;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
};

const isRetryable = (error) => error?.retryable === true
  || error?.code === 'ETIMEDOUT'
  || error?.code === 'ECONNRESET'
  || error?.code === 'EMBEDDING_TIMEOUT'
  || Number(error?.statusCode) === 429
  || Number(error?.statusCode) >= 500;

const createEmbeddingCapability = ({
  provider,
  cache = new EmbeddingCache(),
  quota = new EmbeddingQuota(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  retries = DEFAULT_RETRIES,
  sleep
} = {}) => {
  if (!provider || provider.contract !== EMBEDDING_PROVIDER_CONTRACT) {
    throw embeddingError('EMBEDDING_PROVIDER_INVALID', 'Contrat provider embedding requis.');
  }
  const boundedTimeout = Math.min(MAX_TIMEOUT_MS, Math.max(1, Number(timeoutMs) || DEFAULT_TIMEOUT_MS));
  const boundedRetries = Math.min(MAX_RETRIES, Math.max(0, Number(retries) || 0));
  const publicMetadata = Object.freeze({
    capabilityVersion: EMBEDDING_CAPABILITY_VERSION,
    contract: provider.contract,
    providerId: provider.providerId,
    model: provider.model,
    dimensions: provider.dimensions,
    tokenizerVersion: provider.tokenizerVersion,
    providerVersion: provider.version,
    kind: provider.kind,
    enabled: provider.enabled === true
  });

  const embed = async (texts, { signal } = {}) => {
    if (provider.enabled !== true) throw embeddingError('EMBEDDING_DISABLED', 'Provider embedding desactive.');
    const normalized = normalizeTexts(texts);
    const output = Array(normalized.length);
    const pending = new Map();
    for (let index = 0; index < normalized.length; index += 1) {
      const key = cacheKey(provider, normalized[index]);
      const cached = cache.get(key);
      if (cached) output[index] = cached;
      else if (!pending.has(key)) pending.set(key, { text: normalized[index], indexes: [index], key });
      else pending.get(key).indexes.push(index);
    }
    if (pending.size === 0) return output;
    const requests = [...pending.values()];
    quota.consume(requests.length, requests.reduce((total, item) => total + item.text.length, 0));
    for (let offset = 0; offset < requests.length; offset += MAX_BATCH_SIZE) {
      if (signal?.aborted) throw embeddingError('EMBEDDING_CANCELLED', 'Embedding annule.');
      const batch = requests.slice(offset, offset + MAX_BATCH_SIZE);
      let vectors;
      for (let attempt = 0; ; attempt += 1) {
        try {
          vectors = validateVectors(
            await runWithTimeout(
              (requestSignal) => provider.embedBatch(batch.map((item) => item.text), { signal: requestSignal }),
              boundedTimeout,
              signal
            ),
            provider,
            batch.length
          );
          break;
        } catch (error) {
          if (signal?.aborted || error?.code === 'EMBEDDING_CANCELLED') {
            throw embeddingError('EMBEDDING_CANCELLED', 'Embedding annule.');
          }
          if (attempt >= boundedRetries || !isRetryable(error)) throw error;
          await sleepWithSignal(Math.min(5000, 250 * (2 ** attempt)), signal, sleep);
        }
      }
      for (let index = 0; index < batch.length; index += 1) {
        const item = batch[index];
        cache.set(item.key, vectors[index]);
        for (const outputIndex of item.indexes) output[outputIndex] = vectors[index].slice();
      }
    }
    return output;
  };

  return Object.freeze({
    metadata: () => publicMetadata,
    embed,
    quota: () => quota.snapshot(),
    cache: () => Object.freeze({ entries: cache.size })
  });
};

module.exports = {
  EMBEDDING_CAPABILITY_VERSION,
  EMBEDDING_PROVIDER_CONTRACT,
  MAX_DIMENSIONS,
  MAX_BATCH_SIZE,
  MAX_CACHE_ENTRIES,
  EmbeddingCache,
  EmbeddingQuota,
  createEmbeddingProvider,
  createLocalEmbeddingProvider,
  createByokEmbeddingProvider,
  createEmbeddingCapability,
  cacheKey,
  validateVectors
};
