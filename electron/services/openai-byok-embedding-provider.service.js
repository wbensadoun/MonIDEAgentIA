'use strict';

const { createByokEmbeddingProvider } = require('./embedding-capability.service');

const OPENAI_EMBEDDINGS_URL = 'https://api.openai.com/v1/embeddings';
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

const toEmbeddingError = (code, message, statusCode = null) => {
  const error = new Error(message);
  error.code = code;
  if (statusCode) error.statusCode = statusCode;
  error.retryable = statusCode === 429 || Number(statusCode) >= 500;
  return error;
};

const readVectors = (data, expectedCount) => {
  if (!Array.isArray(data?.data) || data.data.length !== expectedCount) {
    throw toEmbeddingError('EMBEDDING_INVALID_RESPONSE', 'Reponse embedding BYOK invalide.');
  }
  const ordered = data.data.slice().sort((left, right) => Number(left?.index) - Number(right?.index));
  if (!ordered.every((entry, index) => Number(entry?.index) === index && Array.isArray(entry?.embedding))) {
    throw toEmbeddingError('EMBEDDING_INVALID_RESPONSE', 'Reponse embedding BYOK invalide.');
  }
  return ordered.map((entry) => entry.embedding);
};

/**
 * Only the standard OpenAI HTTPS endpoint is supported in this slice. This is
 * intentionally not a generic renderer-configurable HTTP client: the API key
 * is resolved from the Electron vault immediately before this request.
 */
const createOpenAIByokEmbeddingProvider = ({ vault, secretId, model, dimensions, tokenizerVersion, version = 1, fetchImpl = fetch } = {}) => {
  if (typeof fetchImpl !== 'function') throw new Error('Transport embedding BYOK indisponible.');
  return createByokEmbeddingProvider({
    vault,
    secretId,
    providerId: 'openai',
    model,
    dimensions,
    tokenizerVersion,
    version,
    enabled: true,
    requestBatch: async (texts, { apiKey, signal } = {}) => {
      const response = await fetchImpl(OPENAI_EMBEDDINGS_URL, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ model, input: texts, encoding_format: 'float' }),
        signal
      });
      if (!response.ok) {
        throw toEmbeddingError('EMBEDDING_PROVIDER_REQUEST_FAILED', 'La requete embedding BYOK a echoue.', response.status);
      }
      const contentLength = Number(response.headers?.get?.('content-length'));
      if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
        throw toEmbeddingError('EMBEDDING_INVALID_RESPONSE', 'Reponse embedding BYOK trop volumineuse.');
      }
      return readVectors(await response.json(), texts.length);
    }
  });
};

module.exports = {
  OPENAI_EMBEDDINGS_URL,
  createOpenAIByokEmbeddingProvider,
  readVectors
};
