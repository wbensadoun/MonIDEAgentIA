'use strict';

const { ipcMain } = require('electron');
const { ProviderSecretVault } = require('../services/provider-secret-vault.service');
const { getCredentialId } = require('../services/provider-policy.service');

const normalizeProvider = (provider) => String(provider || '').trim().toLowerCase();

const registerProviderHandlers = ({ ipc = ipcMain, app, vault, resolveWorkspaceContext = async () => null } = {}) => {
  const getVault = () => vault || new ProviderSecretVault({
    filePath: ProviderSecretVault.defaultFilePath(app.getPath('userData'))
  });

  ipc.handle('provider:list-credentials', async (event) => {
    try {
      const context = await resolveWorkspaceContext(event);
      if (!context?.workspaceId) return { success: false, credentials: [], error: 'Accès workspace fournisseur refusé.' };
      const credentials = await getVault().listMetadata();
      return { success: true, credentials: credentials.filter((credential) => credential.workspaceId === context.workspaceId) };
    } catch (error) {
      return { success: false, credentials: [], error: error.message };
    }
  });

  // Credentials are provisioned by a backend-owned managed integration only.
  // Renderer IPC cannot submit policy, origin or secrets.
  ipc.handle('provider:connect', async () => ({ success: false, error: 'Provisionnement de credential indisponible depuis le renderer.' }));

  ipc.handle('provider:revoke', async (event, payload = {}) => {
    try {
      const context = await resolveWorkspaceContext(event);
      if (!context?.workspaceId) return { success: false, error: 'Accès workspace fournisseur refusé.' };
      const secretId = getCredentialId({ workspaceId: context.workspaceId, provider: normalizeProvider(payload.provider) });
      return { success: await getVault().revoke(secretId) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  return getVault;
};

module.exports = { registerProviderHandlers };
