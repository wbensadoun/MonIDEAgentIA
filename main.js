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
  readSettingsSafe,
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
const { createProviderCredentialComposition } = require('./electron/services/provider-credential-composition.service');
const { normalizePolicy } = require('./electron/services/provider-policy.service');
const { ProviderUsageLedger } = require('./electron/services/provider-usage-ledger.service');
const {
  NevenControlPlaneClient,
  createNevenAccessResolver
} = require('./electron/services/neven-control-plane.service');
const { createNevenIdentityService } = require('./electron/services/neven-identity.service');
const {
  NevenManagedGatewayClient,
  createManagedGatewayCompletion,
  isNevenManagedGatewayEnabled
} = require('./electron/services/neven-managed-gateway.service');
const { createNevenUsagePublisher } = require('./electron/services/neven-usage-publisher.service');

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
const { vault: providerSecretVault, credentialService: providerCredentialService } = createProviderCredentialComposition({
  userDataPath: app.getPath('userData')
});
// Le control plane Neven reste dans le main process. Il ne retourne jamais de
// cle fournisseur au renderer : uniquement un droit court vers la passerelle
// Neven, conservé en mémoire et destiné aux futures exécutions managed.
const nevenIdentity = createNevenIdentityService({ userDataPath: app.getPath('userData'), isDevelopment: isDev });
const nevenControlPlane = new NevenControlPlaneClient({ accessTokenResolver: nevenIdentity.resolveSessionToken });
const publishNevenUsageEvent = createNevenUsagePublisher({ client: nevenControlPlane, workspaceId: nevenIdentity.workspaceId });
const resolveNevenAccess = createNevenAccessResolver({ client: nevenControlPlane });
const nevenManagedGatewayEnabled = isNevenManagedGatewayEnabled();
const completeManagedGateway = createManagedGatewayCompletion({
  accessResolver: resolveNevenAccess,
  gatewayClient: new NevenManagedGatewayClient(),
  enabled: nevenManagedGatewayEnabled
});
const providerUsageLedger = new ProviderUsageLedger({ filePath: ProviderUsageLedger.defaultFilePath(app.getPath('userData')) });
const setWorkspaceContext = (event) => nevenIdentity.bindSender(event);
const resolveWorkspaceContext = (event) => nevenIdentity.resolveWorkspaceContext(event);
const resolveTrustedRouterConfiguration = async () => {
  const settings = await readSettingsSafe();
  // Do not pass persisted credential fields to the router. Provider credentials
  // and policies are resolved later by the main/workspace execution boundary.
  return {
    provider: settings.defaultProvider,
    settings: {
      defaultProvider: settings.defaultProvider,
      geminiModel: settings.geminiModel,
      claudeModel: settings.claudeModel,
      kimiModel: settings.kimiModel,
      ollamaModel: settings.ollamaModel,
      routerClassifierProvider: settings.routerClassifierProvider,
      routerClassifierModel: settings.routerClassifierModel,
      routerComplexityThreshold: settings.routerComplexityThreshold
    }
  };
};
const resolveManagedProviderCredential = async ({ origin, provider, workspaceId, context }) => {
  if (!context || context.workspaceId !== workspaceId) return null;
  if (origin === 'local') return null;
  if (origin === 'byok') return {
    withActiveSecret: (operation) => providerCredentialService.withActiveCredential({ workspaceId, provider }, operation)
  };
  // The grant stays inside the managed gateway path; it is never an API key.
  return nevenManagedGatewayEnabled && context.access ? { managedGateway: true } : { unavailable: true };
};
configureAIService({ dialog, getMainWindow: () => mainWindow });
const processService = createProcessService({ getMainWindow: () => mainWindow });
const ptyService = createPtyService({ getMainWindow: () => mainWindow });

// Deuxieme passe de configuration : configureAIService fusionne ses deps, et
// ptyService n'existe pas encore ligne 85. Donne a l'outil <read_terminal> des
// providers un acces LECTURE SEULE au tampon du terminal partage.
configureAIService({
  ptyService,
  resolveProviderCredential: resolveManagedProviderCredential,
  resolveProviderPolicy: async ({ access }) => {
    // Without a managed grant, only local/BYOK origins can execute. Prefer a
    // stored BYOK credential and never use a provider environment credential.
    return normalizePolicy(access?.providerPolicy || { byok: 'priority' });
  },
  resolveProviderExecutionContext: async ({ request }) => {
    const context = request?.workspaceContext;
    const workspaceId = context?.workspaceId;
    const deviceId = context?.deviceId;
    if (!workspaceId || !deviceId) return null;
    const profile = 'haiku';
    if (!nevenManagedGatewayEnabled) return { workspaceId, profile, access: null };
    const access = await resolveNevenAccess({ workspaceId, deviceId, profile, capability: 'completion' });
    return { workspaceId, profile, access };
  },
  executeManagedGateway: completeManagedGateway,
  providerUsageLedger
});

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
registerProjectHandlers({ getMainWindow: () => mainWindow, setWorkspaceContext });
registerProcessHandlers(processService);
registerQualityHandlers(processService);
registerSystemHandlers();
registerSettingsHandlers();
registerConversationHandlers();
registerFileHandlers();
registerSnapshotHandlers();
registerAgentHandlers(() => mainWindow);
registerOllamaHandlers(() => mainWindow);
registerAIHandlers({
  getMainWindow: () => mainWindow,
  executeCommandForAI,
  publishUsageEvent: publishNevenUsageEvent,
  resolveWorkspaceContext
});
registerSkillHandlers();
registerRouterHandlers({
  ipcMain,
  getMainWindow: () => mainWindow,
  listAgents,
  listSkills,
  runSingleCompletionProvider,
  ensureTrustedProjectPath,
  resolveOptionalTrustedProjectPath,
  resolveWorkspaceContext,
  resolveTrustedRouterConfiguration
});
registerPtyHandlers(ptyService);
registerProviderHandlers({ app, credentialService: providerCredentialService, resolveWorkspaceContext });
