'use strict';

const DEFAULT_ACCESS_PATH = '/api/v1/control-plane/access/resolve';
const DEFAULT_REVOKE_PATH = '/api/v1/control-plane/access/revoke';
const DEFAULT_EVENTS_PATH = '/api/v1/internal/events';
const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_CACHE_SKEW_MS = 15000;
const DEFAULT_GATEWAY_BASE_PATH = '/api/v1/gateway';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GRANT_PATTERN = /^[^\s\r\n]{1,4096}$/;
const PROFILES = new Set(['haiku', 'luna', 'sol', 'opus']);
const USAGE_ORIGINS = new Set(['neven', 'byok', 'local']);
const USAGE_PROVIDERS = new Set(['gemini', 'claude', 'kimi', 'ollama', 'dashscope', 'neven']);
const MAX_EVENT_ID_LENGTH = 160;
const MAX_IDENTIFIER_LENGTH = 80;
const MAX_TOKEN_COUNT = 1000000000;
const MAX_DURATION_MS = 86400000;

const isLoopbackHost = (hostname) => ['localhost', '127.0.0.1', '[::1]'].includes(String(hostname).toLowerCase());

const normalizeAllowedHosts = (value) => {
  const values = Array.isArray(value) ? value : String(value || '').split(',');
  return new Set(values.map((host) => String(host).trim().toLowerCase()).filter(Boolean));
};

const normalizeBaseUrl = (value, label, {
  allowedHosts = process.env.NEVEN_CONTROL_PLANE_ALLOWED_HOSTS,
  allowLoopback = process.env.NODE_ENV === 'development' || process.env.ELECTRON_IS_DEV === '1',
  enforceAllowlist = true
} = {}) => {
  const raw = String(value || '').trim();
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${label} invalide.`);
  }
  const isLoopback = isLoopbackHost(parsed.hostname);
  const hosts = normalizeAllowedHosts(allowedHosts);
  const isAllowedRemoteHost = hosts.has(parsed.hostname.toLowerCase());
  if (parsed.username || parsed.password || parsed.hash
    || !['http:', 'https:'].includes(parsed.protocol)
    || (isLoopback ? !allowLoopback : parsed.protocol !== 'https:' || (enforceAllowlist && !isAllowedRemoteHost))) {
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
  if (!UUID_PATTERN.test(workspaceId)) {
    throw new Error('Workspace Neven invalide.');
  }
  return workspaceId.toLowerCase();
};

const normalizeDeviceId = (value) => {
  const deviceId = String(value || '').trim();
  if (!UUID_PATTERN.test(deviceId)) throw new Error('Appareil Neven invalide.');
  return deviceId.toLowerCase();
};

const normalizeSubjectId = (value) => {
  const subjectId = String(value || '').trim();
  if (!GRANT_PATTERN.test(subjectId)) throw new Error('Sujet Neven invalide.');
  return subjectId;
};

const normalizeGrant = (value) => {
  const grant = String(value || '').trim();
  if (!GRANT_PATTERN.test(grant)) throw new Error('Grant Neven invalide.');
  return grant;
};

const normalizeEventId = (value) => {
  const eventId = String(value || '').trim();
  if (!eventId || eventId.length > MAX_EVENT_ID_LENGTH || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(eventId)) {
    throw new Error('Événement Neven invalide.');
  }
  return eventId;
};

const normalizeUsageIdentifier = (value, field, allowedValues = null) => {
  const identifier = String(value || '').trim().toLowerCase();
  if (!identifier || identifier.length > MAX_IDENTIFIER_LENGTH || !/^[a-z0-9][a-z0-9._:-]*$/.test(identifier)) {
    throw new Error(`${field} invalide.`);
  }
  if (allowedValues && !allowedValues.has(identifier)) throw new Error(`${field} invalide.`);
  return identifier;
};

const normalizeUsageNumber = (value, max, field) => {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > max) throw new Error(`${field} invalide.`);
  return Math.floor(number);
};

const normalizeUsageEvent = (event = {}, now = () => new Date().toISOString()) => {
  const origin = String(event.origin || '').trim().toLowerCase();
  if (!USAGE_ORIGINS.has(origin)) throw new Error('Origine d’usage invalide.');

  const occurredAt = new Date(event.occurredAt || event.recordedAt || now());
  if (!Number.isFinite(occurredAt.getTime())) throw new Error('Date d’usage invalide.');

  return Object.freeze({
    eventId: normalizeEventId(event.eventId),
    eventType: 'usage.recorded',
    occurredAt: occurredAt.toISOString(),
    workspaceId: normalizeWorkspaceId(event.workspaceId),
    usage: Object.freeze({
      origin,
      providerId: normalizeUsageIdentifier(event.providerId || 'neven', 'providerId', USAGE_PROVIDERS),
      inputTokens: normalizeUsageNumber(event.inputTokens, MAX_TOKEN_COUNT, 'inputTokens'),
      outputTokens: normalizeUsageNumber(event.outputTokens, MAX_TOKEN_COUNT, 'outputTokens'),
      durationMs: normalizeUsageNumber(event.durationMs, MAX_DURATION_MS, 'durationMs'),
      success: event.success === undefined ? null : Boolean(event.success)
    })
  });
};

const normalizeProfile = (value) => {
  const profile = String(value || 'haiku').trim().toLowerCase();
  if (!PROFILES.has(profile)) throw new Error('Profil Neven invalide.');
  return profile;
};

const normalizeCapability = (value) => {
  const capability = String(value || 'completion').trim();
  if (capability !== 'completion') throw new Error('Capacité Neven invalide.');
  return capability;
};

const normalizeExpiry = (value) => {
  const timestamp = Date.parse(String(value || ''));
  return Number.isFinite(timestamp) && timestamp > Date.now() ? new Date(timestamp).toISOString() : null;
};

const normalizeAccess = (payload, {
  workspaceId,
  deviceId,
  profile = 'haiku',
  capability = 'completion',
  gatewayBaseUrl,
  allowedHosts,
  allowLoopback
}) => {
  const source = payload?.data && typeof payload.data === 'object' ? payload.data : null;
  const grant = source?.grant;
  const subjectId = normalizeSubjectId(source?.subjectId);
  const expiresAt = normalizeExpiry(source?.expiresAt);
  const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
  const normalizedDeviceId = normalizeDeviceId(deviceId);
  const normalizedProfile = normalizeProfile(profile);
  const normalizedCapability = normalizeCapability(capability);
  const gatewayUrl = normalizeBaseUrl(gatewayBaseUrl, 'Passerelle Neven', {
    allowedHosts,
    allowLoopback
  });

  if (!source || !GRANT_PATTERN.test(String(grant || '')) || !expiresAt || !gatewayUrl) return null;

  return Object.freeze({
    kind: 'neven-gateway',
    workspaceId: normalizedWorkspaceId,
    deviceId: normalizedDeviceId,
    subjectId,
    gatewayUrl,
    grant: String(grant),
    expiresAt,
    profile: normalizedProfile,
    capability: normalizedCapability
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
    allowedHosts = process.env.NEVEN_CONTROL_PLANE_ALLOWED_HOSTS,
    allowLoopback,
    accessTokenResolver = async () => null,
    fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    accessPath = DEFAULT_ACCESS_PATH,
    revokePath = DEFAULT_REVOKE_PATH,
    eventsPath = process.env.NEVEN_INTERNAL_EVENTS_PATH || DEFAULT_EVENTS_PATH,
    eventTokenResolver = async () => process.env.NEVEN_INTERNAL_EVENTS_TOKEN || null
  } = {}) {
    this.baseUrl = null;
    this.gatewayBaseUrl = null;
    this.allowedHosts = allowedHosts;
    this.allowLoopback = allowLoopback;
    try {
      this.baseUrl = normalizeBaseUrl(baseUrl, 'URL du control plane Neven', { allowedHosts, allowLoopback });
      this.gatewayBaseUrl = normalizeBaseUrl(
        gatewayBaseUrl || `${this.baseUrl}${DEFAULT_GATEWAY_BASE_PATH}`,
        'URL de la passerelle Neven',
        { allowedHosts, allowLoopback }
      );
    } catch {
      // Une ancienne configuration distante sans allowlist ne doit pas empêcher
      // Electron de démarrer. Elle reste inopérante tant qu'elle n'est pas migrée.
      this.baseUrl = null;
      this.gatewayBaseUrl = null;
    }
    this.accessTokenResolver = accessTokenResolver;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = Math.max(1000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS);
    this.accessPath = normalizePath(accessPath, DEFAULT_ACCESS_PATH);
    this.revokePath = normalizePath(revokePath, DEFAULT_REVOKE_PATH);
    this.eventsPath = normalizePath(eventsPath, DEFAULT_EVENTS_PATH);
    this.eventTokenResolver = eventTokenResolver;
  }

  isConfigured() {
    return !!this.baseUrl && typeof this.fetchImpl === 'function';
  }

  async request(path, { method = 'GET', body, tokenResolver = this.accessTokenResolver, headers = {} } = {}) {
    if (!this.isConfigured()) return failure('not_configured', 'Control plane Neven non configure.');

    let accessToken = null;
    try {
      accessToken = String(await tokenResolver?.() || '').trim() || null;
    } catch {
      return failure('auth_unavailable', 'Session Neven indisponible.');
    }
    if (!accessToken) return failure('auth_required', 'Session Neven requise.');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${normalizePath(path, path)}`, {
        method,
        // Une redirection peut changer d'hôte après validation de l'allowlist.
        // Elle doit donc échouer avant qu'un bearer ne soit transmis ailleurs.
        redirect: 'error',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...headers
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

  async resolveAccess({ workspaceId, deviceId, profile = 'haiku', capability = 'completion' } = {}) {
    let normalizedWorkspaceId;
    let normalizedDeviceId;
    let normalizedProfile;
    let normalizedCapability;
    try {
      normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
      normalizedDeviceId = normalizeDeviceId(deviceId);
      normalizedProfile = normalizeProfile(profile);
      normalizedCapability = normalizeCapability(capability);
    } catch (error) {
      return failure('invalid_access_request', error.message);
    }

    const response = await this.request(this.accessPath, {
      method: 'POST',
      body: {
        workspaceId: normalizedWorkspaceId,
        deviceId: normalizedDeviceId,
        profile: normalizedProfile,
        capability: normalizedCapability
      }
    });
    if (!response.success) return response;

    let access = null;
    try {
      access = normalizeAccess(response.data, {
        workspaceId: normalizedWorkspaceId,
        deviceId: normalizedDeviceId,
        profile: normalizedProfile,
        capability: normalizedCapability,
        gatewayBaseUrl: this.gatewayBaseUrl || this.baseUrl,
        allowedHosts: this.allowedHosts,
        allowLoopback: this.allowLoopback
      });
    } catch {
      access = null;
    }
    return access
      ? { success: true, access }
      : failure('invalid_access_response', 'Réponse d’accès Neven invalide.');
  }

  async revokeAccess({ grant } = {}) {
    let normalizedGrant;
    try {
      normalizedGrant = normalizeGrant(grant);
    } catch (error) {
      return failure('invalid_grant', error.message);
    }
    return this.request(this.revokePath, {
      method: 'POST',
      body: { grant: normalizedGrant }
    });
  }

  async publishUsageEvent(event = {}) {
    let payload;
    try {
      payload = normalizeUsageEvent(event);
    } catch {
      return failure('invalid_usage_event', 'Événement d’usage Neven invalide.');
    }

    const response = await this.request(this.eventsPath, {
      method: 'POST',
      body: payload,
      tokenResolver: this.eventTokenResolver,
      headers: { 'Idempotency-Key': payload.eventId }
    });
    if (response.success) return { success: true, status: response.status };
    if (response.status === 401 || response.status === 403) {
      return failure('auth_failed', 'Événement Neven non transmis.');
    }
    if (response.code === 'timeout') return failure('timeout', 'Événement Neven non transmis.');
    return failure('event_unavailable', 'Événement Neven non transmis.');
  }
}

const createNevenAccessResolver = ({ client, cacheSkewMs = DEFAULT_CACHE_SKEW_MS } = {}) => {
  if (!client || typeof client.resolveAccess !== 'function') throw new Error('Client control plane Neven requis.');
  const cache = new Map();

  const getCacheKey = ({ workspaceId, deviceId, profile = 'haiku', capability = 'completion' } = {}) =>
    JSON.stringify([
      normalizeWorkspaceId(workspaceId),
      normalizeDeviceId(deviceId),
      normalizeProfile(profile),
      normalizeCapability(capability)
    ]);

  const resolve = async ({ workspaceId, deviceId, profile = 'haiku', capability = 'completion' } = {}) => {
    let key;
    try {
      key = getCacheKey({ workspaceId, deviceId, profile, capability });
    } catch {
      return null;
    }
    const cached = cache.get(key);
    if (cached && Date.parse(cached.expiresAt) > Date.now() + cacheSkewMs) return cached;

    const result = await client.resolveAccess({ workspaceId, deviceId, profile, capability });
    if (!result?.success || !result.access) return null;
    // A newly resolved grant is not usable when it cannot outlive the same
    // safety margin used by the cache. Never hand it to the gateway bearer.
    if (Date.parse(result.access.expiresAt) <= Date.now() + cacheSkewMs) return null;
    cache.set(key, result.access);
    return result.access;
  };

  resolve.clear = () => cache.clear();
  resolve.invalidate = ({ workspaceId, deviceId, profile = 'haiku', capability = 'completion' } = {}) => {
    try {
      cache.delete(getCacheKey({ workspaceId, deviceId, profile, capability }));
    } catch {
      // Invalid input must not affect unrelated grants.
    }
  };
  resolve.revoke = async ({ workspaceId, deviceId, profile = 'haiku', capability = 'completion', grant } = {}) => {
    let normalizedWorkspaceId;
    let normalizedDeviceId;
    let cacheKey;
    try {
      normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
      normalizedDeviceId = normalizeDeviceId(deviceId);
      cacheKey = getCacheKey({ workspaceId: normalizedWorkspaceId, deviceId: normalizedDeviceId, profile, capability });
    } catch (error) {
      return failure('invalid_revoke_request', error.message);
    }
    // Purge first: a remote revoke failure must never leave a usable local grant.
    const cached = cache.get(cacheKey);
    for (const key of cache.keys()) {
      const [cachedWorkspaceId, cachedDeviceId] = JSON.parse(key);
      if (cachedWorkspaceId === normalizedWorkspaceId && cachedDeviceId === normalizedDeviceId) cache.delete(key);
    }
    try {
      return await client.revokeAccess({ grant: grant || cached?.grant });
    } catch {
      return failure('revoke_unavailable', 'Révocation Neven indisponible.');
    }
  };
  return resolve;
};

module.exports = {
  DEFAULT_ACCESS_PATH,
  DEFAULT_REVOKE_PATH,
  DEFAULT_EVENTS_PATH,
  DEFAULT_GATEWAY_BASE_PATH,
  DEFAULT_CACHE_SKEW_MS,
  NevenControlPlaneClient,
  createNevenAccessResolver,
  normalizeAccess,
  normalizeBaseUrl,
  normalizeDeviceId,
  normalizeGrant,
  normalizeProfile,
  normalizeSubjectId,
  normalizeUsageEvent,
  normalizeWorkspaceId
};
