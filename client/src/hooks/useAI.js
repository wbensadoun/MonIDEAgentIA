import { useState, useCallback, useEffect } from 'react';
import {
  generateCaptainFinalPrompt,
  generateDynamicTeamAgentPrompt
} from './aiPrompts';
import useAISettingsSync from './useAISettingsSync';
import useAIPendingChanges from './useAIPendingChanges';
import { DEFAULT_OLLAMA_MODEL } from '../utils/ollamaModels';
import { DEFAULT_CLAUDE_MODEL, DEFAULT_GEMINI_MODEL, DEFAULT_KIMI_MODEL } from '../utils/remoteModels';
import {
  getProviderLabel,
  normalizeAIProvider,
  normalizeMultiAgentRoles
} from '../utils/multiAgentConfig';
import { buildTeamPlan, formatTeamPlanForPrompt } from '../utils/teamSelector';

const MAX_MULTI_AI_EVENTS = 16;

const normalizeMultiStepStatus = (status) => {
  if (status === 'done' || status === 'completed') return 'completed';
  if (status === 'active' || status === 'error') return status;
  return 'pending';
};

const truncateMultiDetail = (value, fallback = '') => {
  const safeValue = String(value || fallback || '').replace(/\s+/g, ' ').trim();
  if (!safeValue) return '';
  return safeValue.length > 180 ? `${safeValue.slice(0, 177)}...` : safeValue;
};

const createEmptyMultiAIState = () => ({
  isActive: false,
  mode: null,
  runLabel: null,
  currentPhase: null,
  architectPlan: null,
  approvedPlan: null,
  startedAt: null,
  finishedAt: null,
  models: null,
  requestedModels: null,
  steps: [],
  events: [],
  error: null
});

const resolveMultiRoleKeyFromLabel = (label) => {
  const safeLabel = String(label || '').toLowerCase();
  if (safeLabel.includes('chef')) return 'chef';
  if (safeLabel.includes('frontend')) return 'frontend';
  if (safeLabel.includes('backend')) return 'backend';
  if (safeLabel.includes('architecte')) return 'architect';
  if (safeLabel.includes('codeur')) return 'coder';
  if (safeLabel.includes('relecteur') || safeLabel.includes('reviewer')) return 'tester';
  if (safeLabel.includes('scrum')) return 'scrum';
  return null;
};

const appendMultiAIEvent = (events, nextEvent) => {
  const safeEvents = Array.isArray(events) ? events : [];
  const label = String(nextEvent?.label || 'Equipe IA').trim();
  const status = normalizeMultiStepStatus(nextEvent?.status);
  const detail = truncateMultiDetail(nextEvent?.detail, nextEvent?.text);
  const roleKey = nextEvent?.roleKey || resolveMultiRoleKeyFromLabel(label);
  const lastEvent = safeEvents[safeEvents.length - 1];

  if (
    lastEvent &&
    lastEvent.label === label &&
    lastEvent.status === status &&
    lastEvent.detail === detail
  ) {
    return safeEvents;
  }

  const nextEvents = [
    ...safeEvents.slice(-(MAX_MULTI_AI_EVENTS - 1)),
    {
      id: `${Date.now()}-${safeEvents.length}`,
      at: Date.now(),
      label,
      status,
      detail,
      roleKey
    }
  ];

  return nextEvents;
};

const buildDynamicTeamSteps = (teamPlan, statusByKey = {}) => (
  (Array.isArray(teamPlan?.selectedAgents) ? teamPlan.selectedAgents : []).map((agent) => ({
    key: agent.key,
    label: agent.title,
    provider: agent.providerLabel || getProviderLabel(agent.provider),
    model: agent.model,
    detail: agent.reason || agent.focus,
    stage: agent.stage,
    execution: agent.execution,
    status: normalizeMultiStepStatus(statusByKey[agent.key])
  }))
);

const buildOllamaMultiSteps = (models = {}, statusByKey = {}) => {
  const baseSteps = [
    {
      key: 'architect',
      label: '🏗️ Architecte',
      provider: 'Ollama',
      model: models.architect || null,
      detail: 'Pose le plan technique et choisit la strategie.'
    },
    {
      key: 'coder',
      label: '💻 Codeur',
      provider: 'Ollama',
      model: models.coder || null,
      detail: 'Produit le patch, les fichiers et les workflows.'
    },
    {
      key: 'tester',
      label: '🔍 Relecteur',
      provider: 'Ollama',
      model: models.tester || null,
      detail: 'Verifie le patch, lance les checks et boucle si besoin.'
    }
  ];

  return baseSteps.map((step) => ({
    ...step,
    status: normalizeMultiStepStatus(statusByKey[step.key])
  }));
};

const updateMultiStepsFromEvent = (steps, { label, status, detail, models } = {}) => {
  const safeSteps = Array.isArray(steps) ? steps : [];
  const roleKey = resolveMultiRoleKeyFromLabel(label);
  const normalizedStatus = normalizeMultiStepStatus(status);
  const shortDetail = truncateMultiDetail(detail);

  return safeSteps.map((step) => {
    if (!step || typeof step !== 'object') return step;

    const stepModel = models?.[step.key] || step.model || null;
    const matchesRole = roleKey && step.key === roleKey;
    const matchesLabel = label && (
      step.label === label ||
      String(label).startsWith(`${step.label} `)
    );

    if (!matchesRole && !matchesLabel) {
      return stepModel && stepModel !== step.model ? { ...step, model: stepModel } : step;
    }

    return {
      ...step,
      status: normalizedStatus,
      detail: shortDetail || step.detail,
      model: stepModel
    };
  });
};

const markAllMultiStepsCompleted = (steps, models = null) => (
  (Array.isArray(steps) ? steps : []).map((step) => {
    if (!step || typeof step !== 'object') return step;
    return {
      ...step,
      status: step.status === 'error' ? 'error' : 'completed',
      model: models?.[step.key] || step.model || null
    };
  })
);

const markActiveMultiStepsErrored = (steps) => (
  (Array.isArray(steps) ? steps : []).map((step) => {
    if (!step || typeof step !== 'object') return step;
    if (step.status !== 'active') return step;
    return { ...step, status: 'error' };
  })
);

const ROLE_PROVIDER_METHODS = {
  gemini: 'getGeminiCompletion',
  claude: 'getClaudeCompletion',
  kimi: 'getKimiCompletion',
  ollama: 'getOllamaCompletion'
};

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
  contextMaxFiles = 120
) => {
  const [prompt, setPrompt] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [aiConversationHistory, setAiConversationHistory] = useState([]);
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
  const [conversations, setConversations] = useState([]);
  const [activeConversationFile, setActiveConversationFile] = useState(null);
  const [isConversationLoading, setIsConversationLoading] = useState(false);
  const [abortController, setAbortController] = useState(null);
  const [pendingImages, setPendingImages] = useState([]);
  const [pendingMessage, setPendingMessage] = useState(null); // { text, images }
  const [contextEstimate, setContextEstimate] = useState({
    provider: aiProvider,
    promptChars: 0,
    contextChars: 0,
    estimatedTokens: 0,
    estimatedCostUsd: 0
  });
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

  const stopGeneration = useCallback(() => {
    if (abortController) {
      abortController.abort();
      setAbortController(null);
    }
    setIsLoading(false);
    resetMultiAIState();
    showMessage('Generation arretee', 2000);
  }, [abortController, resetMultiAIState, showMessage]);

  const refreshConversations = useCallback(async () => {
    if (!currentProjectPath || !isElectronApiAvailable || !window.electronAPI?.listConversations) {
      setConversations([]);
      return;
    }

    try {
      const res = await window.electronAPI.listConversations(currentProjectPath);
      if (res?.success && Array.isArray(res.conversations)) {
        setConversations(res.conversations);
      } else {
        setConversations([]);
      }
    } catch (error) {
      // silencieux
    }
  }, [currentProjectPath, isElectronApiAvailable]);

  useEffect(() => {
    refreshConversations();
  }, [refreshConversations]);

  const estimateRequestCost = useCallback((providerName, estimatedTokens) => {
    const provider = String(providerName || 'gemini');
    const inputRatePerMTokens = (() => {
      if (provider === 'claude') return 3.0;
      if (provider === 'kimi') return 0.6;
      if (provider === 'multi') return 1.6;
      if (provider === 'ollama' || provider === 'ollama-multi') return 0;
      return 1.25; // gemini
    })();
    return (Math.max(0, Number(estimatedTokens) || 0) / 1000000) * inputRatePerMTokens;
  }, []);

  const computeContextChars = useCallback((projectContextPayload) => {
    if (!projectContextPayload || typeof projectContextPayload !== 'object') return 0;
    const files = projectContextPayload.files;
    if (!files || typeof files !== 'object') return 0;

    let total = 0;
    for (const [filePath, entry] of Object.entries(files)) {
      total += String(filePath || '').length;
      if (entry && typeof entry.content === 'string') {
        total += entry.content.length;
      }
    }
    return total;
  }, []);

  const updateContextEstimate = useCallback((providerName, promptText, projectContextPayload) => {
    const promptChars = String(promptText || '').length;
    const contextChars = computeContextChars(projectContextPayload);
    const estimatedTokens = Math.ceil((promptChars + contextChars) / 4);
    const estimatedCostUsd = estimateRequestCost(providerName, estimatedTokens);

    setContextEstimate({
      provider: providerName,
      promptChars,
      contextChars,
      estimatedTokens,
      estimatedCostUsd: Number(estimatedCostUsd.toFixed(4))
    });
  }, [computeContextChars, estimateRequestCost]);

  const addImageMessage = useCallback((dataUrl) => {
    if (!dataUrl) return;

    try {
      const match = typeof dataUrl === 'string'
        ? dataUrl.match(/^data:(.+);base64,/)
        : null;
      const mimeType = match ? match[1] : 'image/png';

      const newImg = {
        type: 'inline',
        mimeType,
        dataUrl
      };

      setPendingImages(prev => [...prev, newImg]);
    } catch (error) {
      // silencieux
    }
  }, []);

  const autoSaveConversation = useCallback(async (history) => {
    if (!currentProjectPath || !window.electronAPI?.saveConversation) return;
    if (history.length < 4) return;
    try {
      const response = await window.electronAPI.saveConversation(currentProjectPath, history);
      if (response && response.success) {
        await refreshConversations();
      }
    } catch (error) {
      // silencieux
    }
  }, [currentProjectPath, refreshConversations]);

  // Auto-trigger pending message when loading completes
  useEffect(() => {
    if (!isLoading && pendingMessage) {
      const { text, images } = pendingMessage;
      setPendingMessage(null);
      setPrompt(text);
      if (images && images.length > 0) setPendingImages(images);
      // Small delay to let state settle before triggering
      setTimeout(() => {
        generateAIResponse(text);
      }, 100);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  const generateAIResponse = useCallback(async (overridePrompt) => {
    const effectivePrompt = overridePrompt !== undefined ? overridePrompt : prompt;
    if (!effectivePrompt.trim()) {
      showMessage("Veuillez entrer une requête.");
      return;
    }
    // If already loading, queue the message
    if (isLoading) {
      setPendingMessage({ text: effectivePrompt, images: pendingImages });
      setPrompt('');
      setPendingImages([]);
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

    let offOllamaMultiStepListener = null;

    try {
      let trimmedPrompt = effectivePrompt.trim();
      let explicitContextFilesContent = '';
      const explicitContextFilesMap = {};
      let explicitContextPaths = [];

      // Extraction du contexte explicite (@mentions)
      const explicitContextMatch = trimmedPrompt.match(/^\[Contexte forcé:\s*(.+?)\]\n\n/);
      if (explicitContextMatch) {
        try {
          explicitContextPaths = explicitContextMatch[1]
            .split(',')
            .map((rawPath) => String(rawPath || '').trim())
            .filter(Boolean);

          const readPromises = explicitContextPaths.map(async (filePath) => {
            const res = await window.electronAPI.readFile(currentProjectPath, filePath);
            if (res && res.success) {
              const content = String(res.content || '');
              explicitContextFilesMap[filePath] = {
                type: 'file',
                content,
                size: content.length,
                source: 'mention'
              };
              return `\n--- Contenu de ${filePath} ---\n${content}\n--- Fin de ${filePath} ---\n`;
            }
            return '';
          });
          const contents = await Promise.all(readPromises);
          explicitContextFilesContent = contents.join('\n');
        } catch (err) {
          console.warn("[IA] Impossible de charger le contexte explicite:", err);
        }
      }

      // Ajout du contenu explicite au prompt final envoyé à l'IA
      const promptToSend = explicitContextFilesContent
        ? `${trimmedPrompt}\n\nVoici le contenu des fichiers explicitement mentionnés :\n${explicitContextFilesContent}`
        : trimmedPrompt;

      const normalizedContextMode =
        contextMode === 'mentions' || contextMode === 'none' ? contextMode : 'auto';
      const projectIntentRegex = /\b(projet|project|repo|repository|structure|arborescence|architecture|analyse|audit|overview|contexte|context|scan|lire|lis|read|workflow|workflows|flux|visuel|diagramme|n8n)\b/i;
      const isKimiFastPath = aiProvider === 'kimi' && !deepContextEnabled;
      const autoContextWanted =
        !!deepContextEnabled ||
        aiProvider === 'multi' ||
        aiProvider === 'ollama-multi' ||
        projectIntentRegex.test(trimmedPrompt) ||
        (!isKimiFastPath && trimmedPrompt.length > 140);
      const wantsProjectContext =
        normalizedContextMode === 'none'
          ? false
          : normalizedContextMode === 'mentions'
            ? false
            : autoContextWanted;

      let allProjectFiles = Object.keys(explicitContextFilesMap).length > 0
        ? {
          success: true,
          files: explicitContextFilesMap,
          stats: { fileCount: Object.keys(explicitContextFilesMap).length, source: 'mentions' }
        }
        : null;

      if (wantsProjectContext) {
        showMessage("Lecture du contexte projet...", 2000);

        const scanPresets = {
          safe: {
            includeHidden: false,
            includeBuild: false,
            includeNodeModules: false,
            includeGit: false,
            maxFileSize: 50000,
            maxFiles: 8000,
            maxTotalBytes: 25000000,
            maxDepth: 30
          },
          full: {
            includeHidden: true,
            includeBuild: false,
            includeNodeModules: false,
            includeGit: false,
            maxFileSize: 120000,
            maxFiles: 12000,
            maxTotalBytes: 40000000,
            maxDepth: 40
          },
          god: {
            includeHidden: true,
            includeBuild: true,
            includeNodeModules: true,
            includeGit: true,
            maxFileSize: 250000,
            maxFiles: 50000,
            maxTotalBytes: 150000000,
            maxDepth: 60
          }
        };

        const presetKey = deepContextEnabled || aiProvider === 'multi' || aiProvider === 'ollama-multi' ? projectScanPreset : 'safe';
        const baseOptions = scanPresets[presetKey] || scanPresets.safe;
        const scanOptions = {
          ...baseOptions,
          includeSecrets: projectScanIncludeSecrets,
          largeFileStrategy: projectScanLargeFileStrategy,
          includeVisualWorkflows: true
        };
        const maxFilesLimit = Number(contextMaxFiles);
        if (Number.isFinite(maxFilesLimit) && maxFilesLimit > 0) {
          scanOptions.maxFiles = Math.max(10, Math.min(scanOptions.maxFiles, Math.floor(maxFilesLimit)));
        }

        if (scanOptions.includeSecrets) {
          scanOptions.includeHidden = true;
        }

        const projectFilesResponse = await window.electronAPI.getAllProjectFiles(currentProjectPath, scanOptions);
        if (projectFilesResponse.success) {
          if (Object.keys(explicitContextFilesMap).length > 0) {
            projectFilesResponse.files = {
              ...(projectFilesResponse.files || {}),
              ...explicitContextFilesMap
            };
            projectFilesResponse.stats = {
              ...(projectFilesResponse.stats || {}),
              fileCount: Object.keys(projectFilesResponse.files).length
            };
          }
          allProjectFiles = projectFilesResponse;
          const fileCount = Object.keys(projectFilesResponse.files).length;
          const hitLimit = projectFilesResponse?.stats?.hitLimit;
          const truncated = projectFilesResponse?.stats?.truncatedCount;
          const suffix = hitLimit ? ' (limite atteinte)' : '';
          const truncInfo = truncated ? `, ${truncated} tronqués` : '';
          showMessage(`Contexte lu: ${fileCount} fichiers${truncInfo}${suffix}`, 2200);
        } else {
          showMessage(`Erreur lecture projet: ${projectFilesResponse.error}`, 3000);
        }
      } else {
        if (normalizedContextMode === 'none') {
          showMessage("Contexte IA desactive (mode: none).", 2200);
        } else if (normalizedContextMode === 'mentions') {
          if (explicitContextPaths.length > 0) {
            showMessage(`Contexte par mentions: ${explicitContextPaths.length} fichier(s).`, 2200);
          } else {
            showMessage("Mode mentions: ajoutez @fichier pour injecter du contexte.", 2600);
          }
        } else {
          showMessage("Mode rapide: pas de scan projet (active Ctx si besoin).", 2200);
        }
      }
      updateContextEstimate(aiProvider, promptToSend, allProjectFiles);
      const sharedAgentContextOptions = {
        includeVisualWorkflows: true,
        includeN8nCatalog: true,
        maxVisualWorkflowIndexItems: deepContextEnabled ? 40 : 20,
        maxVisualWorkflowDetailedItems: deepContextEnabled ? 6 : 2,
        maxVisualWorkflowContentChars: deepContextEnabled ? 14000 : 7000,
        maxN8nCatalogItems: deepContextEnabled ? 200 : 80
      };

      const normalizedMultiAgentRoles = normalizeMultiAgentRoles(multiAgentRoles);
      const getProviderApiKey = (provider) => {
        if (provider === 'claude') return claudeApiKey;
        if (provider === 'kimi') return kimiApiKey;
        if (provider === 'gemini') return geminiApiKey;
        return undefined;
      };
      const runMultiAgentRole = async ({
        roleKey,
        promptText,
        codeContext = code,
        projectFiles = allProjectFiles,
        thinking = false,
        maxTokens = 4096
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
          skillsContent: Array.isArray(skills)
            ? skills
              .filter((s) => s && s.name && s.hasSkillMd !== false)
              .map((s) => ({ name: s.name, scope: s.scope }))
            : [],
          maxTokens,
          ...sharedAgentContextOptions
        };

        // For ollama, fall back to the globally configured model if role has no explicit model
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

        const method = window.electronAPI?.[methodName];
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

      const runWithConcurrency = async (items, limit, worker) => {
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

      const runAgentBatch = async ({
        agents,
        phase,
        previousOutputs,
        teamPlan,
        teamPlanText,
        projectContextStr
      }) => {
        const safeAgents = Array.isArray(agents) ? agents : [];
        const localAgents = safeAgents.filter((agent) => agent.provider === 'ollama');
        const cloudAgents = safeAgents.filter((agent) => agent.provider !== 'ollama');
        const outputs = [];

        const runOneAgent = async (agent) => {
          setMultiAIState(prev => ({
            ...prev,
            currentPhase: agent.title,
            steps: updateMultiStepsFromEvent(prev.steps, {
              label: agent.title,
              status: 'active',
              detail: `${phase} - ${agent.reason || agent.focus}`,
              models: prev.models
            }),
            events: appendMultiAIEvent(prev.events, {
              label: agent.title,
              status: 'active',
              detail: `${phase} - ${agent.reason || agent.focus}`,
              roleKey: agent.key
            })
          }));

          const promptText = generateDynamicTeamAgentPrompt({
            agent,
            teamPlanText,
            userRequest: promptToSend,
            projectContext: projectContextStr,
            currentCode: code,
            previousOutputs,
            phase
          });

          const response = await runMultiAgentRole({
            roleKey: agent.key,
            promptText,
            projectFiles: allProjectFiles,
            thinking: agent.stage === 'planning' || agent.stage === 'validation',
            maxTokens: Math.min(
              Number(teamPlan?.budget?.maxTokens) || 4096,
              agent.canWrite ? 8192 : 4096
            )
          });

          if (!response.success) {
            throw new Error(`${agent.title}: ${response.error}`);
          }

          const output = {
            agent,
            roleKey: agent.key,
            text: response.text,
            provider: response.provider,
            model: response.model
          };

          setAiConversationHistory(prev => [...prev, {
            role: 'model',
            text: `**[${agent.title}]**\n\n${response.text}`,
            dynamicAgentKey: agent.key,
            dynamicAgentTitle: agent.title,
            agentProvider: getProviderLabel(response.provider),
            agentModel: response.model
          }]);

          setMultiAIState(prev => ({
            ...prev,
            steps: updateMultiStepsFromEvent(prev.steps, {
              label: agent.title,
              status: 'completed',
              detail: 'Termine',
              models: prev.models
            }),
            events: appendMultiAIEvent(prev.events, {
              label: agent.title,
              status: 'completed',
              detail: 'Sortie produite.',
              roleKey: agent.key
            })
          }));

          return output;
        };

        const [cloudOutputs, localOutputs] = await Promise.all([
          runWithConcurrency(cloudAgents, teamPlan?.budget?.maxConcurrentCloud || 3, runOneAgent),
          runWithConcurrency(localAgents, teamPlan?.budget?.maxConcurrentLocal || 1, runOneAgent)
        ]);
        outputs.push(...cloudOutputs, ...localOutputs);
        return outputs;
      };

      // Mode Multi-IA: selectionneur + equipe dynamique adaptee a la demande.
      if (aiProvider === 'multi') {
        // Build a compact project context string (file paths + first 300 chars each) — NOT the full raw JSON
        // Full allProjectFiles is still passed separately to each agent via projectFiles param
        const buildCompactProjectContext = (projectFiles) => {
          if (!projectFiles?.files) return 'Aucun contexte projet disponible.';
          const entries = Object.entries(projectFiles.files).slice(0, 60);
          let ctx = `Projet (${Object.keys(projectFiles.files).length} fichiers):\n`;
          for (const [filePath, entry] of entries) {
            const snippet = String(entry?.content || '').slice(0, 250).replace(/\n/g, ' ');
            ctx += `- ${filePath}${snippet ? `: ${snippet}` : ''}\n`;
          }
          return ctx.slice(0, 8000);
        };
        const projectContextStr = buildCompactProjectContext(allProjectFiles);
        let hardwareProfile = null;

        if (
          localAISettings?.optimizationMode === 'auto' &&
          localAISettings?.hardwareConsent &&
          window.electronAPI?.getSystemAIProfile
        ) {
          hardwareProfile = await window.electronAPI.getSystemAIProfile({ consent: true });
        }

        const teamPlan = buildTeamPlan({
          userRequest: promptToSend,
          projectFiles: allProjectFiles,
          rolesConfig: normalizedMultiAgentRoles,
          localAISettings,
          hardwareProfile
        });
        const teamPlanText = formatTeamPlanForPrompt(teamPlan);
        const multiAgentModelMap = (teamPlan.selectedAgents || []).reduce((acc, agent) => {
          acc[agent.key] = agent.model;
          return acc;
        }, {});

        setMultiAIState({
          ...createEmptyMultiAIState(),
          isActive: true,
          mode: 'multi',
          runLabel: `Equipe ${teamPlan.formationLabel}`,
          currentPhase: 'Selectionneur',
          architectPlan: teamPlanText,
          approvedPlan: null,
          startedAt: Date.now(),
          models: multiAgentModelMap,
          requestedModels: teamPlan.selectedAgents,
          steps: buildDynamicTeamSteps(teamPlan, { selector: 'completed' }),
          events: appendMultiAIEvent([], {
            label: 'Selectionneur',
            status: 'completed',
            detail: `${teamPlan.formationLabel}: ${teamPlan.budget?.reason || 'budget etabli'}`,
            roleKey: 'selector'
          }),
          error: null
        });

        setAiConversationHistory(prev => [...prev, {
          role: 'model',
          text: `**[Selectionneur - TeamPlan]**\n\n${teamPlanText}`,
          dynamicAgentKey: 'selector',
          dynamicAgentTitle: 'Selectionneur',
          agentProvider: 'Local',
          agentModel: 'heuristique'
        }]);

        showMessage(`Equipe: ${teamPlan.formationLabel} (${teamPlan.selectedAgents.length} agents)`, 3000);

        const outputs = [];
        const agentsByStage = (stage) => teamPlan.selectedAgents.filter((agent) => agent.stage === stage && agent.key !== 'selector');

        const analysisOutputs = await runAgentBatch({
          agents: agentsByStage('analysis'),
          phase: 'Analyse parallele',
          previousOutputs: outputs,
          teamPlan,
          teamPlanText,
          projectContextStr
        });
        outputs.push(...analysisOutputs);

        const planningOutputs = await runAgentBatch({
          agents: agentsByStage('planning'),
          phase: 'Plan de jeu',
          previousOutputs: outputs,
          teamPlan,
          teamPlanText,
          projectContextStr
        });
        outputs.push(...planningOutputs);

        const implementationOutputs = await runAgentBatch({
          agents: agentsByStage('implementation'),
          phase: 'Implementation',
          previousOutputs: outputs,
          teamPlan,
          teamPlanText,
          projectContextStr
        });
        outputs.push(...implementationOutputs);

        const validationOutputs = await runAgentBatch({
          agents: agentsByStage('validation'),
          phase: 'Validation',
          previousOutputs: outputs,
          teamPlan,
          teamPlanText,
          projectContextStr
        });
        outputs.push(...validationOutputs);

        const finalPrompt = generateCaptainFinalPrompt({
          teamPlanText,
          userRequest: promptToSend,
          previousOutputs: outputs
        });
        const captainAgent = teamPlan.selectedAgents.find((agent) => agent.key === 'captain');
        const captainResponse = captainAgent
          ? await runMultiAgentRole({
            roleKey: 'captain',
            promptText: finalPrompt,
            projectFiles: allProjectFiles,
            thinking: true,
            maxTokens: Math.min(Number(teamPlan?.budget?.maxTokens) || 4096, 4096)
          })
          : { success: true, text: 'Aucun capitaine selectionne.' };

        if (!captainResponse.success) {
          throw new Error(`Capitaine Projet: ${captainResponse.error}`);
        }

        const artifactsText = outputs
          .filter((output) => output?.agent?.canWrite)
          .map((output) => `\n\n## Artefacts - ${output.agent.title}\n${output.text}`)
          .join('');
        const finalDeliverable = `## TeamPlan\n${teamPlanText}\n\n## Synthese Capitaine\n${captainResponse.text}\n${artifactsText}`;

        setMultiAIState(prev => ({
          ...prev,
          isActive: false,
          currentPhase: 'Equipe terminee',
          finishedAt: Date.now(),
          steps: markAllMultiStepsCompleted(prev.steps, multiAgentModelMap),
          events: appendMultiAIEvent(prev.events, {
            label: '✅ Equipe multi-agent',
            status: 'completed',
            detail: `${teamPlan.formationLabel} terminee.`
          })
        }));

        setAiConversationHistory(prev => [...prev, {
          role: 'model',
          text: `**[Capitaine Projet - LIVRABLE FINAL]**\n\n${finalDeliverable}`,
          dynamicAgentKey: 'captain',
          dynamicAgentTitle: 'Capitaine Projet',
          agentProvider: captainResponse.provider ? getProviderLabel(captainResponse.provider) : 'Local',
          agentModel: captainResponse.model || 'synthese'
        }]);

        await processAIFileModifications(finalDeliverable, {
          prompt: promptToSend,
          provider: aiProvider,
          model: aiProvider === 'ollama-multi' ? `${ollamaModelArchitect}/${ollamaModelCoder}/${ollamaModelTester}` : aiProvider,
          summary: 'Livrable multi-agent'
        });
        await autoSaveConversation(updatedHistory.concat([{ role: 'model', text: finalDeliverable }]));

        showMessage("Multi-IA dynamique terminee avec succes ! 🎉", 4000);


      } else {
        // Mode simple (Gemini ou Kimi seul)
        let response;
        if (aiProvider === 'kimi') {
          const images = updatedHistory
            .filter(msg => Array.isArray(msg.images))
            .flatMap(msg =>
              msg.images.map(img => ({
                dataUrl: img.dataUrl,
                mimeType: img.mimeType
              }))
            );

          const kimiOptions = {
            model: kimiModel || DEFAULT_KIMI_MODEL,
            thinkingMode,
            images,
            apiKey: kimiApiKey,
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

          response = await window.electronAPI.getKimiCompletion(
            kimiHistory.slice(-8),
            code,
            allProjectFiles,
            kimiOptions
          );
        } else if (aiProvider === 'ollama-multi') {
          // Multi-Ollama: 3 agents séquentiels avec steps live
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

          if (window.electronAPI?.onOllamaMultiStep) {
            offOllamaMultiStepListener = window.electronAPI.onOllamaMultiStep((data) => {
              const safeData = data && typeof data === 'object' ? data : {};
              setMultiAIState(prev => ({
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
            // Send only skill metadata; main process will read files only for selected skills.
            skillsContent: Array.isArray(skills)
              ? skills
                .filter((s) => s && s.name && s.hasSkillMd !== false)
                .map((s) => ({ name: s.name, scope: s.scope }))
              : [],
            ...sharedAgentContextOptions
          };
          response = await window.electronAPI.getOllamaMultiCompletion(
            [...aiConversationHistory, Object.assign({}, newMessage, { text: promptToSend })], code, allProjectFiles, ollamaMultiOptions
          );
          if (response?.success) {
            const resolvedModels = response.models || requestedModels;
            setMultiAIState(prev => ({
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
            setMultiAIState(prev => ({
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

        } else if (aiProvider === 'claude') {
          const images = updatedHistory
            .filter(msg => Array.isArray(msg.images))
            .flatMap(msg =>
              msg.images.map(img => ({
                dataUrl: img.dataUrl,
                mimeType: img.mimeType
              }))
            );

          const claudeOptions = {
            model: claudeModel || DEFAULT_CLAUDE_MODEL,
            thinkingMode,
            images,
            apiKey: claudeApiKey,
            projectPath: currentProjectPath,
            agent: activeAgent,
            skill: activeSkill,
            ...sharedAgentContextOptions
          };

          response = await window.electronAPI.getClaudeCompletion(
            [...aiConversationHistory, Object.assign({}, newMessage, { text: promptToSend })],
            code,
            allProjectFiles,
            claudeOptions
          );

        } else if (aiProvider === 'ollama') {
          const ollamaOptions = {
            model: ollamaModel || DEFAULT_OLLAMA_MODEL,
            projectPath: currentProjectPath,
            agent: activeAgent,
            skill: activeSkill,
            ...sharedAgentContextOptions
          };
          response = await window.electronAPI.getOllamaCompletion(
            [...aiConversationHistory, Object.assign({}, newMessage, { text: promptToSend })],
            code,
            allProjectFiles,
            ollamaOptions
          );
        } else {
          const geminiOptions = {
            model: geminiModel || DEFAULT_GEMINI_MODEL,
            thinkingMode,
            apiKey: geminiApiKey,
            projectPath: currentProjectPath,
            agent: activeAgent,
            skill: activeSkill,
            ...sharedAgentContextOptions
          };

          response = await window.electronAPI.getGeminiCompletion(
            [...aiConversationHistory, Object.assign({}, newMessage, { text: promptToSend })],
            code,
            allProjectFiles,
            geminiOptions
          );
        }

        if (response.success) {
          const fullAiText = response.text;
          setAiConversationHistory(prev => [...prev, { role: 'model', text: fullAiText }]);
          await processAIFileModifications(fullAiText, {
            prompt: promptToSend,
            provider: aiProvider,
            model: response.model || geminiModel || kimiModel || claudeModel || ollamaModel,
            summary: 'Reponse IA'
          });
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
      if (typeof offOllamaMultiStepListener === 'function') {
        offOllamaMultiStepListener();
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
    activeAgent,
    activeSkill,
    skills,
    processAIFileModifications,
    autoSaveConversation,
    pendingImages,
    isLoading,
    updateContextEstimate,
    setPreviousCode
  ]);

  const saveConversation = useCallback(async () => {
    if (!currentProjectPath || aiConversationHistory.length === 0) {
      showMessage("Aucune conversation à sauvegarder.", 3000);
      return;
    }

    try {
      const response = await window.electronAPI.saveConversation(currentProjectPath, aiConversationHistory);
      if (response.success) {
        showMessage(`Conversation sauvegardée: ${response.fileName}`, 4000);
        setActiveConversationFile(response.fileName || null);
        setAiConversationHistory(prev => [...prev, {
          role: 'system',
          text: `Conversation sauvegardée dans: conversations/${response.fileName}`
        }]);
        await refreshConversations();
      } else {
        showMessage(`Erreur: ${response.error}`, 5000);
      }
    } catch (error) {
      showMessage(`Erreur: ${error.message}`, 5000);
    }
  }, [currentProjectPath, aiConversationHistory, showMessage, refreshConversations]);

  const startNewConversation = useCallback(() => {
    setAiConversationHistory([]);
    setPrompt('');
    resetPendingChangesState();
    setContextEstimate({
      provider: aiProvider,
      promptChars: 0,
      contextChars: 0,
      estimatedTokens: 0,
      estimatedCostUsd: 0
    });
    setActiveConversationFile(null);
    resetMultiAIState();
    if (abortController) {
      abortController.abort();
      setAbortController(null);
    }
  }, [abortController, aiProvider, resetMultiAIState, resetPendingChangesState]);

  const loadConversationByFile = useCallback(async (fileName) => {
    if (!fileName || !currentProjectPath || !isElectronApiAvailable || !window.electronAPI?.loadConversation) {
      return;
    }

    setIsConversationLoading(true);
    try {
      const res = await window.electronAPI.loadConversation(currentProjectPath, fileName);
      if (res?.success && Array.isArray(res.history)) {
        setAiConversationHistory(res.history);
        setPrompt('');
        resetPendingChangesState();
        setActiveConversationFile(fileName);
        resetMultiAIState();
        showMessage(`Conversation chargée: ${fileName}`, 3000);
      } else if (res && !res.success && res.error) {
        showMessage(`Erreur chargement conversation: ${res.error}`, 5000);
      }
    } catch (error) {
      showMessage(`Erreur chargement conversation: ${error.message}`, 5000);
    } finally {
      setIsConversationLoading(false);
    }
  }, [currentProjectPath, isElectronApiAvailable, resetMultiAIState, resetPendingChangesState, showMessage]);

  const handleUndo = useCallback(async () => {
    const result = await handlePendingUndo();

    if (result === 'pending-rejected') {
      setAiConversationHistory(prev => [...prev, { role: 'system', text: 'Modification IA rejetee.' }]);
    } else if (result === 'rollback-applied') {
      setAiConversationHistory(prev => [...prev, { role: 'system', text: 'Rollback patch applique.' }]);
    } else if (result === 'single-undo') {
      setAiConversationHistory(prev => [...prev, { role: 'system', text: 'Modification IA annulee.' }]);
    }
  }, [handlePendingUndo]);

  const handleAcceptDiff = useCallback(async () => {
    const result = await handlePendingAcceptDiff();

    if (result === 'pending-applied') {
      setAiConversationHistory(prev => [...prev, { role: 'system', text: 'Modification IA acceptee.' }]);
    } else if (result === 'accepted') {
      setAiConversationHistory(prev => [...prev, { role: 'system', text: 'Modifications IA acceptees.' }]);
    }
  }, [handlePendingAcceptDiff]);

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


