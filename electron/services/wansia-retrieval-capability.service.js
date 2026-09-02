'use strict';

/**
 * Main-process boundary for the optional Wansia retrieval capability.
 *
 * Code Companion must not manufacture a Wansia identity or accept a tenant
 * claim from the renderer.  A real transport is injected by the main process
 * and receives the trusted principal resolved by its authentication layer.
 * With no transport the capability remains disabled and fails closed.
 */

const WANSIA_RETRIEVAL_CONTRACT = 'wansia-retrieval-v1';
const WANSIA_RETRIEVAL_PROTOCOL_VERSION = 1;
const WANSIA_RETRIEVAL_SUPPORTED_VERSIONS = Object.freeze([WANSIA_RETRIEVAL_PROTOCOL_VERSION]);
const MAX_QUERY_LENGTH = 8000;
const MAX_TOP_K = 20;
const MAX_SOURCE_IDS = 100;
const MAX_PASSAGES = 20;
const MAX_PASSAGE_LENGTH = 12000;
const MAX_CITATIONS = 8;
const MAX_SOURCE_NAME_LENGTH = 240;
const MAX_QUOTE_LENGTH = 2000;
const MAX_OFFSET = 10_000_000;

const WANSIA_RETRIEVAL_ERRORS = Object.freeze({
  INVALID_REQUEST: 'WANSIA_RETRIEVAL_INVALID_REQUEST',
  SCOPE_UNAVAILABLE: 'WANSIA_RETRIEVAL_SCOPE_UNAVAILABLE',
  SCOPE_MISMATCH: 'WANSIA_RETRIEVAL_SCOPE_MISMATCH',
  PROTOCOL_UNSUPPORTED: 'WANSIA_RETRIEVAL_PROTOCOL_UNSUPPORTED',
  UNAVAILABLE: 'WANSIA_RETRIEVAL_UNAVAILABLE',
  RESPONSE_INVALID: 'WANSIA_RETRIEVAL_RESPONSE_INVALID'
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_PATTERN = /^[a-f0-9]{64}$/i;
const CITATION_ID_PATTERN = /^[a-f0-9]{32}$/;

class WansiaRetrievalError extends Error {
  constructor(code, message = 'Retrieval Wansia refusé.') {
    super(message);
    this.name = 'WansiaRetrievalError';
    this.code = code;
  }
}

const isPlainObject = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const fail = (code, message) => {
  throw new WansiaRetrievalError(code, message);
};

const assertUuid = (value, code, message) => {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) fail(code, message);
  return value.toLowerCase();
};

const assertHash = (value) => {
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)) {
    fail(WANSIA_RETRIEVAL_ERRORS.RESPONSE_INVALID, 'Hash de citation invalide.');
  }
  return value.toLowerCase();
};

const assertNoUnknownKeys = (value, allowed, code = WANSIA_RETRIEVAL_ERRORS.INVALID_REQUEST) => {
  if (!isPlainObject(value) || Object.keys(value).some((key) => !allowed.has(key))) {
    fail(code, 'Contrat retrieval Wansia invalide.');
  }
};

const normalizeSupportedVersions = (versions) => {
  if (!Array.isArray(versions)) return [];
  return [...new Set(versions.filter((version) => Number.isInteger(version) && version > 0))];
};

const negotiateWansiaRetrievalVersion = (
  peerVersions,
  supportedVersions = WANSIA_RETRIEVAL_SUPPORTED_VERSIONS,
) => {
  const peer = normalizeSupportedVersions(peerVersions);
  const supported = normalizeSupportedVersions(supportedVersions);
  const common = peer.filter((version) => supported.includes(version));
  if (common.length === 0) {
    fail(WANSIA_RETRIEVAL_ERRORS.PROTOCOL_UNSUPPORTED, 'Aucune version retrieval Wansia commune.');
  }
  return Math.max(...common);
};

/**
 * Only the main process may turn an authenticated identity into this scope.
 * Wansia currently uses a user subject as its RAG tenant boundary.
 */
const normalizeTrustedPrincipal = (principal) => {
  if (!isPlainObject(principal)) {
    fail(WANSIA_RETRIEVAL_ERRORS.SCOPE_UNAVAILABLE, 'Identité Wansia indisponible.');
  }
  assertNoUnknownKeys(principal, new Set(['userId']), WANSIA_RETRIEVAL_ERRORS.SCOPE_UNAVAILABLE);
  const userId = assertUuid(
    principal.userId,
    WANSIA_RETRIEVAL_ERRORS.SCOPE_UNAVAILABLE,
    'Identité Wansia invalide.',
  );
  return Object.freeze({ tenantType: 'user', subjectId: userId });
};

/**
 * Strict renderer request. It intentionally has no subjectId, tenantType,
 * workspaceId or scope field. Those are resolved from the trusted principal.
 */
const parseWansiaRetrievalRequest = (payload) => {
  assertNoUnknownKeys(
    payload,
    new Set(['protocolVersion', 'requestId', 'query', 'topK', 'sourceIds', 'includeConversations']),
  );
  if (!Number.isInteger(payload.protocolVersion) || payload.protocolVersion < 1) {
    fail(WANSIA_RETRIEVAL_ERRORS.INVALID_REQUEST, 'Version retrieval invalide.');
  }
  if (typeof payload.requestId !== 'string' || !/^[A-Za-z0-9_.:-]{8,128}$/.test(payload.requestId)) {
    fail(WANSIA_RETRIEVAL_ERRORS.INVALID_REQUEST, 'Identifiant retrieval invalide.');
  }
  const query = typeof payload.query === 'string' ? payload.query.trim() : '';
  if (!query || query.length > MAX_QUERY_LENGTH) {
    fail(WANSIA_RETRIEVAL_ERRORS.INVALID_REQUEST, 'Query retrieval invalide.');
  }
  const topK = payload.topK == null ? 8 : payload.topK;
  if (!Number.isInteger(topK) || topK < 1 || topK > MAX_TOP_K) {
    fail(WANSIA_RETRIEVAL_ERRORS.INVALID_REQUEST, 'topK retrieval invalide.');
  }
  const sourceIds = payload.sourceIds == null ? [] : payload.sourceIds;
  if (!Array.isArray(sourceIds) || sourceIds.length > MAX_SOURCE_IDS) {
    fail(WANSIA_RETRIEVAL_ERRORS.INVALID_REQUEST, 'Sources retrieval invalides.');
  }
  const normalizedSourceIds = [...new Set(sourceIds.map((sourceId) => assertUuid(
    sourceId,
    WANSIA_RETRIEVAL_ERRORS.INVALID_REQUEST,
    'Source retrieval invalide.',
  )))];
  if (payload.includeConversations != null && typeof payload.includeConversations !== 'boolean') {
    fail(WANSIA_RETRIEVAL_ERRORS.INVALID_REQUEST, 'Option conversations invalide.');
  }
  return Object.freeze({
    protocolVersion: payload.protocolVersion,
    requestId: payload.requestId,
    query,
    topK,
    sourceIds: Object.freeze(normalizedSourceIds),
    includeConversations: payload.includeConversations === true
  });
};

const normalizeResponseScope = (value, principal) => {
  if (!isPlainObject(value)) fail(WANSIA_RETRIEVAL_ERRORS.RESPONSE_INVALID, 'Scope retrieval absent.');
  assertNoUnknownKeys(value, new Set(['tenantType', 'subjectId']), WANSIA_RETRIEVAL_ERRORS.RESPONSE_INVALID);
  if (value.tenantType !== principal.tenantType || value.subjectId !== principal.subjectId) {
    fail(WANSIA_RETRIEVAL_ERRORS.SCOPE_MISMATCH, 'Scope retrieval différent de l’utilisateur authentifié.');
  }
  return principal;
};

const normalizePassage = (passage, principal) => {
  if (!isPlainObject(passage)) fail(WANSIA_RETRIEVAL_ERRORS.RESPONSE_INVALID, 'Passage retrieval invalide.');
  assertNoUnknownKeys(
    passage,
    new Set(['id', 'sourceId', 'content', 'score', 'subjectId', 'tenantType']),
    WANSIA_RETRIEVAL_ERRORS.RESPONSE_INVALID,
  );
  if (passage.subjectId !== principal.subjectId || passage.tenantType !== principal.tenantType) {
    fail(WANSIA_RETRIEVAL_ERRORS.SCOPE_MISMATCH, 'Passage retrieval hors scope.');
  }
  if (typeof passage.id !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(passage.id)) {
    fail(WANSIA_RETRIEVAL_ERRORS.RESPONSE_INVALID, 'Identifiant passage invalide.');
  }
  const sourceId = assertUuid(passage.sourceId, WANSIA_RETRIEVAL_ERRORS.RESPONSE_INVALID, 'Source passage invalide.');
  if (typeof passage.content !== 'string' || !passage.content.trim() || passage.content.length > MAX_PASSAGE_LENGTH) {
    fail(WANSIA_RETRIEVAL_ERRORS.RESPONSE_INVALID, 'Contenu passage invalide.');
  }
  if (passage.score != null && !Number.isFinite(passage.score)) {
    fail(WANSIA_RETRIEVAL_ERRORS.RESPONSE_INVALID, 'Score passage invalide.');
  }
  return Object.freeze({
    id: passage.id,
    sourceId,
    content: passage.content,
    ...(passage.score == null ? {} : { score: passage.score })
  });
};

const normalizeCitation = (citation, sourceIds) => {
  if (!isPlainObject(citation)) fail(WANSIA_RETRIEVAL_ERRORS.RESPONSE_INVALID, 'Citation retrieval invalide.');
  assertNoUnknownKeys(
    citation,
    new Set(['id', 'sourceId', 'sourceName', 'sourceHash', 'quoteHash', 'startOffset', 'endOffset', 'quote', 'subjectId', 'tenantType']),
    WANSIA_RETRIEVAL_ERRORS.RESPONSE_INVALID,
  );
  if (citation.subjectId != null || citation.tenantType != null) {
    fail(WANSIA_RETRIEVAL_ERRORS.RESPONSE_INVALID, 'Métadonnées de scope citation inattendues.');
  }
  if (typeof citation.id !== 'string' || !CITATION_ID_PATTERN.test(citation.id)) {
    fail(WANSIA_RETRIEVAL_ERRORS.RESPONSE_INVALID, 'Identifiant citation invalide.');
  }
  const sourceId = assertUuid(citation.sourceId, WANSIA_RETRIEVAL_ERRORS.RESPONSE_INVALID, 'Source citation invalide.');
  if (!sourceIds.has(sourceId)) fail(WANSIA_RETRIEVAL_ERRORS.SCOPE_MISMATCH, 'Citation hors passages retournés.');
  if (typeof citation.sourceName !== 'string' || !citation.sourceName.trim() || citation.sourceName.length > MAX_SOURCE_NAME_LENGTH) {
    fail(WANSIA_RETRIEVAL_ERRORS.RESPONSE_INVALID, 'Nom de source citation invalide.');
  }
  const sourceHash = assertHash(citation.sourceHash);
  const quoteHash = assertHash(citation.quoteHash);
  if (!Number.isInteger(citation.startOffset) || citation.startOffset < 0 || citation.startOffset > MAX_OFFSET
    || !Number.isInteger(citation.endOffset) || citation.endOffset <= citation.startOffset || citation.endOffset > MAX_OFFSET
    || citation.endOffset - citation.startOffset > MAX_QUOTE_LENGTH) {
    fail(WANSIA_RETRIEVAL_ERRORS.RESPONSE_INVALID, 'Offsets citation invalides.');
  }
  if (typeof citation.quote !== 'string' || !citation.quote || citation.quote.length > MAX_QUOTE_LENGTH) {
    fail(WANSIA_RETRIEVAL_ERRORS.RESPONSE_INVALID, 'Extrait citation invalide.');
  }
  return Object.freeze({
    id: citation.id,
    sourceId,
    sourceName: citation.sourceName.trim(),
    sourceHash,
    quoteHash,
    startOffset: citation.startOffset,
    endOffset: citation.endOffset,
    quote: citation.quote
  });
};

const normalizeMetrics = (metrics) => {
  if (metrics == null) return null;
  if (!isPlainObject(metrics)) fail(WANSIA_RETRIEVAL_ERRORS.RESPONSE_INVALID, 'Métriques retrieval invalides.');
  const allowed = new Set([
    'latencyMs', 'candidateCount', 'vectorActive', 'retrievalMode',
    'abstentionThreshold', 'rerankerStatus', 'fallbackUsed'
  ]);
  assertNoUnknownKeys(metrics, allowed, WANSIA_RETRIEVAL_ERRORS.RESPONSE_INVALID);
  const normalized = {};
  for (const [key, value] of Object.entries(metrics)) {
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || value < 0) fail(WANSIA_RETRIEVAL_ERRORS.RESPONSE_INVALID, 'Métrique retrieval invalide.');
      normalized[key] = value;
    } else if (typeof value === 'boolean') {
      normalized[key] = value;
    } else if (typeof value === 'string' && value.length <= 64) {
      normalized[key] = value;
    } else {
      fail(WANSIA_RETRIEVAL_ERRORS.RESPONSE_INVALID, 'Métrique retrieval invalide.');
    }
  }
  return Object.freeze(normalized);
};

const normalizeRetrievalResponse = (response, principal, request) => {
  if (!isPlainObject(response)) fail(WANSIA_RETRIEVAL_ERRORS.RESPONSE_INVALID, 'Réponse retrieval absente.');
  assertNoUnknownKeys(
    response,
    new Set(['scope', 'passages', 'citations', 'abstained', 'abstentionReason', 'metrics']),
    WANSIA_RETRIEVAL_ERRORS.RESPONSE_INVALID,
  );
  normalizeResponseScope(response.scope, principal);
  if (!Array.isArray(response.passages) || response.passages.length > MAX_PASSAGES) {
    fail(WANSIA_RETRIEVAL_ERRORS.RESPONSE_INVALID, 'Passages retrieval invalides.');
  }
  const passages = response.passages.slice(0, request.topK).map((passage) => normalizePassage(passage, principal));
  const passageSourceIds = new Set(passages.map((passage) => passage.sourceId));
  const citationsInput = response.citations == null ? [] : response.citations;
  if (!Array.isArray(citationsInput) || citationsInput.length > MAX_CITATIONS) {
    fail(WANSIA_RETRIEVAL_ERRORS.RESPONSE_INVALID, 'Citations retrieval invalides.');
  }
  const citations = citationsInput.map((citation) => normalizeCitation(citation, passageSourceIds));
  if (response.abstained != null && typeof response.abstained !== 'boolean') {
    fail(WANSIA_RETRIEVAL_ERRORS.RESPONSE_INVALID, 'État abstention retrieval invalide.');
  }
  if (response.abstentionReason != null && typeof response.abstentionReason !== 'string') {
    fail(WANSIA_RETRIEVAL_ERRORS.RESPONSE_INVALID, 'Motif abstention retrieval invalide.');
  }
  const abstained = response.abstained === true;
  if (!abstained && passages.length === 0) {
    fail(WANSIA_RETRIEVAL_ERRORS.RESPONSE_INVALID, 'Réponse sans preuve non abstentionnelle.');
  }
  return Object.freeze({
    contract: WANSIA_RETRIEVAL_CONTRACT,
    protocolVersion: request.protocolVersion,
    requestId: request.requestId,
    scope: principal,
    passages: Object.freeze(passages),
    citations: Object.freeze(citations),
    abstained,
    ...(typeof response.abstentionReason === 'string' ? { abstentionReason: response.abstentionReason.slice(0, 128) } : {}),
    ...(response.metrics == null ? {} : { metrics: normalizeMetrics(response.metrics) })
  });
};

const createWansiaRetrievalCapability = ({
  getPrincipal = null,
  retrieve = null,
  supportedVersions = WANSIA_RETRIEVAL_SUPPORTED_VERSIONS
} = {}) => {
  const supported = Object.freeze(normalizeSupportedVersions(supportedVersions));
  const enabled = typeof getPrincipal === 'function' && typeof retrieve === 'function';
  return Object.freeze({
    metadata: () => Object.freeze({
      contract: WANSIA_RETRIEVAL_CONTRACT,
      supportedVersions: supported,
      enabled
    }),
    negotiate: (peerVersions) => negotiateWansiaRetrievalVersion(peerVersions, supported),
    retrieve: async (payload) => {
      const request = parseWansiaRetrievalRequest(payload);
      negotiateWansiaRetrievalVersion([request.protocolVersion], supported);
      if (!enabled) fail(WANSIA_RETRIEVAL_ERRORS.UNAVAILABLE, 'Transport Wansia retrieval non configuré.');
      let principal;
      try {
        principal = normalizeTrustedPrincipal(await getPrincipal());
      } catch (error) {
        if (error instanceof WansiaRetrievalError) throw error;
        fail(WANSIA_RETRIEVAL_ERRORS.SCOPE_UNAVAILABLE, 'Identité Wansia indisponible.');
      }
      let response;
      try {
        response = await retrieve(Object.freeze({ request, principal }));
      } catch (error) {
        if (error instanceof WansiaRetrievalError) throw error;
        fail(WANSIA_RETRIEVAL_ERRORS.UNAVAILABLE, 'Transport Wansia retrieval indisponible.');
      }
      return normalizeRetrievalResponse(response, principal, request);
    }
  });
};

module.exports = {
  WANSIA_RETRIEVAL_CONTRACT,
  WANSIA_RETRIEVAL_PROTOCOL_VERSION,
  WANSIA_RETRIEVAL_SUPPORTED_VERSIONS,
  WANSIA_RETRIEVAL_ERRORS,
  WansiaRetrievalError,
  parseWansiaRetrievalRequest,
  negotiateWansiaRetrievalVersion,
  normalizeTrustedPrincipal,
  normalizeRetrievalResponse,
  createWansiaRetrievalCapability
};
