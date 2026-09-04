/**
 * Wansia / Code Companion — API de stockage des ressources back-only.
 *
 * Protégée par Cloudflare Access (service token, vérifié au bord) + un
 * Bearer token applicatif (secret worker AGENTS_API_TOKEN, défense en profondeur).
 *
 * Ressources supportées (type ∈ agents | skills | workflows) :
 *   GET    /:type            -> { <type>: [{ name, updatedAt, size }] }
 *   GET    /:type/:name      -> { name, content, updatedAt }
 *   PUT    /:type/:name      body { "content": "..." }   -> { ok: true, name }
 *   DELETE /:type/:name                                  -> { ok: true, name }
 *
 * Stockage : Workers KV (binding AGENTS_KV). Clé = "<type>/<name>".
 * Taille max par objet : 512 Ko.
 */

'use strict';

const RESOURCE_TYPES = { agents: true, skills: true, workflows: true };
const NAME_RE = /^[a-zA-Z0-9._-]{1,200}$/;
const MAX_CONTENT_BYTES = 512 * 1024;

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, authorization, cf-access-client-id, cf-access-client-secret',
  'access-control-allow-methods': 'GET, PUT, DELETE, OPTIONS',
  'access-control-max-age': '86400',
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...CORS_HEADERS },
  });

const error = (status, message) => json({ error: { code: status === 401 ? 'unauthorized' : status === 404 ? 'not_found' : 'bad_request', message } }, status);

const kvKey = (type, name) => `${type}/${name}`;

const authorized = (request, env) => {
  const expected = String(env.AGENTS_API_TOKEN || '').trim();
  if (!expected) return false; // échoue fermé si le secret n'est pas configuré
  const header = String(request.headers.get('authorization') || '');
  const provided = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (provided.length !== expected.length) return false;
  // comparaison temps constant
  let mismatch = 0;
  for (let i = 0; i < provided.length; i += 1) {
    mismatch |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
};

const parseRoute = (url) => {
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length === 0) return { action: 'health' };
  const type = parts[0];
  if (!RESOURCE_TYPES[type]) return null;
  if (parts.length === 1) return { action: 'list', type };
  if (parts.length === 2) {
    const name = decodeURIComponent(parts[1]);
    if (!NAME_RE.test(name)) return null;
    return { action: 'item', type, name };
  }
  return null;
};

const listItems = async (env, type) => {
  const items = [];
  let cursor;
  do {
    const page = await env.AGENTS_KV.list({ prefix: `${type}/`, cursor, limit: 1000 });
    for (const key of page.keys) {
      const name = key.name.slice(type.length + 1);
      if (!name) continue;
      items.push({
        name,
        updatedAt: key.metadata?.updatedAt || null,
        size: Number.isFinite(key.metadata?.size) ? key.metadata.size : null,
      });
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  items.sort((a, b) => a.name.localeCompare(b.name));
  return items;
};

const readBody = async (request) => {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > MAX_CONTENT_BYTES) return { tooLarge: true };
  const raw = await request.text();
  if (Buffer.byteLength(raw, 'utf8') > MAX_CONTENT_BYTES) return { tooLarge: true };
  try {
    return { body: JSON.parse(raw) };
  } catch {
    return { invalid: true };
  }
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    if (url.pathname === '/' || url.pathname === '/health') {
      return json({ ok: true, service: 'wansia-agents-api', storage: !!env.AGENTS_KV });
    }

    const route = parseRoute(url);
    if (!route) return error(400, 'Route inconnue. Types: agents, skills, workflows.');
    if (!authorized(request, env)) return error(401, 'Authorization: Bearer <AGENTS_API_TOKEN> requis.');
    if (!env.AGENTS_KV) return json({ error: { code: 'storage_unavailable', message: 'Binding AGENTS_KV absent.' } }, 503);

    try {
      if (route.action === 'list') {
        const items = await listItems(env, route.type);
        return json({ [route.type]: items });
      }

      if (route.action === 'item') {
        const key = kvKey(route.type, route.name);
        if (request.method === 'GET') {
          const value = await env.AGENTS_KV.get(key, 'text');
          if (value === null) return error(404, `Ressource introuvable: ${route.name}`);
          const meta = await env.AGENTS_KV.getWithMetadata(key, 'text');
          return json({ name: route.name, content: meta.value, updatedAt: meta.metadata?.updatedAt || null });
        }
        if (request.method === 'PUT') {
          const { body, tooLarge, invalid } = await readBody(request);
          if (tooLarge) return error(400, 'Contenu trop volumineux (max 512 Ko).');
          if (invalid) return error(400, 'Corps JSON invalide.');
          const content = typeof body?.content === 'string' ? body.content : null;
          if (content === null) return error(400, 'Champ "content" (string) requis.');
          await env.AGENTS_KV.put(key, content, {
            metadata: { updatedAt: new Date().toISOString(), size: content.length },
          });
          return json({ ok: true, name: route.name, updatedAt: new Date().toISOString() });
        }
        if (request.method === 'DELETE') {
          await env.AGENTS_KV.delete(key);
          return json({ ok: true, name: route.name });
        }
        return error(400, 'Méthode non supportée.');
      }
    } catch (err) {
      return json({ error: { code: 'internal_error', message: String(err?.message || err) } }, 500);
    }

    return error(400, 'Méthode non supportée.');
  },
};
