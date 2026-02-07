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
  thinkingMode = false
) => {
  const [prompt, setPrompt] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [aiConversationHistory, setAiConversationHistory] = useState([]);
  const [previousCode, setPreviousCode] = useState('');
  const [apiKeys, setApiKeys] = useState({ gemini: '', kimi: '' });
  const [settingsLoaded, setSettingsLoaded] = useState(false);
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

  // Charger les settings (clés API) au montage
  useEffect(() => {
    const loadApiKeys = async () => {
      if (!isElectronApiAvailable) return;
      try {
        const response = await window.electronAPI.loadSettings();
        if (response.success && response.settings) {
          setApiKeys({
            gemini: response.settings.geminiApiKey || '',
            kimi: response.settings.kimiApiKey || ''
          });
          setSettingsLoaded(true);
        }
      } catch (error) {
        console.warn('Erreur chargement clés API:', error);
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
        kimi: next.kimiApiKey || ''
      });
      setSettingsLoaded(true);
    };

    window.addEventListener('settings-updated', onSettingsUpdated);
    return () => window.removeEventListener('settings-updated', onSettingsUpdated);
  }, []);

  const updateMultiAIStep = (stepIndex, status, message = '') => {
    setMultiAIState(prev => {
      const newSteps = [...prev.steps];
      if (newSteps[stepIndex]) {
        newSteps[stepIndex] = { ...newSteps[stepIndex], status, message };
      }
      return { ...prev, steps: newSteps };
    });
  };

  const generateArchitectPrompt = (userRequest, projectContext, currentCode) => {
    return `Tu es l'ARCHITECTE logiciel (Gemini). Analyse cette demande et produis un PLAN.

DEMANDE: "${userRequest}"

CONTEXTE: ${projectContext}
CODE ACTUEL: ${currentCode || 'Aucun'}

INSTRUCTIONS:
1. Analyse si la demande necessite:
   - [ ] Base de donnees (nouvelles tables/champs?)
   - [ ] Routes API (nouveaux endpoints?)
   - [ ] UI/Composants (nouvelles pages/elements?)
   - [ ] Logique metier (services/fonctions?)
   - [ ] Tests (a creer/modifier?)
   - [ ] Autres modifications (config, dependances?)

2. Produis un DECISION_TREE structure avec pour chaque categorie: OUI/NON + details si OUI.

3. Produis ensuite un PLAN detaille avec les etapes d'implementation.

FORMAT DE SORTIE:
DECISION_TREE:
{
  "database": {"needed": boolean, "details": "..."},
  "apiRoutes": {"needed": boolean, "details": "..."},
  "ui": {"needed": boolean, "details": "..."},
  "businessLogic": {"needed": boolean, "details": "..."},
  "tests": {"needed": boolean, "details": "..."},
  "other": {"needed": boolean, "details": "..."}
}

PLAN:
1. [Premiere etape]
2. [Deuxieme etape]
...

CONSIGNES IMPORTANTES:
- Sois precis et technique
- Identifie les fichiers concernes
- Propose une architecture coherente avec le projet existant`;
  };

  const generateReviewerPrompt = (architectPlan, userRequest) => {
    return `Tu es le RELECTEUR (Kimi 2.5). Examine ce plan architectural.

PLAN DE L'ARCHITECTE:
${architectPlan}

DEMANDE ORIGINALE: "${userRequest}"

TACHE:
1. Analyse chaque decision de l'arbre (database, apiRoutes, ui, businessLogic, tests, other)
2. Pour chaque point, reponds: AGREE (d'accord) ou DISAGREE (pas d'accord) + justification courte
3. Si DISAGREE, propose une correction/amelioration
4. Donne un verdict final: APPROVED (plan valide) ou REJECTED (plan a corriger)

FORMAT DE SORTIE:
REVUE:
- Database: [AGREE/DISAGREE] - justification
- API Routes: [AGREE/DISAGREE] - justification
- UI: [AGREE/DISAGREE] - justification
- Business Logic: [AGREE/DISAGREE] - justification
- Tests: [AGREE/DISAGREE] - justification
- Other: [AGREE/DISAGREE] - justification

VERDICT: [APPROVED/REJECTED]

Si REJECTED, explique pourquoi et propose un PLAN_CORRIGE.
Si APPROVED, resume le PLAN_APPROUVE en 3-4 lignes.`;
  };

  const generateCoderPrompt = (approvedPlan, userRequest, projectContext, currentCode) => {
    return `Tu es le CODEUR (Kimi 2.5). Implemente ce plan approuve.

PLAN APPROUVE:
${approvedPlan}

DEMANDE: "${userRequest}"

CONTEXTE: ${projectContext}
CODE ACTUEL: ${currentCode || 'Aucun'}

INSTRUCTIONS:
1. Implemente TOUTES les etapes du plan
2. Pour chaque fichier modifie ou cree, utilise le format:
   **FICHIER: chemin/du/fichier.ext**
   \`\`\`langage
   // code complet ici
   \`\`\`
3. Assure-toi que le code est:
   - Complet et fonctionnel
   - Coherent avec le style existant
   - Bien commente si necessaire
   - Sans erreurs de syntaxe evidentes

Genere maintenant le code pour tous les fichiers concernes.`;
  };

  const stopGeneration = useCallback(() => {
    if (abortController) {
      abortController.abort();
      setAbortController(null);
    }
    setIsLoading(false);
    resetMultiAIState();
    showMessage("Génération arrêtée", 2000);
  }, [abortController, showMessage]);

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
      console.warn('Erreur chargement liste conversations:', error);
    }
  }, [currentProjectPath, isElectronApiAvailable]);

  useEffect(() => {
    refreshConversations();
  }, [refreshConversations]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const generateAIResponse = useCallback(async () => {
    console.log('[useAI] generateAIResponse appelée !');
    console.log('[useAI] État avant génération:', { prompt, currentProjectPath, isLoading, aiProvider });
    if (!prompt.trim()) {
      showMessage("Veuillez entrer une requête.");
      return;
    }
    if (!currentProjectPath) {
      showMessage("Veuillez ouvrir un dossier de projet.");
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

    const updatedHistory = [...aiConversationHistory, { role: 'user', text: prompt }];
    setAiConversationHistory(updatedHistory);
    setPrompt('');

    try {
      const trimmedPrompt = prompt.trim();
      const isLightRequest = aiProvider !== 'multi' && trimmedPrompt.length <= 80;

      let allProjectFiles = null;

      if (!isLightRequest) {
        showMessage("Lecture du contexte projet...", 2000);
        console.log('[useAI] Tentative de lecture des fichiers du projet:', currentProjectPath);
        const projectFilesResponse = await window.electronAPI.getAllProjectFiles(currentProjectPath);
        console.log('[useAI] Réponse getAllProjectFiles:', projectFilesResponse);
        if (projectFilesResponse.success) {
          allProjectFiles = projectFilesResponse;
          const fileCount = Object.keys(projectFilesResponse.files).length;
          showMessage(`Contexte lu: ${fileCount} fichiers analysés`, 2000);
          console.log(`[useAI] Succès: ${fileCount} fichiers lus`);
        } else {
          console.error('[useAI] Erreur lecture projet:', projectFilesResponse.error);
          showMessage(`Erreur lecture projet: ${projectFilesResponse.error}`, 3000);
        }
      } else {
        showMessage("Mode rapide: réponse sans analyse complète du projet.", 2000);
      }

      // Mode Multi-IA: Gemini (Architecte) + Kimi (Relecteur + Codeur)
      if (aiProvider === 'multi') {
        setMultiAIState({
          isActive: true,
          currentPhase: 'architect',
          architectPlan: null,
          approvedPlan: null,
          steps: [
            { label: 'Analyse Architecte (Gemini)', status: 'active', provider: 'Gemini' },
            { label: 'Revue Relecteur (Kimi)', status: 'pending', provider: 'Kimi' },
            { label: 'Génération Code (Kimi)', status: 'pending', provider: 'Kimi' }
          ],
          error: null
        });

        // Phase 1: Architecte (Gemini)
        showMessage("Phase 1/3: L'architecte analyse...", 3000);
        const architectPromptText = generateArchitectPrompt(prompt, JSON.stringify(allProjectFiles), code);
        
        const architectResponse = await window.electronAPI.getGeminiCompletion(
          [{ role: 'user', text: architectPromptText }],
          code,
          allProjectFiles,
          { thinkingMode: true, apiKey: apiKeys.gemini }
        );

        if (!architectResponse.success) {
          throw new Error(`Architecte: ${architectResponse.error}`);
        }

        const architectPlan = architectResponse.text;
        setMultiAIState(prev => ({
          ...prev,
          architectPlan,
          currentPhase: 'reviewer',
          steps: [
            { label: 'Analyse Architecte (Gemini)', status: 'completed', provider: 'Gemini' },
            { label: 'Revue Relecteur (Kimi)', status: 'active', provider: 'Kimi' },
            { label: 'Génération Code (Kimi)', status: 'pending', provider: 'Kimi' }
          ]
        }));

        // Ajouter le plan de l'architecte à l'historique
        setAiConversationHistory(prev => [...prev, { 
          role: 'model', 
          text: `**[ARCHITECTE GEMINI]**\n\n${architectPlan}`,
          isArchitect: true 
        }]);

        // Phase 2: Relecteur (Kimi)
        showMessage("Phase 2/3: Le relecteur examine...", 3000);
        const reviewerPromptText = generateReviewerPrompt(architectPlan, prompt);
        
        const reviewerResponse = await window.electronAPI.getKimiCompletion(
          [{ role: 'user', text: reviewerPromptText }],
          code,
          null,
          { model: 'moonshotai/Kimi-K2.5', thinkingMode: true, apiKey: apiKeys.kimi }
        );

        if (!reviewerResponse.success) {
          throw new Error(`Relecteur: ${reviewerResponse.error}`);
        }

        const reviewText = reviewerResponse.text;
        const isApproved = reviewText.includes('VERDICT: APPROVED');
        
        // Extraire le plan approuvé (ou corrigé)
        let approvedPlan = architectPlan;
        if (reviewText.includes('PLAN_CORRIGE')) {
          const planMatch = reviewText.match(/PLAN_CORRIGE:?\s*\n?([\s\S]*?)(?=\n\n|$)/i);
          if (planMatch) {
            approvedPlan = planMatch[1].trim();
          }
        } else if (reviewText.includes('PLAN_APPROUVE')) {
          const planMatch = reviewText.match(/PLAN_APPROUVE:?\s*\n?([\s\S]*?)(?=\n\n|$)/i);
          if (planMatch) {
            approvedPlan = planMatch[1].trim();
          }
        }

        setMultiAIState(prev => ({
          ...prev,
          approvedPlan,
          currentPhase: 'coder',
          steps: [
            { label: 'Analyse Architecte (Gemini)', status: 'completed', provider: 'Gemini' },
            { label: 'Revue Relecteur (Kimi)', status: 'completed', provider: 'Kimi', verdict: isApproved ? 'APPROVED' : 'REJECTED' },
            { label: 'Génération Code (Kimi)', status: 'active', provider: 'Kimi' }
          ]
        }));

        // Ajouter la revue à l'historique
        setAiConversationHistory(prev => [...prev, { 
          role: 'model', 
          text: `**[RELECTEUR KIMI]**\n\n${reviewText}`,
          isReviewer: true 
        }]);

        if (!isApproved) {
          showMessage("Plan rejeté, tentative avec corrections...", 3000);
        }

        // Phase 3: Codeur (Kimi)
        showMessage("Phase 3/3: Génération du code final...", 3000);
        const coderPromptText = generateCoderPrompt(approvedPlan, prompt, JSON.stringify(allProjectFiles), code);
        
        const coderResponse = await window.electronAPI.getKimiCompletion(
          [{ role: 'user', text: coderPromptText }],
          code,
          allProjectFiles,
          { model: 'moonshotai/Kimi-K2.5', thinkingMode: false, apiKey: apiKeys.kimi }
        );

        if (!coderResponse.success) {
          throw new Error(`Codeur: ${coderResponse.error}`);
        }

        const finalCode = coderResponse.text;

        setMultiAIState(prev => ({
          ...prev,
          currentPhase: 'completed',
          steps: [
            { label: 'Analyse Architecte (Gemini)', status: 'completed', provider: 'Gemini' },
            { label: 'Revue Relecteur (Kimi)', status: 'completed', provider: 'Kimi' },
            { label: 'Génération Code (Kimi)', status: 'completed', provider: 'Kimi' }
          ]
        }));

        // Ajouter le code final à l'historique
        setAiConversationHistory(prev => [...prev, { 
          role: 'model', 
          text: `**[CODEUR KIMI - CODE FINAL]**\n\n${finalCode}`,
          isCoder: true 
        }]);

        // Appliquer les modifications
        await processAIFileModifications(finalCode);
        await autoSaveConversation(updatedHistory.concat([{ role: 'model', text: finalCode }]));

        showMessage("Multi-IA terminé avec succès !", 4000);

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
            apiKey: apiKeys.kimi
          };

          response = await window.electronAPI.getKimiCompletion(
            updatedHistory,
            code,
            allProjectFiles,
            kimiOptions
          );
        } else {
          const geminiOptions = {
            thinkingMode,
            apiKey: apiKeys.gemini
          };

          response = await window.electronAPI.getGeminiCompletion(
            updatedHistory,
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
      console.error("Erreur IA:", error);
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
  }, [prompt, currentProjectPath, code, aiConversationHistory, isElectronApiAvailable, showMessage, aiProvider, thinkingMode]);

  // Log pour diagnostiquer
  console.log('[useAI] État actuel:', {
    hasPrompt: !!prompt,
    hasCurrentProjectPath: !!currentProjectPath,
    currentProjectPath,
    isElectronApiAvailable,
    aiProvider
  });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const processAIFileModifications = useCallback(async (aiResponse) => {
    try {
      let modificationsApplied = 0;
      
      const fileBlockRegex1 = /\*\*FICHIER:\s*([^*\n]+)\*\*\s*```([\w]*)?\s*([\s\S]*?)```/gi;
      
      let match;
      while ((match = fileBlockRegex1.exec(aiResponse)) !== null) {
        const fileName = match[1].trim();
        const fileContent = match[3].trim();
        
        if (fileName && fileContent) {
          const success = await createOrUpdateFile(fileName, fileContent);
          if (success) modificationsApplied++;
        }
      }
      
      if (modificationsApplied > 0) {
        showMessage(`${modificationsApplied} fichier(s) modifié(s) par l'IA`, 4000);
      }
    } catch (error) {
      console.error('Erreur traitement modifications IA :', error);
    }
  }, [showMessage]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const createOrUpdateFile = useCallback(async (fileName, fileContent) => {
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
            setCode(fileContent);
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
      console.error(`Erreur fichier ${fileName}:`, error);
      return false;
    }
  }, [currentProjectPath, activeFile, setCode, setActiveFile, loadProjectItems]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const checkFileExists = useCallback(async (fileName) => {
    try {
      const response = await window.electronAPI.getAllFiles(currentProjectPath);
      if (response.success) {
        return response.items.some(item => item.name === fileName && item.type === 'file');
      }
      return false;
    } catch {
      return false;
    }
  }, [currentProjectPath]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const addImageMessage = useCallback((dataUrl) => {
    if (!dataUrl) return;

    try {
      const match = typeof dataUrl === 'string'
        ? dataUrl.match(/^data:(.+);base64,/)
        : null;
      const mimeType = match ? match[1] : 'image/png';

      const newMessage = {
        role: 'user',
        text: '[Image collée]',
        images: [
          {
            type: 'inline',
            mimeType,
            dataUrl
          }
        ]
      };

      setAiConversationHistory(prev => [...prev, newMessage]);
    } catch (error) {
      console.warn('Erreur lors de l\'ajout du message image:', error);
    }
  }, []);

  const autoSaveConversation = useCallback(async (history) => {
    if (currentProjectPath && history.length >= 4) {
      try {
        const response = await window.electronAPI.saveConversation(currentProjectPath, history);
        if (response && response.success) {
          await refreshConversations();
        }
      } catch (error) {
        console.warn('Erreur sauvegarde auto:', error);
      }
    }
  }, [currentProjectPath, refreshConversations]);

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
          setAiConversationHistory(prev => [...prev, { role: 'system', text: "Modification IA annulée." }]);
          showMessage("Modification annulée.");
        }
      } catch (error) {
        showMessage(`Erreur: ${error.message}`, 5000);
      }
    }
  }, [previousCode, activeFile, currentProjectPath, setCode, showMessage]);

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
    multiAIState,
    conversations,
    activeConversationFile,
    isConversationLoading,
    startNewConversation,
    loadConversationByFile,
    stopGeneration
  };
};

export default useAI;
