export const extractDecoratedUserPrompt = (value) => {
  const text = String(value || '').trim();
  const match = text.match(/DEMANDE UTILISATEUR:\s*([\s\S]*)$/i);
  return (match ? match[1] : text).trim();
};

const normalizePromptForIntent = (value) => (
  extractDecoratedUserPrompt(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[!?.,;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
);

const SIMPLE_OLLAMA_CHAT_PROMPTS = new Set([
  'hi',
  'hello',
  'hey',
  'yo',
  'salut',
  'bonjour',
  'bonsoir',
  'coucou',
  'ca va',
  'comment ca va',
  'how are you',
  'merci',
  'thanks',
  'thank you',
  'ok'
]);

const SIMPLE_OLLAMA_PROJECT_INTENT_REGEX = /\b(projet|project|repo|repository|fichier|file|code|bug|test|tests|refactor|corrige|fix|cree|creer|create|modifie|modifier|analyse|audit|terminal|commande|run|workflow|workflows|docs|documentation|php|javascript|typescript|js|jsx|ts|tsx|css|html|sql|fonction|function|classe|class|component|composant)\b/i;

export const isSimpleOllamaChatPrompt = (value) => {
  const raw = extractDecoratedUserPrompt(value);
  const normalized = normalizePromptForIntent(raw);
  if (!normalized || raw.length > 80 || raw.includes('\n')) return false;
  if (SIMPLE_OLLAMA_PROJECT_INTENT_REGEX.test(normalized)) return false;
  if (/[`@/\\]|[a-z0-9_-]+\.[a-z0-9]{1,8}/i.test(raw)) return false;
  if (SIMPLE_OLLAMA_CHAT_PROMPTS.has(normalized)) return true;
  const words = normalized.split(' ').filter(Boolean);
  return words.length <= 4 && /\b(hi|hello|hey|salut|bonjour|bonsoir|coucou|merci|thanks|ca va)\b/i.test(normalized);
};

export const resolveSimpleOllamaMaxTokens = (executionMode, localAISettings = {}, promptText = '') => {
  if (isSimpleOllamaChatPrompt(promptText)) return 256;

  const mode = String(executionMode || '').trim().toLowerCase();
  const modeDefault = mode === 'ask' || mode === 'plan' ? 512 : 2048;
  const configured = Number(localAISettings?.maxTokens);

  // The persisted default is 4096 in existing installs; keep the faster mode
  // defaults unless the user intentionally sets a different value.
  if (!Number.isFinite(configured) || configured <= 0 || configured === 4096) {
    return modeDefault;
  }

  const hardMax = configured > 4096 ? 8192 : 4096;
  return Math.max(128, Math.min(Math.floor(configured), hardMax));
};

export const findInstalledInstructVariant = (selectedModel, installedModels = []) => {
  const selected = String(selectedModel || '').trim();
  if (!selected || /-instruct$/i.test(selected)) return '';

  const [family, tag] = selected.split(':');
  if (!family || !tag) return '';

  const preferred = `${family}:${tag}-instruct`;
  const installedSet = new Set(
    (Array.isArray(installedModels) ? installedModels : [])
      .map((model) => String(model || '').trim())
      .filter(Boolean)
  );

  return installedSet.has(preferred) ? preferred : '';
};
