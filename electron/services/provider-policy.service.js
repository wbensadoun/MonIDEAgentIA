'use strict';

const crypto = require('node:crypto');

const PROVIDER_ORIGINS = Object.freeze({ neven: 'neven', byok: 'byok', local: 'local' });
const BYOK_POLICIES = Object.freeze({ disabled: 'disabled', nonPriority: 'non_priority', priority: 'priority', mandatory: 'mandatory' });
const OPERATIONAL_ERROR_CODES = new Set(['timeout', 'rate_limited', 'unavailable', 'network_error', 'gateway_error']);

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

const normalizePolicy = (policy = {}) => {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) throw new Error('Policy fournisseur invalide.');
  const byok = policy.byok === undefined ? BYOK_POLICIES.disabled : String(policy.byok).trim().toLowerCase();
  if (!Object.values(BYOK_POLICIES).includes(byok)) throw new Error('Policy BYOK inconnue.');
  return { byok };
};

// Pure: it determines allowed ordered origins and never reads a vault.
const decideProviderOrigins = ({ provider, policy } = {}) => {
  const normalizedProvider = normalizeProvider(provider);
  if (!normalizedProvider) throw new Error('Provider invalide.');
  if (normalizedProvider === 'ollama') return [PROVIDER_ORIGINS.local];
  switch (normalizePolicy(policy).byok) {
    case BYOK_POLICIES.nonPriority: return [PROVIDER_ORIGINS.neven, PROVIDER_ORIGINS.byok];
    case BYOK_POLICIES.priority: return [PROVIDER_ORIGINS.byok, PROVIDER_ORIGINS.neven];
    case BYOK_POLICIES.mandatory: return [PROVIDER_ORIGINS.byok];
    default: return [PROVIDER_ORIGINS.neven];
  }
};

const isPermittedOperationalError = (error) => OPERATIONAL_ERROR_CODES.has(String(error?.code || error?.kind || '').trim().toLowerCase());

const normalizeProviderError = (error, result = {}) => {
  const rawCode = String(error?.code || error?.kind || result.errorCode || '').trim().toLowerCase();
  const status = Number(error?.status || error?.statusCode || result.status || result.statusCode);
  const text = String(typeof error === 'string' ? error : error?.message || '').toLowerCase();
  if (rawCode === 'err_canceled' || result.aborted) return { code: 'cancelled' };
  if (status === 401 || status === 403 || /unauthori[sz]ed|forbidden|permission|access denied|accès refusé|invalid api key/.test(text)) return { code: 'permission_denied' };
  if (status === 429 || /\b429\b|rate.?limit|too many requests|quota/.test(text)) return { code: 'rate_limited' };
  if (rawCode === 'provider_timeout' || /timeout|timed out|deadline exceeded|etimedout|econnaborted/.test(`${rawCode} ${text}`)) return { code: 'timeout' };
  if (/network|fetch failed|econn|enotfound|eai_again|socket/.test(`${rawCode} ${text}`)) return { code: 'network_error' };
  if ([502, 503, 504].includes(status) || /gateway|service unavailable|temporarily unavailable|http (502|503|504)/.test(text)) return { code: 'unavailable' };
  if (result.retryable === true || error?.retryable === true) return { code: 'gateway_error' };
  return { code: 'provider_error' };
};

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

  const origin = decideProviderOrigins({ provider: normalizedProvider, policy })[0];
  if (origin === PROVIDER_ORIGINS.byok && vault) {
    const secretId = getCredentialId({ workspaceId, provider: normalizedProvider });
    const credential = await vault.get(secretId);
    if (credential) return { provider: normalizedProvider, origin: PROVIDER_ORIGINS.byok, credential, secretId };
  }

  if (origin !== PROVIDER_ORIGINS.neven) return { provider: normalizedProvider, origin: null, credential: null };
  const nevenCredential = await nevenCredentialResolver?.({ provider: normalizedProvider, workspaceId });
  if (nevenCredential) return { provider: normalizedProvider, origin: PROVIDER_ORIGINS.neven, credential: nevenCredential };

  return { provider: normalizedProvider, origin: null, credential: null };
};

// Gateway execution is injected. COD-26 owns real provider gateway wiring.
const executeProviderPolicy = async ({ provider, workspaceId, policy, resolveCredential, attempt, ledger, usage = {} } = {}) => {
  if (typeof resolveCredential !== 'function' || typeof attempt !== 'function') throw new Error('Dependances managed requises.');
  const normalizedProvider = normalizeProvider(provider);
  const origins = decideProviderOrigins({ provider: normalizedProvider, policy });
  let lastResult = null;
  let credentialUnavailable = false;
  for (let index = 0; index < origins.length; index += 1) {
    const origin = origins[index];
    const credential = await resolveCredential({ origin, provider: normalizedProvider, workspaceId });
    if (credential?.unavailable === true) {
      // A managed origin may be authorized but not executable yet. This is not
      // a provider credential and must never reach a provider adapter.
      lastResult = { success: false, error: { code: 'unavailable' } };
      continue;
    }
    if (credential == null && origin !== PROVIDER_ORIGINS.local) {
      credentialUnavailable = true;
      continue;
    }
    let attempted;
    try {
      attempted = await attempt({ origin, provider: normalizedProvider, workspaceId, credential });
    } catch (error) {
      attempted = { success: false, error, retryable: error?.retryable === true };
    }
    const rawResult = attempted && typeof attempted === 'object' ? attempted : { success: false, error: 'Réponse provider invalide.' };
    const result = rawResult.success === true ? rawResult : {
      ...rawResult,
      error: normalizeProviderError(rawResult.error, rawResult)
    };
    const usageEvent = typeof usage === 'function' ? usage(result) : usage;
    await ledger?.append?.({ workspaceId, origin, providerId: normalizedProvider, ...usageEvent, success: result.success === true });
    if (result.success === true || index === origins.length - 1 || !isPermittedOperationalError(result.error)) return { ...result, origin };
    lastResult = result;
  }
  return {
    success: false,
    origin: null,
    error: lastResult?.error || (credentialUnavailable ? { code: 'credential_unavailable' } : { code: 'unavailable' })
  };
};

module.exports = {
  PROVIDER_ORIGINS,
  BYOK_POLICIES,
  OPERATIONAL_ERROR_CODES,
  getCredentialId,
  normalizePolicy,
  normalizeProvider,
  decideProviderOrigins,
  isPermittedOperationalError,
  normalizeProviderError,
  executeProviderPolicy,
  resolveProviderCredential
};
