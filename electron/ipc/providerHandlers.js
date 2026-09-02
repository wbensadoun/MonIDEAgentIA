'use strict';

const { ipcMain } = require('electron');
const { ProviderSecretVault } = require('../services/provider-secret-vault.service');
const { getCredentialId } = require('../services/provider-policy.service');

const normalizeProvider = (provider) => String(provider || '').trim().toLowerCase();

const registerProviderHandlers = ({ ipc = ipcMain, app, vault, embeddingCatalogue = null } = {}) => {
  const getVault = () => vault || new ProviderSecretVault({
    filePath: ProviderSecretVault.defaultFilePath(app.getPath('userData'))
  });

  ipc.handle('provider:list-credentials', async () => {
    try {
      return { success: true, credentials: await getVault().listMetadata() };
    } catch (error) {
      return { success: false, credentials: [], error: error.message };
    }
  });

  ipc.handle('provider:connect', async (_event, payload = {}) => {
    try {
      const provider = normalizeProvider(payload.provider);
      const workspaceId = String(payload.workspaceId || '').trim();
      const secretId = getCredentialId({ workspaceId, provider });
      const metadata = await getVault().put(secretId, payload.apiKey, {
        provider,
        workspaceId,
        label: String(payload.label || provider).trim().slice(0, 120),
        scope: 'workspace'
      });
      return { success: true, credential: metadata };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipc.handle('provider:revoke', async (_event, payload = {}) => {
    try {
      const secretId = getCredentialId(payload);
      return { success: await getVault().revoke(secretId) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Safe catalogue only: no endpoint, credential identifier or secret leaves
  // the main process. It lets the UI report whether semantic indexing is
  // genuinely available instead of implying a hash-vector fallback.
  ipc.handle('provider:list-embedding-capabilities', async () => ({
    success: true,
    providers: embeddingCatalogue?.list?.() || []
  }));

  return getVault;
};

module.exports = { registerProviderHandlers };
