'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const logger = require('../../../logger');
const { DEFAULT_CLAUDE_MODEL } = require('../settings.service');
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
  executeCommandForAI: defaultExecuteCommandForAI,
} = require('../ai.service');

const getClaudeCompletion = async ({
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
    return { success: false, error: 'Local-only actif: Claude interdit.', provider: 'claude' };
  }
  const apiKey = options.apiKey || process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY;
  const modelFromEnv = process.env.CLAUDE_MODEL;
  const model = options.model || modelFromEnv || DEFAULT_CLAUDE_MODEL;
  const thinkingMode = !!options.thinkingMode;
  const images = Array.isArray(options.images) ? options.images : [];

  console.log(`[Main] Appel Claude (${model}): Vérification de la clé API...`);

  if (!apiKey) {
    const errorMsg = "La clé API Claude n'est pas configurée. Veuillez définir CLAUDE_API_KEY dans votre environnement ou les paramètres.";
    console.error('[Main][Claude] Erreur:', errorMsg);
    showProviderError('Erreur API Claude', errorMsg);
    return { success: false, error: errorMsg };
  }

  if (!history || !Array.isArray(history) || history.length === 0) {
    const errorMsg = "Aucun historique de conversation n'a été fourni pour Claude.";
    console.error('[Main][Claude] Erreur:', errorMsg);
    return { success: false, error: errorMsg };
  }

  try {
    const validHistory = history.filter(msg =>
      msg && typeof msg === 'object' && msg.text !== undefined
    );

    if (validHistory.length === 0) {
      return { success: false, error: "Aucun message valide trouvé." };
    }

    const projectPath = await resolveOptionalTrustedProjectPath(options.projectPath);
    const lastUserText = String(validHistory[validHistory.length - 1]?.text || '');
    let projectContext = '';
    if (allProjectFiles && allProjectFiles.files) {
      projectContext = '\n--- CONTEXTE COMPLET DU PROJET ---\n';
      const fileEntries = Object.entries(allProjectFiles.files);
      const maxFiles = 20;
      const filesToShow = pickFilesForContext(allProjectFiles.files, maxFiles);

      for (const [filePath, fileData] of filesToShow) {
        projectContext += `\n=== FICHIER: ${filePath} ===\n`;
        if (fileData.content && !String(fileData.content).startsWith('[')) {
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
    const globalSkillsContent = await loadAllGlobalSkillsForCompletion();
    const selectedSkill = await loadSkillForCompletion(options.skill, projectPath);
    const visualWorkflowContext = await buildVisualWorkflowContextForPrompt(projectPath, lastUserText, options);
    const n8nCatalogContext = await buildN8nCatalogContextForPrompt(lastUserText, options);

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

    const thinkingInstructions = thinkingMode
      ? `\nMODE THINKING ACTIVÉ : Détaillez explicitement votre raisonnement étape par étape dans des balises <thinking> avant de proposer le code final.\n`
      : '';

    const systemPrompt = `
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
      
      ${thinkingInstructions}
      ${TERMINAL_CAPABILITY_PROMPT}
      
      INSTRUCTIONS POUR AGIR COMME UN AGENT AUTONOME :
      1. **ANALYSE COMPLÈTE** : Analysez le contexte complet du projet
      2. **MODIFICATIONS PRÉCISES** : Pour chaque fichier à modifier, utilisez ce format strict :
         **FICHIER: nom_du_fichier.ext**
         \`\`\`langage
         // Code complet du fichier avec vos modifications
         \`\`\`
      3. **ACTIONS AUTONOMES** : Utilisez <run_command> pour interagir avec le terminal si besoin.
    `;

    const anthropic = new Anthropic({ apiKey });

    // Convert history to Anthropic format
    const messages = validHistory.map((msg, index) => {
      // Anthropic requires alternating user/assistant messages, starting with user.
      // For simplicity in this implementation, we map roles directly but keep in mind consecutive roles might need merging in production
      let role = msg.role === 'model' ? 'assistant' : 'user';
      let content = [];

      content.push({ type: 'text', text: String(msg.text) });

      if (msg.images && Array.isArray(msg.images)) {
        msg.images.forEach(img => {
          if (!img || !img.dataUrl) return;
          const match = String(img.dataUrl).match(/^data:(image\/[^;]+);base64,(.+)$/);
          if (match) {
            content.push({
              type: 'image',
              source: {
                type: 'base64',
                media_type: match[1],
                data: match[2],
              }
            });
          }
        });
      }
      return { role, content };
    });

    // Enforce role alternating for Anthropic API
    let mergedMessages = [];
    for (const msg of messages) {
      if (mergedMessages.length > 0 && mergedMessages[mergedMessages.length - 1].role === msg.role) {
        // Merge content
        mergedMessages[mergedMessages.length - 1].content = [
          ...mergedMessages[mergedMessages.length - 1].content,
          { type: 'text', text: '\n\n' },
          ...msg.content
        ];
      } else {
        mergedMessages.push(msg);
      }
    }

    // Anthropic API requires first message to be role 'user'
    if (mergedMessages.length > 0 && mergedMessages[0].role !== 'user') {
      mergedMessages.unshift({ role: 'user', content: [{ type: 'text', text: '(Contexte initial)' }] });
    }

    logger.info(`[Claude Agent API] Création du prompt et appel du modèle ${model}...`);

    const claudeCallWithMessages = async (msgs) => {
      const response = await anthropic.messages.create({
        model: model,
        max_tokens: options.maxTokens || 4096,
        temperature: options.temperature || 0.7,
        system: systemPrompt,
        messages: msgs
      });
      return response.content[0].text;
    };

    const MAX_ITERATIONS = 8;
    let fullTranscript = '';
    let currentMessages = [...mergedMessages];

    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      logger.info(`[Claude Agent API] Itération ReAct ${iter + 1}/${MAX_ITERATIONS}...`);
      const aiText = await claudeCallWithMessages(currentMessages);
      logger.info(`[Claude Agent API] Réponse de l'IA (Itération ${iter + 1}):\n${aiText}`);

      fullTranscript += (iter > 0 ? '\n\n---\n\n' : '') + aiText;

      const cmd = parseRunCommand(aiText);
      if (!cmd) {
        return { success: true, text: fullTranscript, terminalActions: iter };
      }

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('ai-terminal-action', { command: cmd, iteration: iter + 1 });
      }

      const { output } = await executeCommandForAI(cmd, projectPath);

      currentMessages = [
        ...currentMessages,
        { role: 'assistant', content: [{ type: 'text', text: aiText }] },
        { role: 'user', content: [{ type: 'text', text: `[RÉSULTAT TERMINAL — itération ${iter + 1}]\n\`\`\`\n${output}\n\`\`\`\nContinue si nécessaire. Si tu as terminé, réponds sans balise <run_command>.` }] }
      ];

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('ai-terminal-result', { command: cmd, output, iteration: iter + 1 });
      }
    }

    return { success: true, text: fullTranscript, terminalActions: MAX_ITERATIONS };

  } catch (error) {
    if (error.status === 429) {
      const errorMsg = "Limite de requêtes atteinte (Quota API Anthropic/Claude épuisé ou trop de requêtes). Veuillez patienter quelques instants avant de réessayer.";
      logger.error('[Claude Agent API] Erreur 429 Rate Limit:', error);
      showProviderError('Erreur API Claude (Trop de requêtes)', errorMsg);
      return { success: false, error: 'Rate limit (429)' };
    }
    logger.error("[Claude Agent API] Erreur API:", error);
    showProviderError('Erreur API Claude', `Erreur lors de l'appel à l'API Claude: ${error.message}.`);
    return { success: false, error: error.message };
  }
};

module.exports = { getClaudeCompletion };
