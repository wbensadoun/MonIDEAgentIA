import { getProviderLabel } from './multiAgentConfig';

const MAX_MULTI_AI_EVENTS = 16;

export const normalizeMultiStepStatus = (status) => {
  if (status === 'done' || status === 'completed') return 'completed';
  if (status === 'active' || status === 'error') return status;
  return 'pending';
};

export const truncateMultiDetail = (value, fallback = '') => {
  const safeValue = String(value || fallback || '').replace(/\s+/g, ' ').trim();
  if (!safeValue) return '';
  return safeValue.length > 180 ? `${safeValue.slice(0, 177)}...` : safeValue;
};

export const createEmptyMultiAIState = () => ({
  isActive: false,
  mode: null,
  runLabel: null,
  currentPhase: null,
  architectPlan: null,
  approvedPlan: null,
  startedAt: null,
  finishedAt: null,
  models: null,
  requestedModels: null,
  steps: [],
  events: [],
  error: null
});

export const resolveMultiRoleKeyFromLabel = (label) => {
  const safeLabel = String(label || '').toLowerCase();
  if (safeLabel.includes('chef')) return 'chef';
  if (safeLabel.includes('frontend')) return 'frontend';
  if (safeLabel.includes('backend')) return 'backend';
  if (safeLabel.includes('architecte')) return 'architect';
  if (safeLabel.includes('codeur')) return 'coder';
  if (safeLabel.includes('relecteur') || safeLabel.includes('reviewer')) return 'tester';
  if (safeLabel.includes('scrum')) return 'scrum';
  return null;
};

export const appendMultiAIEvent = (events, nextEvent) => {
  const safeEvents = Array.isArray(events) ? events : [];
  const label = String(nextEvent?.label || 'Equipe IA').trim();
  const status = normalizeMultiStepStatus(nextEvent?.status);
  const detail = truncateMultiDetail(nextEvent?.detail, nextEvent?.text);
  const roleKey = nextEvent?.roleKey || resolveMultiRoleKeyFromLabel(label);
  const lastEvent = safeEvents[safeEvents.length - 1];

  if (
    lastEvent &&
    lastEvent.label === label &&
    lastEvent.status === status &&
    lastEvent.detail === detail
  ) {
    return safeEvents;
  }

  return [
    ...safeEvents.slice(-(MAX_MULTI_AI_EVENTS - 1)),
    {
      id: `${Date.now()}-${safeEvents.length}`,
      at: Date.now(),
      label,
      status,
      detail,
      roleKey
    }
  ];
};

export const buildDynamicTeamSteps = (teamPlan, statusByKey = {}) => (
  (Array.isArray(teamPlan?.selectedAgents) ? teamPlan.selectedAgents : []).map((agent) => ({
    key: agent.key,
    label: agent.title,
    provider: agent.providerLabel || getProviderLabel(agent.provider),
    model: agent.model,
    detail: agent.reason || agent.focus,
    stage: agent.stage,
    execution: agent.execution,
    status: normalizeMultiStepStatus(statusByKey[agent.key])
  }))
);

export const updateMultiStepsFromEvent = (steps, { label, status, detail, models } = {}) => {
  const safeSteps = Array.isArray(steps) ? steps : [];
  const roleKey = resolveMultiRoleKeyFromLabel(label);
  const normalizedStatus = normalizeMultiStepStatus(status);
  const shortDetail = truncateMultiDetail(detail);

  return safeSteps.map((step) => {
    if (!step || typeof step !== 'object') return step;

    const stepModel = models?.[step.key] || step.model || null;
    const matchesRole = roleKey && step.key === roleKey;
    const matchesLabel = label && (
      step.label === label ||
      String(label).startsWith(`${step.label} `)
    );

    if (!matchesRole && !matchesLabel) {
      return stepModel && stepModel !== step.model ? { ...step, model: stepModel } : step;
    }

    return {
      ...step,
      status: normalizedStatus,
      detail: shortDetail || step.detail,
      model: stepModel
    };
  });
};

export const markAllMultiStepsCompleted = (steps, models = null) => (
  (Array.isArray(steps) ? steps : []).map((step) => {
    if (!step || typeof step !== 'object') return step;
    return {
      ...step,
      status: step.status === 'error' ? 'error' : 'completed',
      model: models?.[step.key] || step.model || null
    };
  })
);

export const markActiveMultiStepsErrored = (steps) => (
  (Array.isArray(steps) ? steps : []).map((step) => {
    if (!step || typeof step !== 'object') return step;
    if (step.status !== 'active') return step;
    return { ...step, status: 'error' };
  })
);

export const ROLE_PROVIDER_METHODS = {
  gemini: 'getGeminiCompletion',
  claude: 'getClaudeCompletion',
  kimi: 'getKimiCompletion',
  ollama: 'getOllamaCompletion',
  neven: 'getNevenCompletion'
};
