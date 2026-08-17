'use strict';

const { ipcMain } = require('electron');
const { ProviderSecretVault } = require('../services/provider-secret-vault.service');
const { ProviderCredentialService } = require('../services/provider-credential.service');

const registerProviderHandlers = ({ ipc = ipcMain, app, vault, credentialService, resolveWorkspaceContext = async () => null } = {}) => {
  const getVault = () => vault || new ProviderSecretVault({
    filePath: ProviderSecretVault.defaultFilePath(app.getPath('userData'))
  });
  const getCredentialService = () => credentialService || new ProviderCredentialService({ vault: getVault() });

  ipc.handle('provider:list-credentials', async (event) => {
    try {
      const context = await resolveWorkspaceContext(event);
      if (!context?.workspaceId) return { success: false, credentials: [], error: 'Accès workspace fournisseur refusé.' };
      return { success: true, credentials: await getCredentialService().list({ workspaceId: context.workspaceId }) };
    } catch {
      return { success: false, credentials: [], error: 'Lecture des credentials indisponible.' };
    }
  });

  // Credentials are provisioned by a backend-owned managed integration only.
  // Renderer IPC cannot submit policy, origin or secrets.
  ipc.handle('provider:connect', async (event, payload = {}) => {
    const context = await resolveWorkspaceContext(event);
    if (!context?.workspaceId) return { success: false, resultCode: 'invalid_request' };
    // Only a main-scoped credential id is accepted. Renderer secrets and workspace ids are ignored.
    return getCredentialService().connectivity({ workspaceId: context.workspaceId, credentialId: payload?.credentialId });
  });

  ipc.handle('provider:revoke', async (event, payload = {}) => {
    try {
      const context = await resolveWorkspaceContext(event);
      if (!context?.workspaceId) return { success: false, error: 'Accès workspace fournisseur refusé.' };
      return await getCredentialService().revoke({ workspaceId: context.workspaceId, credentialId: payload?.credentialId });
    } catch {
      return { success: false, resultCode: 'failed' };
    }
  });

  return getCredentialService;
};

module.exports = { registerProviderHandlers };
