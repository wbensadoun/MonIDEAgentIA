'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  VECTOR_DIMENSIONS,
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

test('local index scans allowlisted text, excludes secrets/gitignore and stores structure plus vector', async () => {
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
  assert.equal(index['src/app.js'].chunks[0].vector.length, VECTOR_DIMENSIONS);
  assert.equal(index._meta.vector, 'hash-v1');
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
