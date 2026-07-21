'use strict';

const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const axios = require('axios');
const {
  resolveOptionalTrustedProjectPath,
  safeResolvePath,
  AGENT_MAX_FILE_BYTES,
  AGENT_MAX_LINES_PER_CALL,
  AGENT_MAX_TOOL_CALLS,
  AGENT_TOOL_MAX_ROUNDS,
  isLikelyBinary,
  formatToolError,
  validateAgentFileAccess,
  readAgentFileWithLimits,
  readAgentLinesWithLimits,
  parseAgentToolCalls,
  AGENT_FILE_TOOL_CONTRACT,
  executeAgentFileToolCall,
  buildProjectIndexContext,
} = require('../../core/security');
const {
  OLLAMA_BASE_URL,
  DEFAULT_OLLAMA_MODEL,
  OLLAMA_STREAM_RESPONSE_TIMEOUT_MS,
  OLLAMA_STREAM_INACTIVITY_TIMEOUT_MS,
  FALLBACK_OLLAMA_MODEL_CANDIDATES,
  normalizeOllamaModelName,
  computeOllamaThink,
  stripThinkBlocks,
  fetchOllamaTags,
  startOllamaServerIfPossible,
  extractOllamaModelNames,
  pickInstalledOllamaModel,
} = require('../ollama.service');
const {
  getGlobalSkillsDir,
  getWorkspaceSkillsDir,
  loadAgentForCompletion,
  loadSkillForCompletion,
  safeFileBase,
  formatAvailableSkillsListForPrompt,
} = require('../agent.service');
const {
  buildVisualWorkflowContextForPrompt,
  buildN8nCatalogContextForPrompt,
  getVisualWorkflowIndex,
  readVisualWorkflowById,
  parseRunCommand,
  TERMINAL_CAPABILITY_PROMPT,
  executeCommandForAI: defaultExecuteCommandForAI,
} = require('../ai.service');

const getOllamaCompletion = async ({
  history,
  currentCode,
  allProjectFiles = null,
  options = {},
  getMainWindow,
  executeCommandForAI: injectedExecuteCommandForAI,
} = {}) => {
  const mainWindow = typeof getMainWindow === 'function' ? getMainWindow() : null;
  const executeCommandForAI = injectedExecuteCommandForAI || defaultExecuteCommandForAI;

  const requestedModel = normalizeOllamaModelName(options.model || process.env.OLLAMA_MODEL);

  if (!history || !Array.isArray(history) || history.length === 0) {
    return { success: false, error: "Aucun historique fourni pour Ollama." };
  }

  try {
    const projectPath = await resolveOptionalTrustedProjectPath(options.projectPath);
    let model = requestedModel;
    let installedModelNames = [];
    try {
      const startResult = await startOllamaServerIfPossible();
      if (!startResult.success) {
        throw new Error(startResult.error || 'Ollama indisponible.');
      }
      const tagsResponse = await fetchOllamaTags(OLLAMA_BASE_URL, 5000);
      installedModelNames = extractOllamaModelNames(tagsResponse?.data);
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return {
          success: false,
          error: `Ollama: endpoint introuvable (${OLLAMA_BASE_URL}/api/tags -> 404). Verifiez OLLAMA_URL.`
        };
      }
      return {
        success: false,
        error: `Ollama: impossible de joindre Ollama (${OLLAMA_BASE_URL}). ${error.message}`
      };
    }

    if (!Array.isArray(installedModelNames) || installedModelNames.length === 0) {
      return {
        success: false,
        error: `Ollama: aucun modele installe. Lancez par exemple: ollama pull ${DEFAULT_OLLAMA_MODEL}`
      };
    }

    model = pickInstalledOllamaModel(requestedModel, installedModelNames, FALLBACK_OLLAMA_MODEL_CANDIDATES);
    if (!model) {
      return {
        success: false,
        error: 'Ollama: aucun modele installe compatible avec la configuration courante.'
      };
    }

    // Cap history to last 10 messages to avoid overflowing small local models
    const validHistory = history
      .filter(msg => msg && typeof msg === 'object' && msg.text !== undefined)
      .slice(-10);
    if (validHistory.length === 0) return { success: false, error: "Historique vide pour Ollama." };

    const lastMessage = validHistory[validHistory.length - 1];
    const lastUserText = String(lastMessage.text || '');
    if (!lastUserText.trim()) return { success: false, error: "Dernier message utilisateur vide pour Ollama." };

    // Contexte A LA DEMANDE : on injecte un INDEX leger (chemins + tailles, pas le
    // contenu complet) ; l'agent lit les fichiers utiles via read_file/read_lines.
    // Fini le bourrage de 15 fichiers tronques dans chaque prompt.
    const hasProjectTools = !!projectPath && !!allProjectFiles?.files;
    const projectContext = hasProjectTools ? buildProjectIndexContext(allProjectFiles) : '';
    const toolContract = hasProjectTools ? `\n${AGENT_FILE_TOOL_CONTRACT}\n` : '';
    const agentPrompt = await loadAgentForCompletion(options.agent, projectPath);
    // Skill selectionne : charge le contenu complet (choix explicite de l'utilisateur).
    const selectedSkill = await loadSkillForCompletion(options.skill, projectPath);
    // Skills globaux : noms seulement — l'agent lit le contenu via outil si besoin.
    // (Meme logique que Multi-Ollama : on ne bourre pas le prompt avec tout le contenu.)
    const skillNamesText = formatAvailableSkillsListForPrompt(options.skillsContent);
    // Workflows et n8n : charger seulement si l'intention est detectee dans la question.
    const visualWorkflowContext = await buildVisualWorkflowContextForPrompt(projectPath, lastUserText, options);
    const n8nCatalogContext = await buildN8nCatalogContextForPrompt(lastUserText, options);

    const agentContext = agentPrompt
      ? `\n--- AGENT PERSONA (${agentPrompt.name}) ---\n${agentPrompt.body}\n--- FIN AGENT ---\n`
      : '';

    const skillContext = [
      selectedSkill
        ? `\n--- SKILL ACTIF (${selectedSkill.name}) ---\n${selectedSkill.content}\n--- FIN SKILL ACTIF ---\n`
        : '',
      skillNamesText
    ].filter(Boolean).join('\n');

    const systemPrompt = `Tu es un assistant de développement expert et autonome.
${agentContext}
${skillContext}
${projectContext}
${toolContract}
${visualWorkflowContext}
${n8nCatalogContext}
FICHIER OUVERT: ${currentCode ? currentCode.substring(0, 2000) : 'Aucun'}

${TERMINAL_CAPABILITY_PROMPT}

Pour modifier des fichiers, utilise: **FICHIER: nom.ext** \`\`\`langage\n// code complet\n\`\`\``;

    const buildOllamaMessages = (baseHistory, userPrompt) => {
      const msgs = [{ role: 'system', content: systemPrompt }];
      baseHistory.slice(0, -1).forEach(msg => {
        if (msg.role === 'model') msgs.push({ role: 'assistant', content: String(msg.text) });
        else if (msg.role === 'user') msgs.push({ role: 'user', content: String(msg.text) });
      });
      msgs.push({ role: 'user', content: userPrompt });
      return msgs;
    };

    const ollamaCall = async (messages) => {
      try {
        const resp = await axios.post(`${OLLAMA_BASE_URL}/api/chat`, {
          model,
          messages,
          stream: false, // IMPORTANT: must be false to get a single JSON response, not a stream
          think: computeOllamaThink(model, options.thinkingMode),
          options: { temperature: options.temperature || 0.7, num_predict: options.maxTokens || 8192 }
        }, { timeout: 180000 }); // 3-minute timeout for large local models
        const content = resp.data?.message?.content;
        if (content === undefined || content === null) {
          throw new Error(`Ollama: reponse inattendue (message.content absent). Verifiez que le modele "${model}" est bien charge.`);
        }
        return String(content);
      } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 404) {
          const details = String(error.response?.data?.error || error.message || '404');
          throw new Error(`Ollama 404 (modele="${model}"): ${details}`);
        }
        if (axios.isAxiosError(error) && error.code === 'ECONNABORTED') {
          throw new Error(`Ollama: timeout apres 3 minutes. Le modele "${model}" est peut-etre trop lent ou bloque.`);
        }
        throw error;
      }
    };

    let messages = buildOllamaMessages(validHistory, String(lastMessage.text));
    let fullTranscript = '';
    const MAX_ITERATIONS = 8;

    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      const aiText = await ollamaCall(messages);

      // Outils a la demande (lecture fichiers) : prioritaire, et on ne pollue PAS
      // la reponse finale avec les tours d'outils (balises + resultats).
      if (hasProjectTools) {
        const toolCalls = parseAgentToolCalls(aiText);
        if (toolCalls.length > 0) {
          const toolResults = [];
          for (const call of toolCalls.slice(0, AGENT_MAX_TOOL_CALLS)) {
            // eslint-disable-next-line no-await-in-loop
            toolResults.push(await executeAgentFileToolCall(projectPath, call));
          }
          messages = [
            ...messages,
            { role: 'assistant', content: aiText },
            { role: 'user', content: `[RESULTATS_OUTILS]\n${toolResults.join('\n\n')}\n\nSi les infos suffisent, donne la reponse finale sans nouvel appel outil.` }
          ];
          continue;
        }
      }

      fullTranscript += (fullTranscript ? '\n\n---\n\n' : '') + aiText;

      const cmd = parseRunCommand(aiText);
      if (!cmd) return { success: true, text: stripThinkBlocks(fullTranscript), terminalActions: iter };

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('ai-terminal-action', { command: cmd, iteration: iter + 1 });
      }
      const { output } = await executeCommandForAI(cmd, projectPath);
      messages = [
        ...messages,
        { role: 'assistant', content: aiText },
        { role: 'user', content: `[RÉSULTAT TERMINAL]\n\`\`\`\n${output}\n\`\`\`\nContinue ou termine.` }
      ];
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('ai-terminal-result', { command: cmd, output, iteration: iter + 1 });
      }
    }

    return { success: true, text: stripThinkBlocks(fullTranscript), terminalActions: MAX_ITERATIONS };
  } catch (error) {
    console.error('[Ollama] Erreur:', error.message);
    return { success: false, error: `Ollama: ${error.message}` };
  }
};

module.exports = { getOllamaCompletion };
