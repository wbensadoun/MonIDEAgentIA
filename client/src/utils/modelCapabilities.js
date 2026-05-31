const DEFAULT_CAPABILITIES = {
  streaming: true,
  toolCalling: false,
  jsonMode: false,
  vision: false,
  embeddings: false,
  local: false,
  endpointType: 'cloud',
  maxInputTokens: 32000,
  maxOutputTokens: 4096,
  costInputPerMTokens: 0,
  costOutputPerMTokens: 0
};

const PROVIDER_CAPABILITIES = {
  gemini: {
    toolCalling: true,
    jsonMode: true,
    vision: true,
    embeddings: true,
    endpointType: 'cloud',
    costInputPerMTokens: 1.25,
    costOutputPerMTokens: 5
  },
  claude: {
    toolCalling: true,
    jsonMode: false,
    vision: true,
    endpointType: 'cloud',
    costInputPerMTokens: 3,
    costOutputPerMTokens: 15
  },
  kimi: {
    toolCalling: false,
    jsonMode: true,
    vision: false,
    endpointType: 'cloud',
    costInputPerMTokens: 0.6,
    costOutputPerMTokens: 2.5
  },
  ollama: {
    toolCalling: false,
    jsonMode: false,
    vision: false,
    embeddings: false,
    local: true,
    endpointType: 'local',
    costInputPerMTokens: 0,
    costOutputPerMTokens: 0
  }
};

export const normalizeCapabilityProvider = (provider) => {
  const value = String(provider || '').trim().toLowerCase();
  if (value === 'ollama-multi') return 'ollama';
  if (value === 'multi') return 'multi';
  return PROVIDER_CAPABILITIES[value] ? value : '';
};

export const getModelCapabilities = ({ provider, model = '' } = {}) => {
  const normalizedProvider = normalizeCapabilityProvider(provider);
  if (normalizedProvider === 'multi') {
    return {
      ...DEFAULT_CAPABILITIES,
      provider: 'multi',
      model: String(model || 'dynamic-roster'),
      endpointType: 'mixed',
      local: false,
      orchestration: true
    };
  }

  const providerCaps = PROVIDER_CAPABILITIES[normalizedProvider];
  if (!providerCaps) {
    return {
      ...DEFAULT_CAPABILITIES,
      provider: '',
      model: String(model || ''),
      disabled: true,
      reason: `Provider inconnu: ${provider || 'aucun'}`
    };
  }

  return {
    ...DEFAULT_CAPABILITIES,
    ...providerCaps,
    provider: normalizedProvider,
    model: String(model || ''),
    disabled: false
  };
};

export const assertProviderAllowedByPolicy = ({ provider, model, localOnly = false } = {}) => {
  const capabilities = getModelCapabilities({ provider, model });
  if (capabilities.disabled) {
    return { allowed: false, capabilities, reason: capabilities.reason };
  }
  if (localOnly && !capabilities.local) {
    return {
      allowed: false,
      capabilities,
      reason: `Local-only actif: ${provider} est un provider ${capabilities.endpointType}.`
    };
  }
  return { allowed: true, capabilities, reason: '' };
};

export const estimateCapabilityCost = ({ provider, model, inputTokens = 0, outputTokens = 0 } = {}) => {
  const capabilities = getModelCapabilities({ provider, model });
  const inputCost = (Math.max(0, Number(inputTokens) || 0) / 1000000) * capabilities.costInputPerMTokens;
  const outputCost = (Math.max(0, Number(outputTokens) || 0) / 1000000) * capabilities.costOutputPerMTokens;
  return Number((inputCost + outputCost).toFixed(6));
};
