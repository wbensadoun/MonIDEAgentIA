'use strict';

const { createLocalEmbeddingProvider } = require('./embedding-capability.service');

const DEFAULT_BASE_URL = 'http://127.0.0.1:11434';
const DEFAULT_TIMEOUT_MS = 15000;

const normalizeBaseUrl = (value) => String(value || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');

const assertLocalBaseUrl = (baseUrl) => {
  let parsed;
  try { parsed = new URL(baseUrl); } catch { throw new Error('URL Ollama invalide.'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Protocole Ollama invalide.');
  // A local provider must not become an arbitrary SSRF transport. Remote
  // embedding services belong behind the explicit BYOK provider contract.
  if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(parsed.hostname)) {
    throw new Error('Le provider Ollama doit rester local.');
  }
  return parsed.toString().replace(/\/+$/, '');
};

const readEmbeddings = (data) => {
  if (Array.isArray(data?.embeddings)) return data.embeddings;
  if (Array.isArray(data?.embedding)) return [data.embedding];
  return null;
};

const postOllamaEmbedding = async ({ baseUrl, model, input, signal, timeoutMs, httpClient }) => {
  const url = `${baseUrl}/api/embed`;
  if (httpClient && typeof httpClient.post === 'function') {
    return httpClient.post(url, { model, input }, {
      timeout: timeoutMs,
      signal,
      maxContentLength: 1024 * 1024,
      maxBodyLength: 1024 * 1024
    });
  }
  if (typeof fetch !== 'function') throw new Error('Transport embedding local indisponible.');
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, input }),
      signal: controller.signal
    });
    if (!response.ok) {
      const error = new Error(`Ollama embedding request failed (${response.status})`);
      error.statusCode = response.status;
      error.retryable = response.status === 429 || response.status >= 500;
      throw error;
    }
    return { data: await response.json() };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
};

/**
 * Explicit opt-in local Ollama provider. `dimensions` is required because a
 * vector index cannot safely mix dimensions and this adapter never invents a
 * fallback vector when Ollama is unavailable.
 */
const createOllamaEmbeddingProvider = ({
  enabled = false,
  model,
  dimensions,
  tokenizerVersion = 'ollama-tokenizer-unknown',
  version = 1,
  baseUrl = DEFAULT_BASE_URL,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  httpClient = null
} = {}) => {
  const safeModel = String(model || '').trim();
  if (!safeModel) throw new Error('Modele Ollama embedding requis.');
  const safeBaseUrl = assertLocalBaseUrl(normalizeBaseUrl(baseUrl));
  const safeTimeout = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0
    ? Number(timeoutMs) : DEFAULT_TIMEOUT_MS;
  return createLocalEmbeddingProvider({
    providerId: 'ollama',
    model: safeModel,
    dimensions,
    tokenizerVersion,
    version,
    enabled,
    embedBatch: async (texts, { signal } = {}) => {
      if (enabled !== true) throw new Error('Provider Ollama embedding desactive.');
      const response = await postOllamaEmbedding({
        baseUrl: safeBaseUrl,
        model: safeModel,
        input: texts,
        signal,
        timeoutMs: safeTimeout,
        httpClient
      });
      const embeddings = readEmbeddings(response?.data);
      if (!Array.isArray(embeddings)) throw new Error('Reponse Ollama embedding invalide.');
      return embeddings;
    }
  });
};

module.exports = {
  DEFAULT_BASE_URL,
  assertLocalBaseUrl,
  readEmbeddings,
  postOllamaEmbedding,
  createOllamaEmbeddingProvider
};
