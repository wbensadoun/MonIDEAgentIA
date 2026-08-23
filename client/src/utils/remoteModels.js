import { DEFAULT_OLLAMA_MODEL, SUGGESTED_OLLAMA_MODELS } from './ollamaModels';

export const DEFAULT_GEMINI_MODEL = 'gemini-3-flash-preview';
export const DEFAULT_GEMINI_PRO_MODEL = 'gemini-3.1-pro-preview';
export const DEFAULT_KIMI_MODEL = 'moonshotai/Kimi-K2.5';
export const KIMI_K2_6_MODEL = 'moonshotai/Kimi-K2.6';
export const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-6';
export const DEFAULT_QWEN_MODEL = 'qwen-plus';

export const REMOTE_MODEL_OPTIONS = {
  gemini: [
    DEFAULT_GEMINI_MODEL,
    DEFAULT_GEMINI_PRO_MODEL
  ],
  claude: [
    DEFAULT_CLAUDE_MODEL
  ],
  kimi: [
    DEFAULT_KIMI_MODEL,
    KIMI_K2_6_MODEL
  ],
  dashscope: [
    DEFAULT_QWEN_MODEL
  ]
};

// ---------------------------------------------------------------------------
// Catalogue des fournisseurs
// ---------------------------------------------------------------------------
//
// Source unique de verite pour l'onglet Fournisseurs : cle API, champ modele et
// repli hors-ligne vivent sur le meme objet. L'UI itere sur ce tableau, donc
// ajouter un fournisseur = ajouter une entree ici, sans toucher au rendu.
// `fallbackModels` ne sert que si la detection reseau echoue (pas de cle, hors
// ligne, endpoint injoignable) — sinon la liste vient de l'API du fournisseur.

export const PROVIDER_CATALOG = [
  {
    id: 'gemini',
    label: 'Google Gemini',
    kind: 'cloud',
    keyField: 'geminiApiKey',
    modelField: 'geminiModel',
    keyPlaceholder: 'AIza...',
    keyHint: 'Google AI Studio → API keys',
    defaultModel: DEFAULT_GEMINI_MODEL,
    fallbackModels: [DEFAULT_GEMINI_MODEL, DEFAULT_GEMINI_PRO_MODEL]
  },
  {
    id: 'claude',
    label: 'Anthropic Claude',
    kind: 'cloud',
    keyField: 'claudeApiKey',
    modelField: 'claudeModel',
    keyPlaceholder: 'sk-ant-api...',
    keyHint: 'console.anthropic.com → API keys',
    defaultModel: DEFAULT_CLAUDE_MODEL,
    fallbackModels: [DEFAULT_CLAUDE_MODEL]
  },
  {
    id: 'kimi',
    label: 'Moonshot Kimi',
    kind: 'cloud',
    keyField: 'kimiApiKey',
    modelField: 'kimiModel',
    keyPlaceholder: 'tgp_v1_...',
    keyHint: 'Servi via Together AI → API keys',
    defaultModel: DEFAULT_KIMI_MODEL,
    fallbackModels: [DEFAULT_KIMI_MODEL, KIMI_K2_6_MODEL]
  },
  {
    id: 'dashscope',
    label: 'Qwen / DashScope',
    kind: 'cloud',
    keyField: null,
    modelField: 'qwenModel',
    supportsModelDiscovery: false,
    keyHint: 'Configuration du modèle DashScope uniquement',
    defaultModel: DEFAULT_QWEN_MODEL,
    fallbackModels: [DEFAULT_QWEN_MODEL]
  },
  {
    id: 'ollama',
    label: 'Ollama',
    kind: 'local',
    keyField: null,
    modelField: 'ollamaModel',
    keyHint: 'Aucune clé : tourne en local sur cette machine',
    defaultModel: DEFAULT_OLLAMA_MODEL,
    fallbackModels: SUGGESTED_OLLAMA_MODELS
  }
];

export const getProviderDescriptor = (providerId) => (
  PROVIDER_CATALOG.find((provider) => provider.id === providerId) || null
);

export const getDefaultRemoteModel = (provider) => {
  if (provider === 'claude') return DEFAULT_CLAUDE_MODEL;
  if (provider === 'kimi') return DEFAULT_KIMI_MODEL;
  if (provider === 'dashscope') return DEFAULT_QWEN_MODEL;
  return DEFAULT_GEMINI_MODEL;
};

export const normalizeRemoteModelName = (value, fallback = '') => {
  const normalized = String(value || '').trim();
  if (normalized) return normalized;
  return String(fallback || '').trim();
};

export const getRemoteModelOptions = (provider, currentModel = '') => (
  Array.from(new Set([
    ...(REMOTE_MODEL_OPTIONS[provider] || []),
    normalizeRemoteModelName(currentModel)
  ].filter(Boolean)))
);

export const TRACKED_REMOTE_MODELS = [
  {
    id: 'gemini-flash',
    provider: 'Gemini',
    role: 'Assistant principal',
    model: DEFAULT_GEMINI_MODEL,
    channel: 'API Google',
    cadence: 'Latest preview'
  },
  {
    id: 'gemini-pro',
    provider: 'Gemini',
    role: 'Planification / multi-agent',
    model: DEFAULT_GEMINI_PRO_MODEL,
    channel: 'API Google',
    cadence: 'Latest preview'
  },
  {
    id: 'claude-sonnet',
    provider: 'Claude',
    role: 'Assistant Claude',
    model: DEFAULT_CLAUDE_MODEL,
    channel: 'API Anthropic',
    cadence: 'Alias officiel'
  },
  {
    id: 'kimi-k25',
    provider: 'Kimi',
    role: 'Code / swarm hybride',
    model: DEFAULT_KIMI_MODEL,
    channel: 'Together AI',
    cadence: 'Modele officiel'
  },
  {
    id: 'kimi-k26',
    provider: 'Kimi',
    role: 'Code / swarm hybride',
    model: KIMI_K2_6_MODEL,
    channel: 'Together AI',
    cadence: 'Modele officiel'
  }
];
