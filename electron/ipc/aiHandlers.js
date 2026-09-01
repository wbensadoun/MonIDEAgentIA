'use strict';

const { ipcMain: electronIpcMain, dialog } = require('electron');
const { listGeminiModels, getGeminiCompletion } = require('../services/ai-providers/gemini.provider');
const { getClaudeCompletion } = require('../services/ai-providers/claude.provider');
const { getKimiCompletion } = require('../services/ai-providers/kimi.provider');
const { getOllamaCompletion } = require('../services/ai-providers/ollama.provider');
const {
  executeCommandForAI: defaultExecuteCommandForAI,
  runSingleCompletionProvider
} = require('../services/ai.service');
const {
  buildNevenCoreExecutionContext,
  formatNevenCoreExecutionPrompt,
  isNevenCoreExecutionEnabled
} = require('../services/neven-core.service');
const {
  listAgents: defaultListAgents,
  listSkills: defaultListSkills
} = require('../services/agent.service');
const { resolveModelForProfile } = require('../services/router.service');

const providerHandlers = {
  gemini: getGeminiCompletion,
  claude: getClaudeCompletion,
  kimi: getKimiCompletion,
  ollama: getOllamaCompletion
};

// Registre des generations en cours : runId -> AbortController.
//
// ipcMain.handle est un aller-retour anonyme : sans identifiant de requete, le
// renderer n'a aucun moyen de designer LA generation a interrompre. C'est
// exactement ce qui rendait le bouton "Arreter" decoratif — un AbortController
// etait bien cree cote React, mais son signal ne quittait jamais le renderer.
const activeRuns = new Map();

const registerRun = (runId) => {
  if (!runId) return null;
  // Meme runId reutilise (relance rapide) : on avorte l'ancien avant d'ecraser,
  // sinon la premiere requete devient orpheline et intuable.
  const previous = activeRuns.get(runId);
  if (previous) previous.abort();
  const controller = new AbortController();
  activeRuns.set(runId, controller);
  return controller;
};

// On ne supprime que si l'entree est toujours la NOTRE : un run relance sous le
// meme id a pu remplacer la valeur entre-temps.
const releaseRun = (runId, controller) => {
  if (!runId) return;
  if (activeRuns.get(runId) === controller) activeRuns.delete(runId);
};

const isTechnicalResponseKey = (key) => {
  const normalized = String(key || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
  return normalized === 'provider'
    || normalized.includes('provider')
    || normalized.includes('model')
    || normalized.includes('profile')
    || normalized.includes('resolved')
    || normalized === 'source'
    || normalized.includes('metadata');
};

const isSensitiveResponseKey = (key) => {
  const normalized = String(key || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
  return normalized.includes('key')
    || normalized.includes('token')
    || normalized.includes('authorization')
    || normalized.includes('credential')
    || normalized.includes('secret')
    || normalized.includes('ciphertext');
};

const collectTechnicalResponseValues = (value, values = []) => {
  if (!value || typeof value !== 'object') return values;
  if (Array.isArray(value)) {
    value.forEach((item) => collectTechnicalResponseValues(item, values));
    return values;
  }
  Object.entries(value).forEach(([key, item]) => {
    if (isTechnicalResponseKey(key) && typeof item === 'string' && item.trim()) values.push(item.trim());
    collectTechnicalResponseValues(item, values);
  });
  return values;
};

const collectSensitiveResponseValues = (value, values = []) => {
  if (!value || typeof value !== 'object') return values;
  if (Array.isArray(value)) {
    value.forEach((item) => collectSensitiveResponseValues(item, values));
    return values;
  }
  Object.entries(value).forEach(([key, item]) => {
    if (isSensitiveResponseKey(key) && typeof item === 'string' && item.trim()) values.push(item.trim());
    collectSensitiveResponseValues(item, values);
  });
  return values;
};

const SECRET_LIKE_ERROR_PATTERNS = [
  /\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\b(?:sk|rk|pk|sess|api|token|key)[-_][A-Za-z0-9._~+/=-]{8,}\b/gi,
  /\beyJ[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]{4,}){1,2}\b/g,
  /((?:api[_ -]?key|access[_ -]?token|authorization|credential|secret|ciphertext|token|key)\s*[:=]\s*)["']?[^\s"',;]+/gi,
  /\b(?=[A-Za-z0-9._-]{20,}\b)(?=[A-Za-z0-9._-]*[A-Za-z])(?=[A-Za-z0-9._-]*\d)[A-Za-z0-9._-]{20,}\b/g
];

const sanitizeErrorText = (value, sensitiveValues = []) => {
  let text = String(value || '');
  for (const sensitiveValue of sensitiveValues.sort((a, b) => b.length - a.length)) {
    if (sensitiveValue.length > 1) text = text.split(sensitiveValue).join('[metadata masquee]');
  }
  for (const pattern of SECRET_LIKE_ERROR_PATTERNS) {
    text = text.replace(pattern, (_match, label) => label ? `${label}[metadata masquee]` : '[metadata masquee]');
  }
  return text.replace(/\b(gemini|claude|kimi|ollama|neven)\b/gi, 'provider IA');
};

const sanitizeCompletionResponseValue = (value, sensitiveValues) => {
  if (Array.isArray(value)) return value.map((item) => sanitizeCompletionResponseValue(item, sensitiveValues));
  if (!value || typeof value !== 'object') return value;

  const sanitized = {};
  for (const [key, item] of Object.entries(value)) {
    if (isTechnicalResponseKey(key) || isSensitiveResponseKey(key)) continue;
    sanitized[key] = key === 'error'
      ? sanitizeErrorText(item, sensitiveValues)
      : sanitizeCompletionResponseValue(item, sensitiveValues);
  }
  return sanitized;
};

const sanitizeCompletionResponse = (response, options = {}) => {
  const sensitiveValues = [
    ...collectTechnicalResponseValues(response),
    ...collectSensitiveResponseValues(response),
    ...collectSensitiveResponseValues(options),
    options.model,
    options.requestedModel,
    options.resolvedModel
  ].filter((value) => typeof value === 'string' && value.trim());
  return sanitizeCompletionResponseValue(response, sensitiveValues);
};

const cleanRendererCompletionOptions = (options) => {
  const cleaned = options && typeof options === 'object' && !Array.isArray(options)
    ? { ...options }
    : {};
  delete cleaned.nevenCoreExecutionContext;
  delete cleaned.nevenCoreExecutionPrompt;
  // Retrieval evidence and its tool policy are main-process outputs. Never
  // accept renderer-supplied values for these fields, even when they look
  // restrictive: otherwise a compromised renderer can forge the provenance
  // contract or smuggle prompt/tool metadata into a provider call.
  delete cleaned.retrievalContext;
  delete cleaned.toolsAllowed;
  delete cleaned.allowToolCalls;
  delete cleaned.promptSafety;
  delete cleaned.retrievalPromptSafety;
  return cleaned;
};

const getLatestUserPrompt = (history) => {
  if (!Array.isArray(history)) return '';
  const latest = [...history].reverse().find((message) => (
    message && typeof message === 'object' && (message.role === 'user' || message.role == null)
  ));
  return String(latest?.text || latest?.content || '');
};

// Internal-only execution context. Empty or unavailable catalogs return the
// original options and never trigger a secondary LLM call.
const prepareNevenCoreExecutionOptions = async ({
  options = {},
  prompt = '',
  listAgents = defaultListAgents,
  listSkills = defaultListSkills,
  isExecutionEnabled = isNevenCoreExecutionEnabled,
  resolveProfileModel = resolveModelForProfile
} = {}) => {
  const cleanedOptions = cleanRendererCompletionOptions(options);
  if (!isExecutionEnabled()) return cleanedOptions;

  try {
    const projectPath = cleanedOptions.projectPath || null;
    const [agentsResult, skillsResult] = await Promise.all([
      typeof listAgents === 'function' ? listAgents(projectPath) : null,
      typeof listSkills === 'function' ? listSkills(projectPath) : null
    ]);
    const context = buildNevenCoreExecutionContext({
      prompt,
      agents: Array.isArray(agentsResult?.agents) ? agentsResult.agents : [],
      skills: Array.isArray(skillsResult?.skills) ? skillsResult.skills : [],
      enabled: true
    });
    if (!context) return cleanedOptions;

    // Profile-to-model selection is backend-only and opt-in with the Core flag.
    // A resolver failure must preserve the original model choice.
    const provider = cleanedOptions.provider;
    if (provider && typeof resolveProfileModel === 'function') {
      try {
        const resolved = await resolveProfileModel(provider, context.profile, {
          settings: cleanedOptions.settings
        });
        if (resolved?.resolved) {
          return { ...cleanedOptions, model: resolved.resolved, nevenCoreExecutionContext: context };
        }
      } catch (error) {
        console.error('[AIHandlers] Neven Core model resolution unavailable:', error?.message || 'unknown error');
      }
    }

    return { ...cleanedOptions, nevenCoreExecutionContext: context };
  } catch (error) {
    console.error('[AIHandlers] Neven Core execution context unavailable:', error?.message || 'unknown error');
    return cleanedOptions;
  }
};

const registerProviderCompletionHandler = ({
  ipcMain,
  channel,
  provider,
  getMainWindow,
  executeCommandForAI,
  listAgents,
  listSkills,
  completionHandlers = providerHandlers,
  managedCompletionRunner,
  retrieveContext = null
}) => {
  const handler = completionHandlers[provider];
  if (typeof handler !== 'function') {
    throw new Error(`Provider IA non supporte: ${provider}`);
  }

  ipcMain.handle(channel, async (_event, history, currentCode, allProjectFiles = null, options = {}) => {
    const runId = options?.runId || null;
    const controller = registerRun(runId);
    let executionOptions = cleanRendererCompletionOptions(options);
    try {
      executionOptions = await prepareNevenCoreExecutionOptions({
        options,
        prompt: getLatestUserPrompt(history),
        listAgents,
        listSkills
      });
      if (executionOptions.retrievalRequest) {
        if (typeof retrieveContext !== 'function') {
          return { success: false, error: 'Retrieval indisponible.' };
        }
        const retrieval = await retrieveContext(executionOptions.retrievalRequest);
        if (!retrieval?.success) return retrieval || { success: false, error: 'Retrieval refuse.' };
        executionOptions = {
          ...executionOptions,
          retrievalContext: retrieval.context,
          toolsAllowed: false,
          promptSafety: retrieval.promptSafety || { source: 'untrusted-data', allowInstructions: false, allowToolCalls: false }
        };
      }
      const response = executionOptions.credentialMode === 'managed'
        ? await managedCompletionRunner?.({
          workspaceId: executionOptions.workspaceId || executionOptions.projectPath,
          profile: executionOptions.nevenCoreExecutionContext?.profile || executionOptions.providerPolicy?.profile,
          payload: {
            mode: 'chat', provider, history, currentCode, allProjectFiles,
            retrievalContext: executionOptions.retrievalContext,
            toolsAllowed: executionOptions.toolsAllowed,
            promptSafety: executionOptions.promptSafety
          }
        }) || { success: false, error: 'Execution managed Neven indisponible.' }
        : await handler({
        history,
        currentCode,
        allProjectFiles,
        // Le signal est injecte ici et non cote renderer : un AbortSignal n'est
        // pas serialisable a travers le pont IPC, il doit naitre dans le main.
        options: controller ? { ...executionOptions, signal: controller.signal } : executionOptions,
        getMainWindow,
        executeCommandForAI,
        showErrorBox: (title, message) => dialog.showErrorBox(title, message)
        });
      return sanitizeCompletionResponse(response, executionOptions);
    } catch (error) {
      if (controller?.signal?.aborted) {
        return { success: false, aborted: true, error: 'Generation annulee.' };
      }
      return sanitizeCompletionResponse({ success: false, error: error?.message || String(error) }, executionOptions);
    } finally {
      releaseRun(runId, controller);
    }
  });
};

const registerAIHandlers = ({
  ipcMain = electronIpcMain,
  getMainWindow,
  executeCommandForAI = defaultExecuteCommandForAI,
  listAgents = defaultListAgents,
  listSkills = defaultListSkills,
  completionHandlers = providerHandlers,
  completionRunner = runSingleCompletionProvider,
  managedCompletionRunner,
  retrieveContext
} = {}) => {
  ipcMain.handle('list-gemini-models', async (_event, apiKey) => listGeminiModels(apiKey));

  ipcMain.handle('cancel-ai-generation', async (_event, runId) => {
    const controller = runId ? activeRuns.get(runId) : null;
    if (!controller) {
      // Cas normal quand la generation vient de finir d'elle-meme : pas une erreur.
      return { success: false, reason: 'no-active-run' };
    }
    controller.abort();
    activeRuns.delete(runId);
    return { success: true };
  });

  registerProviderCompletionHandler({
    ipcMain,
    channel: 'get-kimi-completion',
    provider: 'kimi',
    getMainWindow,
    executeCommandForAI,
    listAgents,
    listSkills,
    completionHandlers
    ,managedCompletionRunner, retrieveContext
  });
  registerProviderCompletionHandler({
    ipcMain,
    channel: 'get-gemini-completion',
    provider: 'gemini',
    getMainWindow,
    executeCommandForAI,
    listAgents,
    listSkills,
    completionHandlers
    ,managedCompletionRunner, retrieveContext
  });
  registerProviderCompletionHandler({
    ipcMain,
    channel: 'get-claude-completion',
    provider: 'claude',
    getMainWindow,
    executeCommandForAI,
    listAgents,
    listSkills,
    completionHandlers
    ,managedCompletionRunner, retrieveContext
  });
  registerProviderCompletionHandler({
    ipcMain,
    channel: 'get-ollama-completion',
    provider: 'ollama',
    getMainWindow,
    executeCommandForAI,
    listAgents,
    listSkills,
    completionHandlers
    ,managedCompletionRunner, retrieveContext
  });

  ipcMain.handle('get-inline-completion', async (_event, prompt, code, options = {}) => {
    const systemInstruction = `Tu es un assistant de complétion de code ultra-strict.
RÈGLES ABSOLUES:
1. Ne renvoie QUE le code complété ou modifié.
2. N'ajoute AUCUN bloc markdown (\`\`\`), ni préfixe, ni texte explicatif.
3. Le texte que tu renvoies remplacera EXACTEMENT la sélection de l'utilisateur.`;

    try {
      const executionOptions = await prepareNevenCoreExecutionOptions({
        options,
        prompt,
        listAgents,
        listSkills
      });
      const response = executionOptions.credentialMode === 'managed'
        ? await managedCompletionRunner?.({
          workspaceId: executionOptions.workspaceId || executionOptions.projectPath,
          profile: executionOptions.nevenCoreExecutionContext?.profile || executionOptions.providerPolicy?.profile,
          payload: { mode: 'inline', provider: options.provider, systemInstruction, userPrompt: `CONTEXTE DU FICHIER:\n${code}\n\nINSTRUCTION OU CODE SELECTIONNE:\n${prompt}`, maxTokens: 2048 }
        }) || { success: false, error: 'Execution managed Neven indisponible.' }
        : await completionRunner({
        provider: options.provider,
        systemInstruction: `${systemInstruction}${formatNevenCoreExecutionPrompt(executionOptions.nevenCoreExecutionContext)}`,
        userPrompt: `CONTEXTE DU FICHIER:\n${code}\n\nINSTRUCTION OU CODE SELECTIONNE:\n${prompt}`,
        options: executionOptions,
        maxTokens: 2048
        });
      return sanitizeCompletionResponse(response, executionOptions);
    } catch (error) {
      console.error('[AIHandlers] Erreur Inline Completion:', error);
      return sanitizeCompletionResponse({ success: false, error: error.message }, options);
    }
  });

  ipcMain.handle('get-ghost-completion', async (_event, prefix, suffix, options = {}) => {
    const systemInstruction = `Tu es une IA ultra-rapide d'autocomplétion de code (Fill-In-The-Middle).
Ton but est de prédire EXACTEMENT le code qui manque entre le <PREFIX> (avant le curseur) et le <SUFFIX> (après le curseur).
RÈGLES ABSOLUES:
1. NE RENVOIE QUE LE TEXTE MANQUANT. Rien d'autre.
2. N'ajoute AUCUN bloc markdown (\`\`\`), ni préfixe, ni explication.
3. Si aucune complétion n'est logique, renvoie une chaîne vide.`;

    try {
      const executionOptions = await prepareNevenCoreExecutionOptions({
        options,
        prompt: `${prefix}\n${suffix}`,
        listAgents,
        listSkills
      });
      const response = executionOptions.credentialMode === 'managed'
        ? await managedCompletionRunner?.({
          workspaceId: executionOptions.workspaceId || executionOptions.projectPath,
          profile: executionOptions.nevenCoreExecutionContext?.profile || executionOptions.providerPolicy?.profile,
          payload: { mode: 'ghost', provider: options.provider, systemInstruction, userPrompt: `<PREFIX>\n${prefix}\n</PREFIX>\n\n<SUFFIX>\n${suffix}\n</SUFFIX>`, maxTokens: 256 }
        }) || { success: false, error: 'Execution managed Neven indisponible.' }
        : await completionRunner({
        provider: options.provider,
        systemInstruction: `${systemInstruction}${formatNevenCoreExecutionPrompt(executionOptions.nevenCoreExecutionContext)}`,
        userPrompt: `<PREFIX>\n${prefix}\n</PREFIX>\n\n<SUFFIX>\n${suffix}\n</SUFFIX>`,
        options: executionOptions,
        maxTokens: 256,
        trimEndOnly: true
        });
      return sanitizeCompletionResponse(response, executionOptions);
    } catch (error) {
      console.error('[AIHandlers] Erreur Ghost Completion:', error);
      return sanitizeCompletionResponse({ success: false, error: error.message }, options);
    }
  });
};

module.exports = {
  registerAIHandlers,
  prepareNevenCoreExecutionOptions,
  getLatestUserPrompt,
  sanitizeCompletionResponse,
  cleanRendererCompletionOptions
};
