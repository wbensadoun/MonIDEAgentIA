'use strict';

const { app } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const axios = require('axios');

// ---------------------------------------------------------------------------
// Paths & model constants
// ---------------------------------------------------------------------------

const getSettingsPath = () => path.join(app.getPath('userData'), 'settings.json');

const DEFAULT_GEMINI_MODEL = 'gemini-3-flash-preview';
const DEFAULT_KIMI_MODEL = 'moonshotai/Kimi-K2.5';
const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-6';
const DEFAULT_GEMINI_PRO_MODEL = 'gemini-3.1-pro-preview';
const CANONICAL_QWEN_OLLAMA_MODEL = 'qwen3:8b';

const SUPPORTED_AI_PROVIDERS = new Set(['gemini', 'claude', 'kimi', 'ollama']);

const MULTI_AGENT_ROLE_DEFAULTS = Object.freeze({
  selector: { provider: 'gemini', model: DEFAULT_GEMINI_PRO_MODEL },
  captain: { provider: 'gemini', model: DEFAULT_GEMINI_PRO_MODEL },
  domain: { provider: 'gemini', model: DEFAULT_GEMINI_MODEL },
  ux: { provider: 'gemini', model: DEFAULT_GEMINI_MODEL },
  ui: { provider: 'kimi', model: DEFAULT_KIMI_MODEL },
  frontend: { provider: 'kimi', model: DEFAULT_KIMI_MODEL },
  apiData: { provider: 'kimi', model: DEFAULT_KIMI_MODEL },
  workflow: { provider: 'kimi', model: DEFAULT_KIMI_MODEL },
  security: { provider: 'claude', model: DEFAULT_CLAUDE_MODEL },
  qa: { provider: 'kimi', model: DEFAULT_KIMI_MODEL },
  gitRelease: { provider: 'kimi', model: DEFAULT_KIMI_MODEL }
});

const LEGACY_MULTI_AGENT_ROLE_KEY_MAP = {
  chef: 'captain',
  backend: 'apiData',
  architect: 'security',
  scrum: 'qa'
};

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

const normalizePreferredOllamaModelName = (value, fallback = CANONICAL_QWEN_OLLAMA_MODEL) => {
  const normalized = String(value || '').trim();
  const resolvedFallback = String(fallback || CANONICAL_QWEN_OLLAMA_MODEL).trim() || CANONICAL_QWEN_OLLAMA_MODEL;
  const candidate = normalized || resolvedFallback;
  // Migrate ":latest" alias → ":8b"
  if (/:latest$/i.test(candidate)) return candidate.replace(/:latest$/i, ':8b');
  return candidate;
};

const normalizeAIProviderName = (value, fallback = 'gemini') => {
  const normalized = String(value || '').trim().toLowerCase();
  return SUPPORTED_AI_PROVIDERS.has(normalized) ? normalized : fallback;
};

const getDefaultModelForAIProvider = (provider) => {
  const normalizedProvider = normalizeAIProviderName(provider);
  if (normalizedProvider === 'claude') return DEFAULT_CLAUDE_MODEL;
  if (normalizedProvider === 'kimi') return DEFAULT_KIMI_MODEL;
  if (normalizedProvider === 'ollama') return CANONICAL_QWEN_OLLAMA_MODEL;
  return DEFAULT_GEMINI_MODEL;
};

const normalizeMultiAgentRoles = (raw = {}) => {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return Object.entries(MULTI_AGENT_ROLE_DEFAULTS).reduce((acc, [roleKey, defaults]) => {
    const legacyKey = Object.entries(LEGACY_MULTI_AGENT_ROLE_KEY_MAP)
      .find(([, nextKey]) => nextKey === roleKey)?.[0];
    const roleSource = source[roleKey] || source[legacyKey];
    const role = roleSource && typeof roleSource === 'object' ? roleSource : {};
    const provider = normalizeAIProviderName(role.provider, defaults.provider);
    const fallbackModel = defaults.model || getDefaultModelForAIProvider(provider);
    acc[roleKey] = {
      provider,
      model: String(role.model || fallbackModel || getDefaultModelForAIProvider(provider)).trim()
    };
    return acc;
  }, {});
};

// ---------------------------------------------------------------------------
// Default settings
// ---------------------------------------------------------------------------

const DEFAULT_APP_SETTINGS = Object.freeze({
  defaultProvider: 'gemini',
  thinkingMode: false,
  geminiModel: DEFAULT_GEMINI_MODEL,
  claudeModel: DEFAULT_CLAUDE_MODEL,
  kimiModel: DEFAULT_KIMI_MODEL,
  ollamaModel: CANONICAL_QWEN_OLLAMA_MODEL,
  multiAgentRoles: normalizeMultiAgentRoles(),
  // Routeur Intelligent : voir docs/ARCHITECTURE_ROUTEUR_INTELLIGENT.md.
  // routerClassifierProvider/Model a `null` = repli sur le provider/modele par
  // defaut de l'app (defaultProvider) plutot qu'un provider fige.
  routerAutoRoute: true,
  routerClassifierProvider: null,
  routerClassifierModel: null,
  routerComplexityThreshold: 0.5,
  devPort: '3004',
  allowDangerousActions: false,
  aiContextPreset: 'safe',
  aiContextIncludeSecrets: false,
  aiContextLargeFileStrategy: 'skip',
  aiTerminalApprovalMode: true,
  permissionMode: 'edit_terminal',
  qualityGateOnApply: false,
  qualityGateLint: true,
  qualityGateTest: false,
  qualityGateBuild: false,
  qualityGateBlockOnFail: true,
  onboardingCompleted: false,
  contextMode: 'auto',
  contextMaxFiles: 120,
  localAIOptimizationMode: 'safe',
  localAIHardwareConsent: false,
  localAIMaxConcurrentLocal: 1,
  localAIMaxConcurrentCloud: 3,
  localAIContextBudget: 'short',
  localAIMaxTokens: 4096
});

// ---------------------------------------------------------------------------
// Settings normalization & persistence
// ---------------------------------------------------------------------------

const normalizePermissionMode = (value) => {
  const mode = String(value || '').trim();
  if (mode === 'read_only') return 'read_only';
  if (mode === 'edit') return 'edit';
  return 'edit_terminal';
};

const normalizeSettings = (raw) => {
  const base = raw && typeof raw === 'object' ? raw : {};
  const normalized = { ...DEFAULT_APP_SETTINGS, ...base };

  normalized.permissionMode = normalizePermissionMode(normalized.permissionMode);
  normalized.aiTerminalApprovalMode = normalized.aiTerminalApprovalMode !== false;
  normalized.qualityGateOnApply = !!normalized.qualityGateOnApply;
  normalized.qualityGateLint = normalized.qualityGateLint !== false;
  normalized.qualityGateTest = !!normalized.qualityGateTest;
  normalized.qualityGateBuild = !!normalized.qualityGateBuild;
  normalized.qualityGateBlockOnFail = normalized.qualityGateBlockOnFail !== false;

  const contextMode = String(normalized.contextMode || '').trim();
  normalized.contextMode = contextMode === 'mentions' || contextMode === 'none' ? contextMode : 'auto';

  const maxFiles = Number(normalized.contextMaxFiles);
  normalized.contextMaxFiles = Number.isFinite(maxFiles)
    ? Math.min(50000, Math.max(10, Math.floor(maxFiles))) : 120;

  const localMode = String(normalized.localAIOptimizationMode || 'safe').trim();
  normalized.localAIOptimizationMode = localMode === 'auto' || localMode === 'manual' ? localMode : 'safe';
  normalized.localAIHardwareConsent = !!normalized.localAIHardwareConsent;

  const localMax = Number(normalized.localAIMaxConcurrentLocal);
  normalized.localAIMaxConcurrentLocal = Number.isFinite(localMax)
    ? Math.min(4, Math.max(1, Math.floor(localMax))) : 1;

  const cloudMax = Number(normalized.localAIMaxConcurrentCloud);
  normalized.localAIMaxConcurrentCloud = Number.isFinite(cloudMax)
    ? Math.min(6, Math.max(1, Math.floor(cloudMax))) : 3;

  const localTokens = Number(normalized.localAIMaxTokens);
  normalized.localAIMaxTokens = Number.isFinite(localTokens)
    ? Math.min(8192, Math.max(512, Math.floor(localTokens))) : 4096;

  const localContextBudget = String(normalized.localAIContextBudget || 'short').trim();
  normalized.localAIContextBudget = ['short', 'medium', 'long'].includes(localContextBudget)
    ? localContextBudget : 'short';

  normalized.devPort = String(normalized.devPort || '3004').trim() || '3004';
  normalized.geminiModel = String(normalized.geminiModel || DEFAULT_GEMINI_MODEL).trim() || DEFAULT_GEMINI_MODEL;
  normalized.claudeModel = String(normalized.claudeModel || DEFAULT_CLAUDE_MODEL).trim() || DEFAULT_CLAUDE_MODEL;
  normalized.kimiModel = String(normalized.kimiModel || DEFAULT_KIMI_MODEL).trim() || DEFAULT_KIMI_MODEL;

  normalized.ollamaModel = normalizePreferredOllamaModelName(normalized.ollamaModel, DEFAULT_APP_SETTINGS.ollamaModel);
  normalized.multiAgentRoles = normalizeMultiAgentRoles(normalized.multiAgentRoles);

  // Migration : fusionne les valeurs par defaut du Routeur Intelligent pour les
  // utilisateurs mettant a jour depuis une version anterieure au routeur. Meme
  // principe que la migration d'alias Ollama ci-dessus : on ne lit que la valeur
  // deja persistee et on ne substitue le defaut que si elle est manquante/undefined,
  // sans jamais ecraser un reglage explicite (y compris `false` ou `0`).
  normalized.routerAutoRoute = normalized.routerAutoRoute === undefined
    ? DEFAULT_APP_SETTINGS.routerAutoRoute
    : normalized.routerAutoRoute !== false;

  normalized.routerClassifierProvider = normalized.routerClassifierProvider === undefined
    ? DEFAULT_APP_SETTINGS.routerClassifierProvider
    : (normalized.routerClassifierProvider
      ? normalizeAIProviderName(normalized.routerClassifierProvider, null)
      : null);

  normalized.routerClassifierModel = normalized.routerClassifierModel === undefined
    ? DEFAULT_APP_SETTINGS.routerClassifierModel
    : (String(normalized.routerClassifierModel || '').trim() || null);

  const routerComplexityThreshold = normalized.routerComplexityThreshold === undefined
    ? DEFAULT_APP_SETTINGS.routerComplexityThreshold
    : Number(normalized.routerComplexityThreshold);
  normalized.routerComplexityThreshold = Number.isFinite(routerComplexityThreshold)
    ? Math.min(1, Math.max(0, routerComplexityThreshold))
    : DEFAULT_APP_SETTINGS.routerComplexityThreshold;

  const preset = String(normalized.aiContextPreset || 'safe');
  normalized.aiContextPreset = preset === 'full' || preset === 'god' ? preset : 'safe';

  const largeFileStrategy = String(normalized.aiContextLargeFileStrategy || 'skip');
  normalized.aiContextLargeFileStrategy = largeFileStrategy === 'truncate' ? 'truncate' : 'skip';

  return normalized;
};

const readSettingsSafe = async () => {
  try {
    const settingsPath = getSettingsPath();
    if (!fsSync.existsSync(settingsPath)) return normalizeSettings({});
    const content = await fs.readFile(settingsPath, 'utf8');
    return normalizeSettings(JSON.parse(content));
  } catch {
    return normalizeSettings({});
  }
};

const saveSettings = async (settings) => {
  const normalized = normalizeSettings(settings);
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  await fs.writeFile(getSettingsPath(), JSON.stringify(normalized, null, 2), 'utf8');
  return normalized;
};

const validateApiKey = async (provider, apiKey) => {
  if (!provider || !apiKey) {
    return { success: false, valid: false, error: 'Provider ou clé manquant' };
  }

  if (provider === 'gemini') {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
    try {
      const resp = await axios.get(url, { timeout: 15000 });
      return { success: true, valid: !!(resp && resp.status === 200) };
    } catch (err) {
      return { success: true, valid: false, status: err.response?.status, error: err.message };
    }
  }

  if (provider === 'kimi') {
    try {
      const resp = await axios.get('https://api.together.xyz/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeout: 15000
      });
      return { success: true, valid: !!(resp && resp.status === 200) };
    } catch (err) {
      return { success: true, valid: false, status: err.response?.status, error: err.message };
    }
  }

  if (provider === 'claude') {
    try {
      const resp = await axios.get('https://api.anthropic.com/v1/models', {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        timeout: 15000
      });
      return { success: true, valid: !!(resp && resp.status === 200) };
    } catch (err) {
      return { success: true, valid: false, status: err.response?.status, error: err.message };
    }
  }

  if (provider === 'ollama') {
    try {
      const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
      const resp = await axios.get(`${ollamaUrl}/api/tags`, { timeout: 5000 });
      const models = resp.data?.models || [];
      return { success: true, valid: true, modelCount: models.length };
    } catch (err) {
      return { success: true, valid: false, error: `Ollama non disponible: ${err.message}` };
    }
  }

  return { success: false, valid: false, error: 'Provider inconnu' };
};

// ---------------------------------------------------------------------------
// Permission helpers
// ---------------------------------------------------------------------------

const canEditFiles = (permissionMode) =>
  permissionMode === 'edit' || permissionMode === 'edit_terminal';

const canUseTerminal = (permissionMode) =>
  permissionMode === 'edit_terminal';

const ensureEditPermission = async () => {
  const settings = await readSettingsSafe();
  if (!canEditFiles(settings.permissionMode)) {
    throw new Error('Le mode permissions actuel est en lecture seule.');
  }
  return settings;
};

const ensureTerminalPermission = async () => {
  const settings = await readSettingsSafe();
  if (!canUseTerminal(settings.permissionMode)) {
    throw new Error("Le mode permissions actuel n'autorise pas le terminal.");
  }
  return settings;
};

// ---------------------------------------------------------------------------
// Terminal command validation (companion to permission checks)
// ---------------------------------------------------------------------------

const TERMINAL_ALLOWED_COMMANDS = new Set([
  'npm', 'npx', 'node',
  'git',
  'python', 'py',
  'go', 'cargo', 'rustc', 'gradlew', 'mvn',
  'ollama',
  'curl',
  'ls', 'dir', 'cat', 'type', 'echo', 'mkdir',
  'n8n-search', 'n8n-import'
]);

const TERMINAL_DANGEROUS_COMMAND_PATTERNS =
  /(rm\s+-rf|del\s+\/[a-z]+|rmdir\s+\/[a-z]+|format\s+|shutdown|reboot|halt|mkfs|diskpart|git\s+reset\s+--hard|git\s+clean\s+-fd|:\(\)\{:\|:&\};:)/i;
const TERMINAL_CONTROL_OPERATOR_PATTERNS = /(&&|\|\||[|;&`<>]|\r|\n|\$\()/;
const MAX_CMD_OUTPUT = 4000;

const normalizeCommandName = (command) =>
  path.basename(String(command || '').trim()).toLowerCase().replace(/\.(cmd|exe|bat|ps1)$/i, '');

const tokenizeCommandLine = (commandLine) => {
  const text = String(commandLine || '').trim();
  const tokens = [];
  let current = '';
  let quote = null;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) { current += char; escaped = false; continue; }
    if (char === '\\' && quote) { escaped = true; continue; }
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (/\s/.test(char)) {
      if (current) { tokens.push(current); current = ''; }
      continue;
    }
    current += char;
  }
  if (quote) throw new Error('Guillemets non fermes');
  if (escaped) current += '\\';
  if (current) tokens.push(current);
  return tokens;
};

const buildCommandTokens = (command, args = []) => {
  const rawCommand = String(command || '').trim();
  const safeArgs = Array.isArray(args) ? args.map((arg) => String(arg ?? '')) : [];
  if (!rawCommand) throw new Error('Commande vide');
  if (safeArgs.length > 0) {
    if (/\s/.test(rawCommand) || TERMINAL_CONTROL_OPERATOR_PATTERNS.test(rawCommand)) {
      throw new Error('Commande invalide avec arguments separes');
    }
    return [rawCommand, ...safeArgs];
  }
  return tokenizeCommandLine(rawCommand);
};

const validateCommandTokens = (tokens) => {
  if (!Array.isArray(tokens) || tokens.length === 0) throw new Error('Commande vide');
  const normalizedCommandLine = tokens.join(' ').trim();
  if (TERMINAL_CONTROL_OPERATOR_PATTERNS.test(normalizedCommandLine)) {
    throw new Error('Operateurs shell interdits (&&, |, ;, redirections, etc.)');
  }
  if (TERMINAL_DANGEROUS_COMMAND_PATTERNS.test(normalizedCommandLine)) {
    throw new Error('Commande jugee dangereuse');
  }
  const commandName = normalizeCommandName(tokens[0]);
  if (!TERMINAL_ALLOWED_COMMANDS.has(commandName)) {
    throw new Error(`Commande non autorisee: ${tokens[0]}`);
  }
  return { commandName, normalizedCommandLine };
};

const resolveExecutableForPlatform = (commandName) => {
  if (process.platform === 'win32') {
    if (commandName === 'npm') return 'npm.cmd';
    if (commandName === 'npx') return 'npx.cmd';
    if (commandName === 'gradlew') return 'gradlew.bat';
  }
  return commandName;
};

const buildSafeSpawnRequest = (command, args = []) => {
  const tokens = buildCommandTokens(command, args);
  const { commandName, normalizedCommandLine } = validateCommandTokens(tokens);
  return {
    executable: resolveExecutableForPlatform(commandName),
    args: tokens.slice(1),
    commandName,
    normalizedCommandLine
  };
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  getSettingsPath,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_KIMI_MODEL,
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_GEMINI_PRO_MODEL,
  CANONICAL_QWEN_OLLAMA_MODEL,
  SUPPORTED_AI_PROVIDERS,
  MULTI_AGENT_ROLE_DEFAULTS,
  DEFAULT_APP_SETTINGS,
  normalizePreferredOllamaModelName,
  normalizeAIProviderName,
  getDefaultModelForAIProvider,
  normalizeMultiAgentRoles,
  normalizeSettings,
  readSettingsSafe,
  saveSettings,
  validateApiKey,
  canEditFiles,
  canUseTerminal,
  ensureEditPermission,
  ensureTerminalPermission,
  // Terminal validation
  TERMINAL_ALLOWED_COMMANDS,
  MAX_CMD_OUTPUT,
  normalizeCommandName,
  buildCommandTokens,
  validateCommandTokens,
  buildSafeSpawnRequest,
};
