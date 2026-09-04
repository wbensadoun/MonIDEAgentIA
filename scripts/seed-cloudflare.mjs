// Seed initial des ressources Cloudflare depuis le repo (COD-52).
// Pousse .agent/agents/*.md (les 133 agents produit) vers l'API deployee.
// Usage: node scripts/seed-cloudflare.mjs [--dry]
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  readFileSync(path.join(root, '.env'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_][A-Z0-9_]*=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
);

const base = (env.CF_AGENTS_API_URL || '').trim();
const token = (env.CF_AGENTS_API_TOKEN || '').trim();
if (!base || !token) {
  console.error('CF_AGENTS_API_URL / CF_AGENTS_API_TOKEN manquants dans .env');
  process.exit(1);
}
const dry = process.argv.includes('--dry');
const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

const pushAll = async (dir, type, fileResolver) => {
  if (!existsSync(dir)) return { ok: 0, fail: 0, total: 0 };
  let ok = 0; let fail = 0; let total = 0;
  for (const entry of fileResolver(dir)) {
    total += 1;
    const { name, content } = entry;
    if (dry) { console.log(`[dry] ${type}/${name} (${content.length} o)`); ok += 1; continue; }
    try {
      const res = await fetch(`${base}/${type}/${encodeURIComponent(name)}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ content }),
      });
      if (res.ok) { ok += 1; process.stdout.write('.'); }
      else { fail += 1; console.log(`\nFAIL ${type}/${name}: ${res.status} ${(await res.text()).slice(0, 120)}`); }
    } catch (e) {
      fail += 1; console.log(`\nERR ${type}/${name}: ${e.message}`);
    }
  }
  return { ok, fail, total };
};

console.log(`Seed -> ${base} (dry=${dry})`);

const agentsDir = path.join(root, '.agent', 'agents');
const agents = await pushAll(agentsDir, 'agents', (dir) =>
  readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.md')).map((f) => ({ name: f, content: readFileSync(path.join(dir, f), 'utf8') })));
console.log(`\nagents: ${agents.ok}/${agents.total} ok, ${agents.fail} fail`);

const skillsDir = path.join(root, '.agent', 'skills');
const skills = await pushAll(skillsDir, 'skills', (dir) =>
  readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory())
    .map((d) => {
      const skillFile = path.join(dir, d.name, 'SKILL.md');
      if (!existsSync(skillFile)) return null;
      return { name: `${d.name}.md`, content: readFileSync(skillFile, 'utf8') };
    }).filter(Boolean));
console.log(`skills: ${skills.ok}/${skills.total} ok, ${skills.fail} fail`);

const wfDir = path.join(root, '.agent', 'workflows');
const wfs = await pushAll(wfDir, 'workflows', (dir) =>
  readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.md')).map((f) => ({ name: f, content: readFileSync(path.join(dir, f), 'utf8') })));
console.log(`workflows: ${wfs.ok}/${wfs.total} ok, ${wfs.fail} fail`);

if (!dry) {
  const res = await fetch(`${base}/agents`, { headers });
  const list = await res.json();
  console.log(`\nVerification: ${list.agents?.length ?? 0} agents distants.`);
}
