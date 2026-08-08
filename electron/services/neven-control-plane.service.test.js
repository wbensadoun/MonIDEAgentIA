'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  NevenControlPlaneClient,
  createNevenAccessResolver
} = require('./neven-control-plane.service');

const jsonResponse = (payload, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(payload)
});

test('control plane refuses to operate when no endpoint is configured', async () => {
  const client = new NevenControlPlaneClient({
    baseUrl: '',
    accessTokenResolver: async () => 'session-token',
    fetchImpl: async () => jsonResponse({})
  });

  const result = await client.resolveAccess({ workspaceId: 'workspace-1', profile: 'luna' });
  assert.equal(result.success, false);
  assert.equal(result.code, 'not_configured');
});

test('access resolution sends only a session bearer and returns a short-lived gateway grant', async () => {
  let request;
  const client = new NevenControlPlaneClient({
    baseUrl: 'https://api.neven.test',
    accessTokenResolver: async () => 'session-token',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return jsonResponse({
        granted: true,
        gatewayUrl: 'https://gateway.neven.test',
        accessToken: 'short-lived-grant',
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        scopes: ['completion']
      });
    }
  });

  const result = await client.resolveAccess({ workspaceId: 'workspace-1', profile: 'sol' });
  assert.equal(result.success, true);
  assert.equal(result.access.kind, 'neven-gateway');
  assert.equal(result.access.accessToken, 'short-lived-grant');
  assert.equal(request.url, 'https://api.neven.test/v1/control-plane/access/resolve');
  assert.equal(request.options.headers.Authorization, 'Bearer session-token');
  assert.deepEqual(JSON.parse(request.options.body), {
    workspaceId: 'workspace-1',
    profile: 'sol',
    capability: 'completion'
  });
});

test('resolver caches grants in memory and clears them on revoke', async () => {
  let resolveCount = 0;
  let revokeCount = 0;
  const client = {
    resolveAccess: async () => {
      resolveCount += 1;
      return {
        success: true,
        access: {
          kind: 'neven-gateway',
          workspaceId: 'workspace-1',
          gatewayUrl: 'https://gateway.neven.test',
          accessToken: `grant-${resolveCount}`,
          expiresAt: new Date(Date.now() + 60000).toISOString(),
          scopes: ['completion']
        }
      };
    },
    revokeAccess: async () => {
      revokeCount += 1;
      return { success: true };
    }
  };

  const resolve = createNevenAccessResolver({ client });
  const first = await resolve({ workspaceId: 'workspace-1', profile: 'luna' });
  const cached = await resolve({ workspaceId: 'workspace-1', profile: 'luna' });
  assert.equal(first.accessToken, 'grant-1');
  assert.equal(cached.accessToken, 'grant-1');
  assert.equal(resolveCount, 1);

  await resolve.revoke({ workspaceId: 'workspace-1' });
  const refreshed = await resolve({ workspaceId: 'workspace-1', profile: 'luna' });
  assert.equal(revokeCount, 1);
  assert.equal(refreshed.accessToken, 'grant-2');
  assert.equal(resolveCount, 2);
});

test('invalid grants never become usable access', async () => {
  const client = new NevenControlPlaneClient({
    baseUrl: 'https://api.neven.test',
    accessTokenResolver: async () => 'session-token',
    fetchImpl: async () => jsonResponse({ granted: true, accessToken: 'missing-expiry' })
  });

  const result = await client.resolveAccess({ workspaceId: 'workspace-1' });
  assert.equal(result.success, false);
  assert.equal(result.code, 'invalid_access_response');
});
