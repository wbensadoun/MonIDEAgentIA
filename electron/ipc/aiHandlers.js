'use strict';

const loadDefaultProviders = () => ({
  gemini: require('../services/ai-providers/gemini.provider').getGeminiCompletion,
  claude: require('../services/ai-providers/claude.provider').getClaudeCompletion,
  kimi: require('../services/ai-providers/kimi.provider').getKimiCompletion,
  ollama: require('../services/ai-providers/ollama.provider').getOllamaCompletion
});

// Registre des generations en cours : runId -> AbortController.
//
// ipcMain.handle est un aller-retour anonyme : sans identifiant de requete, le
// renderer n'a aucun moyen de designer LA generation a interrompre. C'est
// exactement ce qui rendait le bouton "Arreter" decoratif — un AbortController
// etait bien cree cote React, mais son signal ne quittait jamais le renderer.
const activeRuns = new Map();

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
    // La télémétrie ne doit jamais modifier le résultat de la complétion.
  }
};

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

const runManagedCompletion = async ({ options = {}, provider, publishUsageEvent, execute, onError }) => {
  const runId = options?.runId || null;
  const startedAt = Date.now();
  const controller = registerRun(runId);
  try {
    const result = await execute(controller ? { ...options, signal: controller.signal } : options);
    const finalResult = controller?.signal?.aborted
      ? { success: false, aborted: true, error: 'Generation annulee.', provider }
      : result;
    publishCompletionUsage({ publishUsageEvent, provider, startedAt, result: finalResult });
    return finalResult;
  } catch (error) {
    const result = controller?.signal?.aborted
      ? { success: false, aborted: true, error: 'Generation annulee.', provider }
      : onError(error);
    publishCompletionUsage({ publishUsageEvent, provider, startedAt, result });
    return result;
  } finally {
    releaseRun(runId, controller);
  }
};

const registerProviderCompletionHandler = ({
  ipcMain,
  channel,
  provider,
  getMainWindow,
  executeCommandForAI,
  publishUsageEvent,
  dialog,
  providers
}) => {
  const handler = providers[provider];
  if (typeof handler !== 'function') {
    throw new Error(`Provider IA non supporte: ${provider}`);
  }

  ipcMain.handle(channel, async (_event, history, currentCode, allProjectFiles = null, options = {}) => {
    return runManagedCompletion({
      options,
      provider,
      publishUsageEvent,
      execute: (managedOptions) => handler({
        history,
        currentCode,
        allProjectFiles,
        // Le signal est injecte ici et non cote renderer : un AbortSignal n'est
        // pas serialisable a travers le pont IPC, il doit naitre dans le main.
        options: managedOptions,
        getMainWindow,
        executeCommandForAI,
        showErrorBox: (title, message) => dialog?.showErrorBox?.(title, message)
      }),
      onError: (error) => ({ success: false, error: error?.message || String(error), provider })
    });
  });
};

const registerAIHandlers = ({
  ipcMain,
  dialog,
  getMainWindow,
  executeCommandForAI,
  publishUsageEvent,
  runSingleCompletion,
  providers,
  listGeminiModels
} = {}) => {
  if (!ipcMain || !dialog) {
    const electron = require('electron');
    ipcMain ||= electron.ipcMain;
    dialog ||= electron.dialog;
  }
  const aiService = (!executeCommandForAI || !runSingleCompletion) ? require('../services/ai.service') : null;
  executeCommandForAI ||= aiService.executeCommandForAI;
  runSingleCompletion ||= aiService.runSingleCompletionProvider;
  providers ||= loadDefaultProviders();
  ipcMain.handle('list-gemini-models', async (_event, apiKey) =>
    (listGeminiModels || require('../services/ai-providers/gemini.provider').listGeminiModels)(apiKey));

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
    publishUsageEvent,
    dialog,
    providers
  });
  registerProviderCompletionHandler({
    ipcMain,
    channel: 'get-gemini-completion',
    provider: 'gemini',
    getMainWindow,
    executeCommandForAI,
    publishUsageEvent,
    dialog,
    providers
  });
  registerProviderCompletionHandler({
    ipcMain,
    channel: 'get-claude-completion',
    provider: 'claude',
    getMainWindow,
    executeCommandForAI,
    publishUsageEvent,
    dialog,
    providers
  });
  registerProviderCompletionHandler({
    ipcMain,
    channel: 'get-ollama-completion',
    provider: 'ollama',
    getMainWindow,
    executeCommandForAI,
    publishUsageEvent,
    dialog,
    providers
  });

  ipcMain.handle('get-inline-completion', async (_event, prompt, code, options = {}) => {
    const systemInstruction = `Tu es un assistant de complétion de code ultra-strict.
RÈGLES ABSOLUES:
1. Ne renvoie QUE le code complété ou modifié.
2. N'ajoute AUCUN bloc markdown (\`\`\`), ni préfixe, ni texte explicatif.
3. Le texte que tu renvoies remplacera EXACTEMENT la sélection de l'utilisateur.`;

    return runManagedCompletion({
      options,
      provider: options.provider || 'unknown',
      publishUsageEvent,
      execute: (managedOptions) => runSingleCompletion({
        provider: options.provider,
        systemInstruction,
        userPrompt: `CONTEXTE DU FICHIER:\n${code}\n\nINSTRUCTION OU CODE SELECTIONNE:\n${prompt}`,
        options: managedOptions,
        maxTokens: 2048
      }),
      onError: (error) => ({ success: false, error: error?.message || String(error) })
    });
  });

  ipcMain.handle('get-ghost-completion', async (_event, prefix, suffix, options = {}) => {
    const systemInstruction = `Tu es une IA ultra-rapide d'autocomplétion de code (Fill-In-The-Middle).
Ton but est de prédire EXACTEMENT le code qui manque entre le <PREFIX> (avant le curseur) et le <SUFFIX> (après le curseur).
RÈGLES ABSOLUES:
1. NE RENVOIE QUE LE TEXTE MANQUANT. Rien d'autre.
2. N'ajoute AUCUN bloc markdown (\`\`\`), ni préfixe, ni explication.
3. Si aucune complétion n'est logique, renvoie une chaîne vide.`;

    return runManagedCompletion({
      options,
      provider: options.provider || 'unknown',
      publishUsageEvent,
      execute: (managedOptions) => runSingleCompletion({
        provider: options.provider,
        systemInstruction,
        userPrompt: `<PREFIX>\n${prefix}\n</PREFIX>\n\n<SUFFIX>\n${suffix}\n</SUFFIX>`,
        options: managedOptions,
        maxTokens: 256,
        trimEndOnly: true
      }),
      onError: (error) => ({ success: false, error: error?.message || String(error) })
    });
  });
};

module.exports = { registerAIHandlers };
