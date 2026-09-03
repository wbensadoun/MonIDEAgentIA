import { DEFAULT_OLLAMA_MODEL, normalizeOllamaModelLabel } from './ollamaModels';
import {
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_KIMI_MODEL,
  normalizeRemoteModelName
} from './remoteModels';
import { assertProviderAllowedByPolicy, getModelCapabilities } from './modelCapabilities';

export const AI_PROVIDER_METHODS = {
  gemini: 'getGeminiCompletion',
  claude: 'getClaudeCompletion',
  kimi: 'getKimiCompletion',
  ollama: 'getOllamaCompletion'
};

const SIMPLE_PROVIDERS = new Set(Object.keys(AI_PROVIDER_METHODS));

export const normalizeSingleAIProvider = (value) => {
  const provider = String(value || '').trim().toLowerCase();
  if (SIMPLE_PROVIDERS.has(provider)) return provider;
  return '';
};

export const getModelForProvider = (provider, models = {}, _sourceProvider = provider) => {
  if (provider === 'claude') {
    return normalizeRemoteModelName(models.claudeModel, DEFAULT_CLAUDE_MODEL);
  }

  if (provider === 'kimi') {
    return normalizeRemoteModelName(models.kimiModel, DEFAULT_KIMI_MODEL);
  }

  if (provider === 'ollama') {
    const preferred = models.ollamaModel || models.resolvedOllamaModel;
    return normalizeOllamaModelLabel(preferred, DEFAULT_OLLAMA_MODEL);
  }

  return normalizeRemoteModelName(models.geminiModel, DEFAULT_GEMINI_MODEL);
};

export const buildSingleAIInvocation = ({
  aiProvider,
  models = {},
  projectPath = '',
  maxTokens,
  temperature,
  localOnly = false,
  disabledReason = ''
} = {}) => {
  const sourceProvider = String(aiProvider || '').trim().toLowerCase();
  const provider = normalizeSingleAIProvider(sourceProvider);

  if (!provider) {
    return {
      disabled: true,
      provider: '',
      sourceProvider,
      methodName: '',
      model: '',
      options: {},
      reason: disabledReason || 'Ce mode IA utilise plusieurs agents. Choisis un provider simple pour cette action.'
    };
  }

  const model = getModelForProvider(provider, models, sourceProvider);
  const policy = assertProviderAllowedByPolicy({ provider, model, localOnly });
  if (!policy.allowed) {
    return {
      disabled: true,
      provider,
      sourceProvider,
      methodName: '',
      model,
      options: {},
      capabilities: policy.capabilities,
      reason: policy.reason
    };
  }
  const options = {
    provider,
    sourceProvider,
    model,
    projectPath,
    localOnly: !!localOnly,
    disallowProviderFallback: true
  };

  if (Number.isFinite(Number(maxTokens))) {
    options.maxTokens = Number(maxTokens);
  }

  if (Number.isFinite(Number(temperature))) {
    options.temperature = Number(temperature);
  }

  if (provider === 'kimi') {
    options.fastMode = true;
    options.reactMode = false;
    options.streamResponse = false;
    options.includeProjectContext = false;
    options.includeGlobalSkills = false;
  }

  return {
    disabled: false,
    provider,
    sourceProvider,
    methodName: AI_PROVIDER_METHODS[provider],
    model,
    options,
    capabilities: getModelCapabilities({ provider, model })
  };
};
