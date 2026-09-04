// Test end-to-end de l'API Cloudflare deployee (agents/skills/workflows).
// Usage: node scripts/test-cloudflare-live.mjs
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fileEnv = existsSync(path.join(root, '.env'))
  ? Object.fromEntries(
      readFileSync(path.join(root, '.env'), 'utf8')
        .split(/\r?\n/)
        .filter((l) => /^[A-Z_][A-Z0-9_]*=/.test(l))
        .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
    )
  : {};
// CI and controlled local runs can inject secrets without creating a second
// plaintext .env copy in an isolated worktree.
const env = { ...fileEnv, ...process.env };

const base = env.CF_AGENTS_API_URL;
const token = env.CF_AGENTS_API_TOKEN;
const accessHeaders = {
  ...(env.CF_ACCESS_CLIENT_ID ? { 'CF-Access-Client-Id': env.CF_ACCESS_CLIENT_ID } : {}),
  ...(env.CF_ACCESS_CLIENT_SECRET ? { 'CF-Access-Client-Secret': env.CF_ACCESS_CLIENT_SECRET } : {}),
};
const headers = {
  ...accessHeaders,
  authorization: `Bearer ${token}`,
  'content-type': 'application/json',
};

const call = async (method, url, body) => {
  const res = await fetch(url, { method, headers, ...(body ? { body } : {}) });
  const text = await res.text();
  console.log(`${method} ${url.replace(base, '')} -> ${res.status} ${text.slice(0, 200)}`);
  return { status: res.status, text };
};

console.log('base =', base);
await call('GET', `${base}/health`);
await call('PUT', `${base}/agents/_sync-test.md`, JSON.stringify({ content: '# agent de test\n\nContenu sync E2E.' }));
await call('GET', `${base}/agents`);
await call('GET', `${base}/agents/_sync-test.md`);
await call('PUT', `${base}/skills/_test-skill.md`, JSON.stringify({ content: '---\nname: _test-skill\n---\nskill E2E' }));
await call('GET', `${base}/skills`);
await call('DELETE', `${base}/skills/_test-skill.md`);
await call('DELETE', `${base}/agents/_sync-test.md`);
// Sans token -> doit rejeter 401
const noAuth = await fetch(`${base}/agents`, { headers: accessHeaders });
console.log(`GET /agents sans token -> ${noAuth.status} (attendu 401)`);
