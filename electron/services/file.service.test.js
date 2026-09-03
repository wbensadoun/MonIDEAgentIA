'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  getAllFiles,
  getAllProjectFiles,
  getFolderChildren,
  listProjectFiles,
  readFile,
  writeFile,
  deleteFile,
  createNewFile,
  renameFile,
  copyFile,
  moveFile,
  searchInProject,
  searchSymbols
} = require('./file.service');
const { trustProjectPath } = require('../core/security');

const makeProject = async () => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), 'code-companion-files-'));
  trustProjectPath(project);
  await fs.mkdir(path.join(project, '.agent', 'agents'), { recursive: true });
  await fs.mkdir(path.join(project, '.agent', 'skills'), { recursive: true });
  await fs.mkdir(path.join(project, 'src'), { recursive: true });
  await fs.writeFile(path.join(project, '.agent', 'agents', 'reviewer.md'), 'internal agent', 'utf8');
  await fs.writeFile(path.join(project, '.agent', 'agents', 'internal.js'), 'export const InternalAgent = true;', 'utf8');
  await fs.writeFile(path.join(project, '.agent', 'skills', 'internal.md'), 'internal skill', 'utf8');
  await fs.writeFile(path.join(project, 'src', 'app.js'), 'export const app = true;', 'utf8');
  return project;
};

test('file APIs hide the internal .agent tree while preserving normal project files', async () => {
  const project = await makeProject();
  try {
    const tree = await getAllFiles(project);
    assert.equal(tree.success, true);
    assert.equal(tree.items.some((item) => item.name === '.agent'), false);

    const normalChildren = await getFolderChildren(project, 'src');
    assert.equal(normalChildren.success, true);
    assert.deepEqual(normalChildren.children.map((item) => item.name), ['app.js']);

    const internalChildren = await getFolderChildren(project, '.agent');
    assert.equal(internalChildren.success, true);
    assert.deepEqual(internalChildren.children, []);

    const files = await listProjectFiles(project, { includeHidden: true });
    assert.deepEqual(files.files.map((file) => file.replaceAll('\\', '/')), ['src/app.js']);

    const search = await searchInProject(project, 'internal agent', { includeHidden: true });
    assert.deepEqual(search.results, []);

    const internalSymbols = await searchSymbols(project, 'internal', { maxResults: 100 });
    assert.deepEqual(internalSymbols.results, []);

    const normalSymbols = await searchSymbols(project, 'app', { maxResults: 100 });
    assert.equal(normalSymbols.results.some((result) => result.file === 'src/app.js'), true);
  } finally {
    await fs.rm(project, { recursive: true, force: true });
  }
});

test('file APIs reject an internal .agent directory used as the project root', async () => {
  const project = await makeProject();
  const internalRoot = path.join(project, '.agent');
  trustProjectPath(internalRoot);
  try {
    const calls = [
      getAllFiles(internalRoot),
      getFolderChildren(internalRoot, 'agents'),
      listProjectFiles(internalRoot, { includeHidden: true }),
      searchInProject(internalRoot, 'internal agent', { includeHidden: true }),
      getAllProjectFiles(internalRoot, { includeHidden: true })
    ];
    const results = await Promise.all(calls);
    results.forEach((result) => {
      assert.equal(result.success, false);
      assert.match(result.error, /\.agent/);
    });
  } finally {
    await fs.rm(project, { recursive: true, force: true });
  }
});

test('renderer file reads reject direct access to internal agent files', async () => {
  const project = await makeProject();
  try {
    const result = await readFile(project, '.agent/agents/reviewer.md');
    assert.equal(result.success, false);
    assert.match(result.error, /\.agent/);
  } finally {
    await fs.rm(project, { recursive: true, force: true });
  }
});

test('renderer file mutations reject every direct path into internal agent files', async () => {
  const project = await makeProject();
  try {
    const results = await Promise.all([
      writeFile(project, '.agent/agents/reviewer.md', 'changed'),
      deleteFile(project, '.agent/agents/reviewer.md'),
      createNewFile(project, '.agent/agents/new.md', 'internal'),
      renameFile(project, '.agent/agents/reviewer.md', '.agent/agents/renamed.md'),
      copyFile(project, '.agent/agents/reviewer.md', '.agent/agents/copied.md'),
      moveFile(project, '.agent/agents/reviewer.md', '.agent/agents/moved.md')
    ]);
    results.forEach((result) => {
      assert.equal(result.success, false);
      assert.match(result.error, /\.agent/);
    });
    assert.equal(await fs.readFile(path.join(project, '.agent', 'agents', 'reviewer.md'), 'utf8'), 'internal agent');
  } finally {
    await fs.rm(project, { recursive: true, force: true });
  }
});

test('renderer file APIs reject a junction alias targeting the internal .agent tree', async () => {
  const project = await makeProject();
  const alias = path.join(project, 'visible-agent-alias');
  try {
    await fs.symlink(path.join(project, '.agent'), alias, 'junction');

    const readResult = await readFile(project, 'visible-agent-alias/agents/reviewer.md');
    assert.equal(readResult.success, false);
    assert.match(readResult.error, /\.agent/);

    const childrenResult = await getFolderChildren(project, 'visible-agent-alias');
    assert.equal(childrenResult.success, false);
    assert.match(childrenResult.error, /\.agent/);

    const symbolsResult = await searchSymbols(project, 'internal', { maxResults: 100 });
    assert.deepEqual(symbolsResult.results, []);

    trustProjectPath(alias);
    const rootResult = await getAllFiles(alias);
    assert.equal(rootResult.success, false);
    assert.match(rootResult.error, /\.agent/);

    const tree = await getAllFiles(project);
    assert.equal(tree.items.some((item) => item.name === 'visible-agent-alias'), false);
  } finally {
    await fs.rm(project, { recursive: true, force: true });
  }
});
