'use strict';

const DEFAULT_ACCESS_PATH = '/v1/control-plane/access/resolve';
const DEFAULT_REVOKE_PATH = '/v1/control-plane/access/revoke';
const DEFAULT_COMPLETION_PATH = '/v1/gateway/completions';
const DEFAULT_INGEST_PATH = '/api/v1/internal/events';
const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_CACHE_SKEW_MS = 15000;
const USAGE_PROFILES = new Set(['haiku', 'luna', 'sol', 'opus']);
const USAGE_ORIGINS = new Set(['neven', 'byok', 'local']);

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

const normalizeUsageNumber = (value) => {
  if (value === undefined || value === null || value === '') return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : undefined;
};

const normalizeUsageEvent = (event = {}, now = () => new Date().toISOString()) => {
  const workspaceId = String(event.workspaceId || process.env.NEVEN_WORKSPACE_ID || '').trim();
  if (!workspaceId || workspaceId.length > 256 || /[\r\n]/.test(workspaceId)) {
    throw new Error('Workspace Neven invalide.');
  }
  const profile = String(event.profile || 'haiku').trim().toLowerCase();
  const origin = String(event.origin || 'neven').trim().toLowerCase();
  const provider = String(event.provider || 'other').trim().toLowerCase();
  const inputTokens = normalizeUsageNumber(event.inputTokens);
  const outputTokens = normalizeUsageNumber(event.outputTokens);
  const durationMs = normalizeUsageNumber(event.durationMs);
  const payload = {
    eventId: String(event.eventId || '').trim(),
    eventType: 'usage.completed',
    source: 'code-companion',
    workspaceId,
    ...(event.runId ? { runId: String(event.runId).trim().slice(0, 128) } : {}),
    profile: USAGE_PROFILES.has(profile) ? profile : 'haiku',
    provider: provider && provider.length <= 128 ? provider : 'other',
    origin: USAGE_ORIGINS.has(origin) ? origin : 'neven',
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(durationMs === undefined ? {} : { durationMs }),
    success: Boolean(event.success),
    occurredAt: String(event.occurredAt || now())
  };
  if (!payload.eventId || payload.eventId.length > 128 || /[\r\n]/.test(payload.eventId)) {
    throw new Error('Identifiant d\'evenement Neven invalide.');
  }
  if (event.runId && (!payload.runId || /[\r\n]/.test(payload.runId))) {
    throw new Error('Identifiant de run Neven invalide.');
  }
  return payload;
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
    revokePath = process.env.NEVEN_CONTROL_PLANE_REVOKE_PATH || DEFAULT_REVOKE_PATH,
    ingestPath = process.env.NEVEN_CONTROL_PLANE_INGEST_PATH || DEFAULT_INGEST_PATH,
    ingestTokenResolver = async () => process.env.NEVEN_CONTROL_PLANE_INGEST_TOKEN || null
  } = {}) {
    this.baseUrl = normalizeBaseUrl(baseUrl, 'URL du control plane Neven');
    this.gatewayBaseUrl = normalizeBaseUrl(gatewayBaseUrl, 'URL de la passerelle Neven');
    this.accessTokenResolver = accessTokenResolver;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = Math.max(100, Number(timeoutMs) || DEFAULT_TIMEOUT_MS);
    this.accessPath = normalizePath(accessPath, DEFAULT_ACCESS_PATH);
    this.revokePath = normalizePath(revokePath, DEFAULT_REVOKE_PATH);
    this.ingestPath = normalizePath(ingestPath, DEFAULT_INGEST_PATH);
    this.ingestTokenResolver = ingestTokenResolver;
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

  async executeManagedCompletion(access, payload) {
    if (!access || access.kind !== 'neven-gateway' || !normalizeExpiry(access.expiresAt)) {
      return failure('invalid_gateway_access', 'Acces managed Neven invalide.');
    }
    let gatewayUrl;
    try {
      gatewayUrl = normalizeBaseUrl(access.gatewayUrl, 'Passerelle Neven');
    } catch {
      return failure('invalid_gateway_access', 'Acces managed Neven invalide.');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${gatewayUrl}${DEFAULT_COMPLETION_PATH}`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${access.accessToken}`,
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      const raw = await response.text();
      let data = null;
      try { data = raw ? JSON.parse(raw) : null; } catch { /* invalid gateway response */ }
      if (!response.ok) return failure(`gateway_http_${response.status}`, 'Passerelle IA indisponible.', { status: response.status });
      if (!data || data.success !== true || typeof data.text !== 'string') {
        return failure('invalid_gateway_response', 'Reponse de passerelle IA invalide.');
      }
      return { success: true, text: data.text };
    } catch (error) {
      if (error?.name === 'AbortError') return failure('gateway_timeout', 'Delai depasse avec la passerelle IA.');
      return failure('gateway_network_error', 'Connexion a la passerelle IA impossible.');
    } finally {
      clearTimeout(timeout);
    }
  }

  async publishUsageEvent(event, { now } = {}) {
    if (!this.isConfigured()) return failure('not_configured', 'Ingestion Neven non configure.');

    let token;
    try {
      token = String(await this.ingestTokenResolver?.() || '').trim();
    } catch {
      return failure('ingest_auth_unavailable', 'Jeton d ingestion Neven indisponible.');
    }
    if (!token) return failure('ingest_auth_required', 'Jeton d ingestion Neven requis.');

    let payload;
    try {
      payload = normalizeUsageEvent(event, now || (() => new Date().toISOString()));
    } catch (error) {
      return failure('invalid_usage_event', error.message);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${this.ingestPath}`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Neven-Ingest-Token': token
        },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        return failure(`http_${response.status}`, `Ingestion Neven refusee (${response.status}).`, {
          status: response.status
        });
      }
      return { success: true, status: response.status };
    } catch (error) {
      if (error?.name === 'AbortError') return failure('timeout', 'Delai depasse avec l ingestion Neven.');
      return failure('network_error', 'Connexion a l ingestion Neven impossible.');
    } finally {
      clearTimeout(timeout);
    }
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

const createManagedCompletionExecutor = ({ client, resolveAccess } = {}) => {
  if (!client || typeof client.executeManagedCompletion !== 'function' || typeof resolveAccess !== 'function') {
    throw new Error('Execution managed Neven non configuree.');
  }
  return async ({ workspaceId, profile = 'haiku', payload } = {}) => {
    const access = await resolveAccess({ workspaceId, profile, capability: 'completion' });
    if (!access) return failure('managed_access_denied', 'Execution managed Neven indisponible.');
    return client.executeManagedCompletion(access, payload);
  };
};

module.exports = {
  DEFAULT_ACCESS_PATH,
  DEFAULT_REVOKE_PATH,
  DEFAULT_COMPLETION_PATH,
  DEFAULT_INGEST_PATH,
  NevenControlPlaneClient,
  createNevenAccessResolver,
  createManagedCompletionExecutor,
  normalizeAccess,
  normalizeBaseUrl,
  normalizeWorkspaceId,
  normalizeUsageEvent
};
