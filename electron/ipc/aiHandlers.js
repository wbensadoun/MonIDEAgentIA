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

const registerProviderCompletionHandler = ({
  ipcMain,
  channel,
  provider,
  getMainWindow,
  executeCommandForAI
}) => {
  const handler = providerHandlers[provider];
  if (typeof handler !== 'function') {
    throw new Error(`Provider IA non supporte: ${provider}`);
  }

  ipcMain.handle(channel, async (_event, history, currentCode, allProjectFiles = null, options = {}) => {
    const runId = options?.runId || null;
    const controller = registerRun(runId);
    try {
      return await handler({
        history,
        currentCode,
        allProjectFiles,
        // Le signal est injecte ici et non cote renderer : un AbortSignal n'est
        // pas serialisable a travers le pont IPC, il doit naitre dans le main.
        options: controller ? { ...options, signal: controller.signal } : options,
        getMainWindow,
        executeCommandForAI,
        showErrorBox: (title, message) => dialog.showErrorBox(title, message)
      });
    } catch (error) {
      if (controller?.signal?.aborted) {
        return { success: false, aborted: true, error: 'Generation annulee.', provider };
      }
      return { success: false, error: error?.message || String(error), provider };
    } finally {
      releaseRun(runId, controller);
    }
  });
};

const registerAIHandlers = ({
  ipcMain = electronIpcMain,
  getMainWindow,
  executeCommandForAI = defaultExecuteCommandForAI
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
    executeCommandForAI
  });
  registerProviderCompletionHandler({
    ipcMain,
    channel: 'get-gemini-completion',
    provider: 'gemini',
    getMainWindow,
    executeCommandForAI
  });
  registerProviderCompletionHandler({
    ipcMain,
    channel: 'get-claude-completion',
    provider: 'claude',
    getMainWindow,
    executeCommandForAI
  });
  registerProviderCompletionHandler({
    ipcMain,
    channel: 'get-ollama-completion',
    provider: 'ollama',
    getMainWindow,
    executeCommandForAI
  });

  ipcMain.handle('get-inline-completion', async (_event, prompt, code, options = {}) => {
    const systemInstruction = `Tu es un assistant de complétion de code ultra-strict.
RÈGLES ABSOLUES:
1. Ne renvoie QUE le code complété ou modifié.
2. N'ajoute AUCUN bloc markdown (\`\`\`), ni préfixe, ni texte explicatif.
3. Le texte que tu renvoies remplacera EXACTEMENT la sélection de l'utilisateur.`;

    try {
      return await runSingleCompletionProvider({
        provider: options.provider,
        systemInstruction,
        userPrompt: `CONTEXTE DU FICHIER:\n${code}\n\nINSTRUCTION OU CODE SELECTIONNE:\n${prompt}`,
        options,
        maxTokens: 2048
      });
    } catch (error) {
      console.error('[AIHandlers] Erreur Inline Completion:', error);
      return { success: false, error: error.message };
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
      return await runSingleCompletionProvider({
        provider: options.provider,
        systemInstruction,
        userPrompt: `<PREFIX>\n${prefix}\n</PREFIX>\n\n<SUFFIX>\n${suffix}\n</SUFFIX>`,
        options,
        maxTokens: 256,
        trimEndOnly: true
      });
    } catch (error) {
      console.error('[AIHandlers] Erreur Ghost Completion:', error);
      return { success: false, error: error.message };
    }
  });
};

module.exports = { registerAIHandlers };
