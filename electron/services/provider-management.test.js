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
  resolveProviderCredential
} = require('./provider-policy.service');

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
});

test('provider policy defaults to Neven and only prioritizes workspace BYOK when enabled', async () => {
  const vault = { get: async (id) => id === getCredentialId({ workspaceId: 'demo', provider: 'claude' }) ? 'byok-secret' : null };
  const neven = async () => 'neven-secret';

  const standard = await resolveProviderCredential({
    provider: 'claude', workspaceId: 'demo', vault,
    policy: {}, nevenCredentialResolver: neven
  });
  assert.deepEqual({ origin: standard.origin, credential: standard.credential }, { origin: 'neven', credential: 'neven-secret' });

  const prioritized = await resolveProviderCredential({
    provider: 'claude', workspaceId: 'demo', vault,
    policy: { prioritizeUserKeys: true }, nevenCredentialResolver: neven
  });
  assert.deepEqual({ origin: prioritized.origin, credential: prioritized.credential }, { origin: 'byok', credential: 'byok-secret' });

  const noFallback = await resolveProviderCredential({
    provider: 'claude', workspaceId: 'other', vault,
    policy: { allowFallbackToNeven: false }, nevenCredentialResolver: neven
  });
  assert.deepEqual({ origin: noFallback.origin, credential: noFallback.credential }, { origin: null, credential: null });
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
