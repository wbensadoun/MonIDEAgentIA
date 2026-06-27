import { DEFAULT_OLLAMA_MODEL } from './ollamaModels';
import {
  getProviderLabel,
  normalizeAIProvider
} from './multiAgentConfig';
import { ROLE_PROVIDER_METHODS } from './multiAIState';

export const buildSharedAgentContextOptions = ({
  localOnlyRun,
  executionMode,
  runPreset,
  deepContextEnabled
}) => ({
  localOnly: localOnlyRun,
  disallowProviderFallback: true,
  executionMode,
  runPreset,
  includeVisualWorkflows: true,
  includeN8nCatalog: true,
  maxVisualWorkflowIndexItems: deepContextEnabled ? 40 : 20,
  maxVisualWorkflowDetailedItems: deepContextEnabled ? 6 : 2,
  maxVisualWorkflowContentChars: deepContextEnabled ? 14000 : 7000,
  maxN8nCatalogItems: deepContextEnabled ? 200 : 80
});

export const buildSkillsMetadata = (skills) => (
  Array.isArray(skills)
    ? skills
      .filter((skill) => skill && skill.name && skill.hasSkillMd !== false)
      .map((skill) => ({ name: skill.name, scope: skill.scope }))
    : []
);

export const createProviderApiKeyResolver = ({
  claudeApiKey,
  kimiApiKey,
  geminiApiKey
}) => (provider) => {
  if (provider === 'claude') return claudeApiKey;
  if (provider === 'kimi') return kimiApiKey;
  if (provider === 'gemini') return geminiApiKey;
  return undefined;
};

export const runMultiAgentRole = async ({
  roleKey,
  promptText,
  codeContext,
  projectFiles,
  thinking = false,
  maxTokens = 4096,
  normalizedMultiAgentRoles,
  getProviderApiKey,
  currentProjectPath,
  activeAgent,
  activeSkill,
  skills,
  ollamaModel,
  deepContextEnabled,
  sharedAgentContextOptions,
  electronAPI = window.electronAPI
}) => {
  const roleConfig = normalizedMultiAgentRoles[roleKey] || {};
  const provider = normalizeAIProvider(roleConfig.provider);
  const methodName = ROLE_PROVIDER_METHODS[provider] || ROLE_PROVIDER_METHODS.gemini;
  const providerOptions = {
    model: roleConfig.model,
    thinkingMode: thinking,
    apiKey: getProviderApiKey(provider),
    projectPath: currentProjectPath,
    agent: activeAgent,
    skill: activeSkill,
    includeGlobalSkills: true,
    skillsContent: buildSkillsMetadata(skills),
    maxTokens,
    ...sharedAgentContextOptions
  };

  if (provider === 'ollama' && !providerOptions.model) {
    providerOptions.model = ollamaModel || DEFAULT_OLLAMA_MODEL;
  }

  if (provider === 'kimi') {
    Object.assign(providerOptions, {
      fastMode: true,
      reactMode: false,
      streamResponse: false,
      maxHistoryMessages: 8,
      contextFilesLimit: deepContextEnabled ? 16 : 8,
      contextCharsPerFile: 1200
    });
  }

  const method = electronAPI?.[methodName];
  if (typeof method !== 'function') {
    return {
      success: false,
      error: `Provider IA indisponible pour ${getProviderLabel(provider)}`
    };
  }

  const response = await method(
    [{ role: 'user', text: promptText }],
    codeContext,
    projectFiles,
    providerOptions
  );

  return {
    ...response,
    provider,
    model: roleConfig.model
  };
};

export const runWithConcurrency = async (items, limit, worker) => {
  const safeItems = Array.isArray(items) ? items : [];
  const safeLimit = Math.max(1, Math.floor(Number(limit) || 1));
  const results = [];
  let nextIndex = 0;

  const runWorker = async () => {
    while (nextIndex < safeItems.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      // eslint-disable-next-line no-await-in-loop
      results[currentIndex] = await worker(safeItems[currentIndex], currentIndex);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(safeLimit, safeItems.length) }, () => runWorker())
  );
  return results.filter(Boolean);
};

export const buildCompactProjectContext = (projectFiles) => {
  if (!projectFiles?.files) return 'Aucun contexte projet disponible.';
  const entries = Object.entries(projectFiles.files).slice(0, 60);
  let context = `Projet (${Object.keys(projectFiles.files).length} fichiers):\n`;
  for (const [filePath, entry] of entries) {
    const snippet = String(entry?.content || '').slice(0, 250).replace(/\n/g, ' ');
    context += `- ${filePath}${snippet ? `: ${snippet}` : ''}\n`;
  }
  return context.slice(0, 8000);
};
