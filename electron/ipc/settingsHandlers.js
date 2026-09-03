'use strict';

const { ipcMain } = require('electron');
const {
  readSettingsSafe,
  saveSettings,
  validateApiKey,
  listProviderModels
} = require('../services/settings.service');
const { normalizeCredentialProviderId } = require('../services/provider-id.service');

const LEGACY_SECRET_FIELDS = Object.freeze({
  geminiApiKey: { provider: 'google', label: 'Google Gemini' },
  claudeApiKey: { provider: 'anthropic', label: 'Anthropic Claude' },
  kimiApiKey: { provider: 'kimi', label: 'Together / Kimi' }
});

const publicSettings = async (settings, { credentialService, workspaceId } = {}) => {
  const safe = { ...(settings || {}) };
  const status = {};
  for (const [field, descriptor] of Object.entries(LEGACY_SECRET_FIELDS)) {
    status[field.replace(/ApiKey$/, '')] = typeof safe[field] === 'string' && safe[field].trim().length > 0;
    delete safe[field];
    if (credentialService && workspaceId) {
      try {
        const records = await credentialService.list({ workspaceId });
        status[field.replace(/ApiKey$/, '')] = records.some((record) => (
          record.status === 'active' && normalizeCredentialProviderId(record.provider) === descriptor.provider
        ));
      } catch {
        // Keep the non-secret legacy presence signal if vault metadata is unavailable.
      }
    }
  }
  safe.providerKeyStatus = status;
  return safe;
};

const migrateLegacySecrets = async (settings, { credentialService, workspaceId, persistSettings = saveSettings } = {}) => {
  if (!credentialService || !workspaceId) return settings;
  const records = await credentialService.list({ workspaceId });
  const activeProviders = new Set(records.filter((record) => record.status === 'active').map((record) => normalizeCredentialProviderId(record.provider)));
  let migrated = false;
  for (const [field, descriptor] of Object.entries(LEGACY_SECRET_FIELDS)) {
    const secret = typeof settings?.[field] === 'string' ? settings[field].trim() : '';
    if (!secret) continue;
    if (!activeProviders.has(descriptor.provider)) {
      await credentialService.create({
        workspaceId,
        secretValue: secret,
        metadata: { provider: descriptor.provider, label: descriptor.label, permissions: ['completion'] }
      });
    }
    delete settings[field];
    migrated = true;
  }
  if (migrated) await persistSettings(settings);
  return settings;
};

const providerDescriptor = (provider) => {
  const normalized = normalizeCredentialProviderId(provider);
  return Object.values(LEGACY_SECRET_FIELDS).find((descriptor) => descriptor.provider === normalized) || null;
};

const stripLegacySecrets = (settings) => {
  const safe = { ...(settings || {}) };
  Object.keys(LEGACY_SECRET_FIELDS).forEach((field) => delete safe[field]);
  return safe;
};

const registerSettingsHandlers = ({
  ipc = ipcMain,
  credentialService,
  resolveWorkspaceContext = async () => null,
  legacyMigrationWorkspaceId = null,
  readSettings = readSettingsSafe,
  persistSettings = saveSettings,
  listModels = listProviderModels
} = {}) => {
  ipc.handle('save-settings', async (_event, settings) => {
    try {
      await persistSettings(stripLegacySecrets(settings));
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipc.handle('load-settings', async (event) => {
    try {
      const context = await resolveWorkspaceContext(event);
      const workspaceId = context?.workspaceId || legacyMigrationWorkspaceId;
      const settings = await migrateLegacySecrets(await readSettings(), {
        credentialService,
        workspaceId,
        persistSettings
      });
      return { success: true, settings: await publicSettings(settings, { credentialService, workspaceId }) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipc.handle('save-provider-key', async (event, provider, secretValue) => {
    try {
      if (!credentialService) return { success: false, error: 'Coffre credential indisponible.' };
      const context = await resolveWorkspaceContext(event);
      const workspaceId = context?.workspaceId;
      const descriptor = providerDescriptor(provider);
      const secret = String(secretValue || '').trim();
      if (!workspaceId || !descriptor || !secret) return { success: false, error: 'Provider, workspace ou clé invalide.' };
      const records = await credentialService.list({ workspaceId });
      const existing = records.find((record) => record.status === 'active' && normalizeCredentialProviderId(record.provider) === descriptor.provider);
      const result = existing
        ? await credentialService.replace({ workspaceId, credentialId: existing.id, secretValue: secret, metadata: { provider: descriptor.provider, label: descriptor.label, permissions: ['completion'] } })
        : await credentialService.create({ workspaceId, secretValue: secret, metadata: { provider: descriptor.provider, label: descriptor.label, permissions: ['completion'] } });
      return result.success ? { success: true, hasKey: true } : { success: false, error: 'Enregistrement de la clé impossible.' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipc.handle('validate-api-key', async (event, provider) => {
    try {
      const result = await listProviderModelsForWorkspace(event, provider);
      return { success: result.success, valid: result.valid, modelCount: result.models?.length || 0, error: result.error };
    } catch (error) {
      return { success: false, valid: false, modelCount: 0, error: error.message };
    }
  });

  const listProviderModelsForWorkspace = async (event, provider) => {
    if (String(provider || '').toLowerCase() === 'ollama') return listModels(provider, null);
    if (!credentialService) return { success: false, valid: false, models: [], error: 'Coffre credential indisponible.' };
    const context = await resolveWorkspaceContext(event);
    if (!context?.workspaceId) return { success: false, valid: false, models: [], error: 'Accès workspace fournisseur refusé.' };
    let result = { success: false, valid: false, models: [], error: 'Clé API manquante.' };
    await credentialService.withActiveCredential({ workspaceId: context.workspaceId, provider }, async ({ credential }) => {
      result = await listModels(provider, credential);
    });
    return result;
  };

  ipc.handle('list-provider-models', async (event, provider) => {
    try {
      return await listProviderModelsForWorkspace(event, provider);
    } catch (error) {
      return { success: false, valid: false, models: [], error: error.message };
    }
  });
};

module.exports = {
  LEGACY_SECRET_FIELDS,
  publicSettings,
  migrateLegacySecrets,
  stripLegacySecrets,
  registerSettingsHandlers
};
