'use strict';

const path = require('path');
const {
  RETRIEVAL_SCOPE_ERRORS,
  formatUntrustedRetrievedContext
} = require('./retrieval-scope.service');

// `readScopedIndexes` already limits the trusted on-disk data it returns. Do
// not apply a lexical candidate cut here: a chunk can be semantically relevant
// while having no lexical overlap with the query.
const MAX_HYBRID_CANDIDATES = 200;
const MAX_HYBRID_TOP_K = 20;
const MAX_HYBRID_CONTEXT_LENGTH = 60000;
const MAX_EMBEDDING_DIMENSIONS = 4096;

const isOpaqueProjectId = (value) => typeof value === 'string'
  && /^[A-Za-z0-9_-]{16,128}$/.test(value);

const queryTokens = (query) => [...new Set(String(query || '').toLowerCase()
  .split(/[^\p{L}\p{N}_.$/-]+/u)
  .map((token) => token.trim())
  .filter((token) => token.length >= 2))];

const lexicalScore = (text, tokens) => {
  const normalized = String(text || '').toLowerCase();
  return tokens.reduce((score, token) => score + (normalized.includes(token) ? 1 : 0), 0);
};

const normalizePath = (value) => String(value || '').replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();

const exactPathScore = (filePath, query) => {
  const candidate = normalizePath(filePath);
  const requested = normalizePath(query).replace(/^\/+|\/+$/g, '');
  if (!candidate || !requested) return 0;
  if (candidate === requested) return 100;
  if (path.posix.basename(candidate) === requested) return 70;
  return 0;
};

const escapeRegExp = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const exactSymbolScore = (entry, query) => {
  const requested = String(query || '').trim();
  if (!/^[A-Za-z_$][\w$]*$/.test(requested)) return 0;
  const symbols = Array.isArray(entry?.symbols) ? entry.symbols : [];
  if (symbols.some((symbol) => symbol === requested)) return 90;
  if (symbols.some((symbol) => String(symbol).toLowerCase() === requested.toLowerCase())) return 80;
  const tokenPattern = new RegExp(`\\b${escapeRegExp(requested)}\\b`);
  return tokenPattern.test(String(entry?.text || '')) ? 20 : 0;
};

const validVector = (value) => Array.isArray(value)
  && value.length > 0
  && value.length <= MAX_EMBEDDING_DIMENSIONS
  && value.every((component) => Number.isFinite(component))
  && value.some((component) => component !== 0);

const cosineSimilarity = (left, right) => {
  if (!validVector(left) || !validVector(right) || left.length !== right.length) return null;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }
  if (!leftNorm || !rightNorm) return null;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
};

/**
 * Embedding is deliberately opt-in. The local index's lexicalFingerprint is
 * not a semantic vector and is never accepted by this adapter. A real local
 * embedding runtime can be injected by the main process when available.
 */
const createEmbeddingAdapter = ({ name = 'unconfigured', embed = null } = {}) => {
  if (typeof embed !== 'function') {
    return Object.freeze({
      enabled: false,
      name: 'none',
      reason: 'no-local-embedding-adapter'
    });
  }
  return Object.freeze({
    enabled: true,
    name: String(name || 'local-embedding').slice(0, 64),
    embed
  });
};

const ensureScope = (scope) => {
  if (!scope || !scope.currentProject || !isOpaqueProjectId(scope.currentProject.projectId)) {
    const error = new Error(RETRIEVAL_SCOPE_ERRORS.NO_AUTHORIZED_PROJECT);
    error.code = RETRIEVAL_SCOPE_ERRORS.NO_AUTHORIZED_PROJECT;
    throw error;
  }
  return scope;
};

const readCandidateVector = (entry) => {
  // Only a future true semantic embedding is valid here. In particular,
  // lexicalFingerprint and legacy vector fields are intentionally ignored.
  return validVector(entry?.embedding) ? entry.embedding
    : (validVector(entry?.semanticEmbedding) ? entry.semanticEmbedding : null);
};

const rankHybridResults = async (scope, retrievalData, { embeddingAdapter = null } = {}) => {
  ensureScope(scope);
  const indexes = Array.isArray(retrievalData?.indexes) ? retrievalData.indexes : [];
  const candidates = indexes.flatMap((index) => Array.isArray(index?.entries)
    ? index.entries.map((entry) => ({ ...entry, projectKind: index.projectKind }))
    : []).slice(0, MAX_HYBRID_CANDIDATES);
  const tokens = queryTokens(scope.query);
  const adapter = embeddingAdapter && embeddingAdapter.enabled === true
    && typeof embeddingAdapter.embed === 'function'
    ? embeddingAdapter
    : createEmbeddingAdapter();
  const vectorCandidates = candidates.filter((entry) => readCandidateVector(entry));
  let queryVector = null;
  let embeddingUnavailable = false;
  if (adapter.enabled && vectorCandidates.length > 0) {
    try {
      const generated = await adapter.embed(scope.query);
      queryVector = validVector(generated) ? generated : null;
    } catch {
      embeddingUnavailable = true;
      queryVector = null;
    }
  }

  const ranked = candidates.map((entry) => {
    const lexical = lexicalScore(entry.text, tokens);
    const pathMatch = exactPathScore(entry.filePath, scope.query);
    const symbolMatch = exactSymbolScore(entry, scope.query);
    const vector = queryVector && readCandidateVector(entry)
      ? (cosineSimilarity(queryVector, readCandidateVector(entry)) || 0)
      : 0;
    return {
      ...entry,
      lexicalScore: lexical,
      exactPathScore: pathMatch,
      exactSymbolScore: symbolMatch,
      vectorScore: vector,
      rankScore: lexical + pathMatch + symbolMatch + (vector > 0 ? vector * 10 : 0)
    };
  }).filter((entry) => entry.rankScore > 0)
    .sort((left, right) => right.rankScore - left.rankScore
      || String(left.filePath).localeCompare(String(right.filePath)));
  const topK = Number.isInteger(scope.topK)
    ? Math.min(Math.max(scope.topK, 1), MAX_HYBRID_TOP_K)
    : 1;
  const selected = ranked.slice(0, topK);
  const vectorActive = queryVector !== null && vectorCandidates.length > 0;
  const mode = vectorActive ? 'hybrid' : 'lexical-fallback';
  const routeReason = vectorActive
    ? 'semantic-embedding-adapter-and-index-vectors-available'
    : (embeddingUnavailable ? 'embedding-query-unavailable'
      : (adapter.enabled ? 'index-has-no-semantic-vectors' : 'no-local-embedding-adapter'));
  const context = formatUntrustedRetrievedContext(selected).slice(0, MAX_HYBRID_CONTEXT_LENGTH);
  return Object.freeze({
    retrievalMode: mode,
    routing: Object.freeze({ mode, reason: routeReason }),
    vector: Object.freeze({
      enabled: adapter.enabled,
      active: vectorActive,
      adapter: adapter.name
    }),
    results: Object.freeze(selected.map((entry) => Object.freeze(entry))),
    context,
    retrievalStatus: selected.length > 0 ? 'evidence-found' : 'abstained'
  });
};

module.exports = {
  MAX_HYBRID_CANDIDATES,
  MAX_HYBRID_TOP_K,
  MAX_HYBRID_CONTEXT_LENGTH,
  createEmbeddingAdapter,
  cosineSimilarity,
  exactPathScore,
  exactSymbolScore,
  rankHybridResults
};
