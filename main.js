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
configureAIService({ dialog, getMainWindow: () => mainWindow });
const processService = createProcessService({ getMainWindow: () => mainWindow });

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
