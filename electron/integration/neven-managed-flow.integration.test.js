'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const test = require('node:test');

test('managed main-process harness resolves through the local gateway without provider metadata leakage', () => {
  const script = String.raw`
    const assert = require('node:assert/strict');
    const Module = require('node:module');
    const path = require('node:path');
    const electronId = path.join(process.cwd(), '.managed-harness-electron.js');
    const axiosId = path.join(process.cwd(), '.managed-harness-axios.js');
    const anthropicId = path.join(process.cwd(), '.managed-harness-anthropic.js');
    const resolveFilename = Module._resolveFilename;
    Module._resolveFilename = function(request, parent, isMain, options) {
      if (request === 'electron') return electronId;
      if (request === 'axios') return axiosId;
      if (request === '@anthropic-ai/sdk') return anthropicId;
      return resolveFilename.call(this, request, parent, isMain, options);
    };
    require.cache[electronId] = {
      id: electronId,
      filename: electronId,
      loaded: true,
      exports: { ipcMain: { handle() {} }, dialog: { showErrorBox() {} }, app: { getPath: () => 'C:/codex-test-user-data' } }
    };
    require.cache[axiosId] = { id: axiosId, filename: axiosId, loaded: true, exports: { post: async () => { throw new Error('adapter must not run'); } } };
    require.cache[anthropicId] = { id: anthropicId, filename: anthropicId, loaded: true, exports: class Anthropic {} };

    const { registerAIHandlers } = require('./electron/ipc/aiHandlers');
    const { configureAIService } = require('./electron/services/ai.service');
    const { NevenControlPlaneClient, createNevenAccessResolver } = require('./electron/services/neven-control-plane.service');
    const { NevenManagedGatewayClient, createManagedGatewayCompletion } = require('./electron/services/neven-managed-gateway.service');

    const workspaceId = '123e4567-e89b-42d3-a456-426614174000';
    const deviceId = '223e4567-e89b-42d3-a456-426614174000';
    const subjectId = '423e4567-e89b-42d3-a456-426614174000';
    const rendererPrompt = 'réponds localement';
    const rendererSensitiveValues = ['renderer-provider', 'renderer-model', 'renderer-grant', 'renderer-hidden-value'];
    const capturedLogs = [];
    for (const level of ['log', 'warn', 'error']) {
      console[level] = (...values) => capturedLogs.push({ level, values: values.map((value) => String(value)) });
    }
    const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) });
    const assertRendererSafe = (result) => {
      for (const forbidden of ['provider', 'model', 'grant', 'apiKey', 'key', 'credential', 'authorization', 'errorCode']) {
        assert.equal(Object.prototype.hasOwnProperty.call(result, forbidden), false);
      }
      for (const value of rendererSensitiveValues) assert.equal(JSON.stringify(result).includes(value), false);
    };

    const invoke = async (scenario) => {
      const requests = [];
      let adapterCalls = 0;
      let resolveCalls = 0;
      let gatewayCalls = 0;
      const policyAllowsByokFallback = new Set(['grant-expired', 'grant-revoked', 'device-refused', 'provider-unavailable', 'model-unavailable']).has(scenario);
      const fetchImpl = async (url, options) => {
        const body = options.body ? JSON.parse(options.body) : null;
        requests.push({ url, body, headers: options.headers });
        if (url.endsWith('/access/resolve')) {
          resolveCalls += 1;
          if (scenario === 'device-refused') return json({ code: 'device_refused' }, 403);
          return json({ data: {
            grant: 'fixture-grant-' + resolveCalls,
            subjectId,
            expiresAt: new Date(Date.now() + 60000).toISOString()
          } });
        }
        gatewayCalls += 1;
        if (scenario === 'grant-expired') return json({ code: 'grant_expired' }, 401);
        if (scenario === 'grant-revoked') return json({ code: 'grant_revoked' }, 403);
        if (scenario === 'provider-unavailable') return json({ code: 'provider_unavailable', detail: 'provider fixture internal' }, 404);
        if (scenario === 'model-unavailable') return json({ code: 'model_unavailable', detail: 'model fixture internal' }, 404);
        if (scenario === 'gateway-invalid') return json({ data: {} });
        if (scenario === 'gateway-timeout') {
          const error = new Error('local timeout');
          error.name = 'AbortError';
          throw error;
        }
        return json({ data: { text: 'texte managed local' } });
      };
      const controlPlane = new NevenControlPlaneClient({
        baseUrl: 'https://managed.neven.test',
        allowedHosts: ['managed.neven.test'],
        accessTokenResolver: async () => 'fixture-session',
        fetchImpl
      });
      const gateway = new NevenManagedGatewayClient({
        allowedHosts: ['managed.neven.test'],
        fetchImpl,
        timeoutMs: 1000
      });
      const completeManagedGateway = createManagedGatewayCompletion({
        accessResolver: createNevenAccessResolver({ client: controlPlane }),
        gatewayClient: gateway,
        enabled: true
      });
      configureAIService({
        resolveProviderExecutionContext: async () => ({ workspaceId, deviceId, profile: 'luna' }),
        resolveProviderPolicy: async () => ({ byok: policyAllowsByokFallback ? 'non_priority' : 'disabled' }),
        resolveProviderCredential: async ({ origin }) => {
          if (origin === 'neven') return { managedGateway: true };
          if (origin === 'byok') return 'fixture-byok-credential';
          return null;
        },
        executeManagedGateway: completeManagedGateway,
        providerUsageLedger: { append: async () => {} }
      });
      const handlers = {};
      registerAIHandlers({
        ipcMain: { handle: (channel, handler) => { handlers[channel] = handler; } },
        completionHandlers: {
          claude: async () => { adapterCalls += 1; throw new Error('provider adapter must not run'); }
        },
        listAgents: async () => ({ agents: [] }),
        listSkills: async () => ({ skills: [] })
      });
      const result = await handlers['get-claude-completion'](
        {}, [{ role: 'user', text: rendererPrompt }], '', null,
        { provider: 'renderer-provider', model: 'renderer-model', grant: 'renderer-grant', apiKey: 'renderer-hidden-value' }
      );
      return { result, requests, adapterCalls, resolveCalls, gatewayCalls, capturedLogs };
    };

    (async () => {
      const success = await invoke('success');
      assert.deepEqual(success.result, { success: true, text: 'texte managed local', origin: 'neven' });
      assert.equal(success.adapterCalls, 0);
      assert.equal(success.resolveCalls, 1);
      assert.equal(success.gatewayCalls, 1);
      const gatewayPayload = success.requests.find(({ url }) => url.endsWith('/gateway/completions')).body;
      const gatewayRequest = success.requests.find(({ url }) => url.endsWith('/gateway/completions'));
      assert.equal(gatewayPayload.userPrompt, rendererPrompt);
      for (const forbidden of ['provider', 'model', 'grant', 'apiKey', 'key', 'credential', 'authorization']) {
        assert.equal(Object.prototype.hasOwnProperty.call(gatewayPayload, forbidden), false);
      }
      for (const value of rendererSensitiveValues) assert.equal(JSON.stringify(gatewayPayload).includes(value), false);
      assert.equal(gatewayRequest.headers.Authorization, 'Bearer fixture-grant-1');
      assert.equal(JSON.stringify(gatewayRequest.headers).includes('renderer-hidden-value'), false);
      assertRendererSafe(success.result);
      assert.equal(Object.prototype.hasOwnProperty.call(success.result, 'usage'), false);

      const expired = await invoke('grant-expired');
      assert.equal(expired.result.success, false);
      assert.equal(expired.adapterCalls, 0);
      assert.equal(expired.resolveCalls, 2);
      assert.equal(expired.gatewayCalls, 2);
      assertRendererSafe(expired.result);

      const revoked = await invoke('grant-revoked');
      assert.equal(revoked.result.success, false);
      assert.equal(revoked.adapterCalls, 0);
      assert.equal(revoked.resolveCalls, 1);
      assert.equal(revoked.gatewayCalls, 1);
      assertRendererSafe(revoked.result);

      const deviceRefused = await invoke('device-refused');
      assert.equal(deviceRefused.result.success, false);
      assert.equal(deviceRefused.adapterCalls, 0);
      assert.equal(deviceRefused.gatewayCalls, 0);
      assertRendererSafe(deviceRefused.result);

      for (const scenario of ['grant-expired', 'grant-revoked', 'device-refused', 'provider-unavailable', 'model-unavailable', 'gateway-timeout', 'gateway-invalid']) {
        const failure = await invoke(scenario);
        assert.equal(failure.result.success, false);
        assert.equal(failure.adapterCalls, 0);
        assertRendererSafe(failure.result);
        assert.equal(JSON.stringify(failure.result).includes(rendererPrompt), false);
        assert.equal(JSON.stringify(failure.capturedLogs).includes(rendererPrompt), false);
        for (const value of rendererSensitiveValues) {
          assert.equal(JSON.stringify(failure.capturedLogs).includes(value), false);
          assert.equal(JSON.stringify(failure.requests.map(({ body }) => body)).includes(value), false);
        }
      }
    })().catch((error) => { console.error(error); process.exitCode = 1; });
  `;

  const output = execFileSync(process.execPath, ['-e', script], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });
  assert.equal(output.trim(), '');
});
