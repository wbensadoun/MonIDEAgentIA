'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  WANSIA_RETRIEVAL_ERRORS,
  createWansiaRetrievalCapability,
  negotiateWansiaRetrievalVersion,
  parseWansiaRetrievalRequest
} = require('./wansia-retrieval-capability.service');

const USER_ID = '11111111-1111-4111-8111-111111111111';
const SOURCE_ID = '22222222-2222-4222-8222-222222222222';
const validRequest = () => ({
  protocolVersion: 1,
  requestId: 'wan21-request-1',
  query: 'contrat',
  topK: 4,
  sourceIds: [SOURCE_ID]
});

const validResponse = (subjectId = USER_ID) => ({
  scope: { tenantType: 'user', subjectId },
  passages: [{
    id: 'passage-1',
    sourceId: SOURCE_ID,
    content: 'Le contrat est disponible.',
    score: 0.9,
    tenantType: 'user',
    subjectId
  }],
  citations: [{
    id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    sourceId: SOURCE_ID,
    sourceName: 'contrat.pdf',
    sourceHash: 'a'.repeat(64),
    quoteHash: 'b'.repeat(64),
    startOffset: 0,
    endOffset: 10,
    quote: 'Le contrat'
  }]
});

test('version negotiation chooses highest common version and fails closed without overlap', () => {
  assert.equal(negotiateWansiaRetrievalVersion([1, 3], [1, 2]), 1);
  assert.throws(() => negotiateWansiaRetrievalVersion([2], [1]), (error) => error.code === WANSIA_RETRIEVAL_ERRORS.PROTOCOL_UNSUPPORTED);
});

test('renderer cannot forge a Wansia tenant or scope', () => {
  assert.throws(() => parseWansiaRetrievalRequest({ ...validRequest(), subjectId: USER_ID }), (error) => error.code === WANSIA_RETRIEVAL_ERRORS.INVALID_REQUEST);
  assert.throws(() => parseWansiaRetrievalRequest({ ...validRequest(), scope: { tenantType: 'user', subjectId: USER_ID } }), (error) => error.code === WANSIA_RETRIEVAL_ERRORS.INVALID_REQUEST);
});

test('retrieval passes only a trusted principal to the transport and strips internal scope claims', async () => {
  let received;
  const capability = createWansiaRetrievalCapability({
    getPrincipal: async () => ({ userId: USER_ID }),
    retrieve: async (request) => {
      received = request;
      return validResponse();
    }
  });
  const result = await capability.retrieve(validRequest());
  assert.equal(received.principal.subjectId, USER_ID);
  assert.equal(received.request.scope, undefined);
  assert.equal(result.scope.subjectId, USER_ID);
  assert.equal(result.passages[0].subjectId, undefined);
  assert.equal(result.citations[0].sourceId, SOURCE_ID);
});

test('missing identity and cross-tenant responses fail closed', async () => {
  const noIdentity = createWansiaRetrievalCapability({
    getPrincipal: async () => null,
    retrieve: async () => validResponse()
  });
  await assert.rejects(() => noIdentity.retrieve(validRequest()), (error) => error.code === WANSIA_RETRIEVAL_ERRORS.SCOPE_UNAVAILABLE);

  const crossTenant = createWansiaRetrievalCapability({
    getPrincipal: async () => ({ userId: USER_ID }),
    retrieve: async () => validResponse('33333333-3333-4333-8333-333333333333')
  });
  await assert.rejects(() => crossTenant.retrieve(validRequest()), (error) => error.code === WANSIA_RETRIEVAL_ERRORS.SCOPE_MISMATCH);
});

test('invalid citation/source data is rejected instead of being shown as verified evidence', async () => {
  const capability = createWansiaRetrievalCapability({
    getPrincipal: async () => ({ userId: USER_ID }),
    retrieve: async () => ({
      ...validResponse(),
      citations: [{ ...validResponse().citations[0], sourceId: '44444444-4444-4444-8444-444444444444' }]
    })
  });
  await assert.rejects(() => capability.retrieve(validRequest()), (error) => error.code === WANSIA_RETRIEVAL_ERRORS.SCOPE_MISMATCH);
});

test('unexpected response metrics are rejected instead of crossing the IPC boundary', async () => {
  const capability = createWansiaRetrievalCapability({
    getPrincipal: async () => ({ userId: USER_ID }),
    retrieve: async () => ({ ...validResponse(), metrics: { apiKey: 'must-not-cross' } })
  });
  await assert.rejects(() => capability.retrieve(validRequest()), (error) => error.code === WANSIA_RETRIEVAL_ERRORS.RESPONSE_INVALID);
});

test('an unconfigured capability is explicit and unavailable, never a fake retrieval', async () => {
  const capability = createWansiaRetrievalCapability();
  assert.equal(capability.metadata().enabled, false);
  await assert.rejects(() => capability.retrieve(validRequest()), (error) => error.code === WANSIA_RETRIEVAL_ERRORS.UNAVAILABLE);
});
