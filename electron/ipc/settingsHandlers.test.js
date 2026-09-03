const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  migrateLegacySecrets,
  publicSettings,
  stripLegacySecrets
} = require('./settingsHandlers');

describe('settings IPC secret boundary', () => {
  test('redacts legacy provider values and exposes only vault status', async () => {
    const list = async () => [{ provider: 'google', status: 'active' }];
    const result = await publicSettings({
      geminiApiKey: 'renderer-must-not-see-this',
      defaultProvider: 'gemini'
    }, {
      workspaceId: 'workspace-1',
      credentialService: {
        list
      }
    });

    assert.equal(Object.hasOwn(result, 'geminiApiKey'), false);
    assert.equal(result.providerKeyStatus.gemini, true);
    assert.equal(result.defaultProvider, 'gemini');
  });

  test('migrates a legacy value into the vault and persists redacted settings', async () => {
    const settings = { claudeApiKey: 'legacy-value', claudeModel: 'claude-test' };
    const createCalls = [];
    const create = async (payload) => {
      createCalls.push(payload);
      return { success: true };
    };
    const persisted = [];
    const persistSettings = async (value) => {
      persisted.push(value);
    };

    await migrateLegacySecrets(settings, {
      workspaceId: 'workspace-1',
      credentialService: {
        list: async () => [],
        create
      },
      persistSettings
    });

    assert.equal(createCalls.length, 1);
    assert.equal(createCalls[0].workspaceId, 'workspace-1');
    assert.equal(createCalls[0].secretValue, 'legacy-value');
    assert.equal(createCalls[0].metadata.provider, 'anthropic');
    assert.equal(Object.hasOwn(settings, 'claudeApiKey'), false);
    assert.deepEqual(persisted, [{ claudeModel: 'claude-test' }]);
  });

  test('strips legacy values before persistence', () => {
    assert.deepEqual(stripLegacySecrets({ geminiApiKey: 'x', kimiApiKey: 'y', safe: true }), { safe: true });
  });
});
