'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  ProviderSecretVault
} = require('./provider-secret-vault.service');
const {
  ProviderUsageLedger,
  normalizeUsageEvent
} = require('./provider-usage-ledger.service');
const {
  getCredentialId,
  decideProviderOrigins,
  executeProviderPolicy,
  normalizePolicy,
  normalizeProviderError
} = require('./provider-policy.service');
const { configureAIService, runProviderCompletionWithPolicy } = require('./ai.service');
const { registerProviderHandlers } = require('../ipc/providerHandlers');

const fakeSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`encrypted:${value}`, 'utf8'),
  decryptString: (value) => Buffer.from(value).toString('utf8').replace(/^encrypted:/, '')
};

const makeTempDir = async () => fs.mkdtemp(path.join(os.tmpdir(), 'neven-provider-'));

test('vault stores encrypted workspace credentials and returns metadata without the secret', async () => {
  const directory = await makeTempDir();
  const filePath = path.join(directory, 'provider-secrets.vault.json');
  const vault = new ProviderSecretVault({ filePath, safeStorage: fakeSafeStorage });

  const metadata = await vault.put('workspace:demo:provider:claude', 'sk-secret-value', {
    provider: 'claude', workspaceId: 'demo', scope: 'workspace'
  });

  assert.equal(metadata.provider, 'claude');
  assert.equal(metadata.ciphertext, undefined);
  assert.equal(await vault.get('workspace:demo:provider:claude'), 'sk-secret-value');
  const raw = await fs.readFile(filePath, 'utf8');
  assert.equal(raw.includes('sk-secret-value'), false);

  await vault.revoke('workspace:demo:provider:claude');
  assert.equal(await vault.get('workspace:demo:provider:claude'), null);
  const revoked = await vault.metadata('workspace:demo:provider:claude');
  assert.equal(Object.prototype.hasOwnProperty.call(revoked, 'ciphertext'), false);
  const revokedRaw = await fs.readFile(filePath, 'utf8');
  assert.equal(revokedRaw.includes('electron-safe-storage:v1:'), false);
});

test('provider policy makes the complete ordered origin decision without I/O', () => {
  assert.deepEqual(decideProviderOrigins({ provider: 'claude', policy: { byok: 'disabled' } }), ['neven']);
  assert.deepEqual(decideProviderOrigins({ provider: 'claude', policy: { byok: 'non_priority' } }), ['neven', 'byok']);
  assert.deepEqual(decideProviderOrigins({ provider: 'claude', policy: { byok: 'priority' } }), ['byok', 'neven']);
  assert.deepEqual(decideProviderOrigins({ provider: 'claude', policy: { byok: 'mandatory' } }), ['byok']);
  assert.deepEqual(decideProviderOrigins({ provider: 'ollama', policy: { byok: 'priority' } }), ['local']);
  assert.deepEqual(decideProviderOrigins({ provider: 'claude', policy: { prioritizeUserKeys: true } }), ['neven']);
  assert.throws(() => normalizePolicy({ byok: 'unknown' }), /inconnue/);
});

test('runtime completion executes the main policy, records real attempts and refuses missing mandatory credentials', async () => {
  const ledgerEvents = [];
  configureAIService({
    resolveProviderExecutionContext: async () => ({ workspaceId: 'runtime-workspace' }),
    resolveProviderPolicy: async () => ({ byok: 'mandatory' }),
    resolveProviderCredential: async () => null,
    providerUsageLedger: { append: async (event) => ledgerEvents.push(event) }
  });
  let invoked = false;
  const denied = await runProviderCompletionWithPolicy({ provider: 'claude', execute: async () => { invoked = true; return { success: true }; } });
  assert.equal(denied.error.code, 'credential_unavailable');
  assert.equal(invoked, false);
  assert.deepEqual(ledgerEvents, []);

  configureAIService({
    resolveProviderPolicy: async () => ({ byok: 'priority' }),
    resolveProviderCredential: async ({ origin }) => origin === 'byok' ? 'workspace-key' : 'managed-key'
  });
  const result = await runProviderCompletionWithPolicy({
    provider: 'claude',
    execute: async ({ options }) => {
      if (options.credentialOrigin === 'byok') {
        assert.equal(options.managedCredential, 'workspace-key');
        return { success: false, error: 'Request failed with status code 429', retryable: true, usage: { inputTokens: 1 } };
      }
      assert.equal(options.managedCredential, 'managed-key');
      return { success: true, usage: { outputTokens: 2 } };
    }
  });
  assert.equal(result.origin, 'neven');
  assert.deepEqual(ledgerEvents.map((event) => event.origin), ['byok', 'neven']);
});

test('provider failures normalize real adapter formats before fallback decisions', () => {
  assert.deepEqual(normalizeProviderError('Request failed with status code 429', { retryable: true }), { code: 'rate_limited' });
  assert.deepEqual(normalizeProviderError({ code: 'ETIMEDOUT', message: 'socket timed out' }), { code: 'timeout' });
  assert.deepEqual(normalizeProviderError('Accès refusé à la clé API'), { code: 'permission_denied' });
});

test('provider IPC scopes list and revoke to the main-derived workspace', async () => {
  const handlers = {};
  const revoked = [];
  const vault = {
    listMetadata: async () => [{ workspaceId: 'workspace-a', id: 'a' }, { workspaceId: 'workspace-b', id: 'b' }],
    revoke: async (id) => { revoked.push(id); return true; }
  };
  registerProviderHandlers({
    ipc: { handle: (channel, handler) => { handlers[channel] = handler; } },
    app: {}, vault,
    resolveWorkspaceContext: async () => ({ workspaceId: 'workspace-a' })
  });
  assert.deepEqual(await handlers['provider:list-credentials']({}, { workspaceId: 'workspace-b' }), {
    success: true, credentials: [{ workspaceId: 'workspace-a', id: 'a' }]
  });
  await handlers['provider:revoke']({}, { workspaceId: 'workspace-b', provider: 'claude' });
  assert.equal(revoked[0], getCredentialId({ workspaceId: 'workspace-a', provider: 'claude' }));
  registerProviderHandlers({
    ipc: { handle: (channel, handler) => { handlers[channel] = handler; } }, app: {}, vault,
    resolveWorkspaceContext: async () => null
  });
  assert.deepEqual(await handlers['provider:list-credentials']({}, { workspaceId: 'workspace-a' }), {
    success: false, credentials: [], error: 'Accès workspace fournisseur refusé.'
  });
});

test('managed fallback happens only after an allowed operational error and records each attempted origin', async () => {
  const attempts = [];
  const recorded = [];
  const result = await executeProviderPolicy({
    provider: 'claude', workspaceId: 'demo', policy: { byok: 'priority' },
    resolveCredential: async ({ origin }) => ({ origin, injected: true }),
    attempt: async ({ origin }) => {
      attempts.push(origin);
      return origin === 'byok' ? { success: false, error: { code: 'timeout' } } : { success: true };
    },
    ledger: { append: async (event) => recorded.push(event) }
  });
  assert.deepEqual(attempts, ['byok', 'neven']);
  assert.deepEqual(recorded.map((event) => event.origin), ['byok', 'neven']);
  assert.equal(result.origin, 'neven');

  const deniedAttempts = [];
  const denied = await executeProviderPolicy({
    provider: 'claude', workspaceId: 'demo', policy: { byok: 'priority' },
    resolveCredential: async () => ({ injected: true }),
    attempt: async ({ origin }) => { deniedAttempts.push(origin); return { success: false, error: { code: 'permission_denied' } }; }
  });
  assert.deepEqual(deniedAttempts, ['byok']);
  assert.equal(denied.origin, 'byok');
});

test('an allowed origin without a credential is skipped until policy options are exhausted', async () => {
  const attempts = [];
  const fallback = await executeProviderPolicy({
    provider: 'claude', workspaceId: 'demo', policy: { byok: 'priority' },
    resolveCredential: async ({ origin }) => origin === 'byok' ? null : 'managed-key',
    attempt: async ({ origin }) => { attempts.push(origin); return { success: true }; }
  });
  assert.deepEqual(attempts, ['neven']);
  assert.equal(fallback.origin, 'neven');

  const mandatory = await executeProviderPolicy({
    provider: 'claude', workspaceId: 'demo', policy: { byok: 'mandatory' },
    resolveCredential: async () => null,
    attempt: async () => { throw new Error('must not execute without a credential'); }
  });
  assert.deepEqual(mandatory, { success: false, origin: null, error: { code: 'credential_unavailable' } });
});

test('managed Neven remains explicitly unavailable without a COD-26 gateway and never executes an adapter', async () => {
  let attempts = 0;
  const result = await executeProviderPolicy({
    provider: 'claude', workspaceId: 'demo', policy: { byok: 'disabled' },
    resolveCredential: async ({ origin }) => {
      assert.equal(origin, 'neven');
      return { unavailable: true };
    },
    attempt: async () => { attempts += 1; return { success: true }; }
  });
  assert.equal(attempts, 0);
  assert.deepEqual(result, { success: false, origin: null, error: { code: 'unavailable' } });
});

test('credential ids do not collide when workspace and provider contain delimiters', async () => {
  assert.notEqual(
    getCredentialId({ workspaceId: 'a', provider: 'b:provider:c' }),
    getCredentialId({ workspaceId: 'a:provider:b', provider: 'c' })
  );
});

test('usage ledger validates billing origin and aggregates tokens', async () => {
  const directory = await makeTempDir();
  const ledger = new ProviderUsageLedger({ filePath: path.join(directory, 'usage.ndjson') });
  await ledger.append({ workspaceId: 'demo', origin: 'byok', providerId: 'claude', inputTokens: 10, outputTokens: 5 });
  await ledger.append({ workspaceId: 'demo', origin: 'neven', providerId: 'gemini', inputTokens: 4, outputTokens: 2 });

  const summary = await ledger.summarizeByOrigin();
  assert.deepEqual(summary.byok, { requests: 1, inputTokens: 10, outputTokens: 5 });
  assert.deepEqual(summary.neven, { requests: 1, inputTokens: 4, outputTokens: 2 });
  assert.throws(() => normalizeUsageEvent({ workspaceId: 'demo', origin: 'unknown' }));
});
