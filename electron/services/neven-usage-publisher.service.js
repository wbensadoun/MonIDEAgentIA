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

  return async ({ providerId, profileId, inputTokens, outputTokens, durationMs, latencyMs, costEur, origin: eventOrigin, fallbackUsed, errorCode, routingReason, success } = {}) => {
    if (!normalizedWorkspaceId) {
      return { success: false, code: 'telemetry_disabled' };
    }
    if (!client || typeof client.publishUsageEvent !== 'function') {
      return { success: false, code: 'telemetry_unavailable' };
    }
    const event = {
      eventId: createEventId(),
      occurredAt: now(),
      workspaceId: normalizedWorkspaceId,
      origin: eventOrigin || origin,
      inputTokens,
      outputTokens,
      latencyMs: latencyMs ?? durationMs,
      costEur: costEur ?? 0,
      success
    };
    if (providerId !== undefined) event.providerId = providerId;
    if (profileId !== undefined) event.profileId = profileId;
    if (fallbackUsed !== undefined) event.fallbackUsed = fallbackUsed;
    if (errorCode !== undefined) event.errorCode = errorCode;
    if (routingReason !== undefined) event.routingReason = routingReason;
    return client.publishUsageEvent(event);
  };
};

module.exports = { createNevenUsagePublisher };
