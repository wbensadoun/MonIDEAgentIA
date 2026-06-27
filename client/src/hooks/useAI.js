import { useState, useCallback } from 'react';
import {
  generateCaptainFinalPrompt,
  generateDynamicTeamAgentPrompt
} from './aiPrompts';
import useAISettingsSync from './useAISettingsSync';
import useAIPendingChanges from './useAIPendingChanges';
import useAIContextEstimate from './useAIContextEstimate';
import useAIConversationSession from './useAIConversationSession';
import {
  useAIPendingMessageQueue,
  useQueuedAIMessageEffect
} from './useAIPendingMessageQueue';
import { normalizeMultiAgentRoles } from '../utils/multiAgentConfig';
import {
  appendMultiAIEvent,
  createEmptyMultiAIState,
  markActiveMultiStepsErrored
} from '../utils/multiAIState';
import { prepareAIProjectContext } from '../utils/aiProjectContext';
import { callSingleAIProvider } from '../utils/aiProviderRequests';
import {
  isLocalOnlyProvider,
  resolveProviderForExecutionMode,
  shouldProcessFileModifications
} from '../utils/agentModes';
import {
  buildSharedAgentContextOptions,
  createProviderApiKeyResolver,
  runMultiAgentRole as callMultiAgentRole
} from '../utils/aiAgentRuntime';
import { runDynamicMultiAgentFlow } from '../utils/dynamicTeamExecution';
import { runOllamaMultiCompletionFlow } from '../utils/ollamaMultiFlow';

export const useAI = (
  currentProjectPath,
  code,
  setCode,
  activeFile,
  isElectronApiAvailable,
  showMessage,
  setActiveFile,
  loadProjectItems,
  aiProvider = 'gemini',
  thinkingMode = false,
  deepContextEnabled = false,
  activeAgent = null,
  activeSkill = null,
  skills = [],
  permissionMode = 'edit_terminal',
  qualityGateConfig = {},
  contextMode = 'auto',
  contextMaxFiles = 120,
  executionMode = 'agent',
  runPreset = 'default',
  multiAgentOptions = {}
) => {
  const [isLoading, setIsLoading] = useState(false);
  const {
    apiKeys,
    projectScanPreset,
    projectScanIncludeSecrets,
    projectScanLargeFileStrategy
  } = useAISettingsSync(isElectronApiAvailable);
  const {
    gemini: geminiApiKey,
    kimi: kimiApiKey,
    claude: claudeApiKey,
    geminiModel,
    claudeModel,
    kimiModel,
    ollamaModel,
    ollamaModelArchitect,
    ollamaModelCoder,
    ollamaModelTester,
    multiAgentRoles,
    localAI: localAISettings
  } = apiKeys;
  const [multiAIState, setMultiAIState] = useState(createEmptyMultiAIState);
  const [abortController, setAbortController] = useState(null);
  const {
    pendingImages,
    setPendingImages,
    pendingMessage,
    setPendingMessage,
    addImageMessage,
    queuePendingMessage
  } = useAIPendingMessageQueue();
  const {
    contextEstimate,
    updateContextEstimate,
    resetContextEstimate
  } = useAIContextEstimate(aiProvider);
  const {
    previousCode,
    setPreviousCode,
    isDiffMode,
    setIsDiffMode,
    pendingFileChanges,
    activePendingChangeId,
    pendingSnapshotId,
    activeAgentRunId,
    agentRunRefreshKey,
    processAIFileModifications,
    applyPendingChangeByIndex,
    rejectPendingChangeByIndex,
    applyAllPendingChanges,
    rejectAllPendingChanges,
    updatePendingChangeContent,
    handleUndo: handlePendingUndo,
    handleAcceptDiff: handlePendingAcceptDiff,
    selectPendingChangeByIndex: selectPendingChangeFromQueue,
    resetPendingChangesState
  } = useAIPendingChanges({
    currentProjectPath,
    activeFile,
    setCode,
    setActiveFile,
    isElectronApiAvailable,
    showMessage,
    loadProjectItems,
    permissionMode,
    qualityGateConfig
  });


  const resetMultiAIState = useCallback(() => {
    setMultiAIState(createEmptyMultiAIState());
  }, []);

  const {
    prompt,
    setPrompt,
    aiConversationHistory,
    setAiConversationHistory,
    conversations,
    activeConversationFile,
    isConversationLoading,
    autoSaveConversation,
    saveConversation,
    startNewConversation,
    loadConversationByFile
  } = useAIConversationSession({
    currentProjectPath,
    isElectronApiAvailable,
    showMessage,
    aiProvider,
    abortController,
    setAbortController,
    resetPendingChangesState,
    resetContextEstimate,
    resetMultiAIState
  });

  const stopGeneration = useCallback(() => {
    if (abortController) {
      abortController.abort();
      setAbortController(null);
    }
    setIsLoading(false);
    resetMultiAIState();
    showMessage('Generation arretee', 2000);
  }, [abortController, resetMultiAIState, showMessage]);

  const generateAIResponse = useCallback(async (overridePrompt) => {
    const effectivePrompt = overridePrompt !== undefined ? overridePrompt : prompt;
    if (!effectivePrompt.trim()) {
      showMessage("Veuillez entrer une requête.");
      return;
    }
    // If already loading, queue the message
    if (isLoading) {
      queuePendingMessage(effectivePrompt, pendingImages);
      setPrompt('');
      showMessage("⏳ Message mis en attente...", 3000);
      return;
    }
    if (!currentProjectPath) {
      showMessage("⚠️ Veuillez d'abord ouvrir un dossier de projet (Ctrl+O ou menu File > Open Folder)", 5000);
      return;
    }
    if (!isElectronApiAvailable) {
      showMessage("Erreur: Electron non disponible.", 10000);
      return;
    }

    const effectiveAIProvider = resolveProviderForExecutionMode(aiProvider, executionMode);
    const localOnlyRun = isLocalOnlyProvider(effectiveAIProvider);
    const canProcessFilesForMode = shouldProcessFileModifications(executionMode, runPreset);

    setIsLoading(true);
    setPreviousCode(code);

    // Créer un AbortController pour cette génération
    const controller = new AbortController();
    setAbortController(controller);

    const newMessage = { role: 'user', text: effectivePrompt };
    if (pendingImages.length > 0) {
      newMessage.images = pendingImages;
      setPendingImages([]);
    }

    const updatedHistory = [...aiConversationHistory, newMessage];
    setAiConversationHistory(updatedHistory);
    if (overridePrompt === undefined) setPrompt('');

    try {
      const {
        promptToSend,
        allProjectFiles
      } = await prepareAIProjectContext({
        effectivePrompt,
        currentProjectPath,
        activeFile,
        effectiveAIProvider,
        deepContextEnabled,
        contextMode,
        contextMaxFiles,
        projectScanPreset,
        projectScanIncludeSecrets,
        projectScanLargeFileStrategy,
        executionMode,
        runPreset,
        showMessage
      });
      updateContextEstimate(effectiveAIProvider, promptToSend, allProjectFiles);
      const sharedAgentContextOptions = buildSharedAgentContextOptions({
        localOnlyRun,
        executionMode,
        runPreset,
        deepContextEnabled
      });

      const normalizedMultiAgentRoles = normalizeMultiAgentRoles(multiAgentRoles);
      const getProviderApiKey = createProviderApiKeyResolver({
        claudeApiKey,
        kimiApiKey,
        geminiApiKey
      });
      const runMultiAgentRole = (options = {}) => callMultiAgentRole({
        codeContext: code,
        projectFiles: allProjectFiles,
        normalizedMultiAgentRoles,
        getProviderApiKey,
        currentProjectPath,
        activeAgent,
        activeSkill,
        skills,
        ollamaModel,
        deepContextEnabled,
        sharedAgentContextOptions,
        ...options
      });

      // Mode Multi-IA: selectionneur + equipe dynamique adaptee a la demande.
      if (effectiveAIProvider === 'multi') {
        await runDynamicMultiAgentFlow({
          promptToSend,
          allProjectFiles,
          normalizedMultiAgentRoles,
          localAISettings,
          multiAgentOptions,
          setMultiAIState,
          setAiConversationHistory,
          showMessage,
          runMultiAgentRole,
          code,
          generateAgentPrompt: generateDynamicTeamAgentPrompt,
          generateCaptainPrompt: generateCaptainFinalPrompt,
          canProcessFilesForMode,
          processAIFileModifications,
          effectiveAIProvider,
          autoSaveConversation,
          updatedHistory
        });
      } else {
        // Mode simple (Gemini ou Kimi seul)
        let response;
        if (effectiveAIProvider === 'ollama-multi') {
          response = await runOllamaMultiCompletionFlow({
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
            setMultiAIState
          });
        } else {
          response = await callSingleAIProvider({
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
            models: {
              geminiModel,
              claudeModel,
              kimiModel,
              ollamaModel
            },
            apiKeys: {
              geminiApiKey,
              claudeApiKey,
              kimiApiKey
            }
          });
        }

        if (response.success) {
          const fullAiText = response.text;
          setAiConversationHistory(prev => [...prev, { role: 'model', text: fullAiText }]);
          if (canProcessFilesForMode) {
            await processAIFileModifications(fullAiText, {
              prompt: promptToSend,
              provider: effectiveAIProvider,
              model: response.model || geminiModel || kimiModel || claudeModel || ollamaModel,
              summary: 'Reponse IA'
            });
          }
          await autoSaveConversation(updatedHistory.concat([{ role: 'model', text: fullAiText }]));
        } else {
          const errorText = response?.error || 'Erreur inconnue';
          const hint = response?.retryable ? ' (temporaire, reessayez)' : '';
          showMessage(`Erreur IA: ${errorText}${hint}`, response?.retryable ? 6500 : 5000);
        }
      }
    } catch (error) {
      // Vérifier si l'erreur est due à une annulation
      if (error.name === 'AbortError') {
        showMessage("Génération arrêtée par l'utilisateur", 2000);
      } else {
        showMessage(`Erreur IA: ${error.message}`, 5000);
      }
      setMultiAIState(prev => ({
        ...prev,
        isActive: false,
        currentPhase: 'Erreur equipe',
        finishedAt: prev?.finishedAt || Date.now(),
        steps: markActiveMultiStepsErrored(prev.steps),
        events: appendMultiAIEvent(prev.events, {
          label: prev?.currentPhase || 'Equipe IA',
          status: 'error',
          detail: error.message
        }),
        error: error.message
      }));
    } finally {
      setIsLoading(false);
      setAbortController(null);
    }
  }, [
    prompt,
    currentProjectPath,
    code,
    aiConversationHistory,
    isElectronApiAvailable,
    showMessage,
    aiProvider,
    executionMode,
    runPreset,
    thinkingMode,
    deepContextEnabled,
    contextMode,
    contextMaxFiles,
    projectScanPreset,
    projectScanIncludeSecrets,
    projectScanLargeFileStrategy,
    geminiApiKey,
    kimiApiKey,
    claudeApiKey,
    geminiModel,
    claudeModel,
    kimiModel,
    ollamaModel,
    ollamaModelArchitect,
    ollamaModelCoder,
    ollamaModelTester,
    multiAgentRoles,
    localAISettings,
    multiAgentOptions,
    activeFile,
    activeAgent,
    activeSkill,
    skills,
    processAIFileModifications,
    autoSaveConversation,
    pendingImages,
    isLoading,
    queuePendingMessage,
    updateContextEstimate,
    setPreviousCode,
    setAiConversationHistory,
    setPendingImages,
    setPrompt
  ]);

  useQueuedAIMessageEffect({
    isLoading,
    pendingMessage,
    setPendingMessage,
    setPrompt,
    setPendingImages,
    generateAIResponse
  });

  const handleUndo = useCallback(async () => {
    const result = await handlePendingUndo();

    if (result === 'pending-rejected') {
      setAiConversationHistory(prev => [...prev, { role: 'system', text: 'Modification IA rejetee.' }]);
    } else if (result === 'rollback-applied') {
      setAiConversationHistory(prev => [...prev, { role: 'system', text: 'Rollback patch applique.' }]);
    } else if (result === 'single-undo') {
      setAiConversationHistory(prev => [...prev, { role: 'system', text: 'Modification IA annulee.' }]);
    }
  }, [handlePendingUndo, setAiConversationHistory]);

  const handleAcceptDiff = useCallback(async () => {
    const result = await handlePendingAcceptDiff();

    if (result === 'pending-applied') {
      setAiConversationHistory(prev => [...prev, { role: 'system', text: 'Modification IA acceptee.' }]);
    } else if (result === 'accepted') {
      setAiConversationHistory(prev => [...prev, { role: 'system', text: 'Modifications IA acceptees.' }]);
    }
  }, [handlePendingAcceptDiff, setAiConversationHistory]);

  const selectPendingChangeByIndex = useCallback((index) => {
    return selectPendingChangeFromQueue(index);
  }, [selectPendingChangeFromQueue]);

  return {
    prompt,
    setPrompt,
    isLoading,
    aiConversationHistory,
    previousCode,
    generateAIResponse,
    addImageMessage,
    saveConversation,
    handleUndo,
    isDiffMode,
    setIsDiffMode,
    handleAcceptDiff,
    pendingFileChanges,
    activePendingChangeId,
    activeAgentRunId,
    agentRunRefreshKey,
    selectPendingChangeByIndex,
    applyPendingChangeByIndex,
    rejectPendingChangeByIndex,
    applyAllPendingChanges,
    rejectAllPendingChanges,
    updatePendingChangeContent,
    pendingSnapshotId,
    contextEstimate,
    multiAIState,
    conversations,
    activeConversationFile,
    isConversationLoading,
    startNewConversation,
    loadConversationByFile,
    stopGeneration,
    pendingImages,
    setPendingImages,
    pendingMessage,
    setPendingMessage
  };
};

export default useAI;


