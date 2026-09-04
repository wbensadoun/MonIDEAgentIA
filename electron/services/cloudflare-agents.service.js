'use strict';

// ---------------------------------------------------------------------------
// Cloudflare Agents storage sync
//
// Publie / recupere les fichiers d'agents (*.md) vers l'API Cloudflare
// protegee par Cloudflare Access (service tokens). Les credentials viennent
// du .env :
//   CF_AGENTS_API_URL        base de l'API (ex: https://agents-api.xxx.workers.dev)
//   CF_ACCESS_CLIENT_ID      ex: 1e2975bd....access
//   CF_ACCESS_CLIENT_SECRET  ex: cfast_...
//   CF_AGENTS_SYNC_ENABLED   "true" pour activer le sync (defaut: desactive)
//   CF_AGENTS_API_PREFIX     chemin optionnel prefixe toutes les routes (ex: /v1/agents)
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 15000;
const MAX_AGENT_NAME_LENGTH = 200;
const RESOURCE_TYPES = new Set(['agents', 'skills', 'workflows']);

const normalizeResourceType = (type) => {
  const value = String(type || 'agents').trim().toLowerCase();
  if (!RESOURCE_TYPES.has(value)) throw new Error(`Type de ressource inconnu: ${value}`);
  return value;
};

const normalizeBaseUrl = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('CF_AGENTS_API_URL invalide.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hash) {
    throw new Error('CF_AGENTS_API_URL invalide.');
  }
  return parsed.toString().replace(/\/$/, '');
};

const normalizePrefix = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const path = raw.startsWith('/') ? raw : `/${raw}`;
  if (path.startsWith('//') || /[\r\n]/.test(path)) throw new Error('CF_AGENTS_API_PREFIX invalide.');
  return path.replace(/\/$/, '');
};

// Nom d'agent = slug securise pour l'URL (les noms locaux sont deja sanitises
// par safeFileBase cote agent.service, on revalide ici cote reseau).
const normalizeAgentName = (value) => {
  const name = String(value || '').trim();
  if (!name || name.length > MAX_AGENT_NAME_LENGTH) throw new Error('Nom d\'agent invalide.');
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) throw new Error('Nom d\'agent invalide.');
  return name;
};

// Configure = URL + au moins une couche d'auth :
//  - service token Cloudflare Access (CF_ACCESS_CLIENT_ID + SECRET), et/ou
//  - bearer applicatif (CF_AGENTS_API_TOKEN), requis par le worker actuel.
const isConfigured = (env = process.env) => {
  const hasUrl = Boolean(String(env.CF_AGENTS_API_URL || '').trim());
  const hasAccess = Boolean(String(env.CF_ACCESS_CLIENT_ID || '').trim()
    && String(env.CF_ACCESS_CLIENT_SECRET || '').trim());
  const hasBearer = Boolean(String(env.CF_AGENTS_API_TOKEN || '').trim());
  return hasUrl && (hasAccess || hasBearer);
};

const syncEnabled = (env = process.env) =>
  /^(1|true|yes)$/i.test(String(env.CF_AGENTS_SYNC_ENABLED || '').trim());

const failure = (code, error, extra = {}) => ({ success: false, code, error, ...extra });

class CloudflareAgentsClient {
  constructor({
    baseUrl = process.env.CF_AGENTS_API_URL,
    clientId = process.env.CF_ACCESS_CLIENT_ID,
    clientSecret = process.env.CF_ACCESS_CLIENT_SECRET,
    apiPrefix = process.env.CF_AGENTS_API_PREFIX,
    apiToken = process.env.CF_AGENTS_API_TOKEN,
    fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = {}) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.clientId = String(clientId || '').trim();
    this.clientSecret = String(clientSecret || '').trim();
    this.apiToken = String(apiToken || '').trim();
    this.apiPrefix = this.baseUrl ? normalizePrefix(apiPrefix) : '';
    this.fetchImpl = fetchImpl;
    this.timeoutMs = Math.max(500, Number(timeoutMs) || DEFAULT_TIMEOUT_MS);
  }

  isConfigured() {
    const hasAccess = Boolean(this.clientId && this.clientSecret);
    const hasBearer = Boolean(this.apiToken);
    return Boolean(this.baseUrl && (hasAccess || hasBearer));
  }

  // Le prefixe remplace le chemin par defaut "/<type>" (ex: /v1/library).
  resourceUrl(name, type = 'agents') {
    const root = this.apiPrefix || `/${normalizeResourceType(type)}`;
    if (!name) return `${this.baseUrl}${root}`;
    return `${this.baseUrl}${root}/${encodeURIComponent(normalizeAgentName(name))}`;
  }

  accessHeaders() {
    // Headers Cloudflare Access (service token) requis par Zero Trust devant l'API.
    const headers = {
      'CF-Access-Client-Id': this.clientId,
      'CF-Access-Client-Secret': this.clientSecret,
    };
    // Bearer applicatif optionnel (secret worker AGENTS_API_TOKEN) : defense en profondeur.
    if (this.apiToken) headers.Authorization = `Bearer ${this.apiToken}`;
    return headers;
  }

  async request(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        ...options,
        headers: { ...this.accessHeaders(), ...(options.headers || {}) },
        signal: controller.signal,
      });
      const text = await response.text().catch(() => '');
      let payload = null;
      try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
      return { ok: response.ok, status: response.status, payload, text };
    } finally {
      clearTimeout(timer);
    }
  }

  // GET /:type -> { <type>: [{ name, updatedAt?, size? }] }
  async list(type = 'agents') {
    const resourceType = normalizeResourceType(type);
    if (!this.isConfigured()) return failure('not_configured', 'API Cloudflare agents non configuree (.env).');
    try {
      const { ok, status, payload, text } = await this.request(this.resourceUrl(null, resourceType), { method: 'GET' });
      if (!ok) return failure('api_error', `Listage des ${resourceType} distants impossible (${status}).`, { status, detail: text.slice(0, 400) });
      const items = Array.isArray(payload?.[resourceType]) ? payload[resourceType] : (Array.isArray(payload) ? payload : []);
      return {
        success: true,
        [resourceType]: items
          .filter((a) => a && typeof a.name === 'string')
          .map((a) => ({ name: a.name, updatedAt: a.updatedAt || null, size: Number.isFinite(Number(a.size)) ? Number(a.size) : null })),
      };
    } catch (error) {
      return failure('network_error', `Reseau Cloudflare ${resourceType}: ${error.message}`);
    }
  }

  // GET /:type/:name -> { name, content }
  async get(name, type = 'agents') {
    const resourceType = normalizeResourceType(type);
    if (!this.isConfigured()) return failure('not_configured', 'API Cloudflare agents non configuree (.env).');
    const url = this.resourceUrl(name, resourceType);
    try {
      const { ok, status, payload, text } = await this.request(url, { method: 'GET' });
      if (status === 404) return failure('not_found', `${resourceType} distant introuvable: ${name}.`, { status });
      if (!ok) return failure('api_error', `Recuperation du ${resourceType} distant impossible (${status}).`, { status, detail: text.slice(0, 400) });
      const content = typeof payload?.content === 'string' ? payload.content : (typeof payload === 'string' ? payload : null);
      if (content === null) return failure('bad_payload', 'Reponse distante sans contenu exploitable.');
      return { success: true, [resourceType === 'agents' ? 'agent' : resourceType === 'skills' ? 'skill' : 'workflow']: { name: normalizeAgentName(name), content, updatedAt: payload?.updatedAt || null } };
    } catch (error) {
      return failure('network_error', `Reseau Cloudflare ${resourceType}: ${error.message}`);
    }
  }

  // PUT /:type/:name  { content }
  async put(name, content, type = 'agents') {
    const resourceType = normalizeResourceType(type);
    if (!this.isConfigured()) return failure('not_configured', 'API Cloudflare agents non configuree (.env).');
    const url = this.resourceUrl(name, resourceType);
    try {
      const body = JSON.stringify({ content: String(content || '') });
      const { ok, status, text } = await this.request(url, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body,
      });
      if (!ok) return failure('api_error', `Publication du ${resourceType} impossible (${status}).`, { status, detail: text.slice(0, 400) });
      return { success: true, name: normalizeAgentName(name) };
    } catch (error) {
      return failure('network_error', `Reseau Cloudflare ${resourceType}: ${error.message}`);
    }
  }

  // DELETE /:type/:name
  async remove(name, type = 'agents') {
    const resourceType = normalizeResourceType(type);
    if (!this.isConfigured()) return failure('not_configured', 'API Cloudflare agents non configuree (.env).');
    const url = this.resourceUrl(name, resourceType);
    try {
      const { ok, status, text } = await this.request(url, { method: 'DELETE' });
      if (!ok && status !== 404) return failure('api_error', `Suppression du ${resourceType} distant impossible (${status}).`, { status, detail: text.slice(0, 400) });
      return { success: true, name: normalizeAgentName(name), existed: ok };
    } catch (error) {
      return failure('network_error', `Reseau Cloudflare ${resourceType}: ${error.message}`);
    }
  }

  // --- Wrappers agents (retro-compat) ---
  async listAgents() { return this.list('agents'); }
  async getAgent(name) { return this.get(name, 'agents'); }
  async putAgent(name, content) { return this.put(name, content, 'agents'); }
  async deleteAgent(name) { return this.remove(name, 'agents'); }
}

let defaultClient = null;
const getCloudflareAgentsClient = () => {
  if (!defaultClient) defaultClient = new CloudflareAgentsClient();
  return defaultClient;
};

module.exports = {
  CloudflareAgentsClient,
  getCloudflareAgentsClient,
  isConfigured,
  syncEnabled,
  normalizeAgentName,
  normalizeResourceType,
  RESOURCE_TYPES,
};
