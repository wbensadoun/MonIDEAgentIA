import { useState, useCallback, useEffect } from 'react';
import {
  AGENT_MODELS,
  generateArchitectEngineerPrompt,
  generateBackendDevPrompt,
  generateChefDeProjetPrompt,
  generateFrontendDevPrompt,
  generateScrumMasterPrompt
} from './aiPrompts';
import useAISettingsSync from './useAISettingsSync';
import useAIPendingChanges from './useAIPendingChanges';

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
    ollamaModel,
    ollamaModelArchitect,
    ollamaModelCoder,
    ollamaModelTester
  } = apiKeys;
  const [multiAIState, setMultiAIState] = useState({
    isActive: false,
    currentPhase: null,
    architectPlan: null,
    approvedPlan: null,
    steps: [],
    error: null
  });
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
    processAIFileModifications,
    applyPendingChangeByIndex,
    rejectPendingChangeByIndex,
    applyAllPendingChanges,
    rejectAllPendingChanges,
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
    setMultiAIState({
      isActive: false,
      currentPhase: null,
      architectPlan: null,
      approvedPlan: null,
      steps: [],
      error: null
    });
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

      // Mode Multi-IA: 5 Agents (Hybride Kimi + Gemini)
      if (aiProvider === 'multi') {
        const projectContextStr = JSON.stringify(allProjectFiles);

        setMultiAIState({
          isActive: true,
          currentPhase: 'chef-projet',
          architectPlan: null,
          approvedPlan: null,
          steps: [
            { label: 'Chef de Projet (Gemini 2.5)', status: 'active', provider: 'Gemini' },
            { label: 'Frontend Dev (Kimi-K2.5)', status: 'pending', provider: 'Together' },
            { label: 'Backend Dev (Kimi-K2.5)', status: 'pending', provider: 'Together' },
            { label: 'Architecte Engineer (Kimi-K2.5)', status: 'pending', provider: 'Together' },
            { label: 'Scrum Master (Gemini 2.5)', status: 'pending', provider: 'Gemini' }
          ],
          error: null
        });

        // ===== PHASE 1: CHEF DE PROJET (GEMINI) =====
        showMessage("Phase 1/5: Le Chef de Projet (Gemini 2.5) analyse...", 3000);
        const chefPromptText = generateChefDeProjetPrompt(prompt, projectContextStr, code);

        // Utilisation de l'API GEMINI pour le Chef de Projet
        const chefResponse = await window.electronAPI.getGeminiCompletion(
          [{ role: 'user', text: chefPromptText }],
          code,
          allProjectFiles,
          {
            model: AGENT_MODELS.chefDeProjet,
            thinkingMode: true,
            apiKey: geminiApiKey, // Utilise la clé Gemini
            projectPath: currentProjectPath,
            agent: activeAgent,
            skill: activeSkill,
            ...sharedAgentContextOptions
          }
        );

        if (!chefResponse.success) {
          throw new Error(`Chef de Projet: ${chefResponse.error}`);
        }

        const cahierDesCharges = chefResponse.text;

        setMultiAIState(prev => ({
          ...prev,
          architectPlan: cahierDesCharges,
          currentPhase: 'frontend-dev',
          steps: [
            { label: 'Chef de Projet (Gemini 2.5)', status: 'completed', provider: 'Gemini' },
            { label: 'Frontend Dev (Kimi-K2.5)', status: 'active', provider: 'Together' },
            { label: 'Backend Dev (Kimi-K2.5)', status: 'pending', provider: 'Together' },
            { label: 'Architecte Engineer (Kimi-K2.5)', status: 'pending', provider: 'Together' },
            { label: 'Scrum Master (Gemini 2.5)', status: 'pending', provider: 'Gemini' }
          ]
        }));

        setAiConversationHistory(prev => [...prev, {
          role: 'model',
          text: `**[🎯 CHEF DE PROJET]**\n\n${cahierDesCharges}`,
          isChefDeProjet: true
        }]);

        // ===== PHASE 2: FRONTEND DEV (KIMI) =====
        showMessage("Phase 2/5: Le Frontend Dev (Kimi) code l'interface...", 3000);
        const frontendPromptText = generateFrontendDevPrompt(cahierDesCharges, projectContextStr, code);

        const frontendResponse = await window.electronAPI.getKimiCompletion(
          [{ role: 'user', text: frontendPromptText }],
          code,
          allProjectFiles,
          {
            model: AGENT_MODELS.frontendDev, // Kimi K2.5
            thinkingMode: false,
            apiKey: kimiApiKey, // Utilise la clé Together
            projectPath: currentProjectPath,
            agent: activeAgent,
            skill: activeSkill,
            fastMode: true,
            reactMode: false,
            includeProjectContext: false,
            includeGlobalSkills: false,
            maxTokens: 4096,
            ...sharedAgentContextOptions
          }
        );

        if (!frontendResponse.success) {
          throw new Error(`Frontend Dev: ${frontendResponse.error}`);
        }

        const frontendCode = frontendResponse.text;

        setMultiAIState(prev => ({
          ...prev,
          currentPhase: 'backend-dev',
          steps: [
            { label: 'Chef de Projet (Gemini 2.0)', status: 'completed', provider: 'Gemini' },
            { label: 'Frontend Dev (Kimi-K2.5)', status: 'completed', provider: 'Together' },
            { label: 'Backend Dev (Kimi-K2.5)', status: 'active', provider: 'Together' },
            { label: 'Architecte Engineer (Kimi-K2.5)', status: 'pending', provider: 'Together' },
            { label: 'Scrum Master (Gemini 2.0)', status: 'pending', provider: 'Gemini' }
          ]
        }));

        setAiConversationHistory(prev => [...prev, {
          role: 'model',
          text: `**[🎨 FRONTEND DEV]**\n\n${frontendCode}`,
          isFrontendDev: true
        }]);

        // ===== PHASE 3: BACKEND DEV (KIMI) =====
        showMessage("Phase 3/5: Le Backend Dev (Kimi) code le serveur...", 3000);
        const backendPromptText = generateBackendDevPrompt(cahierDesCharges, prompt, projectContextStr, code);

        const backendResponse = await window.electronAPI.getKimiCompletion(
          [{ role: 'user', text: backendPromptText }],
          code,
          allProjectFiles,
          {
            model: AGENT_MODELS.backendDev,
            thinkingMode: false,
            apiKey: kimiApiKey,
            projectPath: currentProjectPath,
            agent: activeAgent,
            skill: activeSkill,
            fastMode: true,
            reactMode: false,
            includeProjectContext: false,
            includeGlobalSkills: false,
            maxTokens: 4096,
            ...sharedAgentContextOptions
          }
        );

        if (!backendResponse.success) {
          throw new Error(`Backend Dev: ${backendResponse.error}`);
        }

        const backendCode = backendResponse.text;

        setMultiAIState(prev => ({
          ...prev,
          currentPhase: 'architect-engineer',
          steps: [
            { label: 'Chef de Projet (Gemini 2.0)', status: 'completed', provider: 'Gemini' },
            { label: 'Frontend Dev (Kimi-K2.5)', status: 'completed', provider: 'Together' },
            { label: 'Backend Dev (Kimi-K2.5)', status: 'completed', provider: 'Together' },
            { label: 'Architecte Engineer (Kimi-K2.5)', status: 'active', provider: 'Together' },
            { label: 'Scrum Master (Gemini 2.0)', status: 'pending', provider: 'Gemini' }
          ]
        }));

        setAiConversationHistory(prev => [...prev, {
          role: 'model',
          text: `**[⚙️ BACKEND DEV]**\n\n${backendCode}`,
          isBackendDev: true
        }]);

        // ===== PHASE 4: ARCHITECTE ENGINEER (KIMI) =====
        showMessage("Phase 4/5: L'Architecte (Kimi) vérifie la cohérence...", 3000);
        const architectPromptText = generateArchitectEngineerPrompt(cahierDesCharges, frontendCode, backendCode, prompt, projectContextStr);

        const architectResponse = await window.electronAPI.getKimiCompletion(
          [{ role: 'user', text: architectPromptText }],
          code,
          null,
          {
            model: AGENT_MODELS.architectEngineer,
            thinkingMode: true,
            apiKey: kimiApiKey,
            projectPath: currentProjectPath,
            agent: activeAgent,
            skill: activeSkill,
            fastMode: true,
            reactMode: false,
            includeProjectContext: false,
            includeGlobalSkills: false,
            maxTokens: 4096,
            ...sharedAgentContextOptions
          }
        );

        if (!architectResponse.success) {
          throw new Error(`Architecte Engineer: ${architectResponse.error}`);
        }

        const architectReview = architectResponse.text;

        setMultiAIState(prev => ({
          ...prev,
          currentPhase: 'scrum-master',
          steps: [
            { label: 'Chef de Projet (Gemini 2.0)', status: 'completed', provider: 'Gemini' },
            { label: 'Frontend Dev (Kimi-K2.5)', status: 'completed', provider: 'Together' },
            { label: 'Backend Dev (Kimi-K2.5)', status: 'completed', provider: 'Together' },
            { label: 'Architecte Engineer (Kimi-K2.5)', status: 'completed', provider: 'Together' },
            { label: 'Scrum Master (Gemini 2.0)', status: 'active', provider: 'Gemini' }
          ]
        }));

        setAiConversationHistory(prev => [...prev, {
          role: 'model',
          text: `**[🏗️ ARCHITECTE ENGINEER]**\n\n${architectReview}`,
          isArchitectEngineer: true
        }]);

        // ===== PHASE 5: SCRUM MASTER (GEMINI) =====
        showMessage("Phase 5/5: Le Scrum Master (Gemini) prépare le livrable final...", 3000);
        const scrumPromptText = generateScrumMasterPrompt(cahierDesCharges, frontendCode, backendCode, architectReview, prompt);

        // Utilisation de l'API GEMINI pour le Scrum Master
        const scrumResponse = await window.electronAPI.getGeminiCompletion(
          [{ role: 'user', text: scrumPromptText }],
          code,
          allProjectFiles,
          {
            model: AGENT_MODELS.scrumMaster,
            thinkingMode: true,
            apiKey: geminiApiKey, // Utilise la clé Gemini
            projectPath: currentProjectPath,
            agent: activeAgent,
            skill: activeSkill,
            ...sharedAgentContextOptions
          }
        );

        if (!scrumResponse.success) {
          throw new Error(`Scrum Master: ${scrumResponse.error}`);
        }

        const finalDeliverable = scrumResponse.text;

        setMultiAIState(prev => ({
          ...prev,
          currentPhase: 'completed',
          steps: [
            { label: 'Chef de Projet (Gemini 2.0)', status: 'completed', provider: 'Gemini' },
            { label: 'Frontend Dev (Kimi-K2.5)', status: 'completed', provider: 'Together' },
            { label: 'Backend Dev (Kimi-K2.5)', status: 'completed', provider: 'Together' },
            { label: 'Architecte Engineer (Kimi-K2.5)', status: 'completed', provider: 'Together' },
            { label: 'Scrum Master (Gemini 2.0)', status: 'completed', provider: 'Gemini' }
          ]
        }));

        // Ajouter le livrable final à l'historique
        setAiConversationHistory(prev => [...prev, {
          role: 'model',
          text: `**[📋 SCRUM MASTER - LIVRABLE FINAL]**\n\n${finalDeliverable}`,
          isScrumMaster: true
        }]);

        // Appliquer les modifications de fichiers depuis le livrable final
        await processAIFileModifications(finalDeliverable);
        await autoSaveConversation(updatedHistory.concat([{ role: 'model', text: finalDeliverable }]));

        showMessage("Multi-IA (5 Agents Kimi/Gemini) terminé avec succès ! 🎉", 4000);

        // Réinitialiser après un délai
        setTimeout(() => resetMultiAIState(), 3000);


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
            model: 'moonshotai/Kimi-K2.5',
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
          const multiSteps = [
            { label: '🏗️ Architecte', status: 'pending' },
            { label: '💻 Codeur', status: 'pending' },
            { label: '🔍 Relecteur', status: 'pending' }
          ];
          setMultiAIState({ isActive: true, currentPhase: '🏗️ Architecte...', steps: multiSteps, error: null });

          if (window.electronAPI?.onOllamaMultiStep) {
            offOllamaMultiStepListener = window.electronAPI.onOllamaMultiStep((data) => {
              const safeData = data && typeof data === 'object' ? data : {};
              setMultiAIState(prev => ({
                ...prev,
                currentPhase: safeData.status === 'active' ? (safeData.label || prev.currentPhase) : prev.currentPhase,
                steps: (Array.isArray(prev.steps) ? prev.steps : []).map((s) => {
                  if (!s || typeof s !== 'object') return s;
                  return safeData.label === s.label || String(safeData.label || '').startsWith(`${s.label} `)
                    ? { ...s, status: safeData.status }
                    : s;
                })
              }));
            });
          }

          const ollamaMultiOptions = {
            model: ollamaModel || 'qwen3:8b',
            modelArchitect: ollamaModelArchitect || ollamaModel || 'qwen3:8b',
            modelCoder: ollamaModelCoder || ollamaModel || 'qwen3:8b',
            modelTester: ollamaModelTester || ollamaModel || 'qwen3:8b',
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
          setMultiAIState({ isActive: false, currentPhase: null, steps: [], error: null });

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
            model: 'claude-4.6',
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
            model: ollamaModel || 'qwen3:8b',
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
          await processAIFileModifications(fullAiText);
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
      setMultiAIState(prev => ({ ...prev, currentPhase: 'error', error: error.message }));
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
    ollamaModel,
    ollamaModelArchitect,
    ollamaModelCoder,
    ollamaModelTester,
    activeAgent,
    activeSkill,
    skills,
    processAIFileModifications,
    autoSaveConversation,
    resetMultiAIState,
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
    selectPendingChangeByIndex,
    applyPendingChangeByIndex,
    rejectPendingChangeByIndex,
    applyAllPendingChanges,
    rejectAllPendingChanges,
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


