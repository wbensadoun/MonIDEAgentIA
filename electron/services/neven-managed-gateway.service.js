'use strict';

const { DEFAULT_CACHE_SKEW_MS, normalizeBaseUrl, normalizeWorkspaceId } = require('./neven-control-plane.service');

const DEFAULT_GATEWAY_PATH = '/v1/gateway/completions';
const DEFAULT_TIMEOUT_MS = 10000;
const NEVEN_MANAGED_GATEWAY_FEATURE_FLAG = 'NEVEN_MANAGED_GATEWAY_ENABLED';

const isNevenManagedGatewayEnabled = (env = process.env) =>
  new Set(['true', '1', 'on', 'yes']).has(String(env?.[NEVEN_MANAGED_GATEWAY_FEATURE_FLAG] || '').trim().toLowerCase());

const failure = (code, error) => ({ success: false, error: { code, error } });

const normalizeGatewayError = (error, response = {}) => {
  const status = Number(response.status || error?.status || error?.statusCode);
  const code = String(response.code || error?.code || '').toLowerCase();
  if (code === 'grant_expired' || code === 'token_expired') return 'grant_expired';
  if (status === 401) return 'grant_expired';
  if (status === 403) return 'permission_denied';
  if (error?.name === 'AbortError') return 'gateway_timeout';
  if ([502, 503, 504].includes(status)) return 'gateway_unavailable';
  if (status >= 400) return 'gateway_rejected';
  return 'gateway_network';
};

const normalizeText = (value, max = 200000) => String(value || '').slice(0, max);

// The payload deliberately has no provider identifier. Provider selection and
// credentials remain the gateway's responsibility.
const buildGatewayPayload = ({ workspaceId, profile = 'haiku', capability = 'completion', request = {}, options = {} } = {}) => ({
  workspaceId: normalizeWorkspaceId(workspaceId),
  profile: String(profile || 'haiku').trim().toLowerCase(),
  capability: String(capability || 'completion').trim(),
  request: {
    systemInstruction: normalizeText(request.systemInstruction),
    userPrompt: normalizeText(request.userPrompt),
    maxTokens: Number.isFinite(Number(request.maxTokens)) ? Number(request.maxTokens) : undefined,
    temperature: Number.isFinite(Number(options.temperature)) ? Number(options.temperature) : undefined
  }
});

class NevenManagedGatewayClient {
  constructor({ allowedHosts = process.env.NEVEN_CONTROL_PLANE_ALLOWED_HOSTS, allowLoopback, fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS, completionPath = DEFAULT_GATEWAY_PATH, cacheSkewMs = DEFAULT_CACHE_SKEW_MS } = {}) {
    this.allowedHosts = allowedHosts;
    this.allowLoopback = allowLoopback;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = Math.max(1000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS);
    this.completionPath = String(completionPath || DEFAULT_GATEWAY_PATH);
    this.cacheSkewMs = Math.max(0, Number(cacheSkewMs) || DEFAULT_CACHE_SKEW_MS);
  }

  async complete({ access, workspaceId, profile, capability, request, options } = {}) {
    if (!access?.accessToken || !access?.gatewayUrl) return failure('grant_unavailable', 'Grant Neven indisponible.');
    let gatewayUrl;
    let body;
    try {
      gatewayUrl = normalizeBaseUrl(access.gatewayUrl, 'Passerelle Neven', { allowedHosts: this.allowedHosts, allowLoopback: this.allowLoopback });
      const expiresAt = Date.parse(access.expiresAt);
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() + this.cacheSkewMs) return failure('grant_expired', 'Grant Neven expiré.');
      body = buildGatewayPayload({ workspaceId, profile, capability, request, options });
    } catch {
      return failure('gateway_invalid_request', 'Requête managed Neven invalide.');
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${gatewayUrl}${this.completionPath}`, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { Authorization: `Bearer ${access.accessToken}`, Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const raw = await response.text();
      let data = null;
      try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
      if (!response.ok) return failure(normalizeGatewayError(null, {
        status: response.status,
        code: data?.code || data?.error?.code
      }), 'Passerelle Neven indisponible.');
      if (!data || data.success === false || typeof data.text !== 'string') return failure('gateway_invalid_response', 'Réponse passerelle Neven invalide.');
      return { success: true, text: data.text, usage: data.usage || null };
    } catch (error) {
      return failure(normalizeGatewayError(error), 'Passerelle Neven indisponible.');
    } finally {
      clearTimeout(timeout);
    }
  }
}

const createManagedGatewayCompletion = ({ accessResolver, gatewayClient, enabled = isNevenManagedGatewayEnabled() } = {}) => {
  if (!accessResolver || typeof accessResolver !== 'function' || !gatewayClient || typeof gatewayClient.complete !== 'function') throw new Error('Dépendances passerelle Neven requises.');
  return async ({ workspaceId, profile = 'haiku', capability = 'completion', request = {}, options = {}, access } = {}) => {
    if (!enabled) return failure('managed_disabled', 'Mode managed Neven désactivé.');
    let grant = access || await accessResolver({ workspaceId, profile, capability });
    let result = await gatewayClient.complete({ access: grant, workspaceId, profile, capability, request, options });
    if (result?.error?.code !== 'grant_expired') return result;
    accessResolver.invalidate?.({ workspaceId, profile, capability });
    grant = await accessResolver({ workspaceId, profile, capability });
    result = await gatewayClient.complete({ access: grant, workspaceId, profile, capability, request, options });
    return result;
  };
};

module.exports = { DEFAULT_GATEWAY_PATH, NEVEN_MANAGED_GATEWAY_FEATURE_FLAG, NevenManagedGatewayClient, buildGatewayPayload, createManagedGatewayCompletion, isNevenManagedGatewayEnabled, normalizeGatewayError };
