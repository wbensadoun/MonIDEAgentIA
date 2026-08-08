'use strict';

const crypto = require('node:crypto');

const PROVIDER_ORIGINS = Object.freeze({
  neven: 'neven',
  byok: 'byok',
  local: 'local'
});

const normalizeProvider = (provider) => String(provider || '').trim().toLowerCase();

const normalizeWorkspaceId = (workspaceId) => {
  const value = String(workspaceId || '').trim();
  if (!value || value.length > 400 || /[\r\n]/.test(value)) throw new Error('Workspace invalide.');
  return value;
};

const getCredentialId = ({ workspaceId, provider }) =>
  `workspace:${crypto.createHash('sha256')
    .update(JSON.stringify([normalizeWorkspaceId(workspaceId), normalizeProvider(provider)]))
    .digest('hex')}`;

const normalizePolicy = (policy = {}) => ({
  prioritizeUserKeys: policy.prioritizeUserKeys === true,
  allowFallbackToNeven: policy.allowFallbackToNeven !== false
});

const resolveProviderCredential = async ({
  provider,
  workspaceId,
  policy,
  vault,
  nevenCredentialResolver,
  localCredentialResolver
}) => {
  const normalizedProvider = normalizeProvider(provider);
  if (normalizedProvider === 'ollama') {
    return {
      provider: normalizedProvider,
      origin: PROVIDER_ORIGINS.local,
      credential: await localCredentialResolver?.({ provider: normalizedProvider, workspaceId }) || null
    };
  }

  const normalizedPolicy = normalizePolicy(policy);
  if (normalizedPolicy.prioritizeUserKeys && vault) {
    const secretId = getCredentialId({ workspaceId, provider: normalizedProvider });
    const credential = await vault.get(secretId);
    if (credential) return { provider: normalizedProvider, origin: PROVIDER_ORIGINS.byok, credential, secretId };
  }

  if (normalizedPolicy.allowFallbackToNeven === false) {
    return { provider: normalizedProvider, origin: null, credential: null };
  }

  const nevenCredential = await nevenCredentialResolver?.({ provider: normalizedProvider });
  if (nevenCredential) return { provider: normalizedProvider, origin: PROVIDER_ORIGINS.neven, credential: nevenCredential };

  return { provider: normalizedProvider, origin: null, credential: null };
};

module.exports = {
  PROVIDER_ORIGINS,
  getCredentialId,
  normalizePolicy,
  normalizeProvider,
  resolveProviderCredential
};
