'use strict';

const { randomUUID } = require('crypto');

const createNevenUsagePublisher = ({
  client,
  workspaceId = process.env.NEVEN_WORKSPACE_ID,
  origin = process.env.NEVEN_USAGE_ORIGIN || 'local',
  createEventId = () => `usage-${randomUUID()}`,
  now = () => new Date().toISOString()
} = {}) => {
  const normalizedWorkspaceId = String(workspaceId || '').trim();

  return async ({ providerId, inputTokens, outputTokens, durationMs, success } = {}) => {
    if (!normalizedWorkspaceId) {
      return { success: false, code: 'telemetry_disabled' };
    }
    if (!client || typeof client.publishUsageEvent !== 'function') {
      return { success: false, code: 'telemetry_unavailable' };
    }
    return client.publishUsageEvent({
      eventId: createEventId(),
      occurredAt: now(),
      workspaceId: normalizedWorkspaceId,
      origin,
      providerId,
      inputTokens,
      outputTokens,
      durationMs,
      success
    });
  };
};

module.exports = { createNevenUsagePublisher };
