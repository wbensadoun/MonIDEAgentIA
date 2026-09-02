'use strict';

const { createEmbeddingAdapter } = require('./hybrid-rag-retrieval.service');

const DEFAULT_TIMEOUT_MS = 10000;

const normalizeBaseUrl = (value) => String(value || '').trim().replace(/\/+$/, '');
const normalizeModel = (value) => String(value || '').trim();

const readEmbedding = (data) => {
  const embeddings = Array.isArray(data?.embeddings) ? data.embeddings : [];
  if (Array.isArray(embeddings[0])) return embeddings[0];
  return Array.isArray(data?.embedding) ? data.embedding : null;
};

const postEmbeddingRequest = async ({ baseUrl, model, input, timeoutMs, httpClient }) => {
  if (httpClient && typeof httpClient.post === 'function') {
    return httpClient.post(`${baseUrl}/api/embed`, { model, input }, {
      timeout: timeoutMs,
      maxContentLength: 1024 * 1024,
      maxBodyLength: 1024 * 1024
    });
  }
  if (typeof fetch !== 'function') throw new Error('Local embedding transport unavailable');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, input }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Ollama embedding request failed (${response.status})`);
    return { data: await response.json() };
  } finally {
    clearTimeout(timeout);
  }
};

/**
 * This is deliberately main-process only. It calls the real Ollama embedding
 * endpoint and is disabled unless the application owner explicitly enables it.
 * No lexical fingerprint is ever used as an embedding fallback.
 */
const createOllamaEmbeddingAdapter = ({
  enabled = false,
  model = '',
  baseUrl = '',
  httpClient = null,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) => {
  const safeModel = normalizeModel(model);
  const safeBaseUrl = normalizeBaseUrl(baseUrl);
  if (enabled !== true || !safeModel || !safeBaseUrl) {
    return createEmbeddingAdapter();
  }

  return createEmbeddingAdapter({
    name: `ollama:${safeModel}`,
    embed: async (query) => {
      const response = await postEmbeddingRequest({
        baseUrl: safeBaseUrl,
        model: safeModel,
        input: String(query || ''),
        httpClient,
        timeoutMs: Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0
          ? Number(timeoutMs)
          : DEFAULT_TIMEOUT_MS
      });
      const embedding = readEmbedding(response?.data);
      if (!Array.isArray(embedding)) throw new Error('Ollama embedding response invalid');
      return embedding;
    }
  });
};

module.exports = { createOllamaEmbeddingAdapter, readEmbedding, postEmbeddingRequest };
