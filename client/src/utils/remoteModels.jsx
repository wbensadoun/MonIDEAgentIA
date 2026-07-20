export const DEFAULT_GEMINI_MODEL = 'gemini-3-flash-preview';
export const DEFAULT_GEMINI_PRO_MODEL = 'gemini-3.1-pro-preview';
export const DEFAULT_KIMI_MODEL = 'moonshotai/Kimi-K2.5';
export const KIMI_K2_6_MODEL = 'moonshotai/Kimi-K2.6';
export const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-6';
// Placeholder tier-resolution "light" pour le routeur intelligent (main.js -> resolveModelForTier) :
// facilement ajustable si un vrai modele Claude Haiku plus recent sort.
export const DEFAULT_CLAUDE_LIGHT_MODEL = 'claude-haiku-4-6';

export const REMOTE_MODEL_OPTIONS = {
  gemini: [
    DEFAULT_GEMINI_MODEL,
    DEFAULT_GEMINI_PRO_MODEL
  ],
  claude: [
    DEFAULT_CLAUDE_LIGHT_MODEL,
    DEFAULT_CLAUDE_MODEL
  ],
  kimi: [
    DEFAULT_KIMI_MODEL,
    KIMI_K2_6_MODEL
  ]
};

export const getDefaultRemoteModel = (provider) => {
  if (provider === 'claude') return DEFAULT_CLAUDE_MODEL;
  if (provider === 'kimi') return DEFAULT_KIMI_MODEL;
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
