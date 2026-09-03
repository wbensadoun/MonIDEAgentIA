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
  getTemplateCatalogEntries,
  fetchTrustedCompatibleWorkflow,
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
  ensureTerminalPermission,
  readSettingsSafe,
  buildSafeSpawnRequest,
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
const { createWorkflowEngine } = require('./electron/services/workflowEngine.service');
const {
  NEVEN_INTERNAL_PROFILES,
  buildNevenCorePlan
} = require('./electron/services/neven-core.service');
const { applyReasoningEffortFloor } = require('./electron/services/router.service');

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
  const defaultProvider = settings.defaultProvider === 'dashscope' ? 'neven' : settings.defaultProvider;
  // Do not pass persisted credential fields to the router. Provider credentials
  // and policies are resolved later by the main/workspace execution boundary.
  return {
    provider: defaultProvider,
    settings: {
      defaultProvider,
      geminiModel: settings.geminiModel,
      claudeModel: settings.claudeModel,
      kimiModel: settings.kimiModel,
      ollamaModel: settings.ollamaModel,
      routerClassifierProvider: settings.routerClassifierProvider,
      routerClassifierModel: settings.routerClassifierModel,
      routerComplexityThreshold: settings.routerComplexityThreshold,
      reasoningEffort: settings.reasoningEffort
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
  return nevenManagedGatewayEnabled ? { managedGateway: true } : { unavailable: true };
};
configureAIService({ dialog, getMainWindow: () => mainWindow });
const processService = createProcessService({ getMainWindow: () => mainWindow });
const ptyService = createPtyService({ getMainWindow: () => mainWindow });
const workflowEngine = createWorkflowEngine({
  app,
  fs,
  path,
  getMainWindow: () => mainWindow,
  ensureEditPermission,
  ensureTerminalPermission,
  ensureTrustedProjectPath,
  assertSafePath,
  readSettingsSafe,
  runCommandForTask: processService.runCommandForTask,
  requestTerminalApproval: require('./electron/services/ai.service').requestTerminalApproval,
  buildSafeSpawnRequest,
  runSingleCompletionProvider
});

// Deuxieme passe de configuration : configureAIService fusionne ses deps, et
// ptyService n'existe pas encore ligne 85. Donne a l'outil <read_terminal> des
// providers un acces LECTURE SEULE au tampon du terminal partage.
configureAIService({
  ptyService,
  resolveProviderCredential: resolveManagedProviderCredential,
  resolveProviderPolicy: async () => {
    // Neven is the safe default until the control plane supplies a workspace
    // policy. A BYOK ordering is accepted only as an explicit local override;
    // renderer options and stored credentials cannot silently force it.
    const configured = String(process.env.NEVEN_BYOK_POLICY || '').trim().toLowerCase();
    const allowed = new Set(['disabled', 'non_priority', 'priority', 'mandatory']);
    return normalizePolicy({ byok: allowed.has(configured) ? configured : 'disabled' });
  },
  resolveProviderExecutionContext: async ({ request, options }) => {
    const context = request?.workspaceContext;
    const workspaceId = context?.workspaceId;
    const deviceId = context?.deviceId;
    if (!workspaceId || !deviceId) return null;
    // The renderer never chooses a physical model. The internal Core profile
    // is generated in the main process from the prompt and is then resolved by
    // Neven/Supabase (routing_profiles -> provider -> selected model).
    const profileFromCore = options?.nevenCoreExecutionContext?.profile;
    const derivedProfile = buildNevenCorePlan({ prompt: request?.userPrompt || '' }).profile;
    const baseProfile = Object.prototype.hasOwnProperty.call(NEVEN_INTERNAL_PROFILES, profileFromCore)
      ? profileFromCore
      : (Object.prototype.hasOwnProperty.call(NEVEN_INTERNAL_PROFILES, derivedProfile) ? derivedProfile : 'haiku');
    // L'effort de raisonnement (Settings > Routeur) pose un PLANCHER sur le profil
    // managed : le control plane peut monter au-dessus, jamais descendre en dessous.
    // 'auto' (defaut) laisse le profil derive intact — comportement historique.
    let profile = baseProfile;
    try {
      const settings = await readSettingsSafe();
      profile = applyReasoningEffortFloor(baseProfile, settings.reasoningEffort);
    } catch {
      profile = baseProfile;
    }
    return { workspaceId, deviceId, profile };
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
  workflowEngine,
  getTemplateCatalogEntries,
  fetchTrustedCompatibleWorkflow
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
registerSettingsHandlers({
  credentialService: providerCredentialService,
  resolveWorkspaceContext,
  legacyMigrationWorkspaceId: nevenIdentity.workspaceId
});
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
