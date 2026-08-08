// main.js
require('dotenv').config();
const { app, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const logger = require('./logger');
const { registerAppLifecycle } = require('./electron/core/appLifecycle');
const { registerLogHandlers } = require('./electron/ipc/logHandlers');
const { registerProcessHandlers } = require('./electron/ipc/processHandlers');
const { registerProjectHandlers } = require('./electron/ipc/projectHandlers');
const { registerQualityHandlers } = require('./electron/ipc/qualityHandlers');
const { registerSystemHandlers } = require('./electron/ipc/systemHandlers');
const { registerSkillHandlers } = require('./electron/ipc/skillHandlers');
const { registerGitHandlers } = require('./electron/ipc/gitHandlers');
const { registerWorkflowHandlers } = require('./electron/ipc/workflowHandlers');
const { registerBrainGraphHandlers } = require('./electron/ipc/brainGraphHandlers');
const {
  configureAIService,
  getN8nCatalogEntries,
  fetchTrustedN8nWorkflow,
  executeCommandForAI,
  runSingleCompletionProvider,
} = require('./electron/services/ai.service');
// --- Modules refactorisés ---
const {
  assertSafePath, toPositiveInt,
  trustProjectPath, ensureTrustedProjectPath,
  resolveOptionalTrustedProjectPath,
} = require('./electron/core/security');
const { listAgents, listSkills } = require('./electron/services/agent.service');
const {
  ensureEditPermission,
} = require('./electron/services/settings.service');
const { createProcessService } = require('./electron/services/process.service');
const { runGit } = require('./electron/services/git.service');
const { registerSettingsHandlers } = require('./electron/ipc/settingsHandlers');
const { registerConversationHandlers } = require('./electron/ipc/conversationHandlers');
const { registerFileHandlers } = require('./electron/ipc/fileHandlers');
const { registerSnapshotHandlers } = require('./electron/ipc/snapshotHandlers');
const { registerAgentHandlers } = require('./electron/ipc/agentHandlers');
const { registerOllamaHandlers } = require('./electron/ipc/ollamaHandlers');
const { registerAIHandlers } = require('./electron/ipc/aiHandlers');
const { registerRouterHandlers } = require('./electron/ipc/routerHandlers');
const { registerPtyHandlers } = require('./electron/ipc/ptyHandlers');
const { createPtyService } = require('./electron/services/pty.service');
const { registerProviderHandlers } = require('./electron/ipc/providerHandlers');
const { ProviderSecretVault } = require('./electron/services/provider-secret-vault.service');
const { resolveProviderCredential } = require('./electron/services/provider-policy.service');
const {
  NevenControlPlaneClient,
  createNevenAccessResolver
} = require('./electron/services/neven-control-plane.service');

const isDev =
  process.env.NODE_ENV === 'development' ||
  process.env.ELECTRON_IS_DEV === '1' ||
  process.defaultApp === true;

const installStdioBrokenPipeGuards = () => {
  const guard = (err) => {
    if (!err) return;
    if (err.code === 'EPIPE' || err.code === 'ERR_STREAM_DESTROYED') {
      return;
    }
    try {
      const message = `[Main] stdio stream error: ${err.message || String(err)}\n`;
      fsSync.writeSync(2, message);
    } catch {
      // Ignore: stderr might not be available.
    }
  };
  try {
    if (process.stdout && typeof process.stdout.on === 'function') {
      process.stdout.on('error', guard);
    }
  } catch {
    // ignore
  }
  try {
    if (process.stderr && typeof process.stderr.on === 'function') {
      process.stderr.on('error', guard);
    }
  } catch {
    // ignore
  }
};

installStdioBrokenPipeGuards();

let mainWindow;
const providerSecretVault = new ProviderSecretVault({
  filePath: ProviderSecretVault.defaultFilePath(app.getPath('userData'))
});
// Le control plane Neven reste dans le main process. Il ne retourne jamais de
// cle fournisseur au renderer : uniquement un droit court vers la passerelle
// Neven, conservé en mémoire et destiné aux futures exécutions managed.
const nevenControlPlane = new NevenControlPlaneClient();
const resolveNevenAccess = createNevenAccessResolver({ client: nevenControlPlane });
const resolveManagedProviderCredential = ({ provider, workspaceId, policy }) => resolveProviderCredential({
  provider,
  workspaceId,
  policy,
  vault: providerSecretVault,
  nevenCredentialResolver: async ({ provider: normalizedProvider }) => {
    if (normalizedProvider === 'neven') {
      return resolveNevenAccess({
        workspaceId,
        profile: policy?.profile,
        capability: policy?.capability || 'completion'
      });
    }
    const environmentKeys = {
      gemini: ['GEMINI_API_KEY'],
      claude: ['CLAUDE_API_KEY', 'ANTHROPIC_API_KEY'],
      kimi: ['KIMI_API_KEY', 'TOGETHER_API_KEY']
    }[normalizedProvider] || [];
    return environmentKeys.map((key) => process.env[key]).find(Boolean) || null;
  }
});
configureAIService({ dialog, getMainWindow: () => mainWindow });
const processService = createProcessService({ getMainWindow: () => mainWindow });
const ptyService = createPtyService({ getMainWindow: () => mainWindow });

// Deuxieme passe de configuration : configureAIService fusionne ses deps, et
// ptyService n'existe pas encore ligne 85. Donne a l'outil <read_terminal> des
// providers un acces LECTURE SEULE au tampon du terminal partage.
configureAIService({ ptyService, resolveProviderCredential: resolveManagedProviderCredential });

// Des shells reels doivent etre tues explicitement : contrairement aux
// process.service (spawn de commandes ponctuelles, deja termines pour la
// plupart), un pty reste vivant indefiniment tant qu'on ne le kill pas. Sans
// ce hook, fermer la fenetre laisserait des powershell.exe/bash orphelins.
app.on('before-quit', () => {
  ptyService.killAll();
});

const getLogsDir = () => {
  return path.join(app.getPath('userData'), 'logs');
};

const getLatestLogPath = async () => {
  const logDir = getLogsDir();
  const files = await fs.readdir(logDir);
  const logFiles = files.filter(f => f.startsWith('app-') && f.endsWith('.log'));
  if (logFiles.length === 0) return null;

  // Trier par date/nom (app-YYYY-MM-DD.log)
  logFiles.sort();
  return path.join(logDir, logFiles[logFiles.length - 1]);
};

registerAppLifecycle({
  app,
  dialog,
  logger,
  trustProjectPath,
  rootDir: __dirname,
  isDev,
  getLogsDir,
  getLatestLogPath,
  setMainWindow: (window) => {
    mainWindow = window;
  }
});

registerWorkflowHandlers({
  ipcMain,
  app,
  fs,
  path,
  ensureEditPermission,
  ensureTrustedProjectPath,
  assertSafePath,
  toPositiveInt,
  getN8nCatalogEntries,
  fetchTrustedN8nWorkflow
});

registerBrainGraphHandlers({
  ipcMain,
  ensureTrustedProjectPath,
  assertSafePath
});

registerGitHandlers({
  ipcMain,
  fs,
  path,
  runGit,
  ensureEditPermission,
  ensureTrustedProjectPath,
  assertSafePath
});

// Handlers extraits dans leurs modules respectifs
registerLogHandlers({ getLogsDir, getLatestLogPath });
registerProjectHandlers({ getMainWindow: () => mainWindow });
registerProcessHandlers(processService);
registerQualityHandlers(processService);
registerSystemHandlers();
registerSettingsHandlers();
registerConversationHandlers();
registerFileHandlers();
registerSnapshotHandlers();
registerAgentHandlers(() => mainWindow);
registerOllamaHandlers(() => mainWindow);
registerAIHandlers({ getMainWindow: () => mainWindow, executeCommandForAI });
registerSkillHandlers();
registerRouterHandlers({
  ipcMain,
  getMainWindow: () => mainWindow,
  listAgents,
  listSkills,
  runSingleCompletionProvider,
  ensureTrustedProjectPath,
  resolveOptionalTrustedProjectPath
});
registerPtyHandlers(ptyService);
registerProviderHandlers({ app, vault: providerSecretVault });
