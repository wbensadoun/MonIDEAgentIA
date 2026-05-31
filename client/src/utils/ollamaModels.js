// Defaut concret (jamais ":latest" — alias ambigu supprime).
// La taille reelle est resolue dynamiquement selon la puissance machine
// (voir resolveOllamaFamily / recommendOllamaSize cote backend).
export const DEFAULT_OLLAMA_MODEL = 'qwen3:8b';

// Liste de secours (hors-ligne uniquement). La source principale du menu est
// dynamique : familles via ollama.com/search + tailles via /library/<famille>/tags
// + modeles installes. Aucun ":latest" ici.
export const SUGGESTED_OLLAMA_MODELS = [
  'qwen3:8b',
  'qwen3:14b',
  'qwen3:30b',
  'qwen3:32b'
];

export const normalizeOllamaModelLabel = (value, fallback = DEFAULT_OLLAMA_MODEL) => {
  const normalized = String(value || '').trim();
  const resolvedFallback = String(fallback || DEFAULT_OLLAMA_MODEL).trim() || DEFAULT_OLLAMA_MODEL;
  const candidate = normalized || resolvedFallback;

  // Migration: ":latest" supprime -> taille concrete (8b). Le choix utilisateur
  // (qwen3:8b, qwen3:14b, ...) n'est plus jamais reecrit.
  if (/:latest$/i.test(candidate)) {
    return candidate.replace(/:latest$/i, ':8b');
  }

  return candidate;
};
