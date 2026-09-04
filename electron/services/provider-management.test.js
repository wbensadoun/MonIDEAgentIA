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
const { configureAIService, runProviderCompletionWithPolicy, runSingleCompletionProvider } = require('./ai.service');
const { registerProviderHandlers } = require('../ipc/providerHandlers');
const { ProviderCredentialService, PROVIDER_REGISTRY } = require('./provider-credential.service');
const { ProviderCredentialAuditLedger } = require('./provider-credential-audit.service');
const { createProviderContract } = require('./provider-contract.service');
const { withInterprocessFileLock } = require('./durable-file.service');

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

test('production completion runner sends resolved OpenAI BYOK credentials only to the OpenAI endpoint', async () => {
  const credential = 'controlled-test-credential';
  const previousFetch = global.fetch;
  const requests = [];
  configureAIService({
    resolveProviderExecutionContext: async () => ({ workspaceId: 'openai-workspace', profile: 'lumen', access: null }),
    resolveProviderPolicy: async () => ({ byok: 'mandatory' }),
    resolveProviderCredential: async ({ origin }) => origin === 'byok' ? credential : null,
    providerUsageLedger: { append: async () => {} }
  });
  global.fetch = async (url, init) => {
    requests.push({ url, init });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: 'completion OpenAI bornee' } }],
        usage: { prompt_tokens: 3, completion_tokens: 4 }
      })
    };
  };
  try {
    const result = await runSingleCompletionProvider({
      provider: 'openai',
      systemInstruction: 'systeme de test',
      userPrompt: 'demande de test',
      maxTokens: 12,
      options: { model: 'gpt-test-model' }
    });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://api.openai.com/v1/chat/completions');
    assert.deepEqual(requests[0].init.headers, {
      Authorization: `Bearer ${credential}`,
      'Content-Type': 'application/json'
    });
    assert.deepEqual(JSON.parse(requests[0].init.body), {
      model: 'gpt-test-model',
      messages: [
        { role: 'system', content: 'systeme de test' },
        { role: 'user', content: 'demande de test' }
      ],
      max_tokens: 12,
      temperature: 0.1
    });
    assert.equal(result.success, true);
    assert.equal(result.provider, 'openai');
    assert.equal(result.text, 'completion OpenAI bornee');
    assert.deepEqual(result.usage, { inputTokens: 3, outputTokens: 4, cost: null });
    assert.equal(JSON.stringify(result).includes(credential), false);
  } finally {
    global.fetch = previousFetch;
  }
});

test('Google BYOK timeout never forwards its managed credential to an OpenAI fallback', async () => {
  const googleCredential = 'fixture-not-a-secret';
  const previousFetch = global.fetch;
  const requests = [];
  configureAIService({
    resolveProviderExecutionContext: async () => ({ workspaceId: 'google-workspace', profile: 'lumen', access: null }),
    resolveProviderPolicy: async () => ({ byok: 'mandatory' }),
    resolveProviderCredential: async ({ origin, provider }) => origin === 'byok' && provider === 'gemini' ? googleCredential : null,
    providerUsageLedger: { append: async () => {} }
  });
  global.fetch = async (url, init) => {
    requests.push({ url: String(url), headers: init?.headers || {} });
    throw Object.assign(new Error('Google timeout'), { code: 'ETIMEDOUT', retryable: true });
  };
  try {
    const result = await runSingleCompletionProvider({
      provider: 'gemini',
      systemInstruction: 'systeme de test',
      userPrompt: 'demande de test',
      options: { allowProviderFallback: true, fallbackProvider: 'openai' }
    });

    assert.equal(result.success, false);
    assert.equal(result.provider, 'gemini');
    const openAIRequests = requests.filter(({ url }) => url.startsWith('https://api.openai.com/'));
    assert.equal(openAIRequests.length, 0);
    assert.equal(openAIRequests.some(({ headers }) => headers.Authorization === `Bearer ${googleCredential}`), false);
  } finally {
    global.fetch = previousFetch;
  }
});

test('provider failures normalize real adapter formats before fallback decisions', () => {
  assert.deepEqual(normalizeProviderError('Request failed with status code 429', { retryable: true }), { code: 'rate_limited' });
  assert.deepEqual(normalizeProviderError({ code: 'ETIMEDOUT', message: 'socket timed out' }), { code: 'timeout' });
  assert.deepEqual(normalizeProviderError('Accès refusé à la clé API'), { code: 'permission_denied' });
  assert.deepEqual(normalizeProviderError({ code: 'gateway_unavailable' }), { code: 'unavailable' });
});

test('credential lifecycle is serialized, versioned, audited and never returns a secret', async () => {
  const directory = await makeTempDir();
  const vault = new ProviderSecretVault({ filePath: path.join(directory, 'vault.json'), safeStorage: fakeSafeStorage });
  const auditEvents = [];
  const service = new ProviderCredentialService({
    vault,
    auditLedger: { append: async (event) => auditEvents.push(event) },
    connectivityTester: async ({ credentialId, provider, secretValue }) => {
      assert.equal(credentialId.startsWith('cred_'), true);
      assert.equal(provider, 'anthropic');
      assert.equal(secretValue, 'only-main-process-sees-this');
      return { success: true };
    },
    createId: () => 'cred_11111111-1111-4111-8111-111111111111'
  });
  const created = await service.create({ workspaceId: 'workspace-a', secretValue: 'only-main-process-sees-this', metadata: { provider: 'anthropic', label: 'Production', permissions: ['completion'], limits: { maxRequestsPerDay: 20 } } });
  assert.equal(created.credential.id, 'cred_11111111-1111-4111-8111-111111111111');
  assert.equal(created.credential.version, 1);
  assert.equal(JSON.stringify(created).includes('only-main-process-sees-this'), false);
  assert.deepEqual(Object.keys(created.credential).sort(), ['createdAt', 'id', 'label', 'limits', 'maskedSuffix', 'permissions', 'provider', 'status', 'updatedAt', 'version'].sort());
  const connected = await service.connectivity({ workspaceId: 'workspace-a', credentialId: created.credential.id });
  assert.equal(connected.success, true);
  const replacement = await service.replace({ workspaceId: 'workspace-a', credentialId: created.credential.id, secretValue: 'rotated-only-main', metadata: { provider: 'anthropic', label: 'Production', permissions: ['completion'] } });
  assert.equal(replacement.credential.version, 2);
  const revoked = await service.revoke({ workspaceId: 'workspace-a', credentialId: created.credential.id });
  assert.equal(revoked.success, true);
  assert.equal(await vault.get(created.credential.id), null);
  const afterRevoke = await service.connectivity({ workspaceId: 'workspace-a', credentialId: created.credential.id });
  assert.equal(afterRevoke.resultCode, 'revoked');
  assert.equal(auditEvents.every((event) => event.operationId && ['success', 'revoked'].includes(event.resultCode)), true);
  assert.equal(auditEvents.some((event) => JSON.stringify(event).includes('only-main-process-sees-this')), false);
  assert.equal(PROVIDER_REGISTRY.includes('untrusted-provider'), false);
  const rejected = await service.create({ workspaceId: 'workspace-a', secretValue: 'x', metadata: { provider: 'untrusted-provider', label: 'x', permissions: [] } });
  assert.equal(rejected.resultCode, 'invalid_request');
});

test('invalid renderer credential ids are replaced by unknown and never persisted in audit', async () => {
  const directory = await makeTempDir();
  const auditEvents = [];
  const vault = new ProviderSecretVault({ filePath: path.join(directory, 'vault.json'), safeStorage: fakeSafeStorage });
  const service = new ProviderCredentialService({ vault, auditLedger: { append: async (event) => auditEvents.push(event) } });
  const rawId = 'not-a-credential-secret-shaped';
  const result = await service.revoke({ workspaceId: 'workspace-a', credentialId: rawId });
  assert.deepEqual(result.credentialId, 'unknown');
  assert.equal(auditEvents.at(-1).credentialId, 'unknown');
  assert.equal(JSON.stringify(auditEvents).includes(rawId), false);
});

test('created credentials resolve through the workspace-provider index instead of deterministic ids', async () => {
  const directory = await makeTempDir();
  const vault = new ProviderSecretVault({ filePath: path.join(directory, 'vault.json'), safeStorage: fakeSafeStorage });
  const service = new ProviderCredentialService({
    vault, auditLedger: { append: async () => {} },
    createId: () => 'cred_22222222-2222-4222-8222-222222222222'
  });
  const created = await service.create({ workspaceId: 'workspace-a', secretValue: 'main-only-value', metadata: { provider: 'openai', label: 'Production', permissions: [] } });
  const resolved = await service.resolveActive({ workspaceId: 'workspace-a', provider: 'openai' });
  assert.equal(resolved.credentialId, created.credential.id);
  assert.equal(resolved.credential, 'main-only-value');
  assert.equal(await service.resolveActive({ workspaceId: 'workspace-b', provider: 'openai' }), null);
});

test('v1 vault migration canonicalizes provider aliases and persists its credential index', async () => {
  const directory = await makeTempDir();
  const filePath = path.join(directory, 'vault.json');
  const id = 'cred_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const encrypted = `electron-safe-storage:v1:${Buffer.from('encrypted:legacy-value').toString('base64')}`;
  await fs.writeFile(filePath, JSON.stringify({ version: 1, secrets: { [id]: { workspaceId: 'workspace-a', provider: 'claude', status: 'active', ciphertext: encrypted, updatedAt: '2026-01-01T00:00:00.000Z' } } }), 'utf8');
  const vault = new ProviderSecretVault({ filePath, safeStorage: fakeSafeStorage });
  const service = new ProviderCredentialService({ vault, auditLedger: { append: async () => {} }, now: () => '2026-01-01T01:00:00.000Z' });
  assert.equal((await service.resolveActive({ workspaceId: 'workspace-a', provider: 'anthropic' })).credential, 'legacy-value');
  assert.equal((await service.resolveActive({ workspaceId: 'workspace-a', provider: 'claude' })).credential, 'legacy-value');
  const migrated = JSON.parse(await fs.readFile(filePath, 'utf8'));
  assert.equal(migrated.credentialIndex[JSON.stringify(['workspace-a', 'anthropic'])], id);
});

test('a v1 migration write failure leaves the vault fail-closed for resolution and connectivity', async () => {
  const directory = await makeTempDir();
  const filePath = path.join(directory, 'vault.json');
  const id = 'cred_abababab-abab-4aba-8aba-abababababab';
  const encrypted = `electron-safe-storage:v1:${Buffer.from('encrypted:legacy-value').toString('base64')}`;
  await fs.writeFile(filePath, JSON.stringify({ version: 1, secrets: { [id]: { workspaceId: 'workspace-a', provider: 'openai', status: 'active', ciphertext: encrypted } } }), 'utf8');
  const failingFs = { ...fs, open: async (target, ...args) => {
    if (String(target).includes('.tmp')) throw new Error('migration disk unavailable');
    return fs.open(target, ...args);
  } };
  const vault = new ProviderSecretVault({ filePath, safeStorage: fakeSafeStorage, fsImpl: failingFs });
  let connectivityCalls = 0;
  const service = new ProviderCredentialService({ vault, auditLedger: { append: async () => {} }, connectivityTester: async () => { connectivityCalls += 1; return { success: true }; } });
  assert.equal(await service.resolveActive({ workspaceId: 'workspace-a', provider: 'openai' }), null);
  assert.equal((await service.connectivity({ workspaceId: 'workspace-a', credentialId: id })).resultCode, 'unavailable');
  assert.equal(connectivityCalls, 0);
  assert.equal(vault.state, null);
});

test('Claude, Gemini and OpenAI aliases resolve and execute through canonical credentials', async () => {
  const directory = await makeTempDir();
  const vault = new ProviderSecretVault({ filePath: path.join(directory, 'vault.json'), safeStorage: fakeSafeStorage });
  const service = new ProviderCredentialService({ vault, auditLedger: { append: async () => {} }, createId: () => 'cred_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' });
  for (const [stored, runtime, id] of [['anthropic', 'claude', 'cred_11111111-1111-4111-8111-111111111112'], ['google', 'gemini', 'cred_22222222-2222-4222-8222-222222222223'], ['openai', 'openai', 'cred_33333333-3333-4333-8333-333333333334']]) {
    await vault.put(id, `${stored}-value`, { workspaceId: `workspace-${stored}`, provider: stored, status: 'active' });
    assert.equal((await service.resolveActive({ workspaceId: `workspace-${stored}`, provider: runtime })).credential, `${stored}-value`);
  }
  const contract = createProviderContract({ adapters: { claude: { complete: async () => ({ success: true }) }, gemini: { complete: async () => ({ success: true }) }, openai: { complete: async () => ({ success: true }) } } });
  assert.equal((await contract.complete({ provider: 'anthropic' })).provider, 'claude');
  assert.equal((await contract.complete({ provider: 'google' })).provider, 'gemini');
  assert.equal((await contract.complete({ provider: 'openai' })).provider, 'openai');
});

test('Azure and local Ollama credentials complete the vault lifecycle but stay unsupported for resolution and connectivity', async () => {
  const directory = await makeTempDir();
  let sequence = 0;
  const auditEvents = [];
  let connectivityCalls = 0;
  const vault = new ProviderSecretVault({ filePath: path.join(directory, 'vault.json'), safeStorage: fakeSafeStorage });
  const service = new ProviderCredentialService({
    vault,
    auditLedger: { append: async (event) => auditEvents.push(event) },
    connectivityTester: async () => { connectivityCalls += 1; throw new Error('network must not be called'); },
    createId: () => `cred_12345678-1234-4123-8123-${String(++sequence).padStart(12, '0')}`
  });
  for (const [provider, runtime] of [['azure-openai', 'azure'], ['ollama', 'ollama']]) {
    const workspaceId = `workspace-${runtime}`;
    const created = await service.create({ workspaceId, secretValue: `value-${runtime}`, metadata: { provider, label: runtime, permissions: [] } });
    assert.equal(created.success, true);
    assert.equal(created.credential.provider, runtime === 'ollama' ? 'ollama-local' : 'azure');
    assert.equal((await service.list({ workspaceId })).length, 1);
    const replaced = await service.replace({ workspaceId, credentialId: created.credential.id, secretValue: `replacement-${runtime}`, metadata: { provider, label: `${runtime} replacement`, permissions: [] } });
    assert.equal(replaced.success, true);
    const rotated = await service.rotate({ workspaceId, credentialId: created.credential.id, secretValue: `rotation-${runtime}` });
    assert.equal(rotated.success, true);
    assert.equal(await service.resolveActive({ workspaceId: `workspace-${runtime}`, provider: runtime }), null);
    const connectivity = await service.connectivity({ workspaceId, credentialId: created.credential.id });
    assert.equal(connectivity.resultCode, 'unsupported');
    const revoked = await service.revoke({ workspaceId, credentialId: created.credential.id });
    assert.equal(revoked.success, true);
    assert.equal((await service.list({ workspaceId }))[0].status, 'revoked');
  }
  assert.equal(PROVIDER_REGISTRY.includes('azure'), false);
  assert.equal(PROVIDER_REGISTRY.includes('ollama-local'), false);
  assert.equal(connectivityCalls, 0);
  assert.deepEqual(auditEvents.map((event) => event.operation), [
    'create', 'replace', 'rotate', 'connectivity', 'revoke',
    'create', 'replace', 'rotate', 'connectivity', 'revoke'
  ]);
  assert.deepEqual(auditEvents.map((event) => event.resultCode), [
    'success', 'success', 'success', 'unsupported', 'success',
    'success', 'success', 'success', 'unsupported', 'success'
  ]);
});

test('independent vault instances reload under a shared lock so usage cannot overwrite revocation or double-spend a quota', async () => {
  const directory = await makeTempDir();
  const filePath = path.join(directory, 'vault.json');
  const revokedId = 'cred_cdcdcdcd-cdcd-4cdc-8cdc-cdcdcdcdcdcd';
  const quotaId = 'cred_dededede-dede-4ede-8ede-dededededede';
  const first = new ProviderSecretVault({ filePath, safeStorage: fakeSafeStorage });
  const second = new ProviderSecretVault({ filePath, safeStorage: fakeSafeStorage });
  await first.put(revokedId, 'value-revoked', { workspaceId: 'workspace-a', provider: 'openai' });
  await second.metadata(revokedId); // Deliberately retain a stale in-memory view before the concurrent mutations.
  await Promise.all([first.revoke(revokedId), second.getAndMarkUsed(revokedId, '2026-01-01T10:00:00.000Z')]);
  assert.equal((await first.metadata(revokedId)).status, 'revoked');
  assert.equal(await first.get(revokedId), null);

  await first.put(quotaId, 'value-quota', { workspaceId: 'workspace-a', provider: 'openai', limits: { maxRequestsPerMinute: 1 } });
  await second.metadata(quotaId);
  const uses = await Promise.all([
    first.getAndMarkUsed(quotaId, '2026-01-01T10:00:00.000Z'),
    second.getAndMarkUsed(quotaId, '2026-01-01T10:00:00.000Z')
  ]);
  assert.equal(uses.filter((result) => result.credential).length, 1);
  assert.equal(uses.filter((result) => result.limited).length, 1);
  assert.equal((await first.metadata(quotaId)).usage.minuteCount, 1);
});

test('replace and rotate cannot restore a tombstone when revoke interleaves after their CAS write', async (t) => {
  for (const operation of ['replace', 'rotate']) {
    await t.test(operation, async () => {
      const directory = await makeTempDir();
      const filePath = path.join(directory, 'vault.json');
      const id = 'cred_fefefefe-fefe-4efe-8efe-fefefefefefe';
      const firstVault = new ProviderSecretVault({ filePath, safeStorage: fakeSafeStorage });
      const secondVault = new ProviderSecretVault({ filePath, safeStorage: fakeSafeStorage });
      await firstVault.put(id, 'value-before', { workspaceId: 'workspace-a', provider: 'openai', label: 'Original', permissions: [] });
      await secondVault.metadata(id); // Keep the revoker's pre-CAS state stale on purpose.
      let releaseAudit;
      let auditReached;
      let auditAttempts = 0;
      const auditReachedPromise = new Promise((resolve) => { auditReached = resolve; });
      const mutator = new ProviderCredentialService({
        vault: firstVault,
        auditLedger: { append: async () => {
          auditAttempts += 1;
          if (auditAttempts > 1) return;
          auditReached();
          await new Promise((resolve) => { releaseAudit = resolve; });
          throw new Error('audit unavailable');
        } }
      });
      const revoker = new ProviderCredentialService({ vault: secondVault, auditLedger: { append: async () => {} } });
      const mutation = operation === 'replace'
        ? mutator.replace({ workspaceId: 'workspace-a', credentialId: id, secretValue: 'value-after', metadata: { provider: 'openai', label: 'Updated', permissions: [] } })
        : mutator.rotate({ workspaceId: 'workspace-a', credentialId: id, secretValue: 'value-after' });
      await auditReachedPromise;
      assert.equal((await revoker.revoke({ workspaceId: 'workspace-a', credentialId: id })).success, true);
      releaseAudit();
      assert.equal((await mutation).resultCode, 'audit_unavailable');
      const tombstone = await firstVault.metadataFresh(id);
      assert.equal(tombstone.status, 'revoked');
      assert.equal(await firstVault.get(id), null);
    });
  }
});

test('connectivity rechecks fresh locked state and does not use a cached credential after revoke', async () => {
  const directory = await makeTempDir();
  const filePath = path.join(directory, 'vault.json');
  const id = 'cred_acacacac-acac-4cac-8cac-acacacacacac';
  const cachedVault = new ProviderSecretVault({ filePath, safeStorage: fakeSafeStorage });
  const revokerVault = new ProviderSecretVault({ filePath, safeStorage: fakeSafeStorage });
  await cachedVault.put(id, 'value-before', { workspaceId: 'workspace-a', provider: 'openai', label: 'Original', permissions: [] });
  await cachedVault.metadata(id);
  await revokerVault.revoke(id);
  let networkCalls = 0;
  const service = new ProviderCredentialService({
    vault: cachedVault,
    auditLedger: { append: async () => {} },
    connectivityTester: async () => { networkCalls += 1; return { success: true }; }
  });
  const result = await service.connectivity({ workspaceId: 'workspace-a', credentialId: id });
  assert.equal(result.resultCode, 'revoked');
  assert.equal(networkCalls, 0);
});

test('revoke aborts a blocked connectivity lease immediately and prevents a later credential access', async () => {
  const directory = await makeTempDir();
  const vault = new ProviderSecretVault({ filePath: path.join(directory, 'vault.json'), safeStorage: fakeSafeStorage });
  const id = 'cred_dededede-dede-4ede-8ede-dededededede';
  await vault.put(id, 'value-before', { workspaceId: 'workspace-a', provider: 'openai', label: 'Original', permissions: [] });
  let started;
  const startedPromise = new Promise((resolve) => { started = resolve; });
  let aborted = false;
  let networkCalls = 0;
  const service = new ProviderCredentialService({
    vault,
    auditLedger: { append: async () => {} },
    connectivityTester: async ({ signal }) => new Promise((resolve) => {
      networkCalls += 1;
      started();
      signal.addEventListener('abort', () => { aborted = true; resolve({ success: false, code: 'aborted' }); }, { once: true });
    })
  });
  const connectivity = service.connectivity({ workspaceId: 'workspace-a', credentialId: id });
  await startedPromise;
  const revoked = await service.revoke({ workspaceId: 'workspace-a', credentialId: id });
  assert.equal(revoked.success, true);
  assert.equal(aborted, true);
  assert.equal((await connectivity).resultCode, 'failed');
  assert.equal(networkCalls, 1);
  assert.equal((await service.connectivity({ workspaceId: 'workspace-a', credentialId: id })).resultCode, 'revoked');
  assert.equal(networkCalls, 1);
});

test('get reloads a tombstone under lock and never decrypts a credential revoked by another instance when audit is unavailable', async () => {
  const directory = await makeTempDir();
  const filePath = path.join(directory, 'vault.json');
  const id = 'cred_bcbcbcbc-bcbc-4cbc-8cbc-bcbcbcbcbcbc';
  let decryptions = 0;
  const trackedSafeStorage = {
    ...fakeSafeStorage,
    decryptString: (value) => {
      decryptions += 1;
      return fakeSafeStorage.decryptString(value);
    }
  };
  const cachedVault = new ProviderSecretVault({ filePath, safeStorage: trackedSafeStorage });
  const revokerVault = new ProviderSecretVault({ filePath, safeStorage: trackedSafeStorage });
  await cachedVault.put(id, 'value-before', { workspaceId: 'workspace-a', provider: 'openai', label: 'Original', permissions: [] });
  assert.equal(await cachedVault.get(id), 'value-before');
  const decryptionsBeforeRevoke = decryptions;

  const revoker = new ProviderCredentialService({
    vault: revokerVault,
    auditLedger: { append: async () => { throw new Error('audit unavailable'); } }
  });
  const revoked = await revoker.revoke({ workspaceId: 'workspace-a', credentialId: id });

  assert.equal(revoked.resultCode, 'audit_unavailable');
  assert.equal(await cachedVault.get(id), null);
  assert.equal(decryptions, decryptionsBeforeRevoke);
});

test('resolution updates lastUsedAt, enforces documented limits, and masks short secrets completely', async () => {
  const directory = await makeTempDir();
  const clock = { value: '2026-01-01T10:00:00.000Z' };
  const vault = new ProviderSecretVault({ filePath: path.join(directory, 'vault.json'), safeStorage: fakeSafeStorage });
  const service = new ProviderCredentialService({ vault, auditLedger: { append: async () => {} }, now: () => clock.value, createId: () => 'cred_cccccccc-cccc-4ccc-8ccc-cccccccccccc' });
  const created = await service.create({ workspaceId: 'workspace-a', secretValue: 'abcd', metadata: { provider: 'gemini', label: 'Limited', permissions: [], limits: { maxRequestsPerMinute: 1, maxRequestsPerDay: 2 } } });
  assert.equal(created.credential.maskedSuffix, '••••');
  assert.equal((await service.resolveActive({ workspaceId: 'workspace-a', provider: 'google' })).credential, 'abcd');
  assert.equal((await vault.metadata(created.credential.id)).lastUsedAt, clock.value);
  assert.equal(await service.resolveActive({ workspaceId: 'workspace-a', provider: 'gemini' }), null);
  clock.value = '2026-01-01T10:01:00.000Z';
  assert.equal((await service.resolveActive({ workspaceId: 'workspace-a', provider: 'gemini' })).credential, 'abcd');
  clock.value = '2026-01-01T10:02:00.000Z';
  assert.equal(await service.resolveActive({ workspaceId: 'workspace-a', provider: 'gemini' }), null);
});

test('audit failures restore the exact credential index for compensable credential mutations', async (t) => {
  const ids = {
    first: 'cred_55555555-5555-4555-8555-555555555555',
    second: 'cred_66666666-6666-4666-8666-666666666666',
    created: 'cred_77777777-7777-4777-8777-777777777777'
  };
  for (const [operation, mutate] of [
    ['create', (service) => service.create({ workspaceId: 'workspace-a', secretValue: 'value-created', metadata: { provider: 'openai', label: 'Created', permissions: [] } })],
    ['replace', (service) => service.replace({ workspaceId: 'workspace-a', credentialId: ids.first, secretValue: 'value-replaced', metadata: { provider: 'openai', label: 'Replaced', permissions: [] } })],
    ['rotate', (service) => service.rotate({ workspaceId: 'workspace-a', credentialId: ids.first, secretValue: 'value-rotated' })]
  ]) {
    await t.test(operation, async () => {
      const directory = await makeTempDir();
      const vault = new ProviderSecretVault({ filePath: path.join(directory, 'vault.json'), safeStorage: fakeSafeStorage });
      await vault.put(ids.first, 'value-first', { workspaceId: 'workspace-a', provider: 'openai', label: 'First', permissions: [] });
      await vault.put(ids.second, 'value-second', { workspaceId: 'workspace-a', provider: 'openai', label: 'Second', permissions: [] });
      const service = new ProviderCredentialService({
        vault,
        auditLedger: { append: async () => { throw new Error('audit unavailable'); } },
        createId: () => ids.created
      });
      const before = await service.resolveActive({ workspaceId: 'workspace-a', provider: 'openai' });
      const result = await mutate(service);
      assert.equal(result.resultCode, 'audit_unavailable');
      assert.deepEqual(await service.resolveActive({ workspaceId: 'workspace-a', provider: 'openai' }), before);
      assert.equal(await vault.findCredentialId({ workspaceId: 'workspace-a', provider: 'openai' }), ids.second);
    });
  }
});

test('vault keeps its active memory state unchanged when candidate persistence fails', async () => {
  const directory = await makeTempDir();
  const vault = new ProviderSecretVault({ filePath: path.join(directory, 'vault.json'), safeStorage: fakeSafeStorage });
  const id = 'cred_88888888-8888-4888-8888-888888888888';
  await vault.put(id, 'value-before', { workspaceId: 'workspace-a', provider: 'openai', label: 'Original', permissions: [] });
  const snapshot = await vault.snapshot(id);
  const failingFs = { ...fs, open: async (target, ...args) => {
    if (String(target).includes('.tmp')) throw new Error('disk unavailable');
    return fs.open(target, ...args);
  } };

  vault.fs = failingFs;
  await assert.rejects(vault.put('cred_99999999-9999-4999-8999-999999999999', 'value-new', { workspaceId: 'workspace-a', provider: 'google', label: 'New', permissions: [] }), /disk unavailable/);
  assert.equal(await vault.findCredentialId({ workspaceId: 'workspace-a', provider: 'google' }), null);
  await assert.rejects(vault.revoke(id), /disk unavailable/);
  assert.equal(await vault.get(id), 'value-before');
  assert.equal((await vault.metadata(id)).status, 'active');

  vault.fs = fs;
  await vault.revoke(id);
  vault.fs = failingFs;
  await assert.rejects(vault.restore(id, snapshot, { expectedVersion: (await vault.metadata(id)).version }), /disk unavailable/);
  assert.equal(await vault.get(id), null);
  assert.equal((await vault.metadata(id)).status, 'revoked');
});

test('credential audit ledger bounds retention and rotates without secrets', async () => {
  const directory = await makeTempDir();
  const filePath = path.join(directory, 'credential-audit.ndjson');
  const ledger = new ProviderCredentialAuditLedger({ filePath, maxEvents: 2, maxBytes: 250, maxRotations: 1 });
  const event = await ledger.append({ operationId: 'operation-1', credentialId: 'cred-1', operation: 'not-allowed', resultCode: 'with-secret-value' });
  assert.equal(event.operation, 'connectivity');
  assert.equal(event.resultCode, 'failed');
  assert.equal(event.credentialId, 'unknown');
  await ledger.append({ operationId: 'operation-2', credentialId: 'cred-2', operation: 'create', resultCode: 'success' });
  await ledger.append({ operationId: 'operation-3', credentialId: 'cred-3', operation: 'create', resultCode: 'success' });
  const raw = await fs.readFile(filePath, 'utf8');
  assert.equal(raw.includes('secret'), false);
  assert.equal(raw.split(/\r?\n/).filter(Boolean).length <= 2, true);
  assert.equal(await fs.stat(`${filePath}.1`).then(() => true, () => false), true);
});

test('credential audit quota requires a positive integer and maxEvents=1 replaces prior events', async () => {
  const directory = await makeTempDir();
  const filePath = path.join(directory, 'credential-audit.ndjson');
  assert.throws(() => new ProviderCredentialAuditLedger({ filePath, maxEvents: 0 }), /entier positif/);
  assert.throws(() => new ProviderCredentialAuditLedger({ filePath, maxEvents: 1.5 }), /entier positif/);
  const ledger = new ProviderCredentialAuditLedger({ filePath, maxEvents: 1 });
  await ledger.append({ operationId: 'operation-1', operation: 'create', resultCode: 'success' });
  await ledger.append({ operationId: 'operation-2', operation: 'rotate', resultCode: 'success' });
  const lines = (await fs.readFile(filePath, 'utf8')).split(/\r?\n/).filter(Boolean);
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).operationId, 'operation-2');
});

test('credential audit ledger serializes concurrent append operations', async () => {
  const directory = await makeTempDir();
  const filePath = path.join(directory, 'credential-audit.ndjson');
  const ledger = new ProviderCredentialAuditLedger({ filePath, maxEvents: 10 });
  await Promise.all([
    ledger.append({ operationId: 'connectivity-1', operation: 'connectivity', resultCode: 'success' }),
    ledger.append({ operationId: 'connectivity-2', operation: 'connectivity', resultCode: 'failed' })
  ]);
  const operationIds = (await fs.readFile(filePath, 'utf8')).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line).operationId);
  assert.deepEqual(operationIds.sort(), ['connectivity-1', 'connectivity-2']);
});

test('two audit ledger instances share an inter-process lock and fail closed on atomic write errors', async () => {
  const directory = await makeTempDir();
  const filePath = path.join(directory, 'credential-audit.ndjson');
  const first = new ProviderCredentialAuditLedger({ filePath });
  const second = new ProviderCredentialAuditLedger({ filePath });
  await Promise.all([
    first.append({ operationId: 'instance-one', operation: 'create', resultCode: 'success' }),
    second.append({ operationId: 'instance-two', operation: 'revoke', resultCode: 'success' })
  ]);
  const ids = (await fs.readFile(filePath, 'utf8')).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line).operationId).sort();
  assert.deepEqual(ids, ['instance-one', 'instance-two']);
  const failing = new ProviderCredentialAuditLedger({ filePath: path.join(directory, 'failing.ndjson'), fsImpl: { ...fs, rename: async () => { throw new Error('write failed'); } } });
  await assert.rejects(failing.append({ operationId: 'must-fail', operation: 'create', resultCode: 'success' }), /write failed/);
  assert.equal(await fs.stat(path.join(directory, 'failing.ndjson')).then(() => true, () => false), false);
});

test('durable lock removes its own partial acquisition and safely handles orphaned versus live locks', async (t) => {
  await t.test('write and sync acquisition failures close and remove the created lock', async () => {
    for (const failure of ['writeFile', 'sync']) {
      const directory = await makeTempDir();
      const filePath = path.join(directory, `${failure}.json`);
      const failingFs = {
        ...fs,
        open: async (target, flags) => {
          const handle = await fs.open(target, flags);
          if (String(target).endsWith('.lock')) {
            const original = handle[failure].bind(handle);
            handle[failure] = async (...args) => { await original(...args); throw new Error(`${failure} failed`); };
          }
          return handle;
        }
      };
      await assert.rejects(withInterprocessFileLock({ fsImpl: failingFs, filePath, timeoutMs: 5 }, async () => {}), /Verrou credential indisponible/);
      assert.equal(await fs.stat(`${filePath}.lock`).then(() => true, () => false), false);
    }
  });

  await t.test('open failure leaves no lock behind', async () => {
    const directory = await makeTempDir();
    const filePath = path.join(directory, 'open.json');
    const failingFs = { ...fs, open: async (target, flags) => {
      if (String(target).endsWith('.lock') && flags === 'wx') throw new Error('open failed');
      return fs.open(target, flags);
    } };
    await assert.rejects(withInterprocessFileLock({ fsImpl: failingFs, filePath, timeoutMs: 5 }, async () => {}), /Verrou credential indisponible/);
    assert.equal(await fs.stat(`${filePath}.lock`).then(() => true, () => false), false);
  });

  await t.test('only a proven dead owner is reclaimed', async () => {
    const directory = await makeTempDir();
    const filePath = path.join(directory, 'orphan.json');
    await fs.writeFile(`${filePath}.lock`, '2147483647', 'utf8');
    let executed = false;
    await withInterprocessFileLock({ fsImpl: fs, filePath, timeoutMs: 50 }, async () => { executed = true; });
    assert.equal(executed, true);
    await fs.writeFile(`${filePath}.lock`, String(process.pid), 'utf8');
    await assert.rejects(withInterprocessFileLock({ fsImpl: fs, filePath, timeoutMs: 15, retryMs: 1 }, async () => {}), /Verrou credential indisponible/);
    assert.equal(await fs.readFile(`${filePath}.lock`, 'utf8'), String(process.pid));
    await fs.rm(`${filePath}.lock`);
  });

  await t.test('two concurrent stale recoveries never overlap or reactivate a tombstone', async () => {
    const directory = await makeTempDir();
    const filePath = path.join(directory, 'concurrent-recovery.json');
    const lockPath = `${filePath}.lock`;
    await fs.writeFile(lockPath, '2147483647', 'utf8');
    let renameWaiters = 0;
    let releaseRenames;
    const bothRenames = new Promise((resolve) => { releaseRenames = resolve; });
    const coordinatedFs = {
      ...fs,
      rename: async (source, destination) => {
        if (String(source) === lockPath && String(destination).endsWith('.reclaimed')) {
          renameWaiters += 1;
          if (renameWaiters === 2) releaseRenames();
          await bothRenames;
        }
        return fs.rename(source, destination);
      }
    };
    let active = 0;
    let maximumActive = 0;
    let state = 'active';
    const recover = (name) => withInterprocessFileLock({ fsImpl: coordinatedFs, filePath, timeoutMs: 200, retryMs: 1 }, async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      try {
        if (name === 'revoke') {
          await new Promise((resolve) => setTimeout(resolve, 10));
          state = 'revoked';
        } else if (state === 'active') {
          state = 'revoked';
        }
      } finally {
        active -= 1;
      }
    });
    await Promise.all([recover('revoke'), recover('writer')]);
    assert.equal(maximumActive, 1);
    assert.equal(state, 'revoked');
    assert.equal(await fs.stat(lockPath).then(() => true, () => false), false);
  });
});

test('create is compensated when its final audit fails after the mutation', async () => {
  const directory = await makeTempDir();
  const vault = new ProviderSecretVault({ filePath: path.join(directory, 'vault.json'), safeStorage: fakeSafeStorage });
  let credentialExistedWhenAuditRan = false;
  const service = new ProviderCredentialService({
    vault, auditLedger: { append: async () => {
      credentialExistedWhenAuditRan = credentialExistedWhenAuditRan || (await vault.metadata('cred_33333333-3333-4333-8333-333333333333')) !== null;
      throw new Error('disk unavailable');
    } },
    createId: () => 'cred_33333333-3333-4333-8333-333333333333'
  });
  const result = await service.create({ workspaceId: 'workspace-a', secretValue: 'must-not-persist', metadata: { provider: 'openai', label: 'Production', permissions: [] } });
  assert.equal(result.resultCode, 'audit_unavailable');
  assert.equal(credentialExistedWhenAuditRan, true);
  assert.equal(await vault.metadata('cred_33333333-3333-4333-8333-333333333333'), null);
});

test('replace and rotate restore the preceding state when the second final audit append fails', async (t) => {
  for (const [operation, mutate] of [
    ['replace', (service, input) => service.replace({ ...input, secretValue: 'value-after', metadata: { provider: 'openai', label: 'Updated', permissions: [] } })],
    ['rotate', (service, input) => service.rotate({ ...input, secretValue: 'value-after' })]
  ]) {
    await t.test(operation, async () => {
      const directory = await makeTempDir();
      const vault = new ProviderSecretVault({ filePath: path.join(directory, 'vault.json'), safeStorage: fakeSafeStorage });
      const auditEvents = [];
      let appendCount = 0;
      const service = new ProviderCredentialService({
        vault,
        auditLedger: { append: async (event) => {
          appendCount += 1;
          if (appendCount === 2) throw new Error('audit write failed');
          auditEvents.push(event);
        } },
        createId: () => 'cred_44444444-4444-4444-8444-444444444444'
      });
      const created = await service.create({ workspaceId: 'workspace-a', secretValue: 'value-before', metadata: { provider: 'openai', label: 'Original', permissions: [] } });
      const before = await vault.metadata(created.credential.id);
      const result = await mutate(service, { workspaceId: 'workspace-a', credentialId: created.credential.id });
      assert.equal(result.success, false);
      assert.equal(result.resultCode, 'audit_unavailable');
      assert.equal(auditEvents.at(-1).operationId, result.operationId);
      assert.equal(auditEvents.at(-1).resultCode, 'audit_unavailable');
      assert.deepEqual(await vault.metadata(created.credential.id), before);
      assert.equal(await vault.get(created.credential.id), 'value-before');
    });
  }
});

test('revoke keeps its tombstone when the final audit append fails', async () => {
  const directory = await makeTempDir();
  const vault = new ProviderSecretVault({ filePath: path.join(directory, 'vault.json'), safeStorage: fakeSafeStorage });
  const auditEvents = [];
  let appendCount = 0;
  const service = new ProviderCredentialService({
    vault,
    auditLedger: { append: async (event) => {
      appendCount += 1;
      if (appendCount === 2) throw new Error('audit write failed');
      auditEvents.push(event);
    } },
    createId: () => 'cred_44444444-4444-4444-8444-444444444444'
  });
  const created = await service.create({ workspaceId: 'workspace-a', secretValue: 'value-before', metadata: { provider: 'openai', label: 'Original', permissions: [] } });
  const result = await service.revoke({ workspaceId: 'workspace-a', credentialId: created.credential.id });

  assert.equal(result.success, false);
  assert.equal(result.resultCode, 'audit_unavailable');
  assert.equal(auditEvents.at(-1).operationId, result.operationId);
  assert.equal(auditEvents.at(-1).resultCode, 'audit_unavailable');
  assert.equal((await vault.metadata(created.credential.id)).status, 'revoked');
  assert.equal(await vault.get(created.credential.id), null);
  assert.equal(await service.resolveActive({ workspaceId: 'workspace-a', provider: 'openai' }), null);
  assert.equal((await service.connectivity({ workspaceId: 'workspace-a', credentialId: created.credential.id })).resultCode, 'revoked');
});

test('provider IPC scopes list, revoke and connectivity to the main-derived workspace and credential id', async () => {
  const handlers = {};
  const calls = [];
  const credentialService = {
    list: async (input) => { calls.push(['list', input]); return [{ id: 'cred-a', provider: 'anthropic' }]; },
    revoke: async (input) => { calls.push(['revoke', input]); return { success: true, credential: { id: input.credentialId } }; },
    connectivity: async (input) => { calls.push(['connectivity', input]); return { success: true, credentialId: input.credentialId }; }
  };
  registerProviderHandlers({
    ipc: { handle: (channel, handler) => { handlers[channel] = handler; } },
    app: {}, credentialService,
    resolveWorkspaceContext: async () => ({ workspaceId: 'workspace-a' })
  });
  assert.deepEqual(await handlers['provider:list-credentials']({}, { workspaceId: 'workspace-b' }), {
    success: true, credentials: [{ id: 'cred-a', provider: 'anthropic' }]
  });
  await handlers['provider:revoke']({}, { workspaceId: 'workspace-b', provider: 'anthropic', credentialId: 'cred-a', apiKey: 'must-be-ignored' });
  await handlers['provider:connect']({}, { workspaceId: 'workspace-b', credentialId: 'cred-a', token: 'must-be-ignored' });
  assert.deepEqual(calls, [
    ['list', { workspaceId: 'workspace-a' }],
    ['revoke', { workspaceId: 'workspace-a', credentialId: 'cred-a' }],
    ['connectivity', { workspaceId: 'workspace-a', credentialId: 'cred-a' }]
  ]);
  registerProviderHandlers({
    ipc: { handle: (channel, handler) => { handlers[channel] = handler; } }, app: {}, credentialService,
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
