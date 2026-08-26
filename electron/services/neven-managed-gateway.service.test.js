'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  NevenManagedGatewayClient,
  buildGatewayPayload,
  createManagedGatewayCompletion,
  isNevenManagedGatewayEnabled
} = require('./neven-managed-gateway.service');

const WORKSPACE_ID = '123e4567-e89b-42d3-a456-426614174000';
const DEVICE_ID = '223e4567-e89b-42d3-a456-426614174000';
const SUBJECT_ID = '423e4567-e89b-42d3-a456-426614174000';
const access = (grant = 'grant-for-cod-34', expiresAt = new Date(Date.now() + 60000).toISOString()) => ({
  workspaceId: WORKSPACE_ID,
  deviceId: DEVICE_ID,
  subjectId: SUBJECT_ID,
  profile: 'luna',
  capability: 'completion',
  gatewayUrl: 'https://api.neven.test/api/v1/gateway',
  grant,
  expiresAt
});
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) });

test('gateway uses the frozen COD-33 route, flat bounded payload and data response', async () => {
  let request;
  const client = new NevenManagedGatewayClient({
    allowedHosts: ['api.neven.test'],
    fetchImpl: async (url, options) => {
      request = { url, options };
      return response({ data: { text: 'ok', usage: { inputTokens: 3 }, provider: 'neven', model: 'server-only' } });
    }
  });
  const result = await client.complete({
    access: access(), workspaceId: WORKSPACE_ID, deviceId: DEVICE_ID, profile: 'luna', mode: 'inline',
    request: {
      history: [{ role: 'user', text: 'old prompt' }], systemInstruction: 'system', userPrompt: 'hello', currentCode: 'const x = 1;',
      provider: 'claude', model: 'forged', apiKey: 'forged', key: 'forged'
    }
  });
  assert.deepEqual(result, { success: true, text: 'ok', usage: { inputTokens: 3 } });
  assert.equal(request.url, 'https://api.neven.test/api/v1/gateway/completions');
  assert.equal(request.options.redirect, 'error');
  assert.equal(request.options.headers.Authorization, 'Bearer grant-for-cod-34');
  assert.deepEqual(JSON.parse(request.options.body), {
    workspaceId: WORKSPACE_ID, deviceId: DEVICE_ID, subjectId: SUBJECT_ID, profile: 'luna', capability: 'completion', mode: 'inline',
    history: [{ role: 'user', content: 'old prompt' }], systemInstruction: 'system', userPrompt: 'hello', currentCode: 'const x = 1;'
  });
});

test('gateway rejects injected provider credentials and malformed modes before any call', async () => {
  let calls = 0;
  const client = new NevenManagedGatewayClient({ allowedHosts: ['api.neven.test'], fetchImpl: async () => { calls += 1; return response({}); } });
  assert.throws(() => buildGatewayPayload({ workspaceId: WORKSPACE_ID, deviceId: DEVICE_ID, subjectId: SUBJECT_ID, request: { userPrompt: 'x', provider: 'claude' } }), /Mode/);
  const result = await client.complete({ access: access(), workspaceId: WORKSPACE_ID, deviceId: DEVICE_ID, mode: 'invalid', request: { userPrompt: 'x', provider: 'claude', apiKey: 'forged' } });
  assert.deepEqual(result, { success: false, error: { code: 'gateway_invalid_request', error: 'Requête managed Neven invalide.' } });
  assert.equal(calls, 0);
});

test('managed gateway retries exactly once after grant_expired without leaking transport data', async () => {
  let resolves = 0;
  const resolver = async () => access(`grant-${++resolves}`);
  let invalidated;
  resolver.invalidate = (value) => { invalidated = value; };
  let calls = 0;
  const completion = createManagedGatewayCompletion({
    accessResolver: resolver,
    gatewayClient: { complete: async ({ access: resolvedAccess, mode }) => {
      calls += 1;
      assert.equal(mode, 'ghost');
      return resolvedAccess.grant === 'grant-1'
        ? { success: false, error: { code: 'grant_expired', error: 'sensitive server detail' } }
        : { success: true, text: 'retried' };
    } },
    enabled: true
  });
  assert.deepEqual(await completion({ workspaceId: WORKSPACE_ID, deviceId: DEVICE_ID, profile: 'luna', mode: 'ghost', request: { userPrompt: 'x' } }), { success: true, text: 'retried' });
  assert.deepEqual(invalidated, { workspaceId: WORKSPACE_ID, deviceId: DEVICE_ID, profile: 'luna', capability: 'completion' });
  assert.equal(resolves, 2);
  assert.equal(calls, 2);
  assert.equal(isNevenManagedGatewayEnabled({}), false);
});

test('gateway errors stay sanitized and expiry avoids network calls', async () => {
  let calls = 0;
  const client = new NevenManagedGatewayClient({
    allowedHosts: ['api.neven.test'], cacheSkewMs: 1000,
    fetchImpl: async () => { calls += 1; return response({ detail: 'sensitive detail' }, 401); }
  });
  assert.deepEqual(await client.complete({ access: access('grant', new Date(Date.now() + 500).toISOString()), workspaceId: WORKSPACE_ID, deviceId: DEVICE_ID, mode: 'chat', request: { userPrompt: 'x' } }), {
    success: false, error: { code: 'grant_expired', error: 'Grant Neven expiré.' }
  });
  assert.equal(calls, 0);
  const rejected = await client.complete({ access: access(), workspaceId: WORKSPACE_ID, deviceId: DEVICE_ID, mode: 'chat', request: { userPrompt: 'x' } });
  assert.deepEqual(rejected, { success: false, error: { code: 'grant_expired', error: 'Passerelle Neven indisponible.' } });
});
