'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs').promises;
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createWorkflowEngine, evaluateCondition, topoSort } = require('./workflowEngine.service');

const buildEngine = async (overrides = {}) => {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'code-companion-workflow-'));
  const events = [];
  const engine = createWorkflowEngine({
    app: { getPath: () => userData },
    fs,
    path,
    getMainWindow: () => ({ isDestroyed: () => false, webContents: { send: (channel, payload) => events.push({ channel, payload }) } }),
    ensureEditPermission: async () => {},
    ensureTerminalPermission: async () => {},
    ensureTrustedProjectPath: async (projectPath) => projectPath,
    assertSafePath: () => {},
    readSettingsSafe: async () => ({ permissionMode: 'edit_terminal' }),
    runCommandForTask: async () => ({ ok: true, code: 0, stdout: 'ok', stderr: '' }),
    requestTerminalApproval: async () => true,
    buildSafeSpawnRequest: (command) => ({ normalizedCommandLine: command }),
    runSingleCompletionProvider: async () => ({ success: true, text: 'ai result' }),
    fetchImpl: async () => ({ ok: true, status: 200, arrayBuffer: async () => Buffer.from('pong') }),
    ...overrides
  });
  return { engine, userData, events };
};

test('workflow backend rejects read-only execution and persists the rejection', async () => {
  const { engine } = await buildEngine({ readSettingsSafe: async () => ({ permissionMode: 'read_only' }) });
  const result = await engine.start('C:/trusted-project', { name: 'Read only', nodes: [{ id: 'n1', type: 'trigger', label: 'Start' }], edges: [] });

  assert.equal(result.success, false);
  assert.equal(result.status, 'rejected');
  const history = await engine.get(result.runId, 'C:/trusted-project');
  assert.equal(history.success, true);
  assert.equal(history.run.status, 'rejected');
  assert.match(history.run.error, /lecture seule/);
});

test('workflow backend blocks direct access to the internal .agent tree', async () => {
  const { engine } = await buildEngine();
  const projectPath = 'C:/trusted-project';
  const result = await engine.start(projectPath, {
    schemaVersion: 2,
    name: 'internal-path',
    nodes: [
      { id: 'trigger', type: 'trigger', label: 'Trigger' },
      { id: 'read', type: 'action', label: 'Read', config: { actionType: 'read_file', filename: '.agent/agents/reviewer.md' } }
    ],
    edges: [{ source: 'trigger', target: 'read' }]
  });
  assert.equal(result.success, false);
  assert.equal(result.status, 'failed');
  const history = await engine.get(result.runId, projectPath);
  assert.match(history.run.error, /\.agent/);
});

test('workflow backend executes bounded HTTP and delay nodes and persists history', async () => {
  const { engine, events } = await buildEngine();
  const result = await engine.start('C:/trusted-project', {
    name: 'HTTP flow',
    nodes: [
      { id: 'trigger', type: 'trigger', label: 'Start' },
      { id: 'http', type: 'action', label: 'Ping', config: { actionType: 'http', url: 'https://example.test/health' } },
      { id: 'delay', type: 'logic', label: 'Delay', config: { actionType: 'delay', seconds: 0 } },
      { id: 'output', type: 'output', label: 'Log', config: { message: '{{prev}}' } }
    ],
    edges: [
      { source: 'trigger', target: 'http' },
      { source: 'http', target: 'delay' },
      { source: 'delay', target: 'output' }
    ]
  });

  assert.equal(result.success, true);
  assert.equal(result.status, 'completed');
  const history = await engine.get(result.runId, 'C:/trusted-project');
  assert.equal(history.run.nodes.length, 4);
  assert.ok(history.run.nodes.every((node) => node.status === 'success'));
  assert.ok(events.some((event) => event.channel === 'workflow-run-progress' && event.payload.status === 'completed'));
  assert.ok(events.some((event) => event.channel === 'workflow-run-log' && event.payload.nodeId === 'http'));
});

test('workflow backend records a failed history entry when HTTP loses connectivity', async () => {
  const { engine } = await buildEngine({
    fetchImpl: async () => { throw new Error('network unavailable'); }
  });
  const projectPath = 'C:/trusted-project';
  const result = await engine.start(projectPath, {
    name: 'Network failure',
    nodes: [
      { id: 'trigger', type: 'trigger', label: 'Start' },
      { id: 'http', type: 'action', label: 'Ping', config: { actionType: 'http', url: 'https://example.test/health' } },
      { id: 'delay', type: 'logic', label: 'Delay', config: { actionType: 'delay', seconds: 0 } },
      { id: 'output', type: 'output', label: 'Log', config: { message: 'should not run' } }
    ],
    edges: [
      { source: 'trigger', target: 'http' },
      { source: 'http', target: 'delay' },
      { source: 'delay', target: 'output' }
    ]
  });

  assert.equal(result.success, false);
  assert.equal(result.status, 'failed');
  const history = await engine.get(result.runId, projectPath);
  assert.equal(history.run.status, 'failed');
  assert.equal(history.run.nodes.at(-1).status, 'error');
  assert.match(history.run.error, /network unavailable/);
});

test('workflow helpers reject dependency cycles and evaluate only supported expressions', () => {
  assert.throws(() => topoSort([{ id: 'a' }, { id: 'b' }], [{ source: 'a', target: 'b' }, { source: 'b', target: 'a' }]), /boucle/);
  assert.equal(evaluateCondition('results.node === "ok"', { results: { node: 'ok' }, prev: '' }), true);
  assert.equal(evaluateCondition('prev !== "ok" && false', { results: {}, prev: 'ok' }), false);
});
