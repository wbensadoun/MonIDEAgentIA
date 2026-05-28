export const DEFAULT_OLLAMA_MODEL = 'qwen3:latest';

export const SUGGESTED_OLLAMA_MODELS = [
  'qwen3:latest',
  'qwen2.5-coder:14b',
  'qwen3-coder:30b',
  'qwen3:8b',
  'qwen3:14b',
  'qwen3:30b',
  'qwen3:32b'
];

const LEGACY_PINNED_QWEN_MODELS = new Set([
  'qwen3',
  'qwen3:8b'
]);

export const normalizeOllamaModelLabel = (value, fallback = DEFAULT_OLLAMA_MODEL) => {
  const normalized = String(value || '').trim();
  const resolvedFallback = String(fallback || DEFAULT_OLLAMA_MODEL).trim() || DEFAULT_OLLAMA_MODEL;
  const candidate = normalized || resolvedFallback;

  if (LEGACY_PINNED_QWEN_MODELS.has(candidate)) {
    return DEFAULT_OLLAMA_MODEL;
  }

  return candidate;
};
