'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  LEXICAL_FINGERPRINT_DIMENSIONS,
  buildLocalRagIndex,
  createLocalRagJobManager,
  getIndexPath
} = require('./local-rag-index.service');
const { trustProjectPath } = require('../core/security');

const makeProject = async (name) => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), `code-companion-rag-${name}-`));
  trustProjectPath(project);
  return project;
};

test('local index scans allowlisted text, excludes secrets/gitignore and stores structure plus lexical fingerprint', async () => {
  const project = await makeProject('allowlist');
  await fs.mkdir(path.join(project, 'src'), { recursive: true });
  await fs.writeFile(path.join(project, '.gitignore'), 'ignored.js\nignored-dir/\n', 'utf8');
  await fs.writeFile(path.join(project, 'src', 'app.js'), "import api from './api';\nexport function boot() { return api; }\n", 'utf8');
  await fs.writeFile(path.join(project, '.env'), 'OPENAI_API_KEY=secret', 'utf8');
  await fs.writeFile(path.join(project, 'credentials.json'), '{"token":"secret"}', 'utf8');
  await fs.writeFile(path.join(project, 'ignored.js'), 'ignore me', 'utf8');
  await fs.mkdir(path.join(project, 'ignored-dir'));
  await fs.writeFile(path.join(project, 'ignored-dir', 'nested.js'), 'ignore me too', 'utf8');
  await fs.writeFile(path.join(project, 'image.png'), 'not text', 'utf8');

  const result = await buildLocalRagIndex(project);
  const index = JSON.parse(await fs.readFile(getIndexPath(project), 'utf8'));
  assert.equal(result.files, 1);
  assert.ok(index['src/app.js']);
  assert.equal(index['.env'], undefined);
  assert.equal(index['credentials.json'], undefined);
  assert.equal(index['ignored.js'], undefined);
  assert.equal(index['ignored-dir/nested.js'], undefined);
  assert.deepEqual(index['src/app.js'].imports, ['./api']);
  assert.deepEqual(index['src/app.js'].symbols, ['boot']);
  assert.equal(index['src/app.js'].chunks[0].lexicalFingerprint.length, LEXICAL_FINGERPRINT_DIMENSIONS);
  assert.equal(index._meta.vector, null);
  assert.equal(index._meta.vectorMode, 'lexical-placeholder-v1');
});

test('rebuild deduplicates unchanged files and leaves tombstones for deleted files', async () => {
  const project = await makeProject('tombstone');
  await fs.mkdir(path.join(project, 'src'), { recursive: true });
  await fs.writeFile(path.join(project, 'src', 'keep.js'), 'export const keep = true;', 'utf8');
  await fs.writeFile(path.join(project, 'src', 'remove.js'), 'export const remove = true;', 'utf8');
  await buildLocalRagIndex(project);
  const before = JSON.parse(await fs.readFile(getIndexPath(project), 'utf8'));
  await fs.rm(path.join(project, 'src', 'remove.js'));
  const result = await buildLocalRagIndex(project);
  const after = JSON.parse(await fs.readFile(getIndexPath(project), 'utf8'));
  assert.equal(result.tombstones, 1);
  assert.equal(after['src/keep.js'].hash, before['src/keep.js'].hash);
  assert.deepEqual(after['src/remove.js'].chunks, []);
  assert.equal(after['src/remove.js'].tombstone, true);
});

test('local indexing jobs are queued asynchronously and deduplicated per project', async () => {
  const calls = [];
  const manager = createLocalRagJobManager({
    build: async (projectPath) => {
      calls.push(projectPath);
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { files: 1 };
    }
  });
  const first = manager.enqueue('rp_project_session_id', 'C:/project');
  const duplicate = manager.enqueue('rp_project_session_id', 'C:/project');
  assert.equal(first.status, 'queued');
  assert.equal(duplicate.deduplicated, true);
  assert.equal(calls.length, 0);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(manager.get(first.jobId).status, 'completed');
  assert.deepEqual(calls, ['C:/project']);
});

test('secret material in otherwise allowlisted files is excluded fail-closed', async () => {
  const project = await makeProject('secret-content');
  await fs.writeFile(path.join(project, 'config.json'), '{"OPENAI_API_KEY":"sk-12345678901234567890"}', 'utf8');
  await fs.writeFile(path.join(project, 'service-account.json'), '{"client_email":"x"}', 'utf8');
  await fs.writeFile(path.join(project, 'openai_keys.json'), '{"value":"not-indexed"}', 'utf8');
  await fs.writeFile(path.join(project, 'private_keys.txt'), 'not-indexed', 'utf8');
  await fs.writeFile(path.join(project, 'tokens.txt'), 'not-indexed', 'utf8');
  await fs.writeFile(path.join(project, 'quoted-api-key.json'), '{"apiKey":"abcdefghijklmnop1234"}', 'utf8');
  await fs.writeFile(path.join(project, 'quoted-service-account.json'), '{"serviceAccount":"abcdefghijklmnop1234"}', 'utf8');
  await fs.writeFile(path.join(project, 'safe.json'), '{"name":"safe"}', 'utf8');
  await buildLocalRagIndex(project);
  const index = JSON.parse(await fs.readFile(getIndexPath(project), 'utf8'));
  assert.equal(index['config.json'], undefined);
  assert.equal(index['service-account.json'], undefined);
  assert.equal(index['openai_keys.json'], undefined);
  assert.equal(index['private_keys.txt'], undefined);
  assert.equal(index['tokens.txt'], undefined);
  assert.equal(index['quoted-api-key.json'], undefined);
  assert.equal(index['quoted-service-account.json'], undefined);
  assert.ok(index['safe.json']);
});

test('global traversal budget counts ignored hostile entries', async () => {
  const project = await makeProject('traversal-budget');
  await fs.writeFile(path.join(project, '.gitignore'), 'ignored-*.js\n', 'utf8');
  for (let index = 0; index < 20; index += 1) {
    await fs.writeFile(path.join(project, `ignored-${String(index).padStart(2, '0')}.js`), 'export const ignored = true;', 'utf8');
  }
  await fs.writeFile(path.join(project, 'z-after-budget.js'), 'export const shouldNotBeReached = true;', 'utf8');
  const result = await buildLocalRagIndex(project, { maxTraversalEntries: 10 });
  const index = JSON.parse(await fs.readFile(getIndexPath(project), 'utf8'));
  assert.equal(result.stats.traversalEntries, 10);
  assert.equal(result.stats.hitLimit, true);
  assert.equal(index['z-after-budget.js'], undefined);
});

test('corrupt existing indexes are quarantined and never silently replaced', async () => {
  const project = await makeProject('corrupt');
  const indexPath = getIndexPath(project);
  await fs.mkdir(path.dirname(indexPath), { recursive: true });
  await fs.writeFile(indexPath, '{not-json', 'utf8');
  await assert.rejects(() => buildLocalRagIndex(project), (error) => error.code === 'RAG_INDEX_CORRUPT');
  const siblings = await fs.readdir(path.dirname(indexPath));
  assert.equal(siblings.some((name) => name.startsWith('rag_index.json.corrupt-')), true);
  assert.equal(await fs.readFile(indexPath, 'utf8').catch(() => null), null);
});

test('jobs deduplicate canonical paths and cancel before committing', async () => {
  let resolveBuild;
  const manager = createLocalRagJobManager({
    build: async (_projectPath, { signal }) => new Promise((resolve, reject) => {
      resolveBuild = resolve;
      signal.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), { code: 'RAG_INDEX_CANCELLED' })), { once: true });
    })
  });
  const first = manager.enqueue('rp_one_project_id', 'C:/project/../project');
  const duplicate = manager.enqueue('rp_two_project_id', 'C:/project');
  assert.equal(duplicate.deduplicated, true);
  assert.equal(manager.cancel('rp_one_project_id'), true);
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(manager.get(first.jobId).status, 'cancelled');
  resolveBuild?.();
});
