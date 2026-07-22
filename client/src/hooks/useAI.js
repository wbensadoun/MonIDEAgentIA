import { useState, useCallback, useMemo } from 'react';
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
import { applyCollectiveDepth } from '../utils/collectiveMode';
import { buildTeamPlan } from '../utils/teamSelector';
import {
  classifyPromptLayer1,
  mapRouterModeToExecutionMode,
  mapComplexityToDepth,
  matchAgentByName,
  matchSkillByName,
  createFallbackRouterDecision
} from '../utils/routerDecision';

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
  multiAgentOptions = {},
  autoRoute = false,
  setRouterDecision = () => {},
  availableAgents = [],
  routerClassifierProvider = null,
  routerClassifierModel = null,
  routerComplexityThreshold = null
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

    // ── Intelligent Router ────────────────────────────────────────────────
    // Shadow ("eff*") vars default to the manual selection so that when
    // autoRoute is false every downstream computation is byte-identical to
    // before. When autoRoute is on, a trivial prompt is handled by the local
    // Layer-1 heuristic (no LLM call); otherwise the backend `route-request`
    // handler decides mode / depth / agent / skills / model.
    let effExecutionMode = executionMode;
    let effAgent = activeAgent;
    let effSkill = activeSkill;
    let effDepth = multiAgentOptions?.depth;
    let routerModelOverride = null;

    if (autoRoute) {
      const layer1 = classifyPromptLayer1(effectivePrompt);
      if (layer1?.trivial) {
        effExecutionMode = 'agent';
        effDepth = 'fast';
        setRouterDecision({
          mode: 'single_agent',
          agent: null,
          skills: [],
          complexity: 'light',
          model: null,
          source: 'layer1'
        });
      } else {
        try {
          const getRouterApiKey = createProviderApiKeyResolver({
            claudeApiKey,
            kimiApiKey,
            geminiApiKey
          });
          const routed = await window.electronAPI.routeRequest(
            currentProjectPath,
            effectivePrompt,
            {
              provider: aiProvider,
              apiKey: getRouterApiKey(aiProvider),
              settings: {
                routerClassifierProvider,
                routerClassifierModel,
                routerComplexityThreshold,
                geminiApiKey,
                claudeApiKey,
                kimiApiKey
              }
            }
          );
          if (routed && routed.decision) {
            const { decision } = routed;
            const execution = routed.execution || {};
            effExecutionMode = execution.executionMode || mapRouterModeToExecutionMode(decision.mode);
            effDepth = execution.depth || mapComplexityToDepth(decision.complexity);
            const matchedAgent = decision.agent ? matchAgentByName(availableAgents, decision.agent) : null;
            if (matchedAgent) effAgent = matchedAgent;
            const firstSkillName = Array.isArray(decision.skills) ? decision.skills[0] : null;
            const matchedSkill = firstSkillName ? matchSkillByName(skills, firstSkillName) : null;
            if (matchedSkill) effSkill = matchedSkill;
            routerModelOverride = routed.model?.resolved || null;
            setRouterDecision({
              ...decision,
              model: routed.model || null,
              source: routed.source || 'llm'
            });
          } else {
            effExecutionMode = 'agent';
            effDepth = 'fast';
            setRouterDecision(createFallbackRouterDecision());
          }
        } catch {
          effExecutionMode = 'agent';
          effDepth = 'fast';
          setRouterDecision(createFallbackRouterDecision());
        }
      }
    }

    const isCollective = effExecutionMode === 'multi-agent';
    const effectiveAIProvider = resolveProviderForExecutionMode(aiProvider, effExecutionMode);
    const localOnlyRun = isLocalOnlyProvider(effectiveAIProvider);
    const canProcessFilesForMode = shouldProcessFileModifications(effExecutionMode, runPreset);

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
        executionMode: effExecutionMode,
        runPreset,
        showMessage
      });
      updateContextEstimate(effectiveAIProvider, promptToSend, allProjectFiles);
      const sharedAgentContextOptions = buildSharedAgentContextOptions({
        localOnlyRun,
        executionMode: effExecutionMode,
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
        activeAgent: effAgent,
        activeSkill: effSkill,
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
          multiAgentOptions: { ...multiAgentOptions, depth: effDepth },
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
        // Mode simple : un seul provider, peu importe lequel
        const modelsForRun = {
          geminiModel,
          claudeModel,
          kimiModel,
          ollamaModel
        };
        if (routerModelOverride) {
          if (effectiveAIProvider === 'gemini') modelsForRun.geminiModel = routerModelOverride;
          else if (effectiveAIProvider === 'claude') modelsForRun.claudeModel = routerModelOverride;
          else if (effectiveAIProvider === 'kimi') modelsForRun.kimiModel = routerModelOverride;
          else if (effectiveAIProvider === 'ollama') modelsForRun.ollamaModel = routerModelOverride;
        }
        const response = await callSingleAIProvider({
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
          activeAgent: effAgent,
          activeSkill: effSkill,
          sharedAgentContextOptions,
          models: modelsForRun,
          apiKeys: {
            geminiApiKey,
            claudeApiKey,
            kimiApiKey
          }
        });

        if (response.success) {
          const fullAiText = response.text;
          setAiConversationHistory(prev => [...prev, { role: 'model', text: fullAiText }]);

          // Détection de présence de blocs de modification
          const proposedChangesDetected = /\*\*FICHIER:\s*|FILE:\s*|<<<<\s*SEARCH/gi.test(fullAiText);

          if (proposedChangesDetected) {
            // TOUJOURS parser et afficher les propositions (même en Plan/Ask)
            await processAIFileModifications(fullAiText, {
              prompt: promptToSend,
              provider: effectiveAIProvider,
              model: response.model || geminiModel || kimiModel || claudeModel || ollamaModel,
              summary: 'Reponse IA'
            });

            // Notification interactive si mode lecture seule
            if (!canProcessFilesForMode) {
              showMessage(
                "💡 Des modifications ont été proposées ! Passez en mode 'Agent' pour passer en revue le diff et appliquer les changements.",
                8000
              );
            }
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
    multiAgentRoles,
    localAISettings,
    multiAgentOptions,
    autoRoute,
    setRouterDecision,
    availableAgents,
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

  // Aperçu pré-run du plan d'équipe (calculé seulement en mode Collective)
  const teamPlanPreview = useMemo(() => {
    if (executionMode !== 'multi-agent') return null;
    try {
      const normalizedMultiAgentRoles = normalizeMultiAgentRoles(multiAgentRoles);
      return applyCollectiveDepth(
        buildTeamPlan({
          userRequest: prompt,
          projectFiles: null,
          rolesConfig: normalizedMultiAgentRoles,
          localAISettings,
          hardwareProfile: null,
          preferredFormationKey: multiAgentOptions?.formationKey,
          disabledAgentKeys: multiAgentOptions?.disabledAgentKeys
        }),
        multiAgentOptions?.depth
      );
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [executionMode, prompt, multiAgentRoles, localAISettings, multiAgentOptions]);

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
    setPendingMessage,
    teamPlanPreview
  };
};

export default useAI;


