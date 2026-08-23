'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
process.env.NEVEN_CONTROL_PLANE_ALLOWED_HOSTS = 'api.neven.test,gateway.neven.test';
const {
  NevenControlPlaneClient,
  createNevenAccessResolver,
  normalizeBaseUrl
} = require('./neven-control-plane.service');

const jsonResponse = (payload, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(payload)
});
const WORKSPACE_ID = '123e4567-e89b-42d3-a456-426614174000';
const DEVICE_ID = '223e4567-e89b-42d3-a456-426614174000';
const SECOND_DEVICE_ID = '323e4567-e89b-42d3-a456-426614174000';
const SUBJECT_ID = '423e4567-e89b-42d3-a456-426614174000';
const GRANT = 'grant-for-cod-34';

test('control plane refuses to operate when no endpoint is configured', async () => {
  const client = new NevenControlPlaneClient({
    baseUrl: '',
    accessTokenResolver: async () => 'session-token',
    fetchImpl: async () => jsonResponse({})
  });

  const result = await client.resolveAccess({ workspaceId: WORKSPACE_ID, deviceId: DEVICE_ID, profile: 'luna' });
  assert.equal(result.success, false);
  assert.equal(result.code, 'not_configured');
});

test('control plane disables an unallowlisted legacy remote configuration before a token can be resolved', async () => {
  let tokenRequests = 0;
  const client = new NevenControlPlaneClient({
    baseUrl: 'https://api.neven.test',
    allowedHosts: [],
    eventTokenResolver: async () => { tokenRequests += 1; return 'not-used'; }
  });
  assert.deepEqual(await client.resolveAccess({ workspaceId: WORKSPACE_ID, deviceId: DEVICE_ID }), {
    success: false,
    code: 'not_configured',
    error: 'Control plane Neven non configure.'
  });
  assert.equal(tokenRequests, 0);
});

test('control plane validation still rejects unsafe URLs', () => {
  assert.throws(() => normalizeBaseUrl('http://api.neven.test', 'URL', { allowedHosts: ['api.neven.test'] }), /invalide/);
  assert.throws(() => normalizeBaseUrl('https://untrusted.neven.test', 'URL', { allowedHosts: ['api.neven.test'] }), /invalide/);
  assert.throws(() => normalizeBaseUrl('http://localhost:3000', 'URL', { allowLoopback: false }), /invalide/);
  assert.doesNotThrow(() => normalizeBaseUrl('http://localhost:3000', 'URL', { allowLoopback: true }));
});

test('access resolution uses the COD-33 path/body and unwraps data.grant without exposing a provider credential', async () => {
  let request;
  const client = new NevenControlPlaneClient({
    baseUrl: 'https://api.neven.test',
    accessTokenResolver: async () => 'session-token',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return jsonResponse({ data: { grant: GRANT, subjectId: SUBJECT_ID, expiresAt: new Date(Date.now() + 60000).toISOString() } }, 201);
    }
  });

  const result = await client.resolveAccess({ workspaceId: WORKSPACE_ID, deviceId: DEVICE_ID, profile: 'sol' });
  assert.equal(result.success, true);
  assert.equal(result.access.kind, 'neven-gateway');
  assert.equal(result.access.grant, GRANT);
  assert.equal(result.access.subjectId, SUBJECT_ID);
  assert.equal(result.access.gatewayUrl, 'https://api.neven.test/api/v1/gateway');
  assert.equal(request.url, 'https://api.neven.test/api/v1/control-plane/access/resolve');
  assert.equal(request.options.redirect, 'error');
  assert.equal(request.options.headers.Authorization, 'Bearer session-token');
  assert.deepEqual(JSON.parse(request.options.body), {
    workspaceId: WORKSPACE_ID,
    deviceId: DEVICE_ID,
    profile: 'sol',
    capability: 'completion'
  });
});

test('access resolver caches separately by device and revokes with the exact grant body', async () => {
  let resolveCount = 0;
  let revokeCount = 0;
  const client = {
    resolveAccess: async ({ deviceId }) => {
      resolveCount += 1;
      return {
        success: true,
        access: {
          kind: 'neven-gateway',
          workspaceId: WORKSPACE_ID,
          deviceId,
          subjectId: SUBJECT_ID,
          gatewayUrl: 'https://api.neven.test/api/v1/gateway',
          grant: `grant-${resolveCount}`,
          expiresAt: new Date(Date.now() + 60000).toISOString()
        }
      };
    },
    revokeAccess: async ({ grant }) => {
      revokeCount += 1;
      assert.equal(grant, 'grant-1');
      return { success: true };
    }
  };

  const resolve = createNevenAccessResolver({ client });
  const first = await resolve({ workspaceId: WORKSPACE_ID, deviceId: DEVICE_ID, profile: 'luna' });
  const cached = await resolve({ workspaceId: WORKSPACE_ID, deviceId: DEVICE_ID, profile: 'luna' });
  const otherDevice = await resolve({ workspaceId: WORKSPACE_ID, deviceId: SECOND_DEVICE_ID, profile: 'luna' });
  assert.equal(first.grant, 'grant-1');
  assert.equal(cached.grant, 'grant-1');
  assert.equal(otherDevice.grant, 'grant-2');
  assert.equal(resolveCount, 2);

  await resolve.revoke({ workspaceId: WORKSPACE_ID, deviceId: DEVICE_ID, profile: 'luna' });
  const refreshed = await resolve({ workspaceId: WORKSPACE_ID, deviceId: DEVICE_ID, profile: 'luna' });
  const otherDeviceCached = await resolve({ workspaceId: WORKSPACE_ID, deviceId: SECOND_DEVICE_ID, profile: 'luna' });
  assert.equal(revokeCount, 1);
  assert.equal(refreshed.grant, 'grant-3');
  assert.equal(otherDeviceCached.grant, 'grant-2');
  assert.equal(resolveCount, 3);
});

test('resolver rejects a newly resolved grant inside its expiry safety margin', async () => {
  let resolves = 0;
  const resolve = createNevenAccessResolver({
    cacheSkewMs: 1000,
    client: {
      resolveAccess: async () => ({ success: true, access: {
        kind: 'neven-gateway', workspaceId: WORKSPACE_ID, deviceId: DEVICE_ID, subjectId: SUBJECT_ID,
        gatewayUrl: 'https://api.neven.test/api/v1/gateway', grant: `grant-${++resolves}`, expiresAt: new Date(Date.now() + 500).toISOString()
      } })
    }
  });
  assert.equal(await resolve({ workspaceId: WORKSPACE_ID, deviceId: DEVICE_ID }), null);
  assert.equal(resolves, 1);
});

test('resolver purges local grants before a failing remote revoke', async () => {
  let resolved = 0;
  const resolve = createNevenAccessResolver({ client: {
    resolveAccess: async () => ({ success: true, access: {
      kind: 'neven-gateway', workspaceId: WORKSPACE_ID, deviceId: DEVICE_ID, subjectId: SUBJECT_ID,
      gatewayUrl: 'https://api.neven.test/api/v1/gateway', grant: `grant-${++resolved}`, expiresAt: new Date(Date.now() + 60000).toISOString()
    } }),
    revokeAccess: async () => { throw new Error('offline'); }
  } });
  await resolve({ workspaceId: WORKSPACE_ID, deviceId: DEVICE_ID, profile: 'luna' });
  assert.deepEqual(await resolve.revoke({ workspaceId: WORKSPACE_ID, deviceId: DEVICE_ID, profile: 'luna' }), {
    success: false, code: 'revoke_unavailable', error: 'Révocation Neven indisponible.'
  });
  assert.equal((await resolve({ workspaceId: WORKSPACE_ID, deviceId: DEVICE_ID, profile: 'luna' })).grant, 'grant-2');
});

test('invalid grants never become usable access', async () => {
  const client = new NevenControlPlaneClient({
    baseUrl: 'https://api.neven.test',
    accessTokenResolver: async () => 'session-token',
    fetchImpl: async () => jsonResponse({ data: { grant: GRANT, subjectId: SUBJECT_ID } })
  });

  const result = await client.resolveAccess({ workspaceId: WORKSPACE_ID, deviceId: DEVICE_ID });
  assert.equal(result.success, false);
  assert.equal(result.code, 'invalid_access_response');
});

test('control plane rejects redirects before a bearer can leave the allowlist', async () => {
  let request;
  const client = new NevenControlPlaneClient({
    baseUrl: 'https://api.neven.test',
    accessTokenResolver: async () => 'session-token',
    fetchImpl: async (url, options) => {
      request = { url, options };
      // Un fetch conforme refuse ici la redirection sans jamais contacter cet hôte.
      throw new TypeError('redirect blocked');
    }
  });

  const result = await client.resolveAccess({ workspaceId: WORKSPACE_ID, deviceId: DEVICE_ID });
  assert.equal(request.url, 'https://api.neven.test/api/v1/control-plane/access/resolve');
  assert.equal(request.options.redirect, 'error');
  assert.deepEqual(result, {
    success: false,
    code: 'network_error',
    error: 'Connexion au control plane Neven impossible.'
  });
});

test('access resolution ignores a gateway URL injected into the control-plane response', async () => {
  const client = new NevenControlPlaneClient({
    baseUrl: 'https://api.neven.test',
    allowedHosts: ['api.neven.test'],
    accessTokenResolver: async () => 'session-token',
    fetchImpl: async () => jsonResponse({ data: { grant: GRANT, subjectId: SUBJECT_ID, expiresAt: new Date(Date.now() + 60000).toISOString(), gatewayUrl: 'https://hostile.neven.test' } })
  });

  const result = await client.resolveAccess({ workspaceId: WORKSPACE_ID, deviceId: DEVICE_ID });
  assert.equal(result.success, true);
  assert.equal(result.access.gatewayUrl, 'https://api.neven.test/api/v1/gateway');
});

test('usage events use the internal endpoint, backend-only auth and a bounded normalized payload', async () => {
  let request;
  const client = new NevenControlPlaneClient({
    baseUrl: 'https://api.neven.test',
    accessTokenResolver: async () => 'session-token',
    eventTokenResolver: async () => 'internal-event-token',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return jsonResponse({ accepted: true }, 202);
    }
  });

  const result = await client.publishUsageEvent({
    eventId: 'evt_01HXYZ',
    workspaceId: WORKSPACE_ID,
    origin: 'neven',
    providerId: 'claude',
    inputTokens: 12.8,
    outputTokens: 7,
    durationMs: 42,
    success: true,
    occurredAt: '2026-08-16T10:00:00.000Z',
    prompt: 'must never leave the application',
    response: 'must never leave the application',
    apiKey: 'must never leave the application'
  });

  assert.deepEqual(result, { success: true, status: 202 });
  assert.equal(request.url, 'https://api.neven.test/api/v1/internal/events');
  assert.equal(request.options.headers.Authorization, 'Bearer internal-event-token');
  assert.equal(request.options.headers['Idempotency-Key'], 'evt_01HXYZ');
  assert.deepEqual(JSON.parse(request.options.body), {
    eventId: 'evt_01HXYZ',
    eventType: 'usage.recorded',
    occurredAt: '2026-08-16T10:00:00.000Z',
    workspaceId: WORKSPACE_ID,
    usage: {
      origin: 'neven',
      providerId: 'claude',
      inputTokens: 12,
      outputTokens: 7,
      durationMs: 42,
      success: true
    }
  });
});

test('usage event authorization failures are not verbose', async () => {
  for (const status of [401, 403]) {
    const client = new NevenControlPlaneClient({
      baseUrl: 'https://api.neven.test',
      eventTokenResolver: async () => 'internal-event-token',
      fetchImpl: async () => jsonResponse({ detail: 'sensitive backend detail' }, status)
    });

    const result = await client.publishUsageEvent({
      eventId: `evt-auth-${status}`,
      workspaceId: WORKSPACE_ID,
      origin: 'local'
    });
    assert.deepEqual(result, {
      success: false,
      code: 'auth_failed',
      error: 'Événement Neven non transmis.'
    });
  }
});

test('usage event timeout is bounded and does not expose transport details', async () => {
  const client = new NevenControlPlaneClient({
    baseUrl: 'https://api.neven.test',
    timeoutMs: 1,
    eventTokenResolver: async () => 'internal-event-token',
    fetchImpl: async (_url, { signal }) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => {
        const error = new Error('socket address must not be exposed');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    })
  });

  const result = await client.publishUsageEvent({
    eventId: 'evt-timeout',
    workspaceId: WORKSPACE_ID,
    origin: 'byok'
  });
  assert.deepEqual(result, {
    success: false,
    code: 'timeout',
    error: 'Événement Neven non transmis.'
  });
});

test('usage event validation rejects invalid and oversized values before any request', async () => {
  let calls = 0;
  const client = new NevenControlPlaneClient({
    baseUrl: 'https://api.neven.test',
    eventTokenResolver: async () => 'internal-event-token',
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({});
    }
  });

  for (const event of [
    { eventId: '', workspaceId: WORKSPACE_ID, origin: 'neven' },
    { eventId: 'evt-oversized', workspaceId: WORKSPACE_ID, origin: 'neven', inputTokens: 1000000001 },
    { eventId: 'evt-provider', workspaceId: WORKSPACE_ID, origin: 'neven', providerId: 'prompt-leak' }
  ]) {
    const result = await client.publishUsageEvent(event);
    assert.deepEqual(result, {
      success: false,
      code: 'invalid_usage_event',
      error: 'Événement d’usage Neven invalide.'
    });
  }
  assert.equal(calls, 0);
});
