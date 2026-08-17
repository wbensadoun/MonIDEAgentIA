import { useState, useCallback, useMemo, useRef } from 'react';
import useProjectStore from '../stores/projectStore';
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
  // Run courant. Sert de jeton de validité : quand la réponse revient, si le ref
  // ne pointe plus sur le runId qui l'a demandée, c'est que l'utilisateur a
  // annulé (ou relancé) — on jette le résultat au lieu de l'injecter.
  const activeRunIdRef = useRef(null);
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
    sessions,
    activeSessionId,
    switchSession,
    renameSession,
    duplicateSession,
    deleteSession,
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

    // Invalider le run AVANT tout le reste : c'est ce qui fait jeter la réponse
    // si elle arrive quand même (requête déjà partie, réponse en vol).
    const runId = activeRunIdRef.current;
    activeRunIdRef.current = null;

    // Et surtout : couper réellement l'inférence côté main process. Sans cet
    // appel, Ollama continuait à saturer le CPU jusqu'au bout malgré l'arrêt.
    if (runId && window.electronAPI?.cancelAIGeneration) {
      Promise.resolve(window.electronAPI.cancelAIGeneration(runId)).catch(() => {
        // La génération venait de finir d'elle-même : rien à annuler.
      });
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
    if (!isElectronApiAvailable) {
      showMessage("Erreur: Electron non disponible.", 10000);
      return;
    }
    // Espace projet utilisé pour le reste de cet appel. Distinct du prop
    // `currentProjectPath` (qui reste la dépendance de useCallback ci-dessous)
    // car en cas d'auto-création ci-dessous, le store ne se propagera au
    // prop qu'au prochain rendu — cette exécution doit utiliser le nouveau
    // chemin immédiatement sans réassigner le paramètre du hook (voir
    // react-hooks/exhaustive-deps).
    let effectiveProjectPath = currentProjectPath;
    if (!effectiveProjectPath) {
      // Aucun dossier ouvert : au lieu de bloquer l'envoi (comportement
      // précédent), on crée/réutilise un espace de travail scratch pour que
      // "juste discuter" ne force pas un dialogue "Ouvrir un dossier" avant
      // le premier message.
      if (!window.electronAPI?.createDefaultProject) {
        showMessage("⚠️ Veuillez d'abord ouvrir un dossier de projet (Ctrl+O ou menu File > Open Folder)", 5000);
        return;
      }
      try {
        const response = await window.electronAPI.createDefaultProject();
        if (!response?.success || !response.path) {
          showMessage(`⚠️ Impossible de créer un espace de travail: ${response?.error || 'erreur inconnue'}`, 5000);
          return;
        }
        effectiveProjectPath = response.path;
        useProjectStore.getState().setCurrentProjectPath(effectiveProjectPath);
        showMessage(`Espace de travail créé: "${effectiveProjectPath}"`, 3000);
      } catch (error) {
        showMessage(`⚠️ Erreur création espace de travail: ${error.message}`, 5000);
        return;
      }
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
      try {
          const getRouterApiKey = createProviderApiKeyResolver({
            claudeApiKey,
            kimiApiKey,
            geminiApiKey
          });
          const routed = await window.electronAPI.routeRequest(
            effectiveProjectPath,
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
              mode: decision.mode,
              agent: null,
              skills: [],
              routed: true
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

    const effectiveAIProvider = resolveProviderForExecutionMode(aiProvider, effExecutionMode);
    const localOnlyRun = isLocalOnlyProvider(effectiveAIProvider);
    const canProcessFilesForMode = shouldProcessFileModifications(effExecutionMode);

    setIsLoading(true);
    setPreviousCode(code);

    // Créer un AbortController pour cette génération
    const controller = new AbortController();
    setAbortController(controller);

    // Identifiant de run : c'est LUI qui permet au main process d'avorter la
    // bonne requête HTTP. L'AbortController ci-dessus ne franchit pas le pont
    // IPC (un AbortSignal n'est pas sérialisable) — il ne sert qu'au code local.
    // Stocké dans un ref et non un state : stopGeneration doit lire la valeur
    // courante, pas celle capturée par la closure de son dernier rendu.
    const runId = `run-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    activeRunIdRef.current = runId;

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
        currentProjectPath: effectiveProjectPath,
        activeFile,
        effectiveAIProvider,
        deepContextEnabled,
        contextMode,
        contextMaxFiles,
        projectScanPreset,
        projectScanIncludeSecrets,
        projectScanLargeFileStrategy,
        executionMode: effExecutionMode,
        showMessage
      });
      updateContextEstimate(effectiveAIProvider, promptToSend, allProjectFiles);
      const sharedAgentContextOptions = buildSharedAgentContextOptions({
        localOnlyRun,
        executionMode: effExecutionMode,
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
        currentProjectPath: effectiveProjectPath,
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
          runId,
          executionMode: effExecutionMode,
          currentProjectPath: effectiveProjectPath,
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

        // Run invalidé entre-temps (Arrêter, ou relance) : on sort AVANT tout
        // effet de bord. Sans cette garde, une réponse annulée revenait plusieurs
        // minutes plus tard s'injecter dans le fil, créer des changements en
        // attente dans le panneau de diff et écraser la conversation sauvegardée.
        if (activeRunIdRef.current !== runId) {
          return;
        }

        if (response?.aborted) {
          return;
        }

        if (response.success) {
          const fullAiText = response.text;
          // Un provider peut renvoyer success avec un texte vide. On pousse
          // quand meme le message (la bulle affiche alors "(reponse vide)"),
          // mais on previent : sans ca l'utilisateur voit un blanc et croit
          // a un plantage.
          if (!String(fullAiText || '').trim()) {
            showMessage("L'IA n'a renvoye aucun texte. Reformulez, ou essayez un autre modele.", 5000);
          }
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
      // Ne libérer le ref que si c'est TOUJOURS notre run : stopGeneration a
      // pu le remettre à null, ou une relance a pu en démarrer un autre.
      if (activeRunIdRef.current === runId) {
        activeRunIdRef.current = null;
      }
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
    setPrompt,
    routerClassifierModel,
    routerClassifierProvider,
    routerComplexityThreshold
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
    sessions,
    activeSessionId,
    switchSession,
    renameSession,
    duplicateSession,
    deleteSession,
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


