'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CloudflareAgentsClient,
  isConfigured,
  syncEnabled,
} = require('./cloudflare-agents.service');

const jsonResponse = (payload, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(payload),
});

const CREDENTIALS = {
  baseUrl: 'https://agents.example.workers.dev',
  clientId: 'abc123.access',
  clientSecret: 'cfast_secret',
};

test('client refuses to operate when cloudflare credentials are missing', async () => {
  const client = new CloudflareAgentsClient({ ...CREDENTIALS, baseUrl: '' });
  const result = await client.listAgents();
  assert.equal(result.success, false);
  assert.equal(result.code, 'not_configured');
  assert.equal(isConfigured({ CF_AGENTS_API_URL: '', CF_ACCESS_CLIENT_ID: 'a', CF_ACCESS_CLIENT_SECRET: 'b' }), false);
  assert.equal(isConfigured({ CF_AGENTS_API_URL: 'https://x.dev', CF_ACCESS_CLIENT_ID: 'a', CF_ACCESS_CLIENT_SECRET: 'b' }), true);
});

test('bearer-only configuration is enough to operate (Access optional)', async () => {
  const client = new CloudflareAgentsClient({
    baseUrl: 'https://agents.example.workers.dev',
    clientId: '',
    clientSecret: '',
    apiToken: 'tok-only',
    fetchImpl: async () => jsonResponse({ agents: [] }),
  });
  assert.equal(client.isConfigured(), true);
  const result = await client.listAgents();
  assert.equal(result.success, true);
  assert.equal(isConfigured({ CF_AGENTS_API_URL: 'https://x.dev', CF_AGENTS_API_TOKEN: 't' }), true);
  assert.equal(isConfigured({ CF_AGENTS_API_URL: 'https://x.dev' }), false);
});

test('sync flag parsing accepts only explicit true-like values', () => {
  assert.equal(syncEnabled({ CF_AGENTS_SYNC_ENABLED: 'true' }), true);
  assert.equal(syncEnabled({ CF_AGENTS_SYNC_ENABLED: '1' }), true);
  assert.equal(syncEnabled({ CF_AGENTS_SYNC_ENABLED: 'false' }), false);
  assert.equal(syncEnabled({}), false);
});

test('every request carries the Cloudflare Access service token headers', async () => {
  const requests = [];
  const client = new CloudflareAgentsClient({
    ...CREDENTIALS,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return jsonResponse({ agents: [{ name: 'planner.md' }] });
    },
  });

  const result = await client.listAgents();
  assert.equal(result.success, true);
  assert.deepEqual(result.agents, [{ name: 'planner.md', updatedAt: null, size: null }]);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://agents.example.workers.dev/agents');
  assert.equal(requests[0].options.headers['CF-Access-Client-Id'], 'abc123.access');
  assert.equal(requests[0].options.headers['CF-Access-Client-Secret'], 'cfast_secret');
});

test('bearer token is added when CF_AGENTS_API_TOKEN is set', async () => {
  let options;
  const client = new CloudflareAgentsClient({
    ...CREDENTIALS,
    apiToken: 'tok-123',
    fetchImpl: async (u, o) => { options = o; return jsonResponse({ skills: [] }); },
  });
  const result = await client.list('skills');
  assert.equal(result.success, true);
  assert.equal(options.headers.Authorization, 'Bearer tok-123');
});

test('typed resources route to their own collection', async () => {
  const urls = [];
  const client = new CloudflareAgentsClient({
    ...CREDENTIALS,
    fetchImpl: async (u, o) => {
      urls.push(`${o.method} ${u}`);
      return jsonResponse({ workflows: [{ name: 'wf-1.json' }], content: '{}', ok: true });
    },
  });
  await client.list('workflows');
  await client.put('wf-1.json', '{}', 'workflows');
  await client.get('wf-1.json', 'workflows');
  await client.remove('wf-1.json', 'workflows');
  assert.deepEqual(urls, [
    'GET https://agents.example.workers.dev/workflows',
    'PUT https://agents.example.workers.dev/workflows/wf-1.json',
    'GET https://agents.example.workers.dev/workflows/wf-1.json',
    'DELETE https://agents.example.workers.dev/workflows/wf-1.json',
  ]);
  await assert.rejects(() => client.list('secrets'));
});

test('api prefix is applied to every route', async () => {
  let url;
  const client = new CloudflareAgentsClient({
    ...CREDENTIALS,
    apiPrefix: '/v1/library',
    fetchImpl: async (u) => { url = u; return jsonResponse({ content: 'body' }); },
  });
  const result = await client.getAgent('planner.md');
  assert.equal(url, 'https://agents.example.workers.dev/v1/library/planner.md');
  assert.equal(result.success, true);
  assert.equal(result.agent.content, 'body');
});

test('putAgent sends JSON content and reports api errors', async () => {
  let request;
  const client = new CloudflareAgentsClient({
    ...CREDENTIALS,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return jsonResponse({}, 500);
    },
  });
  const result = await client.putAgent('planner.md', '# Planner');
  assert.equal(request.url, 'https://agents.example.workers.dev/agents/planner.md');
  assert.equal(request.options.method, 'PUT');
  assert.equal(request.options.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(request.options.body), { content: '# Planner' });
  assert.equal(result.success, false);
  assert.equal(result.code, 'api_error');
  assert.equal(result.status, 500);
});

test('getAgent maps 404 to not_found and rejects unsafe names', async () => {
  const client = new CloudflareAgentsClient({
    ...CREDENTIALS,
    fetchImpl: async () => jsonResponse({}, 404),
  });
  const result = await client.getAgent('planner.md');
  assert.equal(result.success, false);
  assert.equal(result.code, 'not_found');
  await assert.rejects(() => client.getAgent('../../etc/passwd'));
});

test('deleteAgent treats remote 404 as success', async () => {
  const client = new CloudflareAgentsClient({
    ...CREDENTIALS,
    fetchImpl: async () => jsonResponse({}, 404),
  });
  const result = await client.deleteAgent('ghost.md');
  assert.equal(result.success, true);
  assert.equal(result.existed, false);
});

test('network failures are reported as network_error', async () => {
  const client = new CloudflareAgentsClient({
    ...CREDENTIALS,
    fetchImpl: async () => { throw new Error('socket hang up'); },
  });
  const result = await client.listAgents();
  assert.equal(result.success, false);
  assert.equal(result.code, 'network_error');
});
