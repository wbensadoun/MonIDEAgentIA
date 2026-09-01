'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { executeAgentFileToolCall } = require('./security');
const { executeCommandForAI } = require('../services/ai.service');

test('retrieval safety policy blocks the tool dispatcher before filesystem access', async () => {
  const result = await executeAgentFileToolCall('C:\\does-not-matter', {
    name: 'read_file',
    attrs: { file: 'secret.txt' }
  }, {
    toolsAllowed: false,
    promptSafety: { allowToolCalls: false }
  });
  assert.match(result, /status="error"/);
  assert.match(result, /Tool calls disabled/);
});

test('AI terminal dispatcher also enforces the retrieval no-tools policy', async () => {
  const result = await executeCommandForAI('echo should-not-run', null, undefined, {
    promptSafety: { allowToolCalls: false }
  });
  assert.equal(result.success, false);
  assert.match(result.output, /Outil desactive/);
});
