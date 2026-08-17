'use strict';

const { ipcMain: electronIpcMain } = require('electron');
const { routeToDecision } = require('../services/router.service');

// Enregistre le handler IPC du routeur intelligent ('route-request').
// Le handler ne throw JAMAIS au renderer : routeToDecision renvoie toujours success:true
// (decision de repli sure en cas d'echec). Le chemin projet est resolu/trust AVANT usage
// via resolveOptionalTrustedProjectPath (null si absent ; on retombe sur le scope global
// si le chemin n'est pas autorise, sans jamais faire echouer la reponse).
const registerRouterHandlers = ({
  ipcMain = electronIpcMain,
  getMainWindow, // conserve pour homogeneite de signature (non utilise ici)
  listAgents,
  listSkills,
  runSingleCompletionProvider,
  ensureTrustedProjectPath, // fourni par symetrie avec les autres handlers (non utilise directement)
  resolveOptionalTrustedProjectPath,
  resolveWorkspaceContext = async () => null,
  routeToDecision: routeToDecisionImpl = routeToDecision
} = {}) => {
  ipcMain.handle('route-request', async (event, projectPath, userPrompt, options = {}) => {
    let trustedProjectPath = null;
    try {
      trustedProjectPath = typeof resolveOptionalTrustedProjectPath === 'function'
        ? await resolveOptionalTrustedProjectPath(projectPath)
        : null;
    } catch {
      // Chemin invalide / non autorise -> routage sur le scope global uniquement.
      trustedProjectPath = null;
    }

    let workspaceContext = null;
    try {
      workspaceContext = await resolveWorkspaceContext(event);
    } catch {
      workspaceContext = null;
    }

    return routeToDecisionImpl({
      projectPath: trustedProjectPath,
      userPrompt,
      provider: options.provider,
      apiKey: options.apiKey,
      hardwareProfile: options.hardwareProfile,
      settings: options.settings,
      listAgents,
      listSkills,
      runSingleCompletionProvider,
      workspaceContext
    });
  });
};

module.exports = { registerRouterHandlers };
