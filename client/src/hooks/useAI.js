import { useState, useCallback, useEffect } from 'react';

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
  const [previousCode, setPreviousCode] = useState('');
  const [isDiffMode, setIsDiffMode] = useState(false);
  const [apiKeys, setApiKeys] = useState({
    gemini: '',
    kimi: '',
    claude: '',
    ollamaModel: '',
    ollamaModelArchitect: '',
    ollamaModelCoder: '',
    ollamaModelTester: ''
  });
  const {
    gemini: geminiApiKey,
    kimi: kimiApiKey,
    claude: claudeApiKey,
    ollamaModel,
    ollamaModelArchitect,
    ollamaModelCoder,
    ollamaModelTester
  } = apiKeys;
  const [projectScanPreset, setProjectScanPreset] = useState('safe'); // safe | full | god
  const [projectScanIncludeSecrets, setProjectScanIncludeSecrets] = useState(false);
  const [projectScanLargeFileStrategy, setProjectScanLargeFileStrategy] = useState('skip'); // skip | truncate
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
  const [pendingFileChanges, setPendingFileChanges] = useState([]);
  const [activePendingChangeId, setActivePendingChangeId] = useState(null);
  const [pendingSnapshotId, setPendingSnapshotId] = useState(null);
  const [appliedPatchHistory, setAppliedPatchHistory] = useState([]);
  const [qualityGatePassedBatch, setQualityGatePassedBatch] = useState(false);
  const [contextEstimate, setContextEstimate] = useState({
    provider: aiProvider,
    promptChars: 0,
    contextChars: 0,
    estimatedTokens: 0,
    estimatedCostUsd: 0
  });

  // Charger les settings (clés API) au montage
  useEffect(() => {
    const loadApiKeys = async () => {
      if (!isElectronApiAvailable) return;
      try {
        const response = await window.electronAPI.loadSettings();
        if (response.success && response.settings) {
          setApiKeys({
            gemini: response.settings.geminiApiKey || '',
            kimi: response.settings.kimiApiKey || '',
            claude: response.settings.claudeApiKey || '',
            ollamaModel: response.settings.ollamaModel || '',
            ollamaModelArchitect: response.settings.ollamaModelArchitect || '',
            ollamaModelCoder: response.settings.ollamaModelCoder || '',
            ollamaModelTester: response.settings.ollamaModelTester || ''
          });

          const preset = response.settings.aiContextPreset;
          if (preset === 'safe' || preset === 'full' || preset === 'god') {
            setProjectScanPreset(preset);
          }

          setProjectScanIncludeSecrets(!!response.settings.aiContextIncludeSecrets);

          const strat = response.settings.aiContextLargeFileStrategy;
          setProjectScanLargeFileStrategy(strat === 'truncate' ? 'truncate' : 'skip');
        }
      } catch (error) {
        // silencieux
      }
    };
    loadApiKeys();
  }, [isElectronApiAvailable]);

  useEffect(() => {
    const onSettingsUpdated = (event) => {
      const next = event?.detail;
      if (!next || typeof next !== 'object') return;

      setApiKeys({
        gemini: next.geminiApiKey || '',
        kimi: next.kimiApiKey || '',
        claude: next.claudeApiKey || '',
        ollamaModel: next.ollamaModel || '',
        ollamaModelArchitect: next.ollamaModelArchitect || '',
        ollamaModelCoder: next.ollamaModelCoder || '',
        ollamaModelTester: next.ollamaModelTester || ''
      });

      if (next.aiContextPreset === 'safe' || next.aiContextPreset === 'full' || next.aiContextPreset === 'god') {
        setProjectScanPreset(next.aiContextPreset);
      }

      setProjectScanIncludeSecrets(!!next.aiContextIncludeSecrets);
      setProjectScanLargeFileStrategy(next.aiContextLargeFileStrategy === 'truncate' ? 'truncate' : 'skip');
    };

    window.addEventListener('settings-updated', onSettingsUpdated);
    return () => window.removeEventListener('settings-updated', onSettingsUpdated);
  }, []);

  // ===== MODÈLES TOGETHER AI PAR AGENT =====
  const AGENT_MODELS = {
    chefDeProjet: 'gemini-2.5-pro',
    frontendDev: 'moonshotai/Kimi-K2.5',
    backendDev: 'moonshotai/Kimi-K2.5',
    architectEngineer: 'moonshotai/Kimi-K2.5',
    scrumMaster: 'gemini-2.5-pro'
  };

  // ===== PROMPTS POUR CHAQUE AGENT =====

  const generateChefDeProjetPrompt = (userRequest, projectContext, currentCode) => {
    return `Tu es le CHEF DE PROJET. Ton unique rôle est d'interpréter au mieux le besoin de l'utilisateur et de rédiger un CAHIER DES CHARGES complet et structuré.

DEMANDE DE L'UTILISATEUR: "${userRequest}"

CONTEXTE DU PROJET: ${projectContext}
CODE ACTUEL: ${currentCode || 'Aucun'}

INSTRUCTIONS:
1. Analyse en profondeur la demande de l'utilisateur
2. Identifie tous les besoins explicites ET implicites
3. Rédige un cahier des charges structuré

FORMAT DE SORTIE OBLIGATOIRE:

CAHIER_DES_CHARGES:

## 1. Résumé du besoin
[Reformulation claire de la demande]

## 2. Spécifications Frontend
- Pages/Composants à créer ou modifier
- Interactions utilisateur attendues
- Design/UX requis

## 3. Spécifications Backend
- Endpoints API nécessaires
- Modèles de données / Base de données
- Logique métier côté serveur

## 4. Architecture technique
- Technologies à utiliser
- Structure des fichiers
- Dépendances nécessaires

## 5. Critères d'acceptation
- [ ] Critère 1
- [ ] Critère 2
...

## 6. Fichiers concernés
- Liste des fichiers à créer/modifier avec leur rôle

CONSIGNES:
- Sois exhaustif et précis
- Pense aux cas limites et à la gestion d'erreurs
- Reste cohérent avec l'architecture existante du projet
NE GÉNÈRE JAMAIS de syntaxe de type **WORKFLOW: nom** ou **FICHIER: nom** dans ta réponse, car ton rôle est uniquement de rédiger le plan. C'est le rôle des codeurs.`;
  };

  const generateFrontendDevPrompt = (cahierDesCharges, projectContext, currentCode) => {
    return `Tu es le DÉVELOPPEUR FRONTEND. Tu ne codes QUE le frontend (HTML, CSS, JavaScript, React, composants UI).

CAHIER DES CHARGES:
${cahierDesCharges}

CONTEXTE DU PROJET: ${projectContext}
CODE ACTUEL: ${currentCode || 'Aucun'}

INSTRUCTIONS:
1. Lis attentivement le cahier des charges, en particulier les "Spécifications Frontend"
2. Code UNIQUEMENT les fichiers frontend (composants React, pages, styles CSS, hooks)
3. NE touche PAS au backend (pas de routes API, pas de modèles de données serveur)
4. Pour chaque fichier, utilise ce format:

   **FICHIER: chemin/du/fichier.ext**
   \`\`\`langage
   // code complet du fichier
   \`\`\`

CONSIGNES:
- Focus UNIQUEMENT sur l'UI, les composants React/Vue, le state management, les appels API côté client, les hooks, le CSS.
- NE PAS écrire de code Backend (Node.js, Express, BD).
- Si un mock est nécessaire, crée-le.
- FOURNIS le code complet, prêt à être intégré, au format **FICHIER: chemin/nom.ext** \`\`\`lang\ncode\n\`\`\`.
- NE GÉNÈRE PAS de **WORKFLOW: nom** car tu ne crées que du code.`;
  };

  const generateBackendDevPrompt = (cahierDesCharges, frontendResponse, projectContext, currentCode) => {
    return `Tu es le DÉVELOPPEUR BACKEND. Tu ne codes QUE le backend (API, routes, modèles, services, base de données).

CAHIER DES CHARGES:
${cahierDesCharges}

CONTEXTE DU PROJET: ${projectContext}
CODE ACTUEL: ${currentCode || 'Aucun'}

INSTRUCTIONS:
1. Lis attentivement le cahier des charges, en particulier les "Spécifications Backend"
2. Code UNIQUEMENT les fichiers backend (routes API, contrôleurs, modèles, services, migrations DB)
3. NE touche PAS au frontend (pas de composants React, pas de CSS)
4. Pour chaque fichier, utilise ce format:

   **FICHIER: chemin/du/fichier.ext**
   \`\`\`langage
   // code complet du fichier
   \`\`\`

CONSIGNES:
- Focus UNIQUEMENT sur les serveurs, les routes d'API, la logique métier, l'accès BDD (Mongoose, Prisma), l'auth, etc.
- Fournis des mocks ou fixtures si besoin.
- Relie ton code à celui du Frontend Dev si nécessaire.
- FOURNIS le code complet, prêt à être intégré, au format **FICHIER: chemin/nom.ext** \`\`\`lang\ncode\n\`\`\`.
- NE GÉNÈRE PAS de **WORKFLOW: nom**.`;
  };

  const generateArchitectEngineerPrompt = (cahierDesCharges, frontendCode, backendCode, userRequest, projectContext) => {
    return `Tu es l'ARCHITECTE LOGICIEL / DEVOPS. Ton rôle est de lier le frontend et le backend, d'optimiser, et de créer la configuration de déploiement.
    
CAHIER DES CHARGES:
${cahierDesCharges}

CODE FRONTEND GÉNÉRÉ:
${frontendCode}

CODE BACKEND GÉNÉRÉ:
${backendCode}

DEMANDE ORIGINALE: "${userRequest}"

CONTEXTE DU PROJET: ${projectContext}

INSTRUCTIONS:
1. Analyse l'intégration entre le frontend et le backend
2. Propose des optimisations et refactorisations si nécessaires
3. Code les fichiers de configuration (Docker, CI/CD, Nginx, etc.) s'ils sont pertinents
4. Assure la cohérence globale de l'application

FORMAT OBLIGATOIRE:
- Fais le lien entre le Frontend et le Backend. Crée les scripts d'intégration, configurations Docker, CI/CD, etc.
- Optimise, refactorise si nécessaire. 
- Vérifie la cohérence globale.
- FOURNIS le code manquant ou les modifications sous forme de **FICHIER: chemin/nom.ext** \`\`\`lang\ncode\n\`\`\`.
- NE GENERÈ JAMAIS LA SYNTAXE **WORKFLOW:**. L'utilisateur utilise un autre format pour cela.`;
  };

  const generateScrumMasterPrompt = (cahierDesCharges, frontendCode, backendCode, architectReview, userRequest) => {
    return `Tu es le SCRUM MASTER. Ton rôle est de synthétiser tout le travail des agents et de produire le LIVRABLE FINAL complet et cohérent.

CAHIER DES CHARGES:
${cahierDesCharges}

CODE FRONTEND:
${frontendCode}

CODE BACKEND:
${backendCode}

REVIEW ARCHITECTE:
${architectReview}

DEMANDE ORIGINALE: "${userRequest}"

INSTRUCTIONS:
1. Synthétise tous les outputs des agents précédents
2. Si l'architecte a proposé des corrections, applique-les dans le code final
3. Produis le LIVRABLE COMPLET avec tous les fichiers dans leur version finale
4. Ajoute un résumé de ce qui a été fait

FORMAT DE SORTIE OBLIGATOIRE:

## Résumé des travaux
[Résumé de ce qui a été implémenté, en 3-5 lignes]

## Fichiers livrés

Pour CHAQUE fichier (frontend + backend), utilise EXACTEMENT ce format stricte !
**FICHIER: chemin/du/fichier.ext**
\`\`\`langage
// code complet final
\`\`\`

NE GÉNÈRE JAMAIS le mot-clé **WORKFLOW:** ni de JSON non-autorisé. Concentre-toi sur le code source.`;
  };


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

  const sanitizeProposedFilePath = useCallback((fileName) => {
    const raw = String(fileName || '').trim();
    if (!raw) return '';

    // Reject absolute paths early; backend will still enforce workspace safety.
    if (/^[a-zA-Z]:[\\/]/.test(raw) || raw.startsWith('/') || raw.startsWith('\\')) {
      return '';
    }

    const segments = raw
      .replace(/\\/g, '/')
      .split('/')
      .map((segment) => String(segment || '').trim())
      .filter(Boolean);

    if (segments.length === 0) return '';
    if (segments.some((segment) => segment === '.' || segment === '..')) return '';

    const cleaned = segments
      .map((segment) => segment.split('\0').join('').replace(/[<>:"|?*]/g, '_').trim())
      .filter(Boolean);

    return cleaned.join('/');
  }, []);

  const buildFileProposal = useCallback(async (fileName, fileContent) => {
    if (!isElectronApiAvailable || !currentProjectPath || !window.electronAPI?.readFile) return null;

    const cleanFileName = sanitizeProposedFilePath(fileName);
    if (!cleanFileName) return null;

    let oldContent = '';
    let existed = false;
    let baseMtimeMs = null;
    try {
      const readRes = await window.electronAPI.readFile(currentProjectPath, cleanFileName);
      if (readRes?.success) {
        existed = true;
        oldContent = String(readRes.content || '');
        baseMtimeMs = Number.isFinite(Number(readRes.mtimeMs)) ? Number(readRes.mtimeMs) : null;
      }
    } catch {
      // keep defaults
    }

    const patchId = `patch-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    return {
      id: patchId,
      patchId,
      filePath: cleanFileName,
      newContent: String(fileContent || ''),
      oldContent,
      existed,
      baseMtimeMs
    };
  }, [currentProjectPath, isElectronApiAvailable, sanitizeProposedFilePath]);

  const focusPendingChange = useCallback((change) => {
    if (!change || !change.filePath) {
      setActivePendingChangeId(null);
      return;
    }
    setActiveFile(change.filePath);
    setActivePendingChangeId(change.id || null);
    setPreviousCode(change.oldContent || '');
    setCode(change.newContent || '');
    setIsDiffMode(true);
  }, [setActiveFile, setCode]);

  const ensureSnapshotForPending = useCallback(async (changes) => {
    if (!Array.isArray(changes) || changes.length === 0) return true;
    if (pendingSnapshotId) return true;
    if (!window.electronAPI?.createAISnapshot || !currentProjectPath) return true;

    try {
      const files = changes.map((c) => c.filePath);
      const res = await window.electronAPI.createAISnapshot(currentProjectPath, files, 'ai-changes');
      if (res?.success) {
        setPendingSnapshotId(res.snapshotId || null);
        return true;
      }
      showMessage(`Snapshot non cree: ${res?.error || 'inconnu'}`, 3500);
      return false;
    } catch (error) {
      showMessage(`Snapshot non cree: ${error.message}`, 3500);
      return false;
    }
  }, [currentProjectPath, pendingSnapshotId, showMessage]);

  const runQualityGatesBeforeApply = useCallback(async () => {
    if (!qualityGateConfig?.onApply) return true;
    if (qualityGatePassedBatch) return true;
    if (!window.electronAPI?.runQualityGates || !currentProjectPath) return true;

    try {
      const res = await window.electronAPI.runQualityGates(currentProjectPath, {
        lint: qualityGateConfig.lint,
        test: qualityGateConfig.test,
        build: qualityGateConfig.build,
        blockOnFail: qualityGateConfig.blockOnFail
      });

      if (!res?.success) {
        showMessage(`Quality gates: ${res?.error || 'erreur inconnue'}`, 5000);
        return false;
      }

      if (!res.passed) {
        const failed = (res.results || []).filter((gate) => !gate.ok).map((gate) => gate.id).join(', ');
        showMessage(`Quality gates echoues: ${failed || 'details indisponibles'}`, 5000);
        return false;
      }

      setQualityGatePassedBatch(true);
      showMessage('Quality gates valides.', 2500);
      return true;
    } catch (error) {
      showMessage(`Quality gates: ${error.message}`, 5000);
      return false;
    }
  }, [currentProjectPath, qualityGateConfig, qualityGatePassedBatch, showMessage]);

  const pushAppliedPatchHistory = useCallback((entries) => {
    if (!Array.isArray(entries) || entries.length === 0) return;
    const normalizedEntries = entries
      .filter((entry) => entry && entry.filePath && entry.patchId)
      .map((entry) => ({
        patchId: String(entry.patchId),
        filePath: String(entry.filePath),
        existedBefore: !!entry.existedBefore,
        previousContent: String(entry.previousContent || ''),
        appliedContent: String(entry.appliedContent || ''),
        appliedAt: entry.appliedAt || new Date().toISOString(),
        appliedMtimeMs: Number.isFinite(Number(entry.appliedMtimeMs)) ? Number(entry.appliedMtimeMs) : null
      }));

    if (normalizedEntries.length === 0) return;

    setAppliedPatchHistory((prev) => {
      const merged = [...prev, ...normalizedEntries];
      const limit = 80;
      return merged.length > limit ? merged.slice(merged.length - limit) : merged;
    });
  }, []);

  const rollbackPatchEntry = useCallback(async (entry) => {
    if (!entry || !currentProjectPath || !isElectronApiAvailable) {
      return { success: false, error: 'Contexte rollback indisponible' };
    }

    if (!entry.existedBefore) {
      if (!window.electronAPI?.deleteFile) {
        return { success: false, error: 'API deleteFile indisponible' };
      }

      try {
        const deleteOptions = Number.isFinite(Number(entry.appliedMtimeMs))
          ? { expectedMtimeMs: Number(entry.appliedMtimeMs) }
          : undefined;
        const res = await window.electronAPI.deleteFile(currentProjectPath, entry.filePath, deleteOptions);
        if (res?.success) {
          return { success: true };
        }
        const errorText = String(res?.error || '');
        if (/ENOENT|introuvable|not exist|n'existe/i.test(errorText)) {
          return { success: true };
        }
        return { success: false, error: res?.error || 'Echec suppression rollback' };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }

    if (!window.electronAPI?.writeFile) {
      return { success: false, error: 'API writeFile indisponible' };
    }

    try {
      const writeOptions = Number.isFinite(Number(entry.appliedMtimeMs))
        ? { expectedMtimeMs: Number(entry.appliedMtimeMs) }
        : undefined;
      const res = await window.electronAPI.writeFile(
        currentProjectPath,
        entry.filePath,
        entry.previousContent || '',
        writeOptions
      );
      if (res?.success) {
        return { success: true, mtimeMs: Number.isFinite(Number(res.mtimeMs)) ? Number(res.mtimeMs) : null };
      }
      return { success: false, error: res?.error || 'Echec restauration rollback', code: res?.code };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }, [currentProjectPath, isElectronApiAvailable]);

  const applyPendingChangeByIndex = useCallback(async (index) => {
    if (permissionMode === 'read_only') {
      showMessage('Mode lecture seule: application IA bloquee.', 3000);
      return false;
    }
    if (!Array.isArray(pendingFileChanges) || pendingFileChanges.length === 0) return false;
    const change = pendingFileChanges[index];
    if (!change) return false;

    const gatesOk = await runQualityGatesBeforeApply();
    if (!gatesOk) return false;

    const snapshotOk = await ensureSnapshotForPending(pendingFileChanges);
    if (!snapshotOk) return false;

    try {
      let res;
      const patchId = String(change.patchId || change.id || `patch-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`);
      if (change.existed) {
        const writeOptions = Number.isFinite(Number(change.baseMtimeMs))
          ? { expectedMtimeMs: Number(change.baseMtimeMs) }
          : undefined;
        res = await window.electronAPI.writeFile(currentProjectPath, change.filePath, change.newContent, writeOptions);
      } else {
        res = await window.electronAPI.createNewFile(currentProjectPath, change.filePath, change.newContent);
      }

      if (!res?.success) {
        if (res?.code === 'FILE_MODIFIED' || res?.code === 'FILE_MISSING') {
          showMessage(`Conflit detecte (${change.filePath}): rechargez puis regenerez le patch.`, 5500);
          return false;
        }
        showMessage(`Erreur application IA: ${res?.error || change.filePath}`, 5000);
        return false;
      }

      pushAppliedPatchHistory([{
        patchId,
        filePath: change.filePath,
        existedBefore: !!change.existed,
        previousContent: change.oldContent || '',
        appliedContent: change.newContent || '',
        appliedAt: new Date().toISOString(),
        appliedMtimeMs: Number.isFinite(Number(res?.mtimeMs)) ? Number(res.mtimeMs) : null
      }]);

      const nextChanges = pendingFileChanges.filter((_, i) => i !== index);
      setPendingFileChanges(nextChanges);
      await loadProjectItems();

      if (nextChanges.length > 0) {
        const nextIndex = Math.min(index, nextChanges.length - 1);
        focusPendingChange(nextChanges[nextIndex]);
      } else {
        setActivePendingChangeId(null);
        setIsDiffMode(false);
        setPreviousCode('');
        setPendingSnapshotId(null);
        setQualityGatePassedBatch(false);
      }

      showMessage(`Modification IA appliquee (${patchId}): ${change.filePath}`, 2800);
      return true;
    } catch (error) {
      showMessage(`Erreur application IA: ${error.message}`, 5000);
      return false;
    }
  }, [
    permissionMode,
    pendingFileChanges,
    runQualityGatesBeforeApply,
    ensureSnapshotForPending,
    currentProjectPath,
    loadProjectItems,
    focusPendingChange,
    pushAppliedPatchHistory,
    showMessage
  ]);

  const rejectPendingChangeByIndex = useCallback((index) => {
    if (!Array.isArray(pendingFileChanges) || pendingFileChanges.length === 0) return false;
    const change = pendingFileChanges[index];
    if (!change) return false;

    const nextChanges = pendingFileChanges.filter((_, i) => i !== index);
    setPendingFileChanges(nextChanges);

    if (nextChanges.length > 0) {
      const nextIndex = Math.min(index, nextChanges.length - 1);
      focusPendingChange(nextChanges[nextIndex]);
    } else {
      setActivePendingChangeId(null);
      setIsDiffMode(false);
      setPreviousCode('');
      if (activeFile === change.filePath) {
        setCode(change.oldContent || '');
      }
      setPendingSnapshotId(null);
      setQualityGatePassedBatch(false);
    }

    showMessage(`Modification IA rejetee: ${change.filePath}`, 2500);
    return true;
  }, [activeFile, pendingFileChanges, focusPendingChange, setCode, showMessage]);

  const applyAllPendingChanges = useCallback(async () => {
    if (permissionMode === 'read_only') {
      showMessage('Mode lecture seule: application IA bloquee.', 3000);
      return { success: false, applied: 0, failed: pendingFileChanges.length };
    }
    if (!Array.isArray(pendingFileChanges) || pendingFileChanges.length === 0) {
      return { success: true, applied: 0, failed: 0 };
    }

    const gatesOk = await runQualityGatesBeforeApply();
    if (!gatesOk) {
      return { success: false, applied: 0, failed: pendingFileChanges.length };
    }

    const snapshotOk = await ensureSnapshotForPending(pendingFileChanges);
    if (!snapshotOk) {
      return { success: false, applied: 0, failed: pendingFileChanges.length };
    }

    let applied = 0;
    const failedChanges = [];
    const appliedEntries = [];

    for (const change of pendingFileChanges) {
      try {
        let res;
        const patchId = String(change.patchId || change.id || `patch-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`);
        if (change.existed) {
          const writeOptions = Number.isFinite(Number(change.baseMtimeMs))
            ? { expectedMtimeMs: Number(change.baseMtimeMs) }
            : undefined;
          res = await window.electronAPI.writeFile(currentProjectPath, change.filePath, change.newContent, writeOptions);
        } else {
          res = await window.electronAPI.createNewFile(currentProjectPath, change.filePath, change.newContent);
        }
        if (res?.success) {
          applied += 1;
          appliedEntries.push({
            patchId,
            filePath: change.filePath,
            existedBefore: !!change.existed,
            previousContent: change.oldContent || '',
            appliedContent: change.newContent || '',
            appliedAt: new Date().toISOString(),
            appliedMtimeMs: Number.isFinite(Number(res?.mtimeMs)) ? Number(res.mtimeMs) : null
          });
        } else {
          failedChanges.push(change);
          if (res?.code === 'FILE_MODIFIED' || res?.code === 'FILE_MISSING') {
            showMessage(`Conflit detecte (${change.filePath}): patch ignore.`, 4500);
          }
        }
      } catch {
        failedChanges.push(change);
      }
    }

    if (appliedEntries.length > 0) {
      pushAppliedPatchHistory(appliedEntries);
    }

    await loadProjectItems();
    setPendingFileChanges(failedChanges);

    if (failedChanges.length === 0) {
      setActivePendingChangeId(null);
      setIsDiffMode(false);
      setPreviousCode('');
      setPendingSnapshotId(null);
      setQualityGatePassedBatch(false);
      showMessage(`${applied} fichier(s) IA appliques.`, 3000);
    } else {
      focusPendingChange(failedChanges[0]);
      showMessage(`${applied} applique(s), ${failedChanges.length} en erreur.`, 4000);
    }

    return { success: failedChanges.length === 0, applied, failed: failedChanges.length };
  }, [
    permissionMode,
    pendingFileChanges,
    runQualityGatesBeforeApply,
    ensureSnapshotForPending,
    currentProjectPath,
    loadProjectItems,
    focusPendingChange,
    pushAppliedPatchHistory,
    showMessage
  ]);

  const rejectAllPendingChanges = useCallback(() => {
    if (!Array.isArray(pendingFileChanges) || pendingFileChanges.length === 0) {
      return { success: true, rejected: 0 };
    }

    const rejectedCount = pendingFileChanges.length;
    const activeChange = pendingFileChanges.find((item) => item.id === activePendingChangeId) || pendingFileChanges[0];

    if (activeChange && activeFile === activeChange.filePath) {
      setCode(activeChange.oldContent || '');
    }

    setPendingFileChanges([]);
    setActivePendingChangeId(null);
    setIsDiffMode(false);
    setPreviousCode('');
    setPendingSnapshotId(null);
    setQualityGatePassedBatch(false);

    showMessage(`${rejectedCount} modification(s) IA rejetee(s).`, 3000);
    return { success: true, rejected: rejectedCount };
  }, [activeFile, activePendingChangeId, pendingFileChanges, setCode, showMessage]);

  useEffect(() => {
    if (!Array.isArray(pendingFileChanges) || pendingFileChanges.length === 0) {
      setActivePendingChangeId(null);
      return;
    }
    if (!activePendingChangeId) return;
    const exists = pendingFileChanges.some((change) => change.id === activePendingChangeId);
    if (!exists) {
      setActivePendingChangeId(pendingFileChanges[0]?.id || null);
    }
  }, [activePendingChangeId, pendingFileChanges]);

  const processAIFileModifications = useCallback(async (aiResponse) => {
    if (!aiResponse) return;
    try {
      const collectedProposals = [];

      const fileBlockRegex1 = /\*\*FICHIER:\s*(.+?)\*\*\s*```[\w]*\s*([\s\S]*?)```/gi;
      let match;
      while ((match = fileBlockRegex1.exec(aiResponse)) !== null) {
        const fileName = match[1].trim();
        const fileContent = match[2].trim();
        if (!fileName || !fileContent) continue;
        const proposal = await buildFileProposal(fileName, fileContent);
        if (proposal) collectedProposals.push(proposal);
      }

      // Diff syntax:
      // FILE: path/to/file.ext
      // <<<< SEARCH
      // ...
      // ====
      // ...
      // >>>> REPLACE
      const diffErrors = [];
      const diffSectionRegex = /(?:^|\n)FILE:\s*(.+?)\s*\r?\n([\s\S]*?)(?=(?:\r?\nFILE:\s*)|$)/g;
      let sectionMatch;
      while ((sectionMatch = diffSectionRegex.exec(aiResponse)) !== null) {
        const fileName = sanitizeProposedFilePath(sectionMatch[1]);
        const sectionBody = String(sectionMatch[2] || '');
        if (!fileName || !sectionBody) continue;

        const diffBlockRegex = /<<<<\s*SEARCH\s*\r?\n([\s\S]*?)\r?\n====\s*\r?\n([\s\S]*?)\r?\n>>>>\s*REPLACE/g;
        const blocks = [];
        let diffMatch;
        while ((diffMatch = diffBlockRegex.exec(sectionBody)) !== null) {
          blocks.push({
            search: String(diffMatch[1] ?? ''),
            replace: String(diffMatch[2] ?? '')
          });
        }
        if (blocks.length === 0) continue;

        if (!currentProjectPath || !window.electronAPI?.readFile) {
          diffErrors.push(`[${fileName}] Projet non disponible pour appliquer le diff.`);
          continue;
        }

        let oldContent = '';
        let existed = false;
        let baseMtimeMs = null;
        try {
          const readRes = await window.electronAPI.readFile(currentProjectPath, fileName);
          if (readRes?.success) {
            oldContent = String(readRes.content || '');
            existed = true;
            baseMtimeMs = Number.isFinite(Number(readRes.mtimeMs)) ? Number(readRes.mtimeMs) : null;
          } else {
            diffErrors.push(`[${fileName}] Impossible de lire le fichier cible.`);
            continue;
          }
        } catch (error) {
          diffErrors.push(`[${fileName}] ${error.message}`);
          continue;
        }

        let nextContent = oldContent;
        let blockError = null;
        for (let i = 0; i < blocks.length; i += 1) {
          const block = blocks[i];
          const searchText = block.search;
          const replaceText = block.replace;
          const occurrenceCount = searchText.length === 0
            ? 0
            : nextContent.split(searchText).length - 1;

          if (searchText.length === 0) {
            blockError = `[${fileName}] SEARCH vide (bloc ${i + 1}).`;
            break;
          }
          if (occurrenceCount === 0) {
            blockError = `[${fileName}] SEARCH introuvable (bloc ${i + 1}).`;
            break;
          }
          if (occurrenceCount > 1) {
            blockError = `[${fileName}] SEARCH ambigu (${occurrenceCount} occurrences, bloc ${i + 1}).`;
            break;
          }

          nextContent = nextContent.replace(searchText, replaceText);
        }

        if (blockError) {
          diffErrors.push(blockError);
          continue;
        }

        const patchId = `patch-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
        collectedProposals.push({
          id: patchId,
          patchId,
          filePath: fileName,
          newContent: nextContent,
          oldContent,
          existed,
          baseMtimeMs
        });
      }

      if (diffErrors.length > 0) {
        showMessage(`Diff IA partiellement rejeté: ${diffErrors[0]}`, 5000);
      }

      if (collectedProposals.length > 0) {
        const dedup = new Map();
        for (const proposal of collectedProposals) dedup.set(proposal.filePath, proposal);
        const proposals = Array.from(dedup.values());

        setPendingFileChanges((prev) => {
          const merged = new Map((prev || []).map((item) => [item.filePath, item]));
          for (const proposal of proposals) merged.set(proposal.filePath, proposal);
          return Array.from(merged.values());
        });

        setPendingSnapshotId(null);
        setQualityGatePassedBatch(false);
        focusPendingChange(proposals[0]);
        showMessage(`${proposals.length} modification(s) IA en attente de validation.`, 4500);
      }

      const workflowRegex = /\*\*WORKFLOW:\s*(.+?)\*\*\s*```(?:json)?\s*([\s\S]*?)```/gi;
      let wfMatch;
      while ((wfMatch = workflowRegex.exec(aiResponse)) !== null) {
        try {
          const wfName = wfMatch[1].trim();
          let jsonStr = wfMatch[2].trim();
          const firstBrace = jsonStr.indexOf('{');
          const lastBrace = jsonStr.lastIndexOf('}');
          if (firstBrace >= 0 && lastBrace > firstBrace) {
            jsonStr = jsonStr.substring(firstBrace, lastBrace + 1);
          }
          const wfData = JSON.parse(jsonStr);
          if (wfData && window.electronAPI?.saveVisualWorkflow && currentProjectPath) {
            wfData.name = wfData.name || wfName;
            const saveRes = await window.electronAPI.saveVisualWorkflow(currentProjectPath, JSON.stringify(wfData));
            if (saveRes?.success) {
              const finalName = saveRes?.name || wfData.name || wfName;
              const safeFilename = saveRes?.filename || `${String(finalName || 'workflow').replace(/[<>:"/\\|?*]/g, '_').trim()}.json`;
              const action = saveRes?.action === 'created' ? 'cree' : 'mis a jour';
              showMessage(`Workflow visuel "${finalName}" ${action} automatiquement.`, 4000);
              try {
                window.dispatchEvent(new CustomEvent('ai-visual-workflow-written', {
                  detail: {
                    projectPath: currentProjectPath,
                    name: finalName,
                    filename: safeFilename,
                    action: saveRes?.action || 'updated'
                  }
                }));
              } catch {
                // ignore UI event errors
              }
            } else {
              showMessage(`Workflow refuse: ${saveRes?.error || 'schema invalide'}`, 4500);
            }
          }
        } catch (wfErr) {
          console.warn('[IA] Erreur parsing workflow JSON:', wfErr.message);
        }
      }

    } catch {
      // silent
    }
  }, [buildFileProposal, currentProjectPath, focusPendingChange, sanitizeProposedFilePath, showMessage]);

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
        const frontendPromptText = generateFrontendDevPrompt(cahierDesCharges, prompt, projectContextStr, code);

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
            window.electronAPI.onOllamaMultiStep((data) => {
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
            model: ollamaModel || 'qwen3-coder:30b',
            modelArchitect: ollamaModelArchitect || ollamaModel || 'qwen2.5-coder:7b',
            modelCoder: ollamaModelCoder || ollamaModel || 'qwen3-coder:30b',
            modelTester: ollamaModelTester || ollamaModel || 'qwen2.5-coder:7b',
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
            model: ollamaModel || 'qwen2.5-coder:7b',
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
          showMessage(`Erreur IA: ${response.error}`, 5000);
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
    AGENT_MODELS.architectEngineer,
    AGENT_MODELS.backendDev,
    AGENT_MODELS.chefDeProjet,
    AGENT_MODELS.frontendDev,
    AGENT_MODELS.scrumMaster,
    processAIFileModifications,
    autoSaveConversation,
    resetMultiAIState,
    pendingImages,
    isLoading,
    updateContextEstimate
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
    setPreviousCode('');
    setPendingFileChanges([]);
    setActivePendingChangeId(null);
    setPendingSnapshotId(null);
    setAppliedPatchHistory([]);
    setQualityGatePassedBatch(false);
    setIsDiffMode(false);
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
  }, [aiProvider, resetMultiAIState, abortController]);

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
        setPreviousCode('');
        setPendingFileChanges([]);
        setActivePendingChangeId(null);
        setPendingSnapshotId(null);
        setAppliedPatchHistory([]);
        setQualityGatePassedBatch(false);
        setIsDiffMode(false);
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
  }, [currentProjectPath, isElectronApiAvailable, resetMultiAIState, showMessage]);

  const handleUndo = useCallback(async () => {
    if (Array.isArray(pendingFileChanges) && pendingFileChanges.length > 0) {
      const idxFromActiveId = pendingFileChanges.findIndex((change) => change.id === activePendingChangeId);
      const idxFromActiveFile = idxFromActiveId >= 0
        ? idxFromActiveId
        : pendingFileChanges.findIndex((change) => change.filePath === activeFile);
      const nextIndex = idxFromActiveFile >= 0 ? idxFromActiveFile : 0;
      rejectPendingChangeByIndex(nextIndex);
      setAiConversationHistory(prev => [...prev, { role: 'system', text: "Modification IA rejetee." }]);
      return;
    }

    if (Array.isArray(appliedPatchHistory) && appliedPatchHistory.length > 0) {
      const lastPatch = appliedPatchHistory[appliedPatchHistory.length - 1];
      const rollbackRes = await rollbackPatchEntry(lastPatch);
      if (rollbackRes?.success) {
        setAppliedPatchHistory((prev) => prev.slice(0, -1));
        await loadProjectItems();

        if (activeFile === lastPatch.filePath) {
          if (lastPatch.existedBefore) {
            setCode(lastPatch.previousContent || '');
          } else {
            setCode('');
          }
        }
        setPreviousCode('');
        setIsDiffMode(false);
        setAiConversationHistory(prev => [...prev, {
          role: 'system',
          text: `Rollback applique: ${lastPatch.patchId} (${lastPatch.filePath})`
        }]);
        showMessage(`Rollback patch ${lastPatch.patchId} applique.`, 3200);
      } else {
        showMessage(`Rollback impossible: ${rollbackRes?.error || 'conflit detecte'}`, 5000);
      }
      return;
    }

    if (previousCode !== '' && activeFile && currentProjectPath) {
      try {
        const response = await window.electronAPI.writeFile(currentProjectPath, activeFile, previousCode);
        if (response.success) {
          setCode(previousCode);
          setPreviousCode('');
          setIsDiffMode(false);
          setAiConversationHistory(prev => [...prev, { role: 'system', text: "Modification IA annulee." }]);
          showMessage("Modification annulee.");
        }
      } catch (error) {
        showMessage(`Erreur: ${error.message}`, 5000);
      }
    }
  }, [
    activeFile,
    activePendingChangeId,
    appliedPatchHistory,
    currentProjectPath,
    loadProjectItems,
    pendingFileChanges,
    previousCode,
    rejectPendingChangeByIndex,
    rollbackPatchEntry,
    setCode,
    showMessage,
    setIsDiffMode
  ]);

  const handleAcceptDiff = useCallback(async () => {
    if (Array.isArray(pendingFileChanges) && pendingFileChanges.length > 0) {
      const idxFromActiveId = pendingFileChanges.findIndex((change) => change.id === activePendingChangeId);
      const idxFromActiveFile = idxFromActiveId >= 0
        ? idxFromActiveId
        : pendingFileChanges.findIndex((change) => change.filePath === activeFile);
      const nextIndex = idxFromActiveFile >= 0 ? idxFromActiveFile : 0;
      const applied = await applyPendingChangeByIndex(nextIndex);
      if (applied) {
        setAiConversationHistory(prev => [...prev, { role: 'system', text: "Modification IA acceptee." }]);
      }
      return;
    }

    setIsDiffMode(false);
    setPreviousCode('');
    setAiConversationHistory(prev => [...prev, { role: 'system', text: "Modifications IA acceptees." }]);
    showMessage("Modifications acceptees.");
  }, [
    activeFile,
    activePendingChangeId,
    applyPendingChangeByIndex,
    pendingFileChanges,
    showMessage,
    setIsDiffMode
  ]);

  const selectPendingChangeByIndex = useCallback((index) => {
    if (!Array.isArray(pendingFileChanges) || pendingFileChanges.length === 0) return false;
    const change = pendingFileChanges[index];
    if (!change) return false;
    focusPendingChange(change);
    return true;
  }, [focusPendingChange, pendingFileChanges]);

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


