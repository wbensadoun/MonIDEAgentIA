'use strict';

const { ipcMain: electronIpcMain, dialog } = require('electron');
const { listGeminiModels, getGeminiCompletion } = require('../services/ai-providers/gemini.provider');
const { getClaudeCompletion } = require('../services/ai-providers/claude.provider');
const { getKimiCompletion } = require('../services/ai-providers/kimi.provider');
const { getOllamaCompletion } = require('../services/ai-providers/ollama.provider');
const { getDashScopeCompletion } = require('../services/ai-providers/dashscope.provider');
const {
  executeCommandForAI: defaultExecuteCommandForAI,
  runSingleCompletionProvider,
  normalizeCompletionProvider,
  runProviderCompletionWithPolicy
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
const { createProviderContract } = require('../services/provider-contract.service');

const providerHandlers = {
  gemini: getGeminiCompletion,
  claude: getClaudeCompletion,
  kimi: getKimiCompletion,
  ollama: getOllamaCompletion,
  dashscope: getDashScopeCompletion
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

// La télémétrie est strictement secondaire : ni le réseau ni une erreur de
// publication ne doivent retarder ou modifier la réponse IPC.
const publishCompletionUsage = ({ publishUsageEvent, provider, startedAt, result }) => {
  if (typeof publishUsageEvent !== 'function') return;
  const usage = result?.usage || {};
  try {
    Promise.resolve(publishUsageEvent({
      providerId: provider,
      inputTokens: usage.inputTokens ?? usage.promptTokens,
      outputTokens: usage.outputTokens ?? usage.completionTokens,
      durationMs: Math.max(0, Date.now() - startedAt),
      success: result?.success === true
    })).catch(() => {});
  } catch {
    // Publication best-effort uniquement.
  }
};

const isTechnicalResponseKey = (key) => {
  const normalized = String(key || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
  return normalized === 'provider'
    || normalized.includes('provider')
    || normalized.includes('model')
    || normalized.includes('profile')
    || normalized.includes('resolved')
    || normalized === 'source'
    || normalized.includes('metadata')
    || normalized.includes('usage')
    || normalized.includes('duration')
    || normalized.includes('cost')
    || normalized.includes('retry')
    || normalized.includes('errorcode');
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
  return text
    .replace(/\b(gemini|claude|kimi|ollama|dashscope|neven)\b/gi, 'provider IA')
    .replace(/\bprovider\b/gi, 'provider IA');
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
  // Les credentials ne traversent jamais IPC : les providers les résolvent
  // depuis l'environnement ou le vault dans le processus principal.
  ['apiKey', 'geminiApiKey', 'claudeApiKey', 'kimiApiKey', 'ollamaApiKey', 'dashscopeApiKey', 'apiUrl', 'authorization', 'credential', 'managedCredential', 'secret', 'accessToken', 'credentialMode', 'providerPolicy', 'origin', 'providerOrigin'].forEach((key) => delete cleaned[key]);
  return cleaned;
};

// The channel is the authority for regular completions. Renderer options may
// select a model but cannot redirect a channel to another provider.
const forceChannelCompletionProvider = (options, provider) => ({
  ...cleanRendererCompletionOptions(options),
  provider
});

// Inline/ghost use the same backend contract. An omitted provider keeps the
// historical Gemini default; an unknown explicit provider is rejected.
const normalizeInlineCompletionOptions = (options) => ({
  ...cleanRendererCompletionOptions(options),
  provider: normalizeCompletionProvider(options?.provider)
});

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
        // The resolver can depend on remote/provider state. Do not echo its
        // error message here: it may contain transport metadata.
        console.warn('[AIHandlers] Neven Core model resolution unavailable; using requested model.');
      }
    }

    return { ...cleanedOptions, nevenCoreExecutionContext: context };
  } catch (error) {
    // Core Lite is optional; keep the original execution path without logging
    // catalog or provider error payloads.
    console.warn('[AIHandlers] Neven Core execution context unavailable; using standard completion.');
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
  completionContract,
  publishUsageEvent,
  resolveWorkspaceContext,
  resolveProfileModel = resolveModelForProfile
}) => {
  ipcMain.handle(channel, async (event, history, currentCode, allProjectFiles = null, options = {}) => {
    const runId = options?.runId || null;
    const controller = registerRun(runId);
    const startedAt = Date.now();
    let executionOptions = forceChannelCompletionProvider(options, provider);
    let completionResult;
    try {
      executionOptions = await prepareNevenCoreExecutionOptions({
        options: executionOptions,
        prompt: getLatestUserPrompt(history),
        listAgents,
        listSkills,
        resolveProfileModel
      });
      const request = {
          kind: 'chat', history, currentCode, allProjectFiles, getMainWindow, executeCommandForAI,
          workspaceContext: typeof resolveWorkspaceContext === 'function' ? await resolveWorkspaceContext(event) : null,
          emitToken: (payload) => {
            const window = typeof getMainWindow === 'function' ? getMainWindow() : null;
            if (window && !window.isDestroyed()) window.webContents.send('ai-generation-token', payload);
          },
          showErrorBox: (title, message) => dialog.showErrorBox(title, message)
        };
      let response;
      if (completionContract.capabilities(provider).streaming) {
        for await (const event of completionContract.stream({
          provider,
          request: { ...request, onComplete: (result) => { response = result; } },
          options: controller ? { ...executionOptions, signal: controller.signal } : executionOptions
        })) {
          request.emitToken(event);
        }
        if (!response) response = { success: false, error: 'Flux provider interrompu.' };
      } else {
        response = await completionContract.complete({
          provider,
          request,
        // Le signal est injecte ici et non cote renderer : un AbortSignal n'est
        // pas serialisable a travers le pont IPC, il doit naitre dans le main.
          options: controller ? { ...executionOptions, signal: controller.signal } : executionOptions
        });
      }
      completionResult = response;
      return sanitizeCompletionResponse(response, executionOptions);
    } catch (error) {
      if (controller?.signal?.aborted) {
        completionResult = { success: false, aborted: true };
        return { success: false, aborted: true, error: 'Generation annulee.' };
      }
      completionResult = { success: false };
      return sanitizeCompletionResponse({ success: false, error: error?.message || String(error) }, executionOptions);
    } finally {
      publishCompletionUsage({ publishUsageEvent, provider, startedAt, result: completionResult });
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
  publishUsageEvent,
  resolveWorkspaceContext,
  resolveProfileModel = resolveModelForProfile
} = {}) => {
  const completionContract = createProviderContract({
    adapters: Object.fromEntries(['gemini', 'claude', 'kimi', 'ollama', 'dashscope'].map((provider) => [provider, {
      // Gemini/Claude n'ont pas de stream implémenté dans ce produit; health
      // non implémenté signifie explicitement unsupported dans le contrat.
      capabilities: { streaming: provider === 'kimi' || provider === 'ollama', usage: true, cost: 'unpriced', health: false },
      complete: async ({ kind, options, ...request }) => {
        if (kind === 'chat') {
          const handler = completionHandlers[provider];
          if (typeof handler !== 'function') throw new Error(`Provider IA non supporte: ${provider}`);
          return runProviderCompletionWithPolicy({
            provider,
            request,
            options,
            execute: (executionRequest) => handler({ ...executionRequest, options: executionRequest.options })
          });
        }
        return completionRunner({ ...request, provider, options });
      },
      stream: (provider === 'kimi' || provider === 'ollama') ? async function* ({ options, onComplete, ...request }) {
        const handler = completionHandlers[provider];
        if (typeof handler !== 'function') throw new Error(`Provider IA non supporte: ${provider}`);
        const events = [];
        let wake = null;
        let settled = false;
        let result;
        const emitToken = (event) => {
          if (settled) return;
          events.push(event);
          wake?.();
          wake = null;
        };
        Promise.resolve(runProviderCompletionWithPolicy({
          provider,
          request: { ...request, emitToken },
          options: { ...options, streamResponse: true },
          execute: (executionRequest) => handler({ ...executionRequest, options: executionRequest.options })
        }))
          .then((value) => { result = value; settled = true; wake?.(); })
          .catch((error) => { result = { success: false, error: error?.message || String(error) }; settled = true; wake?.(); });
        while (!settled || events.length) {
          if (!events.length) await new Promise((resolve) => { wake = resolve; });
          while (events.length) yield events.shift();
        }
        onComplete?.(result);
      } : undefined
    }]))
  });
  ipcMain.handle('list-gemini-models', async () => listGeminiModels(process.env.GEMINI_API_KEY));

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
      completionContract,
      publishUsageEvent,
      resolveWorkspaceContext,
      resolveProfileModel
  });
  registerProviderCompletionHandler({
    ipcMain,
    channel: 'get-dashscope-completion',
    provider: 'dashscope',
    getMainWindow,
    executeCommandForAI,
    listAgents,
      listSkills,
      completionContract,
      publishUsageEvent,
      resolveWorkspaceContext,
      resolveProfileModel
  });
  registerProviderCompletionHandler({
    ipcMain,
    channel: 'get-gemini-completion',
    provider: 'gemini',
    getMainWindow,
    executeCommandForAI,
    listAgents,
      listSkills,
      completionContract,
      publishUsageEvent,
      resolveWorkspaceContext,
      resolveProfileModel
  });
  registerProviderCompletionHandler({
    ipcMain,
    channel: 'get-claude-completion',
    provider: 'claude',
    getMainWindow,
    executeCommandForAI,
    listAgents,
      listSkills,
      completionContract,
      publishUsageEvent,
      resolveWorkspaceContext,
      resolveProfileModel
  });
  registerProviderCompletionHandler({
    ipcMain,
    channel: 'get-ollama-completion',
    provider: 'ollama',
    getMainWindow,
    executeCommandForAI,
    listAgents,
      listSkills,
      completionContract,
      publishUsageEvent,
      resolveWorkspaceContext,
      resolveProfileModel
  });

  ipcMain.handle('get-inline-completion', async (event, prompt, code, options = {}) => {
    const systemInstruction = `Tu es un assistant de complétion de code ultra-strict.
RÈGLES ABSOLUES:
1. Ne renvoie QUE le code complété ou modifié.
2. N'ajoute AUCUN bloc markdown (\`\`\`), ni préfixe, ni texte explicatif.
3. Le texte que tu renvoies remplacera EXACTEMENT la sélection de l'utilisateur.`;

    const runId = options?.runId || null;
    const controller = registerRun(runId);
    const startedAt = Date.now();
    let executionOptions = normalizeInlineCompletionOptions(options);
    let completionResult;
    try {
      executionOptions = await prepareNevenCoreExecutionOptions({
        options: executionOptions,
        prompt,
        listAgents,
        listSkills,
        resolveProfileModel
      });
      const response = await completionContract.complete({
        provider: executionOptions.provider,
        request: {
          kind: 'compact',
          systemInstruction: `${systemInstruction}${formatNevenCoreExecutionPrompt(executionOptions.nevenCoreExecutionContext)}`,
          userPrompt: `CONTEXTE DU FICHIER:\n${code}\n\nINSTRUCTION OU CODE SELECTIONNE:\n${prompt}`,
          maxTokens: 2048,
          workspaceContext: typeof resolveWorkspaceContext === 'function' ? await resolveWorkspaceContext(event) : null
        },
        options: controller ? { ...executionOptions, signal: controller.signal } : executionOptions
      });
      completionResult = response;
      return sanitizeCompletionResponse(response, executionOptions);
    } catch (error) {
      console.warn('[AIHandlers] Inline completion unavailable.');
      completionResult = { success: false };
      return sanitizeCompletionResponse({ success: false, error: error?.message || String(error) }, executionOptions);
    } finally {
      publishCompletionUsage({
        publishUsageEvent,
        provider: executionOptions.provider,
        startedAt,
        result: completionResult
      });
      releaseRun(runId, controller);
    }
  });

  ipcMain.handle('get-ghost-completion', async (event, prefix, suffix, options = {}) => {
    const systemInstruction = `Tu es une IA ultra-rapide d'autocomplétion de code (Fill-In-The-Middle).
Ton but est de prédire EXACTEMENT le code qui manque entre le <PREFIX> (avant le curseur) et le <SUFFIX> (après le curseur).
RÈGLES ABSOLUES:
1. NE RENVOIE QUE LE TEXTE MANQUANT. Rien d'autre.
2. N'ajoute AUCUN bloc markdown (\`\`\`), ni préfixe, ni explication.
3. Si aucune complétion n'est logique, renvoie une chaîne vide.`;

    const runId = options?.runId || null;
    const controller = registerRun(runId);
    const startedAt = Date.now();
    let executionOptions = normalizeInlineCompletionOptions(options);
    let completionResult;
    try {
      executionOptions = await prepareNevenCoreExecutionOptions({
        options: executionOptions,
        prompt: `${prefix}\n${suffix}`,
        listAgents,
        listSkills,
        resolveProfileModel
      });
      const response = await completionContract.complete({
        provider: executionOptions.provider,
        request: {
          kind: 'compact',
          systemInstruction: `${systemInstruction}${formatNevenCoreExecutionPrompt(executionOptions.nevenCoreExecutionContext)}`,
          userPrompt: `<PREFIX>\n${prefix}\n</PREFIX>\n\n<SUFFIX>\n${suffix}\n</SUFFIX>`,
          maxTokens: 256,
          trimEndOnly: true,
          workspaceContext: typeof resolveWorkspaceContext === 'function' ? await resolveWorkspaceContext(event) : null
        },
        options: controller ? { ...executionOptions, signal: controller.signal } : executionOptions
      });
      completionResult = response;
      return sanitizeCompletionResponse(response, executionOptions);
    } catch (error) {
      console.warn('[AIHandlers] Ghost completion unavailable.');
      completionResult = { success: false };
      return sanitizeCompletionResponse({ success: false, error: error?.message || String(error) }, executionOptions);
    } finally {
      publishCompletionUsage({
        publishUsageEvent,
        provider: executionOptions.provider,
        startedAt,
        result: completionResult
      });
      releaseRun(runId, controller);
    }
  });
};

module.exports = {
  registerAIHandlers,
  prepareNevenCoreExecutionOptions,
  getLatestUserPrompt,
  sanitizeCompletionResponse,
  cleanRendererCompletionOptions,
  forceChannelCompletionProvider,
  normalizeInlineCompletionOptions
};
