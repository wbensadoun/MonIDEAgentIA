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
  skills = []
) => {
  const [prompt, setPrompt] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [aiConversationHistory, setAiConversationHistory] = useState([]);
  const [previousCode, setPreviousCode] = useState('');
  const [isDiffMode, setIsDiffMode] = useState(false);
  const [apiKeys, setApiKeys] = useState({ gemini: '', kimi: '', claude: '', ollamaModel: '' });
  const { gemini: geminiApiKey, kimi: kimiApiKey, claude: claudeApiKey, ollamaModel } = apiKeys;
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
            claude: response.settings.claudeApiKey || ''
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
        claude: next.claudeApiKey || ''
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

  const checkFileExists = useCallback(async (fileName) => {
    if (!isElectronApiAvailable || !currentProjectPath || !window.electronAPI?.getAllFiles) {
      return false;
    }
    try {
      const response = await window.electronAPI.getAllFiles(currentProjectPath);
      if (response.success) {
        return response.items.some(item => item.name === fileName && item.type === 'file');
      }
      return false;
    } catch {
      return false;
    }
  }, [currentProjectPath, isElectronApiAvailable]);

  const createOrUpdateFile = useCallback(async (fileName, fileContent) => {
    if (!isElectronApiAvailable || !currentProjectPath || !window.electronAPI) return false;
    try {
      const cleanFileName = fileName
        .replace(/[()]/g, '')
        .replace(/\s+/g, '_')
        .replace(/[<>:"|?*]/g, '')
        .trim();

      const fileExists = await checkFileExists(cleanFileName);

      if (fileExists) {
        const writeResp = await window.electronAPI.writeFile(currentProjectPath, cleanFileName, fileContent);
        if (writeResp.success) {
          await loadProjectItems();
          if (activeFile === cleanFileName) {
            setPreviousCode(code);
            setCode(fileContent);
            setIsDiffMode(true); // Active the Smart Diff Viewer for the user
          }
          return true;
        }
      } else {
        const createResp = await window.electronAPI.createNewFile(currentProjectPath, cleanFileName, fileContent);
        if (createResp.success) {
          await loadProjectItems();
          if (!activeFile) {
            setActiveFile(cleanFileName);
            setCode(fileContent);
          }
          return true;
        }
      }
      return false;
    } catch (error) {
      return false;
    }
  }, [activeFile, checkFileExists, currentProjectPath, isElectronApiAvailable, loadProjectItems, setActiveFile, setCode]);

  const processAIFileModifications = useCallback(async (aiResponse) => {
    if (!aiResponse) return;
    try {
      let modificationsApplied = 0;

      // Match **FICHIER: path** ```lang\ncode\n```
      const fileBlockRegex1 = /\*\*FICHIER:\s*(.+?)\*\*\s*```[\w]*\s * ([\s\S] *?)```/gi;

      let match;
      while ((match = fileBlockRegex1.exec(aiResponse)) !== null) {
        const fileName = match[1].trim();
        const fileContent = match[2].trim();

        if (fileName && fileContent) {
          // eslint-disable-next-line no-console
          console.log(`[IA] Fichier détecté: ${fileName} (${fileContent.length} chars)`);
          const success = await createOrUpdateFile(fileName, fileContent);
          if (success) modificationsApplied++;
        }
      }

      // Match **WORKFLOW: name** ```json\n{... } \n```
      const workflowRegex = /\*\*WORKFLOW:\s*(.+?)\*\*\s*```(?: json) ?\s * ([\s\S] *?)```/gi;
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
            await window.electronAPI.saveVisualWorkflow(currentProjectPath, JSON.stringify(wfData));
            showMessage(`Workflow visuel "${wfData.name}" créé automatiquement! ⚡`, 4000);
            // eslint-disable-next-line no-console
            console.log(`[IA] Workflow visuel créé: ${wfData.name} `);
          }
        } catch (wfErr) {
          console.warn('[IA] Erreur parsing workflow JSON:', wfErr.message);
        }
      }

      if (modificationsApplied > 0) {
        showMessage(`${modificationsApplied} fichier(s) modifie(s) par l'IA`, 4000);
      }
    } catch (error) {
      // silencieux
    }
  }, [createOrUpdateFile, showMessage, currentProjectPath]);

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

      // Extraction du contexte explicite (@mentions)
      const explicitContextMatch = trimmedPrompt.match(/^\[Contexte forcé:\s*(.+?)\]\n\n/);
      if (explicitContextMatch) {
        try {
          const filePaths = explicitContextMatch[1].split(', ');
          const readPromises = filePaths.map(async (filePath) => {
            const res = await window.electronAPI.readFile(currentProjectPath, filePath);
            if (res && res.success) {
              return `\n--- Contenu de ${filePath} ---\n${res.content}\n--- Fin de ${filePath} ---\n`;
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

      const projectIntentRegex = /\b(projet|project|repo|repository|structure|arborescence|architecture|analyse|audit|overview|contexte|context|scan|lire|lis|read)\b/i;
      const wantsProjectContext =
        !!deepContextEnabled ||
        aiProvider === 'multi' ||
        aiProvider === 'ollama-multi' ||
        projectIntentRegex.test(trimmedPrompt) ||
        trimmedPrompt.length > 140;

      let allProjectFiles = null;

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
            includeGit: false,
            maxFileSize: 200000,
            maxFiles: 20000,
            maxTotalBytes: 80000000,
            maxDepth: 60
          }
        };

        const presetKey = deepContextEnabled || aiProvider === 'multi' || aiProvider === 'ollama-multi' ? projectScanPreset : 'safe';
        const baseOptions = scanPresets[presetKey] || scanPresets.safe;
        const scanOptions = {
          ...baseOptions,
          includeSecrets: projectScanIncludeSecrets,
          largeFileStrategy: projectScanLargeFileStrategy
        };

        if (scanOptions.includeSecrets) {
          scanOptions.includeHidden = true;
        }

        const projectFilesResponse = await window.electronAPI.getAllProjectFiles(currentProjectPath, scanOptions);
        if (projectFilesResponse.success) {
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
        showMessage("Mode rapide: pas de scan projet (active Ctx si besoin).", 2200);
      }

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
            skill: activeSkill
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
            skill: activeSkill
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
            skill: activeSkill
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
            skill: activeSkill
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
            skill: activeSkill
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
            skill: activeSkill
          };

          response = await window.electronAPI.getKimiCompletion(
            [...aiConversationHistory, Object.assign({}, newMessage, { text: promptToSend })],
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
              setMultiAIState(prev => ({
                ...prev,
                currentPhase: data.status === 'active' ? data.label : prev.currentPhase,
                steps: prev.steps.map(s =>
                  s.label === data.label ? { ...s, status: data.status } : s
                )
              }));
            });
          }

          const ollamaMultiOptions = {
            model: ollamaModel || 'qwen3-coder:30b',
            projectPath: currentProjectPath,
            agent: activeAgent,
            skill: activeSkill,
            // Pass all skills to the Architecte for distribution
            skillsContent: Array.isArray(skills)
              ? await Promise.all(
                skills.map(async (s) => {
                  try {
                    const res = await window.electronAPI.getSkill(s.name, s.scope, currentProjectPath);
                    return { name: s.name, content: res?.content || '' };
                  } catch { return { name: s.name, content: '' }; }
                })
              )
              : []
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
            skill: activeSkill
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
            skill: activeSkill
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
            skill: activeSkill
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
    projectScanPreset,
    projectScanIncludeSecrets,
    projectScanLargeFileStrategy,
    geminiApiKey,
    kimiApiKey,
    claudeApiKey,
    ollamaModel,
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
    pendingImages
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
    setActiveConversationFile(null);
    resetMultiAIState();
    if (abortController) {
      abortController.abort();
      setAbortController(null);
    }
  }, [resetMultiAIState, abortController]);

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
    if (previousCode !== '' && activeFile && currentProjectPath) {
      try {
        const response = await window.electronAPI.writeFile(currentProjectPath, activeFile, previousCode);
        if (response.success) {
          setCode(previousCode);
          setPreviousCode('');
          setIsDiffMode(false);
          setAiConversationHistory(prev => [...prev, { role: 'system', text: "Modification IA annulée." }]);
          showMessage("Modification annulée.");
        }
      } catch (error) {
        showMessage(`Erreur: ${error.message}`, 5000);
      }
    }
  }, [activeFile, currentProjectPath, previousCode, setCode, showMessage, setIsDiffMode]);

  const handleAcceptDiff = useCallback(() => {
    setIsDiffMode(false);
    setPreviousCode('');
    setAiConversationHistory(prev => [...prev, { role: 'system', text: "Modifications IA acceptées." }]);
    showMessage("Modifications acceptées.");
  }, [showMessage, setIsDiffMode]);

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
