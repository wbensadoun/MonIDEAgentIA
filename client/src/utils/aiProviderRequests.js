import { DEFAULT_OLLAMA_MODEL } from './ollamaModels';
import {
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_KIMI_MODEL
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
  currentProjectPath,
  activeAgent,
  activeSkill,
  sharedAgentContextOptions,
  models,
  apiKeys,
  electronAPI = window.electronAPI
}) => {
  if (effectiveAIProvider === 'kimi') {
    const images = collectInlineImages(updatedHistory);
    const kimiOptions = {
      model: models.kimiModel || DEFAULT_KIMI_MODEL,
      thinkingMode,
      images,
      apiKey: apiKeys.kimiApiKey,
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
      images,
      apiKey: apiKeys.claudeApiKey,
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

  const geminiOptions = {
    model: models.geminiModel || DEFAULT_GEMINI_MODEL,
    thinkingMode,
    apiKey: apiKeys.geminiApiKey,
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
