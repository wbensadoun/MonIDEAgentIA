'use strict';

const {
  DEFAULT_CACHE_SKEW_MS,
  normalizeBaseUrl,
  normalizeDeviceId,
  normalizeProfile,
  normalizeSubjectId,
  normalizeWorkspaceId
} = require('./neven-control-plane.service');

const DEFAULT_GATEWAY_PATH = '/completions';
const DEFAULT_TIMEOUT_MS = 10000;
const NEVEN_MANAGED_GATEWAY_FEATURE_FLAG = 'NEVEN_MANAGED_GATEWAY_ENABLED';
const MODES = new Set(['chat', 'inline', 'ghost']);

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

const normalizeBoundedText = (value, field, max, { required = false, trim = false } = {}) => {
  if (value === undefined || value === null) {
    if (required) throw new Error(`${field} requis.`);
    return undefined;
  }
  const text = String(value);
  const normalized = trim ? text.trim() : text;
  if (normalized.length > max || (required && !normalized)) throw new Error(`${field} invalide.`);
  return normalized;
};

const normalizeHistory = (history) => {
  if (history === undefined) return undefined;
  if (!Array.isArray(history) || history.length > 12) throw new Error('Historique invalide.');
  return history.map((item) => {
    const role = item?.role;
    if (role !== 'user' && role !== 'assistant') throw new Error('Historique invalide.');
    return {
      role,
      content: normalizeBoundedText(item?.content ?? item?.text, 'Contenu historique', 8000, { required: true, trim: true })
    };
  });
};

const normalizeMode = (mode, request = {}) => {
  const candidate = mode || request.mode || ({ chat: 'chat', inline: 'inline', ghost: 'ghost' }[request.kind]);
  if (!MODES.has(candidate)) throw new Error('Mode gateway invalide.');
  return candidate;
};

// The payload deliberately has no provider identifier. Provider selection and
// credentials remain the gateway's responsibility.
const buildGatewayPayload = ({ workspaceId, deviceId, subjectId, profile = 'lumen', capability = 'completion', mode, request = {} } = {}) => {
  const payload = {
    workspaceId: normalizeWorkspaceId(workspaceId),
    deviceId: normalizeDeviceId(deviceId),
    subjectId: normalizeSubjectId(subjectId),
    profile: normalizeProfile(profile),
    capability: capability === 'completion' ? 'completion' : (() => { throw new Error('Capacité gateway invalide.'); })(),
    mode: normalizeMode(mode, request)
  };
  const history = normalizeHistory(request.history);
  const systemInstruction = normalizeBoundedText(request.systemInstruction, 'Instruction système', 4000, { trim: true });
  const userPrompt = normalizeBoundedText(request.userPrompt, 'Prompt utilisateur', 8000, { required: true, trim: true });
  const currentCode = normalizeBoundedText(request.currentCode, 'Code courant', 12000);
  if (history !== undefined) payload.history = history;
  if (systemInstruction !== undefined) payload.systemInstruction = systemInstruction;
  payload.userPrompt = userPrompt;
  if (currentCode !== undefined) payload.currentCode = currentCode;
  return payload;
};

class NevenManagedGatewayClient {
  constructor({ allowedHosts = process.env.NEVEN_CONTROL_PLANE_ALLOWED_HOSTS, allowLoopback, fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS, completionPath = DEFAULT_GATEWAY_PATH, cacheSkewMs = DEFAULT_CACHE_SKEW_MS } = {}) {
    this.allowedHosts = allowedHosts;
    this.allowLoopback = allowLoopback;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = Math.max(1000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS);
    this.completionPath = String(completionPath || DEFAULT_GATEWAY_PATH);
    this.cacheSkewMs = Math.max(0, Number(cacheSkewMs) || DEFAULT_CACHE_SKEW_MS);
  }

  async complete({ access, workspaceId, deviceId, profile, capability, mode, request } = {}) {
    if (!access?.grant || !access?.gatewayUrl) return failure('grant_unavailable', 'Grant Neven indisponible.');
    let gatewayUrl;
    let body;
    try {
      gatewayUrl = normalizeBaseUrl(access.gatewayUrl, 'Passerelle Neven', { allowedHosts: this.allowedHosts, allowLoopback: this.allowLoopback });
      const expiresAt = Date.parse(access.expiresAt);
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() + this.cacheSkewMs) return failure('grant_expired', 'Grant Neven expiré.');
      const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId || access.workspaceId);
      const normalizedDeviceId = normalizeDeviceId(deviceId || access.deviceId);
      if (access.workspaceId !== normalizedWorkspaceId || access.deviceId !== normalizedDeviceId) {
        return failure('gateway_invalid_request', 'Requête managed Neven invalide.');
      }
      body = buildGatewayPayload({
        workspaceId: normalizedWorkspaceId,
        deviceId: normalizedDeviceId,
        subjectId: access.subjectId,
        profile: profile || access.profile,
        capability: capability || access.capability,
        mode,
        request
      });
    } catch {
      return failure('gateway_invalid_request', 'Requête managed Neven invalide.');
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${gatewayUrl}${this.completionPath}`, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { Authorization: `Bearer ${access.grant}`, Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const raw = await response.text();
      let data = null;
      try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
      if (!response.ok) return failure(normalizeGatewayError(null, {
        status: response.status,
        code: data?.code || data?.error?.code
      }), 'Passerelle Neven indisponible.');
      const completion = data?.data;
      if (!completion || typeof completion.text !== 'string') return failure('gateway_invalid_response', 'Réponse passerelle Neven invalide.');
      return {
        success: true,
        text: completion.text,
        usage: completion.usage || null
      };
    } catch (error) {
      return failure(normalizeGatewayError(error), 'Passerelle Neven indisponible.');
    } finally {
      clearTimeout(timeout);
    }
  }
}

const createManagedGatewayCompletion = ({ accessResolver, gatewayClient, enabled = isNevenManagedGatewayEnabled() } = {}) => {
  if (!accessResolver || typeof accessResolver !== 'function' || !gatewayClient || typeof gatewayClient.complete !== 'function') throw new Error('Dépendances passerelle Neven requises.');
  return async ({ workspaceId, deviceId, profile = 'lumen', capability = 'completion', mode, request = {}, access } = {}) => {
    if (!enabled) return failure('managed_disabled', 'Mode managed Neven désactivé.');
    let grant = access || await accessResolver({ workspaceId, deviceId, profile, capability });
    let result = await gatewayClient.complete({ access: grant, workspaceId, deviceId, profile, capability, mode, request });
    if (result?.error?.code !== 'grant_expired') return result;
    accessResolver.invalidate?.({ workspaceId, deviceId, profile, capability });
    grant = await accessResolver({ workspaceId, deviceId, profile, capability });
    result = await gatewayClient.complete({ access: grant, workspaceId, deviceId, profile, capability, mode, request });
    return result;
  };
};

module.exports = { DEFAULT_GATEWAY_PATH, NEVEN_MANAGED_GATEWAY_FEATURE_FLAG, NevenManagedGatewayClient, buildGatewayPayload, createManagedGatewayCompletion, isNevenManagedGatewayEnabled, normalizeGatewayError };
