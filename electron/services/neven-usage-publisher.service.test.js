'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createNevenUsagePublisher } = require('./neven-usage-publisher.service');

test('telemetry is disabled without NEVEN_WORKSPACE_ID and does not call the client', async () => {
  let calls = 0;
  const publishUsageEvent = createNevenUsagePublisher({
    workspaceId: '',
    client: { publishUsageEvent: async () => { calls += 1; } }
  });

  assert.deepEqual(await publishUsageEvent({ providerId: 'local' }), {
    success: false,
    code: 'telemetry_disabled'
  });
  assert.equal(calls, 0);
});

test('main publisher creates the event id and only forwards telemetry fields', async () => {
  let event;
  const publishUsageEvent = createNevenUsagePublisher({
    workspaceId: 'workspace-1',
    createEventId: () => 'usage-stable-id',
    now: () => '2026-08-17T12:00:00.000Z',
    client: { publishUsageEvent: async (value) => { event = value; return { success: true }; } }
  });

  await publishUsageEvent({
    providerId: 'ollama', inputTokens: 4, outputTokens: 2, durationMs: 8, success: false,
    prompt: 'not forwarded', response: 'not forwarded'
  });
  assert.deepEqual(event, {
    eventId: 'usage-stable-id',
    occurredAt: '2026-08-17T12:00:00.000Z',
    workspaceId: 'workspace-1',
    origin: 'local',
    providerId: 'ollama',
    inputTokens: 4,
    outputTokens: 2,
    latencyMs: 8,
    costEur: 0,
    success: false
  });
});
