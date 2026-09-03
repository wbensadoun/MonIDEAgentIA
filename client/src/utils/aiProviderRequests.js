import { DEFAULT_OLLAMA_MODEL } from './ollamaModels';
import {
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_KIMI_MODEL,
  DEFAULT_NEVEN_MODEL
} from './remoteModels';

const collectInlineImages = (history) => (
  history
    .filter((message) => Array.isArray(message.images))
    .flatMap((message) => (
      message.images.map((image) => ({
        dataUrl: image.dataUrl,
        mimeType: image.mimeType
      }))
    ))
);

export const callSingleAIProvider = async ({
  effectiveAIProvider,
  updatedHistory,
  aiConversationHistory,
  newMessage,
  promptToSend,
  code,
  allProjectFiles,
  thinkingMode,
  deepContextEnabled,
  // Jeton d'annulation : le main process s'en sert pour retrouver et avorter la
  // requête HTTP de CETTE génération (cf. electron/ipc/aiHandlers.js, activeRuns).
  // Doit être transmis à tous les providers, sinon leur Arrêter reste décoratif.
  runId = null,
  // Mode d'execution transmis au backend pour y etre APPLIQUE (cf.
  // executeCommandForAI / runContext). Tant qu'il restait cote renderer, Ask et
  // Plan n'etaient qu'une phrase de prompt qu'un petit modele local ignore.
  executionMode = 'agent',
  currentProjectPath,
  activeAgent,
  activeSkill,
  sharedAgentContextOptions,
  models,
  electronAPI = window.electronAPI
}) => {
  if (effectiveAIProvider === 'kimi') {
    const images = collectInlineImages(updatedHistory);
    const kimiOptions = {
      model: models.kimiModel || DEFAULT_KIMI_MODEL,
      thinkingMode,
      runId,
      executionMode,
      images,
      projectPath: currentProjectPath,
      agent: activeAgent,
      skill: activeSkill,
      fastMode: true,
      reactMode: false,
      streamResponse: true,
      includeGlobalSkills: false,
      maxTokens: 2048,
      maxHistoryMessages: 8,
      contextFilesLimit: deepContextEnabled ? 16 : 8,
      contextCharsPerFile: 1200,
      ...sharedAgentContextOptions
    };
    const kimiHistory = [...aiConversationHistory, Object.assign({}, newMessage, { text: promptToSend })];

    return electronAPI.getKimiCompletion(
      kimiHistory.slice(-8),
      code,
      allProjectFiles,
      kimiOptions
    );
  }

  if (effectiveAIProvider === 'claude') {
    const images = collectInlineImages(updatedHistory);
    const claudeOptions = {
      model: models.claudeModel || DEFAULT_CLAUDE_MODEL,
      thinkingMode,
      runId,
      executionMode,
      images,
      projectPath: currentProjectPath,
      agent: activeAgent,
      skill: activeSkill,
      ...sharedAgentContextOptions
    };

    return electronAPI.getClaudeCompletion(
      [...aiConversationHistory, Object.assign({}, newMessage, { text: promptToSend })],
      code,
      allProjectFiles,
      claudeOptions
    );
  }

  if (effectiveAIProvider === 'ollama') {
    const ollamaOptions = {
      model: models.ollamaModel || DEFAULT_OLLAMA_MODEL,
      // Seule branche qui oubliait thinkingMode : computeOllamaThink() le
      // recevait donc toujours `undefined` et le toggle Settings n'avait
      // aucun effet sur Ollama, dans les deux sens.
      thinkingMode,
      runId,
      executionMode,
      projectPath: currentProjectPath,
      agent: activeAgent,
      skill: activeSkill,
      ...sharedAgentContextOptions
    };

    return electronAPI.getOllamaCompletion(
      [...aiConversationHistory, Object.assign({}, newMessage, { text: promptToSend })],
      code,
      allProjectFiles,
      ollamaOptions
    );
  }

  if (effectiveAIProvider === 'neven') {
    const nevenOptions = {
      model: DEFAULT_NEVEN_MODEL,
      thinkingMode,
      runId,
      executionMode,
      projectPath: currentProjectPath,
      agent: activeAgent,
      skill: activeSkill,
      ...sharedAgentContextOptions
    };

    return electronAPI.getNevenCompletion(
      [...aiConversationHistory, Object.assign({}, newMessage, { text: promptToSend })],
      code,
      allProjectFiles,
      nevenOptions
    );
  }

  const geminiOptions = {
    model: models.geminiModel || DEFAULT_GEMINI_MODEL,
    thinkingMode,
    runId,
    executionMode,
    projectPath: currentProjectPath,
    agent: activeAgent,
    skill: activeSkill,
    ...sharedAgentContextOptions
  };

  return electronAPI.getGeminiCompletion(
    [...aiConversationHistory, Object.assign({}, newMessage, { text: promptToSend })],
    code,
    allProjectFiles,
    geminiOptions
  );
};
