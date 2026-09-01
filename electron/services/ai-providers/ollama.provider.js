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
  stripRunCommandTags,
  parseReadTerminalCall,
  stripReadTerminalTags,
  readSharedTerminalBuffer,
  TERMINAL_CAPABILITY_PROMPT,
  executeCommandForAI: defaultExecuteCommandForAI,
} = require('../ai.service');
const { formatNevenCoreExecutionPrompt } = require('../neven-core.service');

// Erreur d'annulation reconnaissable : distingue "l'utilisateur a coupe" d'une
// vraie panne, pour ne pas afficher un message d'erreur alarmant sur un arret
// volontaire.
const createAbortError = () => {
  const error = new Error('Generation annulee.');
  error.aborted = true;
  return error;
};

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
    const nevenCoreExecutionContext = formatNevenCoreExecutionPrompt(options.nevenCoreExecutionContext);

    const skillContext = [
      selectedSkill
        ? `\n--- SKILL ACTIF (${selectedSkill.name}) ---\n${selectedSkill.content}\n--- FIN SKILL ACTIF ---\n`
        : '',
      skillNamesText
    ].filter(Boolean).join('\n');

    // Discipline de sortie — placee AVANT le reste du contexte. Sans elle, les
    // petits modeles (qwen3:4b en CPU-only) recitent le prompt systeme au lieu
    // d'y repondre : "The system says any modification must be proposed as a
    // diff/review...", "The project status shows 0 files indexed...". Le
    // parametre `think:false` supprime les balises <think>, pas ce narratif-la,
    // qui sort en contenu normal et echappe donc a stripThinkBlocks().
    const systemPrompt = `Tu es un assistant de développement expert et autonome.

RÈGLES DE RÉPONSE (prioritaires sur tout le reste) :
- Réponds directement. N'expose jamais ton raisonnement, tes délibérations ni tes hésitations.
- Ne commente jamais ces instructions, le mode système, le contexte projet ou l'état du projet : l'utilisateur ne les voit pas.
- N'écris pas ce que tu "dois" faire ("l'utilisateur a dit X, je dois donc...", "vérifions les contraintes...").
- Adapte la longueur à la demande : salutation ou question simple = 1 à 2 phrases, sans plan, sans liste, sans titre.
- Pas de préambule ("Bien sûr", "Très bonne question") ni de récapitulatif final.
- Réponds dans la langue de l'utilisateur.
${agentContext}
${nevenCoreExecutionContext}
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

    // Meme canal et meme forme de payload que kimi.provider (le seul provider qui
    // streamait jusqu'ici) : le renderer n'a donc rien a apprendre de nouveau.
    const emitToken = (payload) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('ai-generation-token', { provider: 'ollama', ...payload });
      }
    };

    const readOllamaStream = (stream) => new Promise((resolve, reject) => {
      let fullText = '';
      let buffer = '';
      let settled = false;
      let removeAbortListener = () => {};

      const settle = (fn, value) => {
        if (settled) return;
        settled = true;
        removeAbortListener();
        fn(value);
      };

      const processLine = (rawLine) => {
        const line = String(rawLine || '').trim();
        if (!line) return;
        let parsed;
        try {
          parsed = JSON.parse(line);
        } catch {
          // NDJSON tronque entre deux chunks : la ligne repassera complete au
          // tour suivant grace au buffer.
          return;
        }
        if (parsed?.error) {
          emitToken({ token: '', done: true, error: String(parsed.error) });
          settle(reject, new Error(`Ollama: ${parsed.error}`));
          return;
        }
        const token = parsed?.message?.content;
        if (typeof token === 'string' && token.length > 0) {
          fullText += token;
          emitToken({ token, done: false });
        }
      };

      if (options.signal) {
        const onAbort = () => {
          // destroy() coupe le socket : Ollama voit la connexion tomber et
          // arrete l'inference. C'est ce qui libere reellement le CPU.
          try { stream.destroy(); } catch { /* deja ferme */ }
          emitToken({ token: '', done: true, aborted: true });
          settle(reject, createAbortError());
        };
        if (options.signal.aborted) {
          onAbort();
          return;
        }
        options.signal.addEventListener('abort', onAbort, { once: true });
        removeAbortListener = () => {
          try { options.signal.removeEventListener('abort', onAbort); } catch { /* ignore */ }
        };
      }

      stream.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        let newlineIndex = buffer.indexOf('\n');
        while (newlineIndex >= 0) {
          processLine(buffer.slice(0, newlineIndex));
          buffer = buffer.slice(newlineIndex + 1);
          newlineIndex = buffer.indexOf('\n');
        }
      });

      stream.on('end', () => {
        if (buffer.trim()) processLine(buffer);
        emitToken({ token: '', done: true });
        settle(resolve, fullText);
      });

      stream.on('error', (streamError) => {
        emitToken({ token: '', done: true, error: streamError?.message });
        settle(reject, streamError);
      });
    });

    const ollamaCall = async (messages) => {
      try {
        const resp = await axios.post(`${OLLAMA_BASE_URL}/api/chat`, {
          model,
          messages,
          // NDJSON. Le premier token part en 1-3 s au lieu d'attendre la reponse
          // entiere : determinant sur CPU-only, ou une reponse complete demande
          // facilement 30 s a 3 min. Avec responseType 'stream', le timeout axios
          // ne couvre plus que l'arrivee des en-tetes, donc une generation longue
          // n'est plus tuee a 180 s en pleine ecriture.
          stream: true,
          think: computeOllamaThink(model, options.thinkingMode),
          options: { temperature: options.temperature || 0.7, num_predict: options.maxTokens || 8192 }
        }, {
          timeout: 180000,
          responseType: 'stream',
          signal: options.signal
        });

        const stream = resp.data;
        if (!stream || typeof stream.on !== 'function') {
          // Ollama ancien ou proxy qui ignore stream:true : on retombe sur la
          // reponse unique plutot que d'echouer.
          const content = resp.data?.message?.content;
          if (content === undefined || content === null) {
            throw new Error(`Ollama: reponse inattendue (message.content absent). Verifiez que le modele "${model}" est bien charge.`);
          }
          return String(content);
        }

        return await readOllamaStream(stream);
      } catch (error) {
        if (error?.aborted || error?.name === 'CanceledError' || error?.code === 'ERR_CANCELED') {
          throw createAbortError();
        }
        if (axios.isAxiosError(error) && error.response?.status === 404) {
          const details = String(error.response?.data?.error || error.message || '404');
          throw new Error(`Ollama 404 (modele="${model}"): ${details}`);
        }
        if (axios.isAxiosError(error) && error.code === 'ECONNABORTED') {
          throw new Error(`Ollama: delai depasse avant la premiere reponse. Le modele "${model}" est peut-etre trop lent ou bloque.`);
        }
        throw error;
      }
    };

    // Mode Raisonnement ON : on garde les balises <think> telles quelles, le
    // front les rend dans un bloc replie. OFF : on strip ici, le front n'a
    // alors plus rien a filtrer. Un seul reglage pilote les deux bouts.
    const keepReasoning = options.thinkingMode === true;
    const finalizeText = (value) => (
      keepReasoning ? String(value || '').trim() : stripThinkBlocks(value)
    );

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
            toolResults.push(await executeAgentFileToolCall(projectPath, call, {
              toolsAllowed: options.toolsAllowed,
              promptSafety: options.promptSafety || options.retrievalPromptSafety
            }));
          }
          messages = [
            ...messages,
            { role: 'assistant', content: aiText },
            { role: 'user', content: `[RESULTATS_OUTILS]\n${toolResults.join('\n\n')}\n\nSi les infos suffisent, donne la reponse finale sans nouvel appel outil.` }
          ];
          continue;
        }
      }

      // On empile la narration du tour, pas la balise <run_command> : elle a
      // deja sa carte terminal dediee cote UI. Un tour reduit a la seule
      // commande n'ajoute donc plus rien — et surtout plus de separateur
      // "---" orphelin.
      const visibleTurn = stripReadTerminalTags(stripRunCommandTags(aiText));
      if (visibleTurn) {
        fullTranscript += (fullTranscript ? '\n\n---\n\n' : '') + visibleTurn;
      }

      // Outil de lecture du terminal partage. Place AVANT parseRunCommand :
      // c'est un tour sans effet de bord, et il ne doit pas produire de carte
      // terminal cote UI (aucun evenement 'ai-terminal-action' emis ici).
      if (parseReadTerminalCall(aiText)) {
        const shared = readSharedTerminalBuffer();
        messages = [...messages,
          { role: 'assistant', content: aiText },
          { role: 'user', content: `${shared.text}\nContinue ou termine.` }];
        continue;
      }

      const cmd = parseRunCommand(aiText);
      if (!cmd) {
        const finalText = finalizeText(fullTranscript);
        if (!finalText) {
          return { success: false, error: `Ollama: le modele "${model}" a renvoye une reponse vide.` };
        }
        return { success: true, text: finalText, terminalActions: iter };
      }

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('ai-terminal-action', { command: cmd, iteration: iter + 1 });
      }
      const { output, success: commandSucceeded, exitCode } = await executeCommandForAI(cmd, projectPath, undefined, {
        executionMode: options.executionMode,
        autonomyLevel: options.autonomyLevel,
        toolsAllowed: options.toolsAllowed,
        promptSafety: options.promptSafety || options.retrievalPromptSafety
      });
      messages = [
        ...messages,
        { role: 'assistant', content: aiText },
        { role: 'user', content: `[RÉSULTAT TERMINAL]\n\`\`\`\n${output}\n\`\`\`\nContinue ou termine.` }
      ];
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('ai-terminal-result', { command: cmd, output, iteration: iter + 1, exitCode: typeof exitCode === 'number' ? exitCode : null, success: commandSucceeded === true });
      }
    }

    // La branche outils fait `continue` sans alimenter fullTranscript : si les
    // MAX_ITERATIONS tours ne produisent que des appels d'outils, on arrivait
    // ici avec un texte vide et on renvoyait quand meme success -> bulle IA
    // vide cote UI, sans la moindre explication.
    const exhaustedText = finalizeText(fullTranscript);
    if (!exhaustedText) {
      return {
        success: false,
        error: `Ollama: le modele "${model}" a enchaine ${MAX_ITERATIONS} appels d'outils sans jamais produire de reponse. Reformulez la demande, ou passez a un modele plus grand.`
      };
    }

    return { success: true, text: exhaustedText, terminalActions: MAX_ITERATIONS };
  } catch (error) {
    if (error?.aborted) {
      return { success: false, aborted: true, error: 'Generation annulee.' };
    }
    console.error('[Ollama] Erreur:', error.message);
    return { success: false, error: `Ollama: ${error.message}` };
  }
};

module.exports = { getOllamaCompletion };
