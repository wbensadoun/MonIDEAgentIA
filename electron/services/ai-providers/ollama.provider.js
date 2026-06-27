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
  FALLBACK_OLLAMA_ARCHITECT_MODEL_CANDIDATES,
  FALLBACK_OLLAMA_CODER_MODEL_CANDIDATES,
  FALLBACK_OLLAMA_TESTER_MODEL_CANDIDATES,
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

const getOllamaMultiCompletion = async ({
  history,
  currentCode,
  allProjectFiles = null,
  options = {},
  getMainWindow,
  executeCommandForAI: injectedExecuteCommandForAI,
} = {}) => {
  const mainWindow = typeof getMainWindow === 'function' ? getMainWindow() : null;
  const executeCommandForAI = injectedExecuteCommandForAI || defaultExecuteCommandForAI;

  try {
    const OLLAMA_BASE_URL_MULTI = process.env.OLLAMA_URL || 'http://localhost:11434';
    const fallbackModel = String(options.model || process.env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL).trim() || DEFAULT_OLLAMA_MODEL;
    const modelArchitect = String(options.modelArchitect || fallbackModel).trim() || fallbackModel;
    const modelCoder = String(options.modelCoder || fallbackModel).trim() || fallbackModel;
    const modelTester = String(options.modelTester || fallbackModel).trim() || fallbackModel;
    const retryCount = toPositiveInt(options.retryCount, 1, 0, 3);
    const trustedProjectPath = await resolveOptionalTrustedProjectPath(options.projectPath);
    if (!trustedProjectPath) {
      return { success: false, error: 'Projet autorise requis pour Ollama Multi.' };
    }
    const workspaceRoot = trustedProjectPath;

    const validHistory = Array.isArray(history) ? history : [];
    const lastMessage = validHistory[validHistory.length - 1];
    if (!lastMessage || !lastMessage.text) return { success: false, error: 'Aucune question.' };
    const userPrompt = String(lastMessage.text);

    // ── Skill names only (lightweight) ──────────────────────────
    const skillsList = Array.isArray(options.skillsContent) ? options.skillsContent : [];
    const skillNamesText = skillsList.length > 0
      ? '\nSkills disponibles: ' + skillsList.map(s => s.name).join(', ') + '\nChoisis max 5 skills pertinents.'
      : '';

    // ── Build compact project index context (no raw full files) ───────────
    const fileEntries = allProjectFiles?.files && typeof allProjectFiles.files === 'object'
      ? Object.entries(allProjectFiles.files)
      : [];
    const fileIndexLines = fileEntries.slice(0, 200).map(([filePath, fileData]) => {
      const size = Number(fileData?.size || 0);
      return `- ${filePath} (${Number.isFinite(size) ? size : 0} bytes)`;
    });
    if (fileEntries.length > fileIndexLines.length) {
      fileIndexLines.push(`- ... ${fileEntries.length - fileIndexLines.length} fichiers supplementaires`);
    }
    const projectContext = fileIndexLines.length > 0
      ? `\nINDEX PROJET (sans contenu brut):\n${fileIndexLines.join('\n')}\n`
      : '\nINDEX PROJET indisponible.\n';
    const codeCtx = currentCode ? `\nFICHIER OUVERT (extrait):\n${String(currentCode).substring(0, 2000)}` : '';
    const visualWorkflowContext = await buildVisualWorkflowContextForPrompt(trustedProjectPath, userPrompt, options);
    const n8nCatalogContext = await buildN8nCatalogContextForPrompt(userPrompt, options);
    const toolContractText = `OUTILS DISPONIBLES:
- <read_file file="chemin/relatif.ext" />
- <read_lines file="chemin/relatif.ext" start="10" end="80" />
- <list_workflows />
- <read_workflow id="workflow_id" />

REGLES OUTILS:
- Utilise uniquement des chemins relatifs au workspace.
- Extensions lues: tout fichier texte (dotfiles inclus), sauf formats binaires/media/archive courants.
- Taille max fichier: ${AGENT_MAX_FILE_BYTES} bytes
- read_lines renvoie au maximum ${AGENT_MAX_LINES_PER_CALL} lignes.
- Quand tu appelles un outil, reponds uniquement avec les balises d'outil, sans texte autour.`;

    const sendStep = (label, status, text) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('ai-multi-ollama-step', { label, status, text });
      }
    };

    let installedModelNames = [];
    try {
      const startResult = await startOllamaServerIfPossible();
      if (!startResult.success) {
        throw new Error(startResult.error || 'Ollama indisponible.');
      }
      const tagsResponse = await fetchOllamaTags(OLLAMA_BASE_URL_MULTI);
      installedModelNames = extractOllamaModelNames(tagsResponse?.data);
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return {
          success: false,
          error: `Ollama Multi: endpoint introuvable (${OLLAMA_BASE_URL_MULTI}/api/tags -> 404). Vérifiez OLLAMA_URL.`
        };
      }
      return {
        success: false,
        error: `Ollama Multi: impossible de joindre Ollama (${OLLAMA_BASE_URL_MULTI}). ${error.message}`
      };
    }

    if (!Array.isArray(installedModelNames) || installedModelNames.length === 0) {
      return {
        success: false,
        error: `Ollama Multi: aucun modele installe. Lancez par exemple: ollama pull ${DEFAULT_OLLAMA_MODEL}`
      };
    }

    const resolveRoleModel = (requestedModel, roleLabel, preferredCandidates = []) => {
      const requested = normalizeOllamaModelName(requestedModel);
      const selected = pickInstalledOllamaModel(requested, installedModelNames, preferredCandidates);
      if (!selected) {
        throw new Error(`Aucun modele valide disponible pour ${roleLabel}`);
      }
      if (requested && selected !== requested) {
        sendStep('⚙️ Model Router', 'active', `${roleLabel}: "${requested}" indisponible, fallback "${selected}"`);
      }
      return selected;
    };

    const resolvedModelArchitect = resolveRoleModel(
      modelArchitect,
      'Architecte',
      FALLBACK_OLLAMA_ARCHITECT_MODEL_CANDIDATES
    );
    const resolvedModelCoder = resolveRoleModel(
      modelCoder,
      'Codeur',
      FALLBACK_OLLAMA_CODER_MODEL_CANDIDATES
    );
    const resolvedModelTester = resolveRoleModel(
      modelTester,
      'Relecteur',
      FALLBACK_OLLAMA_TESTER_MODEL_CANDIDATES
    );

    const emitStreamingDone = (agentLabel) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('ollama-multi-token', {
          agent: agentLabel,
          token: '',
          done: true
        });
      }
    };

    // ── Streaming Ollama call: sends tokens live to frontend ─────────
    const ollamaCall = async (messages, maxTokens, agentLabel, modelName) => {
      let response;
      try {
        response = await axios.post(`${OLLAMA_BASE_URL_MULTI}/api/chat`, {
          model: modelName,
          messages,
          stream: true,
          think: computeOllamaThink(modelName, options.thinkingMode),
          options: { temperature: 0.7, num_predict: maxTokens || 2048 }
        }, {
          responseType: 'stream',
          // Timeout sur la reponse initiale (chargement modele / premiers octets).
          // Le blocage en cours de flux est gere par le watchdog d'inactivite ci-dessous.
          timeout: OLLAMA_STREAM_RESPONSE_TIMEOUT_MS
        });
      } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 404) {
          const details = String(error.response?.data?.error || error.message || '404');
          throw new Error(`Ollama 404 (${agentLabel}, modele="${modelName}"): ${details}`);
        }
        throw error;
      }

      return new Promise((resolve, reject) => {
        let fullText = '';
        let hasStarted = false;
        let settled = false;
        let doneEmitted = false;
        let buffer = '';
        let inactivityTimer = null;

        const loadWarning = setTimeout(() => {
          if (!hasStarted) {
            sendStep(`${agentLabel} ⏳ (Chargement long...)`, 'active', '');
          }
        }, 45000);

        const execWarning = setTimeout(() => {
          sendStep(`${agentLabel} ⏳ (Generation longue...)`, 'active', '');
        }, 120000);

        const cleanupTimers = () => {
          clearTimeout(loadWarning);
          clearTimeout(execWarning);
          if (inactivityTimer) clearTimeout(inactivityTimer);
        };

        // Watchdog d'inactivite: si Ollama cesse d'emettre des tokens pendant
        // OLLAMA_STREAM_INACTIVITY_TIMEOUT_MS, on rejette vraiment et on detruit le flux
        // (evite le spinner infini quand le modele se bloque en cours de generation).
        const resetWatchdog = () => {
          if (settled) return;
          if (inactivityTimer) clearTimeout(inactivityTimer);
          inactivityTimer = setTimeout(() => {
            try { response.data?.destroy?.(); } catch { /* noop */ }
            const phase = hasStarted ? 'generation' : 'chargement';
            safeReject(new Error(
              `Ollama (${agentLabel}, modele="${modelName}"): aucune reponse pendant `
              + `${Math.round(OLLAMA_STREAM_INACTIVITY_TIMEOUT_MS / 1000)}s (${phase} bloquee).`
            ));
          }, OLLAMA_STREAM_INACTIVITY_TIMEOUT_MS);
        };

        const safeResolve = (value) => {
          if (settled) return;
          settled = true;
          cleanupTimers();
          if (!doneEmitted) {
            doneEmitted = true;
            emitStreamingDone(agentLabel);
          }
          resolve(value);
        };

        const safeReject = (error) => {
          if (settled) return;
          settled = true;
          cleanupTimers();
          if (!doneEmitted) {
            doneEmitted = true;
            emitStreamingDone(agentLabel);
          }
          reject(error);
        };

        const processLine = (line) => {
          const trimmed = String(line || '').trim();
          if (!trimmed) return;

          let json;
          try {
            json = JSON.parse(trimmed);
          } catch {
            return;
          }

          const token = json?.message?.content || '';
          if (token) {
            fullText += token;
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('ollama-multi-token', {
                agent: agentLabel,
                token,
                done: false
              });
            }
          }

          if (json?.done) {
            safeResolve(fullText);
          }
        };

        response.data.on('data', (chunk) => {
          hasStarted = true;
          resetWatchdog();
          buffer += chunk.toString('utf8');
          let newlineIndex = buffer.indexOf('\n');
          while (newlineIndex >= 0) {
            const line = buffer.slice(0, newlineIndex);
            buffer = buffer.slice(newlineIndex + 1);
            processLine(line);
            newlineIndex = buffer.indexOf('\n');
          }
        });

        response.data.on('end', () => {
          if (buffer.trim()) processLine(buffer);
          safeResolve(fullText);
        });
        response.data.on('error', (err) => {
          safeReject(err);
        });

        // Arme le watchdog des le branchement (couvre aussi le silence avant le 1er token).
        resetWatchdog();
      });
    };

    const ollamaCallWithRetry = async (messages, maxTokens, agentLabel, modelName) => {
      let lastError;
      for (let attempt = 0; attempt <= retryCount; attempt += 1) {
        try {
          if (attempt > 0) {
            sendStep(agentLabel, 'active', `Retry ${attempt}/${retryCount}`);
          }
          const attemptMessages = attempt === 0
            ? messages
            : [
              ...messages,
              {
                role: 'system',
                content: "La tentative precedente a echoue. Reprends calmement, respecte strictement le format attendu et termine."
              }
            ];
          // eslint-disable-next-line no-await-in-loop
          return await ollamaCall(attemptMessages, maxTokens, agentLabel, modelName);
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError || new Error('Echec appel Ollama');
    };

    const executeToolCall = async (call) => {
      const toolName = String(call?.name || '').trim();
      const attrs = call?.attrs && typeof call.attrs === 'object' ? call.attrs : {};
      try {
        if (toolName === 'read_file') {
          const relFile = String(attrs.file || '').trim();
          if (!relFile) throw new Error('Attribut file requis');
          const resolvedInfo = safeResolvePath(workspaceRoot, relFile);
          const content = await readAgentFileWithLimits(workspaceRoot, relFile);
          return `<tool_result name="read_file" file="${resolvedInfo.relative}" status="ok">\n${content}\n</tool_result>`;
        }
        if (toolName === 'read_lines') {
          const relFile = String(attrs.file || '').trim();
          if (!relFile) throw new Error('Attribut file requis');
          const { resolvedPath, relativePath } = await validateAgentFileAccess(workspaceRoot, relFile);
          const raw = await fs.readFile(resolvedPath);
          if (isLikelyBinary(raw)) {
            throw new Error(`Fichier binaire non supporte: ${relativePath}`);
          }
          const content = raw.toString('utf8');
          const excerpt = readAgentLinesWithLimits(content, attrs.start, attrs.end, AGENT_MAX_LINES_PER_CALL);
          return `<tool_result name="read_lines" file="${relativePath}" start="${excerpt.start}" end="${excerpt.end}" total="${excerpt.total}" status="ok">\n${excerpt.content}\n</tool_result>`;
        }
        if (toolName === 'list_workflows') {
          const index = await getVisualWorkflowIndex(trustedProjectPath, 40);
          if (index.length === 0) {
            return `<tool_result name="list_workflows" status="ok">\nAucun workflow visuel trouve.\n</tool_result>`;
          }
          const lines = index.map((wf) =>
            `- id=${wf.id} | name=${wf.name} | nodes=${wf.nodes} | edges=${wf.edges}${wf.description ? ` | desc=${wf.description}` : ''}`
          );
          return `<tool_result name="list_workflows" status="ok">\n${lines.join('\n')}\n</tool_result>`;
        }
        if (toolName === 'read_workflow') {
          const workflowId = String(attrs.id || attrs.name || attrs.filename || '').trim();
          if (!workflowId) throw new Error('Attribut id requis');
          const content = await readVisualWorkflowById(trustedProjectPath, workflowId);
          return `<tool_result name="read_workflow" id="${workflowId}" status="ok">\n${content}\n</tool_result>`;
        }
        return formatToolError(toolName || 'unknown_tool', `Outil non supporte: ${toolName}`);
      } catch (error) {
        return formatToolError(toolName || 'unknown_tool', error?.message || String(error));
      }
    };

    const executeToolCalls = async (calls) => {
      const selectedCalls = Array.isArray(calls) ? calls.slice(0, AGENT_MAX_TOOL_CALLS) : [];
      const outputs = [];
      for (const call of selectedCalls) {
        // eslint-disable-next-line no-await-in-loop
        outputs.push(await executeToolCall(call));
      }
      return outputs.join('\n\n');
    };

    const runAgentWithTools = async ({ agentLabel, modelName, systemPrompt, userMessage, maxTokens }) => {
      let messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ];
      let lastResponse = '';

      for (let round = 0; round < AGENT_TOOL_MAX_ROUNDS; round += 1) {
        // eslint-disable-next-line no-await-in-loop
        const responseText = await ollamaCallWithRetry(messages, maxTokens, agentLabel, modelName);
        lastResponse = responseText;
        const toolCalls = parseAgentToolCalls(responseText);
        if (toolCalls.length === 0) return responseText;

        sendStep(agentLabel, 'active', `${toolCalls.length} outil(s), tour ${round + 1}/${AGENT_TOOL_MAX_ROUNDS}`);
        // eslint-disable-next-line no-await-in-loop
        const toolResults = await executeToolCalls(toolCalls);
        messages = [
          ...messages,
          { role: 'assistant', content: responseText },
          {
            role: 'user',
            content: `[RESULTATS_OUTILS]\n${toolResults}\n\nSi les infos suffisent, donne la reponse finale sans nouvel appel outil.`
          }
        ];
      }

      return `${lastResponse}\n\n[NOTE SYSTEME] Limite d'appels outils atteinte (${AGENT_TOOL_MAX_ROUNDS} tours).`;
    };

    // ────────── Agent 1 : Architecte (RAPIDE — 4096 tokens) ──────────
    sendStep('🏗️ Architecte', 'active', '');
    const archSystem = `Tu es un architecte logiciel senior. Sois CONCIS (max 300 mots).
${projectContext}${codeCtx}${visualWorkflowContext}${n8nCatalogContext}${skillNamesText}
${toolContractText}

REPONDS avec:
1. Plan technique en bullet points (structure fichiers, architecture, sequence)
2. Section "## Skills attribues" avec:
   - Codeur: [max 5 noms de skills]
   - Relecteur: [max 3 noms de skills]

PAS de code. PAS d'explications longues. Juste le plan.`;

    const archPlan = await runAgentWithTools({
      agentLabel: '🏗️ Architecte',
      modelName: resolvedModelArchitect,
      systemPrompt: archSystem,
      userMessage: userPrompt,
      maxTokens: 2048
    });
    sendStep('🏗️ Architecte', 'done', archPlan);

    // ── Read only selected skills from disk ──────────────────────
    const readSkillFile = async (name, scope, pPath) => {
      try {
        const safeName = safeFileBase(name);
        if (!safeName) return '';
        let dir;
        if (scope === 'global') dir = getGlobalSkillsDir();
        else if (scope === 'workspace' && pPath) dir = getWorkspaceSkillsDir(pPath);
        else return '';
        const skillFile = path.join(dir, safeName, 'SKILL.md');
        if (fsSync.existsSync(skillFile)) {
          return await fs.readFile(skillFile, 'utf-8');
        }
      } catch (e) { }
      return '';
    };

    const parseAssignedSkills = async (plan, agentName) => {
      try {
        const regex = new RegExp(`${agentName}\\s*:\\s*(.+?)(?:\\n|$)`, 'i');
        const match = plan.match(regex);
        if (!match) return '';
        const assignedNames = match[1].split(',').map(s => s.trim().replace(/[\[\]]/g, ''));
        const filtered = skillsList.filter(s => assignedNames.some(a => a.toLowerCase().includes(s.name.toLowerCase())));
        if (filtered.length === 0) return '';
        let content = '--- SKILLS ---\n';
        for (const s of filtered.slice(0, 5)) {
          const fileContent = await readSkillFile(s.name, s.scope, trustedProjectPath);
          if (fileContent) content += `## ${s.name}\n${fileContent.substring(0, 3000)}\n\n`;
        }
        return content + '---';
      } catch { return ''; }
    };

    const coderSkills = await parseAssignedSkills(archPlan, 'Codeur');
    const reviewSkills = await parseAssignedSkills(archPlan, 'Relecteur');

    const extractArtifactKeys = (text) => {
      const keys = new Set();
      const safeText = String(text || '');
      const fileRegex = /\*\*FICHIER:\s*(.+?)\*\*/gi;
      const diffRegex = /(?:^|\n)FILE:\s*(.+?)\s*(?:\n|$)/gi;
      const workflowRegex = /\*\*WORKFLOW:\s*(.+?)\*\*/gi;
      let match;

      while ((match = fileRegex.exec(safeText)) !== null) {
        const filePath = String(match[1] || '').trim();
        if (filePath) keys.add(`file:${filePath}`);
      }

      while ((match = diffRegex.exec(safeText)) !== null) {
        const filePath = String(match[1] || '').trim();
        if (filePath) keys.add(`file:${filePath}`);
      }

      while ((match = workflowRegex.exec(safeText)) !== null) {
        const workflowName = String(match[1] || '').trim();
        if (workflowName) keys.add(`workflow:${workflowName}`);
      }

      return Array.from(keys);
    };

    // ────────── Agent 2 : Codeur (ACTION — 8192 tokens) ──────────
    sendStep('💻 Codeur', 'active', '');
    const coderSystem = `Tu es un developpeur full-stack expert. Tu produis des modifications applicables.
${projectContext}${codeCtx}${visualWorkflowContext}${n8nCatalogContext}
${coderSkills}
${toolContractText}

REGLES STRICTES:
- Pour modifier un fichier existant, utilise UNIQUEMENT:
FILE: chemin/nom.ext
<<<< SEARCH
code exact existant
====
nouveau code
>>>> REPLACE

- Si SEARCH apparait plusieurs fois dans le fichier, precise davantage le bloc SEARCH.
- Pour creer un nouveau fichier, utilise:
**FICHIER: chemin/nom.ext** \`\`\`langage\n// contenu complet\n\`\`\`
- Si un workflow visuel est demande, produis: **WORKFLOW: NomDuWorkflow** \`\`\`json
{
  "name": "Nom",
  "nodes": [{"id":"node_1","type":"trigger|ai|action|logic|output","label":"Nom","icon":"▶️|🤖|💻|🔀|🔔","position":{"x":100,"y":150},"config":{}}],
  "edges": [{"source":"node_1","target":"node_2"}]
}
\`\`\`
- Couvre TOUS les fichiers necessaires a la demande, pas seulement un extrait.
- Si la reponse tient en une seule passe, termine par **STATUT: COMPLETE**
- S'il reste des fichiers a produire, termine par **STATUT: INCOMPLETE**
- Pas d'explication, uniquement les artefacts.
${TERMINAL_CAPABILITY_PROMPT}`;

    const MAX_CODER_PASSES = 3;
    let coderOutput = '';
    const emittedArtifacts = new Set();
    for (let coderPass = 0; coderPass < MAX_CODER_PASSES; coderPass++) {
      const isFirstCoderPass = coderPass === 0;
      const passLabel = isFirstCoderPass ? '' : `Passe ${coderPass + 1}/${MAX_CODER_PASSES}`;
      sendStep('💻 Codeur', 'active', passLabel);

      const passPrompt = isFirstCoderPass
        ? `${userPrompt}\n\nPLAN:\n${archPlan}`
        : `Continue exactement la generation precedente sans repliquer les artefacts deja emis.

Artefacts deja emis:
${Array.from(emittedArtifacts).join('\n') || '- aucun'}

Rappel:
- ajoute seulement les fichiers ou workflows manquants
- si tout est fini, termine par **STATUT: COMPLETE**
- sinon termine par **STATUT: INCOMPLETE**`;

      // eslint-disable-next-line no-await-in-loop
      const coderPassOutput = await runAgentWithTools({
        agentLabel: '💻 Codeur',
        modelName: resolvedModelCoder,
        systemPrompt: coderSystem,
        userMessage: passPrompt,
        maxTokens: 8192
      });

      coderOutput = coderOutput ? `${coderOutput}\n\n${coderPassOutput}` : coderPassOutput;
      extractArtifactKeys(coderPassOutput).forEach((artifactKey) => emittedArtifacts.add(artifactKey));
      sendStep('💻 Codeur', 'done', coderPassOutput);

      if (/\*\*STATUT:\s*COMPLETE/i.test(coderPassOutput)) {
        break;
      }
    }

    // ── Helper to run a shell command and get its output ──────────────────
    const runShellCommandWithSafety = async (cmd, cwd) => {
      const result = await executeCommandForAI(cmd, cwd || trustedProjectPath);
      return {
        ok: !!result?.success,
        output: String(result?.output || '')
      };
    };

    // ── Parse <run_command>...</run_command> blocks ──
    const parseTestCommands = (text) => {
      const results = [];
      const regex = /<run_command>([\s\S]*?)<\/run_command>/gi;
      let m;
      while ((m = regex.exec(text)) !== null) {
        const cmd = m[1].trim();
        if (cmd) results.push(cmd);
      }
      return results;
    };

    // ────────── Relecteur + Correction Loop ──────────
    const MAX_CORRECTIONS = 3;
    let evolvingProposal = coderOutput;
    let testLog = '';
    const correctionHistory = [];

    for (let iteration = 0; iteration <= MAX_CORRECTIONS; iteration++) {
      sendStep('🔍 Relecteur', 'active', `Iteration ${iteration + 1}`);

      const testerSystem = `Tu es un ingenieur QA senior, specialise en verification de patchs.
${projectContext}${visualWorkflowContext}${n8nCatalogContext}
${reviewSkills}
${toolContractText}

REGLES STRICTES:
- Pour executer une commande (curl, node, npm test...): <run_command>commande</run_command>
- Liste les erreurs avec: **ERREUR:** description precise de l'erreur
- Si tout passe: **STATUT: OK**
${testLog ? `\nRESULTATS DES COMMANDES PRECEDENTES:\n${testLog}` : ''}`;

      const testerOutput = await runAgentWithTools({
        agentLabel: '🔍 Relecteur',
        modelName: resolvedModelTester,
        systemPrompt: testerSystem,
        userMessage: `Teste ce patch:\n\n${evolvingProposal.substring(0, 5000)}\n\nDemande originale: ${userPrompt}`,
        maxTokens: 2048
      });

      sendStep('🔍 Relecteur', 'done', testerOutput);

      // Run shell commands requested by reviewer
      const commands = parseTestCommands(testerOutput);
      let commandResults = '';
      for (const cmd of commands.slice(0, 5)) {
        const cmdLabel = `⚡ ${cmd.substring(0, 50)}`;
        sendStep(cmdLabel, 'active', '');

        // Soft timeout warning for long commands (30s)
        const cmdWarningId = setTimeout(() => {
          sendStep(`${cmdLabel} ⏳ (Long...)`, 'active', '');
        }, 30000);

        const result = await runShellCommandWithSafety(cmd);
        clearTimeout(cmdWarningId);

        commandResults += `\n$ ${cmd}\n-> ${result.ok ? 'ok' : 'blocked/failed'}\n${result.output}\n`;
        sendStep(cmdLabel, 'done', commandResults);
      }
      if (commandResults) testLog += commandResults;

      const hasErrors = /\*\*ERREUR:/i.test(testerOutput);
      const allOK = /\*\*STATUT:\s*OK/i.test(testerOutput);

      correctionHistory.push({
        iteration: iteration + 1,
        testerReport: testerOutput,
        commandResults,
        passed: allOK && !hasErrors
      });

      if ((allOK && !hasErrors) || iteration >= MAX_CORRECTIONS) break;

      // ── Architecte correction round ──
      sendStep('🏗️ Architecte', 'active', `Correction ${iteration + 1}`);
      const errorSummary = testerOutput.match(/\*\*ERREUR:[\s\S]*?(?=\*\*|\n\n|$)/gi)?.join('\n') || testerOutput.substring(0, 800);
      const correctionPlan = await runAgentWithTools({
        agentLabel: '🏗️ Architecte',
        modelName: resolvedModelArchitect,
        systemPrompt: `${archSystem}\n\nCorrige uniquement les erreurs signalees. Sois minimal.`,
        userMessage: `ERREURS:\n${errorSummary}\n\nPATCH:\n${evolvingProposal.substring(0, 3500)}`,
        maxTokens: 1024
      });
      sendStep('🏗️ Architecte', 'done', correctionPlan);

      // ── Codeur correction round ──
      sendStep('💻 Codeur', 'active', `Correction ${iteration + 1}`);
      const correctedCode = await runAgentWithTools({
        agentLabel: '💻 Codeur',
        modelName: resolvedModelCoder,
        systemPrompt: `${coderSystem}\n\nApplique UNIQUEMENT les corrections necessaires.`,
        userMessage: `PLAN DE CORRECTION:\n${correctionPlan}\n\nERREURS:\n${errorSummary}`,
        maxTokens: 4096
      });
      sendStep('💻 Codeur', 'done', correctedCode);
      evolvingProposal += '\n\n---CORRECTION---\n\n' + correctedCode;
    }

    // ────────── Synthèse finale ──────────
    const testSummary = correctionHistory.map(h =>
      `### Itération ${h.iteration}\n${h.passed ? '✅ Tests OK' : '❌ Erreurs détectées'}\n${h.commandResults ? '```\n' + h.commandResults + '\n```' : ''}`
    ).join('\n\n');

    const finalText = [
      `## 🏗️ Plan (Architecte)\n${archPlan}`,
      `## 💻 Patch (Codeur)\n${evolvingProposal}`,
      `## 🔍 Rapport de relecture\n${testSummary}`
    ].join('\n\n---\n\n');

    return {
      success: true,
      text: finalText,
      multiAgent: true,
      models: {
        architect: resolvedModelArchitect,
        coder: resolvedModelCoder,
        tester: resolvedModelTester
      },
      requestedModels: {
        architect: modelArchitect,
        coder: modelCoder,
        tester: modelTester
      }
    };
  } catch (error) {
    console.error('[Ollama Multi] Erreur:', error.message);
    return { success: false, error: `Ollama Multi: ${error.message}` };
  }
};

module.exports = { getOllamaCompletion, getOllamaMultiCompletion };
