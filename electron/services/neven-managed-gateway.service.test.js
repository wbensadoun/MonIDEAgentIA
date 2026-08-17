'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  NevenManagedGatewayClient,
  buildGatewayPayload,
  createManagedGatewayCompletion,
  isNevenManagedGatewayEnabled
} = require('./neven-managed-gateway.service');

const access = (token = 'grant', expiresAt = new Date(Date.now() + 60000).toISOString()) => ({ gatewayUrl: 'https://gateway.neven.test', accessToken: token, expiresAt });
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) });

test('gateway payload has no provider and transport is HTTPS allowlisted with main bearer only', async () => {
  let request;
  const client = new NevenManagedGatewayClient({
    allowedHosts: ['gateway.neven.test'],
    fetchImpl: async (url, options) => { request = { url, options }; return response({ text: 'ok' }); }
  });
  const result = await client.complete({ access: access(), workspaceId: 'workspace-1', profile: 'luna', request: { provider: 'claude', systemInstruction: 'system', userPrompt: 'hello' } });
  assert.equal(result.success, true);
  assert.equal(request.url, 'https://gateway.neven.test/v1/gateway/completions');
  assert.equal(request.options.redirect, 'error');
  assert.equal(request.options.headers.Authorization, 'Bearer grant');
  const payload = JSON.parse(request.options.body);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'provider'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload.request, 'provider'), false);
  assert.deepEqual(buildGatewayPayload({ workspaceId: 'workspace-1', request: { provider: 'ignored' } }).request, { systemInstruction: '', userPrompt: '', maxTokens: undefined, temperature: undefined });
});

test('gateway normalizes redirects, expiry and rejected grants without transport details', async () => {
  const client = new NevenManagedGatewayClient({ allowedHosts: ['gateway.neven.test'], fetchImpl: async () => response({}, 401) });
  assert.deepEqual(await client.complete({ access: access(), workspaceId: 'workspace-1' }), {
    success: false, error: { code: 'grant_expired', error: 'Passerelle Neven indisponible.' }
  });
  assert.deepEqual(await client.complete({ access: { ...access(), gatewayUrl: 'http://gateway.neven.test' }, workspaceId: 'workspace-1' }), {
    success: false, error: { code: 'gateway_invalid_request', error: 'Requête managed Neven invalide.' }
  });
  let fetches = 0;
  const expiringClient = new NevenManagedGatewayClient({ allowedHosts: ['gateway.neven.test'], cacheSkewMs: 1000, fetchImpl: async () => { fetches += 1; return response({ text: 'must-not-run' }); } });
  assert.equal((await expiringClient.complete({ access: access('grant', new Date(Date.now() + 500).toISOString()), workspaceId: 'workspace-1' })).error.code, 'grant_expired');
  assert.equal(fetches, 0);
});

test('managed completion retries exactly once after an expired grant and remains disabled by default', async () => {
  let resolves = 0;
  let calls = 0;
  const resolver = async () => access(`grant-${++resolves}`);
  resolver.invalidate = () => {};
  const completion = createManagedGatewayCompletion({
    accessResolver: resolver,
    gatewayClient: { complete: async ({ access: grant }) => {
      calls += 1;
      return grant.accessToken === 'grant-1'
        ? { success: false, error: { code: 'grant_expired' } }
        : { success: true, text: 'retried' };
    } },
    enabled: true
  });
  assert.deepEqual(await completion({ workspaceId: 'workspace-1' }), { success: true, text: 'retried' });
  assert.equal(resolves, 2);
  assert.equal(calls, 2);
  assert.equal(isNevenManagedGatewayEnabled({}), false);
  const disabled = createManagedGatewayCompletion({ accessResolver: resolver, gatewayClient: { complete: async () => { throw new Error('must not run'); } }, enabled: false });
  assert.equal((await disabled({ workspaceId: 'workspace-1' })).error.code, 'managed_disabled');
});

test('a generic gateway 403 is permission denied and never refreshes or retries the grant', async () => {
  let resolves = 0;
  let calls = 0;
  const resolver = async () => access(`grant-${++resolves}`);
  resolver.invalidate = () => { throw new Error('must not invalidate'); };
  const completion = createManagedGatewayCompletion({
    accessResolver: resolver,
    gatewayClient: {
      complete: async () => {
        calls += 1;
        return { success: false, error: { code: 'permission_denied' } };
      }
    },
    enabled: true
  });
  assert.deepEqual(await completion({ workspaceId: 'workspace-1' }), { success: false, error: { code: 'permission_denied' } });
  assert.equal(resolves, 1);
  assert.equal(calls, 1);

  const client = new NevenManagedGatewayClient({ allowedHosts: ['gateway.neven.test'], fetchImpl: async () => response({ code: 'forbidden' }, 403) });
  assert.equal((await client.complete({ access: access(), workspaceId: 'workspace-1' })).error.code, 'permission_denied');
  const expiredClient = new NevenManagedGatewayClient({ allowedHosts: ['gateway.neven.test'], fetchImpl: async () => response({ error: { code: 'grant_expired' } }, 403) });
  assert.equal((await expiredClient.complete({ access: access(), workspaceId: 'workspace-1' })).error.code, 'grant_expired');
});
