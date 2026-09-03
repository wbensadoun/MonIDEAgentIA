'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const userData = fsSync.mkdtempSync(path.join(os.tmpdir(), 'code-companion-agent-data-'));
const electronId = require.resolve('electron');
require.cache[electronId] = {
  id: electronId,
  filename: electronId,
  loaded: true,
  exports: { app: { getPath: () => userData } }
};

const { listAgents, getAgent, loadAgentForCompletion } = require('./agent.service');
const { trustProjectPath } = require('../core/security');

test('agent service still loads workspace agents from the hidden .agent directory', async () => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), 'code-companion-agent-project-'));
  trustProjectPath(project);
  try {
    const agentsDir = path.join(project, '.agent', 'agents');
    await fs.mkdir(agentsDir, { recursive: true });
    await fs.writeFile(
      path.join(agentsDir, 'reviewer.md'),
      '---\nname: reviewer\ndescription: Review changes\n---\nInspect the diff carefully.',
      'utf8'
    );

    const listed = await listAgents(project);
    assert.deepEqual(listed.agents.map((agent) => agent.name), ['reviewer']);

    const loaded = await getAgent('reviewer', 'workspace', project);
    assert.equal(loaded.success, true);
    assert.match(loaded.agent.body, /Inspect the diff carefully/);

    const completion = await loadAgentForCompletion({ name: 'reviewer', scope: 'workspace' }, project);
    assert.match(completion.body, /Inspect the diff carefully/);
  } finally {
    await fs.rm(project, { recursive: true, force: true });
    await fs.rm(userData, { recursive: true, force: true });
  }
});
