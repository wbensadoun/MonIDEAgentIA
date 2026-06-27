import { DEFAULT_OLLAMA_MODEL } from './ollamaModels';
import {
  appendMultiAIEvent,
  buildOllamaMultiSteps,
  createEmptyMultiAIState,
  markActiveMultiStepsErrored,
  markAllMultiStepsCompleted,
  updateMultiStepsFromEvent
} from './multiAIState';
import { buildSkillsMetadata } from './aiAgentRuntime';

export const runOllamaMultiCompletionFlow = async ({
  ollamaModel,
  ollamaModelArchitect,
  ollamaModelCoder,
  ollamaModelTester,
  currentProjectPath,
  activeAgent,
  activeSkill,
  skills,
  sharedAgentContextOptions,
  aiConversationHistory,
  newMessage,
  promptToSend,
  code,
  allProjectFiles,
  setMultiAIState,
  electronAPI = window.electronAPI
}) => {
  let offOllamaMultiStepListener = null;
  const requestedModels = {
    architect: ollamaModelArchitect || ollamaModel || DEFAULT_OLLAMA_MODEL,
    coder: ollamaModelCoder || ollamaModel || DEFAULT_OLLAMA_MODEL,
    tester: ollamaModelTester || ollamaModel || DEFAULT_OLLAMA_MODEL
  };

  const multiSteps = buildOllamaMultiSteps(requestedModels, { architect: 'active' });
  setMultiAIState({
    ...createEmptyMultiAIState(),
    isActive: true,
    mode: 'ollama-multi',
    runLabel: 'Swarm Ollama',
    currentPhase: '🏗️ Architecte',
    startedAt: Date.now(),
    models: requestedModels,
    requestedModels,
    steps: multiSteps,
    events: appendMultiAIEvent([], {
      label: '🏗️ Architecte',
      status: 'active',
      detail: 'Le swarm demarre par le plan technique.',
      roleKey: 'architect'
    }),
    error: null
  });

  try {
    if (electronAPI?.onOllamaMultiStep) {
      offOllamaMultiStepListener = electronAPI.onOllamaMultiStep((data) => {
        const safeData = data && typeof data === 'object' ? data : {};
        setMultiAIState((prev) => ({
          ...prev,
          currentPhase: safeData.status === 'active'
            ? (safeData.label || prev.currentPhase)
            : prev.currentPhase,
          steps: updateMultiStepsFromEvent(prev.steps, {
            label: safeData.label,
            status: safeData.status,
            detail: safeData.text,
            models: prev.models
          }),
          events: appendMultiAIEvent(prev.events, {
            label: safeData.label,
            status: safeData.status,
            detail: safeData.text
          })
        }));
      });
    }

    const ollamaMultiOptions = {
      model: ollamaModel || DEFAULT_OLLAMA_MODEL,
      modelArchitect: ollamaModelArchitect || ollamaModel || DEFAULT_OLLAMA_MODEL,
      modelCoder: ollamaModelCoder || ollamaModel || DEFAULT_OLLAMA_MODEL,
      modelTester: ollamaModelTester || ollamaModel || DEFAULT_OLLAMA_MODEL,
      projectPath: currentProjectPath,
      agent: activeAgent,
      skill: activeSkill,
      skillsContent: buildSkillsMetadata(skills),
      ...sharedAgentContextOptions
    };

    const response = await electronAPI.getOllamaMultiCompletion(
      [...aiConversationHistory, Object.assign({}, newMessage, { text: promptToSend })],
      code,
      allProjectFiles,
      ollamaMultiOptions
    );

    if (response?.success) {
      const resolvedModels = response.models || requestedModels;
      setMultiAIState((prev) => ({
        ...prev,
        isActive: false,
        currentPhase: 'Swarm termine',
        finishedAt: Date.now(),
        models: resolvedModels,
        requestedModels: response.requestedModels || prev.requestedModels,
        steps: markAllMultiStepsCompleted(prev.steps, resolvedModels),
        events: appendMultiAIEvent(prev.events, {
          label: '✅ Swarm Ollama',
          status: 'completed',
          detail: 'Architecture, patch et relecture termines.'
        }),
        error: null
      }));
    } else {
      setMultiAIState((prev) => ({
        ...prev,
        isActive: false,
        currentPhase: 'Erreur swarm',
        finishedAt: Date.now(),
        steps: markActiveMultiStepsErrored(prev.steps),
        events: appendMultiAIEvent(prev.events, {
          label: '❌ Swarm Ollama',
          status: 'error',
          detail: response?.error || 'Erreur inconnue'
        }),
        error: response?.error || 'Erreur inconnue'
      }));
    }

    return response;
  } finally {
    if (typeof offOllamaMultiStepListener === 'function') {
      offOllamaMultiStepListener();
    }
  }
};
