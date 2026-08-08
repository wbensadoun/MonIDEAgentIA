'use strict';

const DEFAULT_ACCESS_PATH = '/v1/control-plane/access/resolve';
const DEFAULT_REVOKE_PATH = '/v1/control-plane/access/revoke';
const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_CACHE_SKEW_MS = 15000;

const normalizeBaseUrl = (value, label) => {
  const raw = String(value || '').trim();
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${label} invalide.`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hash) {
    throw new Error(`${label} invalide.`);
  }
  return parsed.toString().replace(/\/$/, '');
};

const normalizePath = (value, fallback) => {
  const path = String(value || fallback).trim();
  if (!path.startsWith('/') || path.startsWith('//') || /[\r\n]/.test(path)) {
    throw new Error('Chemin API Neven invalide.');
  }
  return path;
};

const normalizeWorkspaceId = (value) => {
  const workspaceId = String(value || '').trim();
  if (!workspaceId || workspaceId.length > 400 || /[\r\n]/.test(workspaceId)) {
    throw new Error('Workspace Neven invalide.');
  }
  return workspaceId;
};

const normalizeProfile = (value) => {
  const profile = String(value || 'haiku').trim().toLowerCase();
  return ['haiku', 'luna', 'sol', 'opus'].includes(profile) ? profile : 'haiku';
};

const normalizeExpiry = (value) => {
  const timestamp = Date.parse(String(value || ''));
  return Number.isFinite(timestamp) && timestamp > Date.now() ? new Date(timestamp).toISOString() : null;
};

const normalizeAccess = (payload, { workspaceId, gatewayBaseUrl }) => {
  const source = payload?.access && typeof payload.access === 'object' ? payload.access : payload;
  const accessToken = String(source?.accessToken || source?.grantToken || source?.token || '').trim();
  const expiresAt = normalizeExpiry(source?.expiresAt);
  const gatewayUrl = normalizeBaseUrl(source?.gatewayUrl || gatewayBaseUrl, 'Passerelle Neven');

  if (source?.granted === false || !accessToken || !expiresAt || !gatewayUrl) return null;

  return Object.freeze({
    kind: 'neven-gateway',
    workspaceId,
    gatewayUrl,
    accessToken,
    expiresAt,
    scopes: Array.isArray(source?.scopes) ? source.scopes.map((scope) => String(scope)).slice(0, 32) : []
  });
};

const failure = (code, error, extra = {}) => ({
  success: false,
  code,
  error,
  ...extra
});

class NevenControlPlaneClient {
  constructor({
    baseUrl = process.env.NEVEN_CONTROL_PLANE_URL || process.env.NEVEN_API_BASE_URL,
    gatewayBaseUrl = process.env.NEVEN_GATEWAY_URL,
    accessTokenResolver = async () => process.env.NEVEN_ACCESS_TOKEN || process.env.NEVEN_SESSION_TOKEN || null,
    fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    accessPath = process.env.NEVEN_CONTROL_PLANE_ACCESS_PATH || DEFAULT_ACCESS_PATH,
    revokePath = process.env.NEVEN_CONTROL_PLANE_REVOKE_PATH || DEFAULT_REVOKE_PATH
  } = {}) {
    this.baseUrl = normalizeBaseUrl(baseUrl, 'URL du control plane Neven');
    this.gatewayBaseUrl = normalizeBaseUrl(gatewayBaseUrl, 'URL de la passerelle Neven');
    this.accessTokenResolver = accessTokenResolver;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = Math.max(1000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS);
    this.accessPath = normalizePath(accessPath, DEFAULT_ACCESS_PATH);
    this.revokePath = normalizePath(revokePath, DEFAULT_REVOKE_PATH);
  }

  isConfigured() {
    return !!this.baseUrl && typeof this.fetchImpl === 'function';
  }

  async request(path, { method = 'GET', body } = {}) {
    if (!this.isConfigured()) return failure('not_configured', 'Control plane Neven non configure.');

    let accessToken = null;
    try {
      accessToken = String(await this.accessTokenResolver?.() || '').trim() || null;
    } catch {
      return failure('auth_unavailable', 'Session Neven indisponible.');
    }
    if (!accessToken) return failure('auth_required', 'Session Neven requise.');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${normalizePath(path, path)}`, {
        method,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      const raw = await response.text();
      let data = null;
      try {
        data = raw ? JSON.parse(raw) : null;
      } catch {
        data = null;
      }
      if (!response.ok) {
        return failure(`http_${response.status}`, `Control plane Neven indisponible (${response.status}).`, {
          status: response.status
        });
      }
      return { success: true, status: response.status, data };
    } catch (error) {
      if (error?.name === 'AbortError') return failure('timeout', 'Délai dépassé avec le control plane Neven.');
      return failure('network_error', 'Connexion au control plane Neven impossible.');
    } finally {
      clearTimeout(timeout);
    }
  }

  async resolveAccess({ workspaceId, profile = 'haiku', capability = 'completion' } = {}) {
    let normalizedWorkspaceId;
    try {
      normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    } catch (error) {
      return failure('invalid_workspace', error.message);
    }

    const response = await this.request(this.accessPath, {
      method: 'POST',
      body: {
        workspaceId: normalizedWorkspaceId,
        profile: normalizeProfile(profile),
        capability: String(capability || 'completion').trim().slice(0, 80)
      }
    });
    if (!response.success) return response;

    const access = normalizeAccess(response.data, {
      workspaceId: normalizedWorkspaceId,
      gatewayBaseUrl: this.gatewayBaseUrl || this.baseUrl
    });
    return access
      ? { success: true, access }
      : failure('invalid_access_response', 'Réponse d’accès Neven invalide.');
  }

  async revokeAccess({ workspaceId } = {}) {
    let normalizedWorkspaceId;
    try {
      normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    } catch (error) {
      return failure('invalid_workspace', error.message);
    }
    return this.request(this.revokePath, {
      method: 'POST',
      body: { workspaceId: normalizedWorkspaceId }
    });
  }
}

const createNevenAccessResolver = ({ client, cacheSkewMs = DEFAULT_CACHE_SKEW_MS } = {}) => {
  if (!client || typeof client.resolveAccess !== 'function') throw new Error('Client control plane Neven requis.');
  const cache = new Map();

  const resolve = async ({ workspaceId, profile = 'haiku', capability = 'completion' } = {}) => {
    const key = JSON.stringify([String(workspaceId || ''), normalizeProfile(profile), String(capability || 'completion')]);
    const cached = cache.get(key);
    if (cached && Date.parse(cached.expiresAt) > Date.now() + cacheSkewMs) return cached;

    const result = await client.resolveAccess({ workspaceId, profile, capability });
    if (!result?.success || !result.access) return null;
    cache.set(key, result.access);
    return result.access;
  };

  resolve.clear = () => cache.clear();
  resolve.revoke = async ({ workspaceId } = {}) => {
    const result = await client.revokeAccess({ workspaceId });
    if (result?.success) {
      for (const key of cache.keys()) {
        if (key.startsWith(`[\"${String(workspaceId || '')}\"`)) cache.delete(key);
      }
    }
    return result;
  };
  return resolve;
};

module.exports = {
  DEFAULT_ACCESS_PATH,
  DEFAULT_REVOKE_PATH,
  NevenControlPlaneClient,
  createNevenAccessResolver,
  normalizeAccess,
  normalizeBaseUrl,
  normalizeWorkspaceId
};
