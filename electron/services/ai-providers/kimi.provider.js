'use strict';

const axios = require('axios');
const logger = require('../../../logger');
const { DEFAULT_KIMI_MODEL } = require('../settings.service');
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
  parseReadTerminalCall,
  stripReadTerminalTags,
  readSharedTerminalBuffer,
  TERMINAL_CAPABILITY_PROMPT,
  executeCommandForAI: defaultExecuteCommandForAI,
} = require('../ai.service');

const safeConsoleLog = (...args) => {
  try {
    console.log(...args);
  } catch (error) {
    if (error && (error.code === 'EPIPE' || error.code === 'ERR_STREAM_DESTROYED')) return;
    throw error;
  }
};

const getKimiCompletion = async ({
  history,
  currentCode,
  allProjectFiles = null,
  options = {},
  getMainWindow,
  executeCommandForAI: injectedExecuteCommandForAI,
} = {}) => {
  const mainWindow = typeof getMainWindow === 'function' ? getMainWindow() : null;
  const executeCommandForAI = injectedExecuteCommandForAI || defaultExecuteCommandForAI;

  if (options.localOnly) {
    return { success: false, error: 'Local-only actif: Kimi/Together interdit.', provider: 'kimi' };
  }
  const apiKey = options.apiKey || process.env.KIMI_API_KEY || process.env.TOGETHER_API_KEY;
  const modelFromEnv = process.env.KIMI_MODEL;
  const model = options.model || modelFromEnv || DEFAULT_KIMI_MODEL;
  const thinkingMode = !!options.thinkingMode;
  const images = Array.isArray(options.images) ? options.images : [];
  const fastMode = options.fastMode !== false;
  const reactMode = options.reactMode === true;
  const streamResponse = options.streamResponse === true;
  const includeProjectContext = options.includeProjectContext !== false;
  const includeGlobalSkills = options.includeGlobalSkills === true || !fastMode;
  const parsePositiveInt = (value, fallback, min, max) => {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
  };
  const maxHistoryMessages = parsePositiveInt(options.maxHistoryMessages, fastMode ? 8 : 20, 2, 80);
  const contextFilesLimit = parsePositiveInt(options.contextFilesLimit, fastMode ? 8 : 20, 1, 40);
  const contextCharsPerFile = parsePositiveInt(options.contextCharsPerFile, fastMode ? 1200 : 2000, 300, 4000);
  const reactMaxIterations = reactMode
    ? parsePositiveInt(options.maxIterations, fastMode ? 3 : 8, 1, 8)
    : 1;
  const kimiRetryCount = parsePositiveInt(options.retryCount, fastMode ? 2 : 3, 0, 5);
  const kimiRetryDelayMs = parsePositiveInt(options.retryDelayMs, fastMode ? 900 : 1400, 250, 15000);
  const KIMI_RETRYABLE_STATUS = new Set([429, 502, 503, 504]);
  const KIMI_RETRYABLE_CODES = new Set([
    'ECONNABORTED',
    'ETIMEDOUT',
    'ECONNRESET',
    'EAI_AGAIN',
    'ENOTFOUND',
    'EPIPE',
    'ERR_STREAM_PREMATURE_CLOSE'
  ]);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const getKimiStatusCode = (error) => {
    const parsed = Number(error?.response?.status);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  };
  const isRetryableKimiError = (error) => {
    const statusCode = getKimiStatusCode(error);
    if (statusCode && KIMI_RETRYABLE_STATUS.has(statusCode)) return true;
    const errorCode = String(error?.code || '').toUpperCase();
    if (errorCode && KIMI_RETRYABLE_CODES.has(errorCode)) return true;
    return false;
  };
  const formatKimiErrorMessage = (error, statusCode) => {
    if (statusCode === 429) {
      return "Limite de requetes atteinte (quota API Together/Kimi ou trop de requetes). Reessayez dans quelques instants.";
    }
    if (statusCode === 502 || statusCode === 503 || statusCode === 504) {
      return `Service Kimi/Together temporairement indisponible (HTTP ${statusCode}). Reessayez dans quelques instants.`;
    }
    if (statusCode === 401 || statusCode === 403) {
      return 'Acces refuse a l API Kimi/Together. Verifiez votre cle API.';
    }
    if (String(error?.code || '').toUpperCase() === 'ECONNABORTED') {
      return 'Timeout de la requete Kimi/Together. Reessayez avec un timeout plus long.';
    }
    const remoteMessage =
      error?.response?.data?.error?.message ||
      error?.response?.data?.message;
    if (remoteMessage) return String(remoteMessage);
    return error?.message || 'Erreur inconnue lors de l appel Kimi/Together.';
  };
  const emitAIGenerationToken = (payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('ai-generation-token', {
        provider: 'kimi',
        ...payload
      });
    }
  };

  safeConsoleLog('[Main] Appel Kimi: verification de la cle API Kimi/Together...');

  if (!apiKey) {
    const errorMsg = "La clé API Together/Kimi n'est pas configurée. Définissez KIMI_API_KEY (ou TOGETHER_API_KEY) ou renseignez-la dans les Paramètres.";
    console.error('[Main][Kimi] Erreur:', errorMsg);
    return { success: false, error: errorMsg, retryable: false, statusCode: 401, provider: 'kimi' };
  }

  if (!history || !Array.isArray(history) || history.length === 0) {
    const errorMsg = "Aucun historique de conversation n'a été fourni pour Kimi.";
    console.error('[Main][Kimi] Erreur:', errorMsg);
    return { success: false, error: errorMsg };
  }

  try {
    const validHistory = history.filter(msg =>
      msg &&
      typeof msg === 'object' &&
      msg.text !== undefined
    );
    const effectiveHistory = validHistory.slice(-maxHistoryMessages);

    if (effectiveHistory.length === 0) {
      const errorMsg = "Aucun message valide trouvé dans l'historique pour Kimi.";
      console.error('[Main][Kimi] Erreur:', errorMsg);
      return { success: false, error: errorMsg };
    }

    const lastMessage = effectiveHistory[effectiveHistory.length - 1];
    const projectPath = await resolveOptionalTrustedProjectPath(options.projectPath);

    // Construire le contexte du projet si disponible (similaire à Gemini)
    let projectContext = '';
    if (includeProjectContext && allProjectFiles && allProjectFiles.files) {
      projectContext = '\n--- CONTEXTE COMPLET DU PROJET ---\n';
      const fileEntries = Object.entries(allProjectFiles.files);

      const maxFiles = contextFilesLimit;
      const filesToShow = pickFilesForContext(allProjectFiles.files, maxFiles);

      for (const [filePath, fileData] of filesToShow) {
        projectContext += `\n=== FICHIER: ${filePath} ===\n`;
        if (fileData.content && !String(fileData.content).startsWith('[')) {
          const maxContentLength = contextCharsPerFile;
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
    const globalSkillsContent = includeGlobalSkills ? await loadAllGlobalSkillsForCompletion() : '';
    const selectedSkill = await loadSkillForCompletion(options.skill, projectPath);
    const visualWorkflowContext = await buildVisualWorkflowContextForPrompt(projectPath, String(lastMessage.text), options);
    const n8nCatalogContext = await buildN8nCatalogContextForPrompt(String(lastMessage.text), options);

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

    const thinkingInstructionsKimi = thinkingMode
      ? `\nMODE THINKING ACTIVÉ : détaillez explicitement votre raisonnement étape par étape avant de proposer le code final.\n`
      : '';

    const terminalCapabilityPrompt = reactMode ? TERMINAL_CAPABILITY_PROMPT : '';
    const prompt = `
      Vous êtes un assistant de développement expert et autonome.
      ${agentContext}
      ${skillContext}
      ${projectContext}
      ${visualWorkflowContext}
      ${n8nCatalogContext}

      FICHIER ACTUELLEMENT OUVERT :
      --- CODE ACTUEL ---
      ${currentCode || 'Aucun code fourni'}
      ---

      DERNIÈRE DEMANDE DE L'UTILISATEUR :
      ${String(lastMessage.text)}

      ${thinkingInstructionsKimi}

      ${terminalCapabilityPrompt}

      INSTRUCTIONS :
      - Analysez le contexte du projet et la demande.
      - Proposez des modifications de code complètes.
      - Pour chaque fichier modifié, renvoyez le contenu complet au format :
        **FICHIER: nom_du_fichier.ext**
        \`\`\`langage
        // code complet
        \`\`\`
    `;

    const buildMessages = (baseHistory, userPrompt) => {
      const base = baseHistory.slice(0, -1).map(msg => {
        let role = 'user';
        if (msg.role === 'model') role = 'assistant';
        else if (msg.role === 'system') role = 'system';
        else if (msg.role === 'user') role = 'user';
        return { role, content: String(msg.text) };
      });
      let userContent;
      if (images.length > 0) {
        const imageContents = images.map(img => ({ type: 'image_url', image_url: { url: img.dataUrl || img.url || '' } }));
        userContent = [{ type: 'text', text: userPrompt }, ...imageContents];
      } else {
        userContent = userPrompt;
      }
      return [...base, { role: 'user', content: userContent }];
    };

    const kimiUrl = options.apiUrl || process.env.KIMI_API_URL || 'https://api.together.xyz/v1/chat/completions';
    const parsedMaxTokens = Number(options.maxTokens);
    const defaultMaxTokens = 4096;
    const kimiMaxTokens = Number.isFinite(parsedMaxTokens) && parsedMaxTokens > 0
      ? Math.min(16384, Math.floor(parsedMaxTokens))
      : defaultMaxTokens;
    const parsedTemperature = Number(options.temperature);
    const kimiTemperature = Number.isFinite(parsedTemperature) ? parsedTemperature : 0.7;
    const parsedTimeoutMs = Number(options.requestTimeoutMs ?? options.timeoutMs);
    const kimiTimeoutMs = Number.isFinite(parsedTimeoutMs) && parsedTimeoutMs > 0
      ? Math.floor(parsedTimeoutMs)
      : 0;
    const kimiCallWithMessages = async (msgs) => {
      const requestBody = {
        model,
        messages: msgs,
        max_tokens: kimiMaxTokens,
        temperature: kimiTemperature,
      };
      if (streamResponse) {
        requestBody.stream = true;
      }
      const requestMetadata = {
        model,
        maxTokens: requestBody.max_tokens,
        temperature: requestBody.temperature,
        stream: !!requestBody.stream,
        messageCount: Array.isArray(msgs) ? msgs.length : 0
      };
      logger.info(`[Kimi Agent API] Request metadata: ${JSON.stringify(requestMetadata)}`);
      logger.info(`[Kimi Agent API] Timeout HTTP: ${kimiTimeoutMs > 0 ? `${kimiTimeoutMs}ms` : 'disabled'}`);
      const requestConfig = {
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      };
      if (kimiTimeoutMs > 0) {
        requestConfig.timeout = kimiTimeoutMs;
      }
      if (streamResponse) {
        requestConfig.responseType = 'stream';
      }
      if (options.signal) requestConfig.signal = options.signal;
      const resp = await axios.post(kimiUrl, requestBody, requestConfig);
      if (options.signal?.aborted) throw Object.assign(new Error('Generation annulee.'), { name: 'AbortError' });
      if (streamResponse) {
        const stream = resp.data;
        if (!stream || typeof stream.on !== 'function') {
          if (resp.data?.choices?.[0]?.message?.content === undefined) {
            throw new Error("Réponse de l'API Kimi mal formatée");
          }
          return resp.data.choices[0].message.content;
        }
        return await new Promise((resolve, reject) => {
          let fullText = '';
          let buffer = '';
          let rawStreamData = '';
          let settled = false;

          const appendToken = (token) => {
            if (typeof token !== 'string' || token.length === 0) return;
            fullText += token;
            emitAIGenerationToken({ token, done: false });
          };

          const safeResolve = (value) => {
            if (settled) return;
            settled = true;
            emitAIGenerationToken({ token: '', done: true });
            resolve(value);
          };

          const safeReject = (error) => {
            if (settled) return;
            settled = true;
            emitAIGenerationToken({ token: '', done: true, error: error?.message || String(error) });
            reject(error);
          };

          const processLine = (rawLine) => {
            const line = String(rawLine || '').trim();
            if (!line) return;

            // Si la ligne ne commence pas par data:, on l'ignore sauf si on veut debugger
            if (!line.startsWith('data:')) return;

            const payload = line.slice(5).trim();
            if (!payload || payload === '[DONE]') return;

            let parsed;
            try {
              parsed = JSON.parse(payload);
            } catch {
              return;
            }

            const deltaContent = parsed?.choices?.[0]?.delta?.content;
            if (typeof deltaContent === 'string') {
              appendToken(deltaContent);
              return;
            }
            if (Array.isArray(deltaContent)) {
              deltaContent.forEach((part) => {
                if (typeof part === 'string') appendToken(part);
                else if (typeof part?.text === 'string') appendToken(part.text);
              });
              return;
            }

            // Fallback for providers sending full message chunks while streaming
            const messageContent = parsed?.choices?.[0]?.message?.content;
            if (typeof messageContent === 'string' && !fullText) {
              appendToken(messageContent);
            }
          };

          stream.on('data', (chunk) => {
            const textChunk = chunk.toString('utf8');
            if (rawStreamData.length < 2000) rawStreamData += textChunk;
            buffer += textChunk;
            let newlineIndex = buffer.indexOf('\n');
            while (newlineIndex >= 0) {
              const line = buffer.slice(0, newlineIndex);
              buffer = buffer.slice(newlineIndex + 1);
              processLine(line);
              newlineIndex = buffer.indexOf('\n');
            }
          });

          stream.on('end', () => {
            if (buffer.trim()) processLine(buffer);
            if (!fullText) {
              const preview = rawStreamData.length > 500 ? rawStreamData.slice(0, 500) + '...' : rawStreamData;
              safeReject(new Error(`Réponse de l'API Kimi mal formatée (stream vide). Raw: ${preview}`));
              return;
            }
            safeResolve(fullText);
          });

          stream.on('error', (streamError) => {
            safeReject(streamError);
          });
        });
      }
      if (resp.data?.choices?.[0]?.message?.content === undefined) {
        throw new Error("Réponse de l'API Kimi mal formatée");
      }
      return resp.data.choices[0].message.content;
    };

    const kimiCallWithRetry = async (msgs) => {
      let lastError = null;
      for (let attempt = 0; attempt <= kimiRetryCount; attempt += 1) {
        try {
          // eslint-disable-next-line no-await-in-loop
          return await kimiCallWithMessages(msgs);
        } catch (error) {
          lastError = error;
          const statusCode = getKimiStatusCode(error);
          const retryable = isRetryableKimiError(error);
          if (!retryable || attempt >= kimiRetryCount) {
            break;
          }
          const jitterMs = Math.floor(Math.random() * 250);
          const backoffMs = Math.min(20000, kimiRetryDelayMs * (2 ** attempt) + jitterMs);
          logger.warn(`[Kimi Agent API] Tentative ${attempt + 1}/${kimiRetryCount + 1} echouee (status=${statusCode || 'n/a'}, code=${error?.code || 'n/a'}), retry dans ${backoffMs}ms`);
          // eslint-disable-next-line no-await-in-loop
          await sleep(backoffMs);
        }
      }
      throw lastError || new Error('Echec appel API Kimi');
    };

    logger.info(`[Kimi Agent API] Création du prompt et appel du modèle ${model}...`);

    try {
      // Kimi fast path: no terminal tool loop unless explicitly enabled
      let messages = buildMessages(effectiveHistory, prompt);
      let fullTranscript = '';
      if (!reactMode) {
        const aiText = await kimiCallWithRetry(messages);
        return { success: true, text: aiText, terminalActions: 0, mode: 'single' };
      }

      const MAX_ITERATIONS = reactMaxIterations;

      for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
        logger.info(`[Kimi Agent API] Itération ReAct ${iter + 1}/${MAX_ITERATIONS}...`);
        const aiText = await kimiCallWithRetry(messages);
        logger.info(`[Kimi Agent API] Réponse de l'IA (Itération ${iter + 1}):\n${aiText}`);

        const visibleTurn = stripReadTerminalTags(aiText);
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
            { role: 'user', content: `${shared.text}\nContinue si necessaire.` }];
          continue;
        }

        const cmd = parseRunCommand(aiText);
        if (!cmd) {
          // No command → done
          return { success: true, text: fullTranscript, terminalActions: iter };
        }

        // Emit terminal action event to renderer
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('ai-terminal-action', { command: cmd, iteration: iter + 1 });
        }

        const { output, success: commandSucceeded, exitCode } = await executeCommandForAI(cmd, projectPath, undefined, {
          executionMode: options.executionMode,
          autonomyLevel: options.autonomyLevel
        });

        // Feed result back as new user message
        messages = [
          ...messages,
          { role: 'assistant', content: aiText },
          { role: 'user', content: `[RÉSULTAT TERMINAL — itération ${iter + 1}]\n\`\`\`\n${output}\n\`\`\`\nContinue si nécessaire. Si tu as terminé, réponds sans balise <run_command>.` }
        ];

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('ai-terminal-result', { command: cmd, output, iteration: iter + 1, exitCode: typeof exitCode === 'number' ? exitCode : null, success: commandSucceeded === true });
        }
      }

      // Reached max iterations — return what we have
      return { success: true, text: fullTranscript, terminalActions: MAX_ITERATIONS };

    } catch (error) {
      const statusCode = getKimiStatusCode(error);
      const retryable = isRetryableKimiError(error);
      const errorMsg = formatKimiErrorMessage(error, statusCode);
      const payload = {
        statusCode: statusCode || null,
        code: error?.code || null,
        retryable,
        message: error?.message || String(error)
      };
      logger.error(`[Kimi Agent API] Erreur Together: ${JSON.stringify(payload)}`);
      if (error?.response?.data) {
        logger.error(`[Kimi Agent API] Corps erreur Together: ${JSON.stringify(error.response.data).slice(0, 2000)}`);
      }
      return {
        success: false,
        error: errorMsg,
        retryable,
        statusCode: statusCode || undefined,
        errorCode: error?.code || undefined,
        provider: 'kimi'
      };
    }
  } catch (error) {
    const errorMsg = `Erreur inattendue Kimi: ${error.message || 'Erreur inconnue'}`;
    console.error('[Main][Kimi]', errorMsg, error);
    return { success: false, error: errorMsg, retryable: false, provider: 'kimi' };
  }
};

module.exports = { getKimiCompletion };
