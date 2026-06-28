'use strict';

const axios = require('axios');
const logger = require('../../../logger');
const { DEFAULT_GEMINI_MODEL } = require('../settings.service');
const { resolveOptionalTrustedProjectPath } = require('../../core/security');
const {
  loadAgentForCompletion,
  loadSkillForCompletion,
  loadAllGlobalSkillsForCompletion,
  formatAvailableSkillsListForPrompt,
} = require('../agent.service');
const {
  buildVisualWorkflowContextForPrompt,
  buildN8nCatalogContextForPrompt,
  pickFilesForContext,
  parseRunCommand,
  TERMINAL_CAPABILITY_PROMPT,
  FILE_EDIT_PROTOCOL,
  executeCommandForAI: defaultExecuteCommandForAI,
} = require('../ai.service');

const listGeminiModels = async (apiKey) => {
  const key = apiKey || process.env.GEMINI_API_KEY;

  if (!key) {
    return { success: false, error: "Clé API Gemini non fournie" };
  }

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;
    const response = await axios.get(url);

    if (response.data && response.data.models) {
      // Filtrer les modèles qui supportent generateContent
      const generateModels = response.data.models.filter(model =>
        model.supportedGenerationMethods &&
        model.supportedGenerationMethods.includes('generateContent')
      );

      return {
        success: true,
        models: generateModels.map(model => ({
          name: model.name.split('/').pop(),
          fullName: model.name,
          displayName: model.displayName,
          description: model.description,
          methods: model.supportedGenerationMethods
        }))
      };
    } else {
      return { success: false, error: "Aucun modèle trouvé" };
    }
  } catch (error) {
    console.error('Erreur lors de la liste des modèles Gemini:', error);
    return {
      success: false,
      error: error.response?.data?.message || error.message
    };
  }
};

const getGeminiCompletion = async ({
  history,
  currentCode,
  allProjectFiles = null,
  options = {},
  getMainWindow,
  executeCommandForAI: injectedExecuteCommandForAI,
  showErrorBox,
} = {}) => {
  const mainWindow = typeof getMainWindow === 'function' ? getMainWindow() : null;
  const executeCommandForAI = injectedExecuteCommandForAI || defaultExecuteCommandForAI;
  const showProviderError = typeof showErrorBox === 'function' ? showErrorBox : () => {};

  if (options.localOnly) {
    return { success: false, error: 'Local-only actif: Gemini interdit.', provider: 'gemini' };
  }
  const apiKey = options.apiKey || process.env.GEMINI_API_KEY; // Clé prioritaire depuis les Settings côté renderer
  const modelFromEnv = process.env.GEMINI_MODEL;
  const modelFromOptions = options.model;
  const model = modelFromOptions || modelFromEnv || DEFAULT_GEMINI_MODEL;
  const thinkingMode = !!options.thinkingMode;
  const images = Array.isArray(options.images) ? options.images : [];

  console.log('[Main] Appel Gemini: Vérification de la clé API...');
  console.log('[Main] Options reçues:', {
    hasApiKeyOption: !!options.apiKey,
    hasEnvApiKey: !!process.env.GEMINI_API_KEY,
    model,
    thinkingMode,
    hasHistory: !!history,
    historyLength: history?.length
  });

  // Vérification de la clé API
  if (!apiKey) {
    const errorMsg = "La clé API Gemini n'est pas configurée. Veuillez définir GEMINI_API_KEY dans votre environnement.";
    console.error('[Main] Erreur:', errorMsg);
    showProviderError('Erreur API Gemini', errorMsg);
    return { success: false, error: errorMsg };
  }

  console.log('[Main] Clé API Gemini détectée.');

  // Vérification de l'historique
  if (!history || !Array.isArray(history) || history.length === 0) {
    const errorMsg = "Aucun historique de conversation n'a été fourni. Impossible de traiter la requête.";
    console.error('[Main] Erreur:', errorMsg);
    return { success: false, error: errorMsg };
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const redactedUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=***`;
  console.log(`[Main] Appel à l'URL Gemini: ${redactedUrl}`);

  try {
    // Filtrer l'historique pour ne garder que les rôles valides pour l'API Gemini
    const validHistory = history.filter(msg =>
      msg &&
      typeof msg === 'object' &&
      (msg.role === 'user' || msg.role === 'model') &&
      msg.text !== undefined
    );

    if (validHistory.length === 0) {
      const errorMsg = "Aucun message valide avec les rôles 'user' ou 'model' trouvé dans l'historique.";
      console.error('[Main] Erreur:', errorMsg);
      return { success: false, error: errorMsg };
    }

    // Formatage de l'historique pour l'API Gemini
    // L'historique reçu de App.js est de la forme { role: 'user', text: '...', images?: [...] }
    // L'API Gemini attend { role: 'user', parts: [{ text: '...' }, { inline_data: { ... } }, ...] }
    const formattedHistory = validHistory.map(msg => {
      const parts = [{ text: String(msg.text) }];

      if (Array.isArray(msg.images)) {
        msg.images.forEach(img => {
          if (!img || !img.dataUrl) return;
          const match = String(img.dataUrl).match(/^data:(.+);base64,(.+)$/);
          if (!match) return;
          const mimeType = img.mimeType || match[1];
          const data = match[2];
          parts.push({
            inline_data: {
              mime_type: mimeType,
              data
            }
          });
        });
      }

      return {
        role: msg.role,
        parts
      };
    });

    // Vérifier que le dernier message est bien formaté
    const lastMessage = formattedHistory[formattedHistory.length - 1];
    if (!lastMessage || !lastMessage.parts || !lastMessage.parts[0] || !lastMessage.parts[0].text) {
      const errorMsg = "Le dernier message de l'historique est mal formaté.";
      console.error('[Main] Erreur:', errorMsg, 'Dernier message:', lastMessage);
      return { success: false, error: errorMsg };
    }

    const projectPath = await resolveOptionalTrustedProjectPath(options.projectPath);

    // Construire le contexte du projet si disponible
    let projectContext = '';
    if (allProjectFiles && allProjectFiles.files) {
      projectContext = '\n--- CONTEXTE COMPLET DU PROJET ---\n';
      const fileEntries = Object.entries(allProjectFiles.files);

      // Limiter le nombre de fichiers pour éviter de dépasser les limites de l'API
      const maxFiles = 20;
      const filesToShow = pickFilesForContext(allProjectFiles.files, maxFiles);

      for (const [filePath, fileData] of filesToShow) {
        projectContext += `\n=== FICHIER: ${filePath} ===\n`;
        if (fileData.content && !fileData.content.startsWith('[')) {
          // Limiter la taille du contenu pour chaque fichier
          const maxContentLength = 2000;
          const content = fileData.content.length > maxContentLength
            ? fileData.content.substring(0, maxContentLength) + '\n[...CONTENU TRONQUÉ...]'
            : fileData.content;
          projectContext += content;
        } else {
          projectContext += fileData.content || '[Contenu non disponible]';
        }
        projectContext += '\n=== FIN FICHIER ===\n';
      }

      if (fileEntries.length > maxFiles) {
        projectContext += `\n[...ET ${fileEntries.length - maxFiles} AUTRES FICHIERS]\n`;
      }
      projectContext += '--- FIN CONTEXTE PROJET ---\n';
    }

    const agentPrompt = await loadAgentForCompletion(options.agent, projectPath);
    // Replace single skill loading with all global skills
    const globalSkillsContent = await loadAllGlobalSkillsForCompletion();
    const selectedSkill = await loadSkillForCompletion(options.skill, projectPath);
    const visualWorkflowContext = await buildVisualWorkflowContextForPrompt(projectPath, lastMessage.parts?.[0]?.text || '', options);
    const n8nCatalogContext = await buildN8nCatalogContextForPrompt(lastMessage.parts?.[0]?.text || '', options);

    const agentContext = agentPrompt
      ? `\n--- AGENT PERSONA (${agentPrompt.name}) ---\n${agentPrompt.body}\n--- FIN AGENT ---\n`
      : '';

    const skillContext = [
      globalSkillsContent
        ? `\n--- SKILLS GLOBAUX INSTALLÉS ---\n${globalSkillsContent}\n--- FIN SKILLS GLOBAUX ---\n`
        : '',
      selectedSkill
        ? `\n--- SKILL SELECTIONNÉ (${selectedSkill.name}) ---\n${selectedSkill.content}\n--- FIN SKILL SELECTIONNÉ ---\n`
        : '',
      formatAvailableSkillsListForPrompt(options.skillsContent)
    ].filter(Boolean).join('\n');

    const thinkingInstructionsGemini = thinkingMode
      ? `
      MODE THINKING ACTIVÉ :
      - Détaillez explicitement votre raisonnement étape par étape.
      - Justifiez les choix techniques avant de montrer le code final.
      `
      : '';

    // Le prompt est construit ici dans le processus principal
    const prompt = `
      Vous êtes un assistant de développement expert et autonome, comme Cascade AI.
      ${agentContext}
      ${skillContext}
      ${projectContext}
      ${visualWorkflowContext}
      ${n8nCatalogContext}
      
      FICHIER ACTUELLEMENT OUVERT :
      --- CODE ACTUEL ---
      ${currentCode || 'Aucun code fourni'}
      ---
      
      DEMANDE DE L'UTILISATEUR :
      ${lastMessage.parts[0].text}

      ${thinkingInstructionsGemini}

      ${TERMINAL_CAPABILITY_PROMPT}

      INSTRUCTIONS POUR AGIR COMME UN AGENT AUTONOME :
      
      1. **ANALYSE COMPLÈTE** :
         - Analysez le contexte complet du projet
         - Identifiez les patterns, l'architecture, et les dépendances
         - Comprenez l'intention derrière la demande
      
      ${FILE_EDIT_PROTOCOL}

      3. **ACTIONS AUTONOMES** :
         - Corrigez automatiquement les erreurs détectées
         - Ajoutez les imports/dépendances nécessaires
         - Optimisez le code selon les meilleures pratiques
         - Créez de nouveaux fichiers si nécessaire
      
      4. **COMMUNICATION CLAIRE** :
         - Expliquez brièvement ce que vous faites
         - Mentionnez les améliorations apportées
         - Signalez les points d'attention
      
      5. **FORMATS SUPPORTÉS** :
         - JavaScript/TypeScript: \`\`\`javascript ou \`\`\`typescript
         - HTML: \`\`\`html
         - CSS: \`\`\`css
         - Python: \`\`\`python
         - JSON: \`\`\`json
         - Markdown: \`\`\`markdown
      
      AGISSEZ COMME UN DÉVELOPPEUR EXPERT QUI COMPREND LE CONTEXTE ET FAIT DES MODIFICATIONS INTELLIGENTES.
    `;

    // Les contenus à envoyer à l'API incluent l'historique formaté (sauf la dernière requête qui est dans le prompt)
    const inlineImageParts = (Array.isArray(images) ? images : [])
      .map(img => {
        if (!img || !img.dataUrl) return null;
        const match = String(img.dataUrl).match(/^data:(.+);base64,(.+)$/);
        if (!match) return null;
        const mimeType = img.mimeType || match[1];
        const data = match[2];
        return {
          inline_data: {
            mime_type: mimeType,
            data
          }
        };
      })
      .filter(Boolean);

    const finalUserParts = [
      { text: prompt },
      ...inlineImageParts
    ];

    const buildGeminiContents = (extraMessages = []) => [
      ...formattedHistory.slice(0, -1),
      { role: 'user', parts: finalUserParts },
      ...extraMessages
    ];

    logger.info('[Gemini Agent API] Création du prompt et appel du modèle...');

    try {
      const geminiCallWithContents = async (contents) => {
        const resp = await axios.post(url, { contents });
        if (resp.data?.candidates?.[0]?.content?.parts?.[0]?.text === undefined) {
          throw new Error("Réponse de l'API Gemini mal formatée");
        }
        return resp.data.candidates[0].content.parts[0].text;
      };

      // ReAct agent loop — max 8 iterations
      let contents = buildGeminiContents();
      let fullTranscript = '';
      const MAX_ITERATIONS = 8;

      for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
        logger.info(`[Gemini Agent API] Itération ReAct ${iter + 1}/${MAX_ITERATIONS}...`);
        const aiText = await geminiCallWithContents(contents);
        logger.info(`[Gemini Agent API] Réponse de l'IA (Itération ${iter + 1}):\n${aiText}`);

        fullTranscript += (iter > 0 ? '\n\n---\n\n' : '') + aiText;

        const cmd = parseRunCommand(aiText);
        if (!cmd) {
          return { success: true, text: fullTranscript, terminalActions: iter };
        }

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('ai-terminal-action', { command: cmd, iteration: iter + 1 });
        }

        const { output } = await executeCommandForAI(cmd, projectPath);

        // Append model response and new tool result
        contents = [
          ...contents,
          { role: 'model', parts: [{ text: aiText }] },
          { role: 'user', parts: [{ text: `[RÉSULTAT TERMINAL — itération ${iter + 1}]\n\`\`\`\n${output}\n\`\`\`\nContinue si nécessaire. Si tu as terminé, réponds sans balise <run_command>.` }] }
        ];

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('ai-terminal-result', { command: cmd, output, iteration: iter + 1 });
        }
      }

      return { success: true, text: fullTranscript, terminalActions: MAX_ITERATIONS };

    } catch (error) {
      if (error.response && error.response.status === 429) {
        const errorMsg = "Limite de requêtes atteinte (Quota API Gemini épuisé ou trop de requêtes rapides). Veuillez patienter quelques instants avant de réessayer.";
        logger.error('[Gemini Agent API] Erreur 429 Rate Limit:', error.response.data);
        showProviderError('Erreur API Gemini (Trop de requêtes)', errorMsg);
        return { success: false, error: 'Rate limit (429)' };
      }

      logger.error("[Gemini Agent API] Erreur lors de l'appel à l'API Gemini:", error.response ? error.response.data : error.message);
      showProviderError('Erreur API Gemini', `Erreur lors de l'appel à l'API Gemini: ${error.message}.`);
      return { success: false, error: error.message };
    }
  } catch (error) {
    // Gestion des erreurs globales de la fonction
    const errorMsg = `Erreur inattendue: ${error.message || 'Erreur inconnue'}`;
    console.error('[Main]', errorMsg, error);
    showProviderError('Erreur', errorMsg);
    return { success: false, error: errorMsg };
  }
};

module.exports = { listGeminiModels, getGeminiCompletion };
