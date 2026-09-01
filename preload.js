// preload.js
console.log('[Preload] 1. Démarrage du script de préchargement');

// Vérifier que nous avons accès à l'API Electron
try {
  console.log('[Preload] 2. Chargement des modules Electron...');
  const { contextBridge, ipcRenderer } = require('electron');

  console.log('[Preload] 3. Modules Electron chargés avec succès');

  const channelListenerRegistry = new Map();
  const registerChannelListener = (channel, callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, data) => callback(data);
    let listeners = channelListenerRegistry.get(channel);
    if (!listeners) {
      listeners = new Set();
      channelListenerRegistry.set(channel, listeners);
    }
    listeners.add(listener);
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
      const current = channelListenerRegistry.get(channel);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) {
        channelListenerRegistry.delete(channel);
      }
    };
  };

  const removeRegisteredChannelListeners = (channel) => {
    const listeners = channelListenerRegistry.get(channel);
    if (!listeners || listeners.size === 0) return;
    for (const listener of listeners) {
      ipcRenderer.removeListener(channel, listener);
    }
    channelListenerRegistry.delete(channel);
  };

  // Création de l'objet API à exposer
  const electronAPI = {
    // Nouvelle API pour ouvrir un dialogue de sélection de dossier
    openFolderDialog: () => ipcRenderer.invoke('open-folder-dialog'),
    authorizeProjectPath: (projectPath) => ipcRenderer.invoke('authorize-project-path', projectPath),
    createDefaultProject: () => ipcRenderer.invoke('create-default-project'),

    // Événements menu (émis par le processus main)
    onMenuOpenFolder: (callback) => {
      if (typeof callback !== 'function') return () => {};
      const listener = () => callback();
      ipcRenderer.on('menu-open-folder', listener);
      return () => ipcRenderer.removeListener('menu-open-folder', listener);
    },

    onMenuOpenSettings: (callback) => {
      if (typeof callback !== 'function') return () => {};
      const listener = () => callback();
      ipcRenderer.on('menu-open-settings', listener);
      return () => ipcRenderer.removeListener('menu-open-settings', listener);
    },

    // API pour lister tous les fichiers et dossiers dans un chemin donné
    getAllFiles: (folderPath) => ipcRenderer.invoke('get-all-files', folderPath),

    // API pour lister les fichiers d'un projet (flat list) - utile pour Ctrl+P / index
    listProjectFiles: (projectPath, options) => ipcRenderer.invoke('list-project-files', projectPath, options),

    // API pour rechercher dans le projet (recherche globale)
    searchInProject: (projectPath, query, options) => ipcRenderer.invoke('search-in-project', projectPath, query, options),
    searchSymbols: (projectPath, query, options) => ipcRenderer.invoke('search-symbols', projectPath, query, options),

    // API pour charger les enfants d'un dossier spécifique
    getFolderChildren: (projectPath, folderPath) => ipcRenderer.invoke('get-folder-children', projectPath, folderPath),

    // API pour lire le contenu d'un fichier
    readFile: (projectPath, filename) => ipcRenderer.invoke('read-file', projectPath, filename),

    // API pour écrire/créer un fichier
    writeFile: (projectPath, filename, content, options) => ipcRenderer.invoke('write-file', projectPath, filename, content, options),
    runQualityGates: (projectPath, options) => ipcRenderer.invoke('run-quality-gates', projectPath, options),
    createAISnapshot: (projectPath, files, label) => ipcRenderer.invoke('create-ai-snapshot', projectPath, files, label),
    listAISnapshots: (projectPath) => ipcRenderer.invoke('list-ai-snapshots', projectPath),
    restoreAISnapshot: (projectPath, snapshotId) => ipcRenderer.invoke('restore-ai-snapshot', projectPath, snapshotId),
    agentListRuns: (projectPath) => ipcRenderer.invoke('agent:listRuns', projectPath),
    agentGetRun: (projectPath, runId) => ipcRenderer.invoke('agent:getRun', projectPath, runId),
    agentCreateRun: (projectPath, payload) => ipcRenderer.invoke('agent:createRun', projectPath, payload),
    agentUpdateRun: (projectPath, runId, patch) => ipcRenderer.invoke('agent:updateRun', projectPath, runId, patch),
    agentAppendLog: (projectPath, runId, log) => ipcRenderer.invoke('agent:appendLog', projectPath, runId, log),
    agentUpdateChangeStatus: (projectPath, runId, changeId, status, extra) =>
      ipcRenderer.invoke('agent:updateChangeStatus', projectPath, runId, changeId, status, extra),
    agentApplyChange: (projectPath, runId, changeId) => ipcRenderer.invoke('agent:applyChange', projectPath, runId, changeId),
    agentRejectChange: (projectPath, runId, changeId) => ipcRenderer.invoke('agent:rejectChange', projectPath, runId, changeId),
    agentRestoreRun: (projectPath, runId) => ipcRenderer.invoke('agent:restoreRun', projectPath, runId),
    onAgentAction: (callback) => registerChannelListener('agent:action', callback),

    // API pour supprimer un fichier
    deleteFile: (projectPath, filename, options) => ipcRenderer.invoke('delete-file', projectPath, filename, options),

    // API pour créer un nouveau fichier
    createNewFile: (projectPath, filename, initialContent) => ipcRenderer.invoke('createNewFile', projectPath, filename, initialContent),

    // Nouvelle API pour créer un dossier
    createDirectory: (projectPath, dirname) => ipcRenderer.invoke('createDirectory', projectPath, dirname),

    // Nouvelle API pour supprimer un dossier
    deleteDirectory: (projectPath, dirname) => ipcRenderer.invoke('deleteDirectory', projectPath, dirname),

    // API pour lire tous les fichiers du projet
    getAllProjectFiles: (projectPath, options) => ipcRenderer.invoke('getAllProjectFiles', projectPath, options),

    // API pour l'appel Gemini avec contexte complet du projet
    getGeminiCompletion: (history, currentCode, allProjectFiles, options) =>
      ipcRenderer.invoke('get-gemini-completion', history, currentCode, allProjectFiles, options),

    // API pour lister les modèles Gemini disponibles
    listGeminiModels: (apiKey) => ipcRenderer.invoke('list-gemini-models', apiKey),

    // API pour l'appel Kimi K2.5 via Together
    getKimiCompletion: (history, currentCode, allProjectFiles, options) =>
      ipcRenderer.invoke('get-kimi-completion', history, currentCode, allProjectFiles, options),

    // API pour l'appel Claude 3.5 Sonnet / Opus via Anthropic
    getClaudeCompletion: (history, currentCode, allProjectFiles, options) =>
      ipcRenderer.invoke('get-claude-completion', history, currentCode, allProjectFiles, options),

    // API pour sauvegarder une conversation
    saveConversation: (projectPath, conversationHistory) => ipcRenderer.invoke('saveConversation', projectPath, conversationHistory),
    listConversations: (projectPath) => ipcRenderer.invoke('listConversations', projectPath),
    loadConversation: (projectPath, fileName) => ipcRenderer.invoke('loadConversation', projectPath, fileName),

    // Logs
    getLatestLog: () => ipcRenderer.invoke('get-latest-log'),
    openLogsFolder: () => ipcRenderer.invoke('open-logs-folder'),

    // Settings
    saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
    loadSettings: () => ipcRenderer.invoke('load-settings'),
    getSystemAIProfile: (options) => ipcRenderer.invoke('get-system-ai-profile', options),
    validateApiKey: (provider, apiKey) => ipcRenderer.invoke('validate-api-key', provider, apiKey),
    listProviderModels: (provider, apiKey) => ipcRenderer.invoke('list-provider-models', provider, apiKey),
    listProviderCredentials: () => ipcRenderer.invoke('provider:list-credentials'),
    connectProviderCredential: (payload) => ipcRenderer.invoke('provider:connect', payload),
    revokeProviderCredential: (payload) => ipcRenderer.invoke('provider:revoke', payload),

    // Terminal / Process Runner
    startProcess: (payload) => ipcRenderer.invoke('start-process', payload),
    stopProcess: (id) => ipcRenderer.invoke('stop-process', id),

    // Terminal interactif (node-pty). Distinct de startProcess/stopProcess :
    // celui-ci ouvre un vrai shell persistant (cd, variables d'env qui
    // survivent, pipes, programmes interactifs), pas un spawn ponctuel.
    createPty: (payload) => ipcRenderer.invoke('pty-create', payload),
    writePty: (id, data) => ipcRenderer.invoke('pty-write', id, data),
    resizePty: (id, cols, rows) => ipcRenderer.invoke('pty-resize', id, cols, rows),
    killPty: (id) => ipcRenderer.invoke('pty-kill', id),
    readPtyBuffer: (id) => ipcRenderer.invoke('pty-read-buffer', id),
    isPtyAvailable: () => ipcRenderer.invoke('pty-is-available'),
    onPtyData: (callback) => registerChannelListener('pty-data', callback),
    onPtyExit: (callback) => registerChannelListener('pty-exit', callback),
    onProcessOutput: (callback) => {
      return registerChannelListener('process-output', callback);
    },
    onProcessExit: (callback) => {
      return registerChannelListener('process-exit', callback);
    },

    // Nouvelles API pour la gestion avancée des fichiers
    editFile: (projectPath, filename, searchText, replaceText) => ipcRenderer.invoke('editFile', projectPath, filename, searchText, replaceText),
    renameFile: (projectPath, oldFilename, newFilename) => ipcRenderer.invoke('renameFile', projectPath, oldFilename, newFilename),
    copyFile: (projectPath, sourceFilename, destFilename) => ipcRenderer.invoke('copyFile', projectPath, sourceFilename, destFilename),
    moveFile: (projectPath, sourceFilename, destFilename) => ipcRenderer.invoke('moveFile', projectPath, sourceFilename, destFilename),

    // Workflow APIs
    listWorkflows: (projectPath) => ipcRenderer.invoke('list-workflows', projectPath),
    getWorkflow: (name, scope, projectPath) => ipcRenderer.invoke('get-workflow', name, scope, projectPath),
    saveWorkflow: (name, content, scope, projectPath) => ipcRenderer.invoke('save-workflow', name, content, scope, projectPath),
    deleteWorkflow: (name, scope, projectPath) => ipcRenderer.invoke('delete-workflow', name, scope, projectPath),

    // Visual Workflow APIs
    listVisualWorkflows: (projectPath) => ipcRenderer.invoke('list-visual-workflows', projectPath),
    saveVisualWorkflow: (projectPath, workflowJson) => ipcRenderer.invoke('save-visual-workflow', projectPath, workflowJson),
    deleteVisualWorkflow: (projectPath, filename) => ipcRenderer.invoke('delete-visual-workflow', projectPath, filename),
    fetchN8nCatalog: (page, perPage) => ipcRenderer.invoke('fetch-n8n-catalog', page, perPage),
    downloadN8nWorkflow: (downloadUrl) => ipcRenderer.invoke('download-n8n-workflow', downloadUrl),

    // Brain Graph APIs (local-only project graph, no provider dependency)
    brainGraphIndex: (projectPath, options) => ipcRenderer.invoke('brain-graph:index', projectPath, options),
    brainGraphGet: (projectPath, options) => ipcRenderer.invoke('brain-graph:get', projectPath, options),
    brainGraphSelect: (projectPath, query, options) => ipcRenderer.invoke('brain-graph:select', projectPath, query, options),
    brainGraphPath: (projectPath) => ipcRenderer.invoke('brain-graph:path', projectPath),
    // Retrieval is authorized and scoped in the main process. The renderer
    // only supplies a bounded request; raw Neven context is never accepted.
    retrievalRegisterProject: (payload) => ipcRenderer.invoke('retrieval:register-project', payload),
    retrievalRevokeProject: (projectId) => ipcRenderer.invoke('retrieval:revoke-project', projectId),
    retrievalReadIndex: (payload) => ipcRenderer.invoke('retrieval:read-index', payload),
    closeProject: (projectPath) => ipcRenderer.invoke('close-project', projectPath),
    startRagIndex: (projectId) => ipcRenderer.invoke('rag:index-project', { projectId }),
    getRagIndexStatus: (projectId, jobId) => ipcRenderer.invoke('rag:index-status', { projectId, jobId }),

    // Agents APIs
    listAgents: (projectPath) => ipcRenderer.invoke('list-agents', projectPath),
    getAgent: (name, scope, projectPath) => ipcRenderer.invoke('get-agent', name, scope, projectPath),
    saveAgent: (name, content, scope, projectPath) => ipcRenderer.invoke('save-agent', name, content, scope, projectPath),
    deleteAgent: (name, scope, projectPath) => ipcRenderer.invoke('delete-agent', name, scope, projectPath),

    // Skills APIs
    listSkills: (projectPath) => ipcRenderer.invoke('list-skills', projectPath),
    getSkill: (name, scope, projectPath) => ipcRenderer.invoke('get-skill', name, scope, projectPath),
    installSkillFromUrl: (url, scope, projectPath, options) => ipcRenderer.invoke('install-skill-from-url', url, scope, projectPath, options),
    installAllSkills: (catalogEntries) => ipcRenderer.invoke('install-all-skills', catalogEntries),

    // Intelligent Router API
    routeRequest: (projectPath, userPrompt, options) => ipcRenderer.invoke('route-request', projectPath, userPrompt, options),

    // VoltAgent catalogs & packs
    getVoltAgentCatalog: (catalogId) => ipcRenderer.invoke('get-voltagent-catalog', catalogId),
    syncVoltAgentSubagents: (options) => ipcRenderer.invoke('sync-voltagent-subagents', options),
    exportLibraryPack: (projectPath, options) => ipcRenderer.invoke('export-library-pack', projectPath, options),
    importLibraryPack: (projectPath, options) => ipcRenderer.invoke('import-library-pack', projectPath, options),

    // Git Integration
    gitStatus: (projectPath) => ipcRenderer.invoke('git-status', projectPath),
    gitDiff: (projectPath, filePath) => ipcRenderer.invoke('git-diff', projectPath, filePath),
    gitAdd: (projectPath, files) => ipcRenderer.invoke('git-add', projectPath, files),
    gitUnstage: (projectPath, files) => ipcRenderer.invoke('git-unstage', projectPath, files),
    gitCommit: (projectPath, message) => ipcRenderer.invoke('git-commit', projectPath, message),
    gitPush: (projectPath, remote, branch) => ipcRenderer.invoke('git-push', projectPath, remote, branch),
    gitPull: (projectPath) => ipcRenderer.invoke('git-pull', projectPath),
    gitLog: (projectPath, limit) => ipcRenderer.invoke('git-log', projectPath, limit),
    gitReadFileState: (projectPath, filePath) => ipcRenderer.invoke('git-read-file-state', projectPath, filePath),
    gitInit: (projectPath) => ipcRenderer.invoke('git-init', projectPath),
    gitBranch: (projectPath) => ipcRenderer.invoke('git-branch', projectPath),
    gitRemotes: (projectPath) => ipcRenderer.invoke('git-remotes', projectPath),
    gitListBranches: (projectPath) => ipcRenderer.invoke('git-list-branches', projectPath),
    gitCheckoutBranch: (projectPath, branchName) => ipcRenderer.invoke('git-checkout-branch', projectPath, branchName),
    gitCreateBranch: (projectPath, branchName) => ipcRenderer.invoke('git-create-branch', projectPath, branchName),
    gitStashSave: (projectPath, message) => ipcRenderer.invoke('git-stash-save', projectPath, message),
    gitStashList: (projectPath) => ipcRenderer.invoke('git-stash-list', projectPath),
    gitStashPop: (projectPath, stashRef) => ipcRenderer.invoke('git-stash-pop', projectPath, stashRef),

    // Ollama Local AI
    listOllamaModels: () => ipcRenderer.invoke('list-ollama-models'),
    getLatestOllamaQwenVersion: () => ipcRenderer.invoke('get-latest-ollama-qwen-version'),
    // Catalogue dynamique (famille + tailles) depuis la librairie Ollama publique
    resolveOllamaFamily: (vendor, force) => ipcRenderer.invoke('resolve-ollama-family', { vendor, force }),
    fetchOllamaLibrarySizes: (family, force) => ipcRenderer.invoke('fetch-ollama-library-sizes', { family, force }),
    recommendOllamaSize: (sizes, consent) => ipcRenderer.invoke('recommend-ollama-size', { sizes, consent }),
    checkOllamaUpdates: (modelNames) => ipcRenderer.invoke('check-ollama-updates', modelNames),
    startOllama: () => ipcRenderer.invoke('start-ollama'),
    installOllama: () => ipcRenderer.invoke('install-ollama'),
    pullOllamaModel: (modelName) => ipcRenderer.invoke('pull-ollama-model', modelName),
    onOllamaPullProgress: (callback) => {
      return registerChannelListener('ollama-pull-progress', callback);
    },
    getOllamaCompletion: (history, currentCode, allProjectFiles, options) =>
      ipcRenderer.invoke('get-ollama-completion', history, currentCode, allProjectFiles, options),

    // Annulation REELLE d'une generation. Avant, le renderer creait un
    // AbortController qu'il n'envoyait nulle part : le bouton "Arreter" masquait
    // le resultat pendant que le CPU continuait a generer jusqu'au bout.
    // Le runId est genere par le renderer et passe dans options.runId.
    cancelAIGeneration: (runId) => ipcRenderer.invoke('cancel-ai-generation', runId),

    // Inline Completion (Ctrl+K / Ghost Text)
    getInlineCompletion: (prompt, code, options) =>
      ipcRenderer.invoke('get-inline-completion', prompt, code, options),
    getGhostCompletion: (prefix, suffix, options) =>
      ipcRenderer.invoke('get-ghost-completion', prefix, suffix, options),

    // AI Terminal events (emitted by main process during agent ReAct loop)
    onAITerminalAction: (callback) => {
      return registerChannelListener('ai-terminal-action', callback);
    },
    onAITerminalResult: (callback) => {
      return registerChannelListener('ai-terminal-result', callback);
    },
    onAIGenerationToken: (callback) => {
      return registerChannelListener('ai-generation-token', callback);
    },

    // MCP Integration
    mcpGetCatalog: () => ipcRenderer.invoke('mcp-get-catalog'),
    mcpListServers: () => ipcRenderer.invoke('mcp-list-servers'),
    mcpUpsertServer: (config) => ipcRenderer.invoke('mcp-upsert-server', config),
    mcpRemoveServer: (serverId) => ipcRenderer.invoke('mcp-remove-server', serverId),
    mcpConnect: (serverId) => ipcRenderer.invoke('mcp-connect', serverId),
    mcpDisconnect: (serverId) => ipcRenderer.invoke('mcp-disconnect', serverId),
    mcpListTools: () => ipcRenderer.invoke('mcp-list-tools'),
    mcpCallTool: (serverId, toolName, args) => ipcRenderer.invoke('mcp-call-tool', serverId, toolName, args),
    mcpGetToolsContext: () => ipcRenderer.invoke('mcp-get-tools-context'),
    mcpQuickAdd: (catalogId, envOverrides) => ipcRenderer.invoke('mcp-quick-add', catalogId, envOverrides),
    mcpRegistrySearch: (query) => ipcRenderer.invoke('mcp-registry-search', query),
    mcpRegistryImport: (server, envValues) => ipcRenderer.invoke('mcp-registry-import', server, envValues),
    onMcpStatusChanged: (callback) => {
      return registerChannelListener('mcp-status-changed', callback);
    },
  };

  // Afficher les méthodes disponibles
  console.log('[Preload] 4. Méthodes disponibles:', Object.keys(electronAPI));

  // Exposer l'API
  console.log('[Preload] 5. Exposition de l\'API sur window.electronAPI');
  contextBridge.exposeInMainWorld('electronAPI', electronAPI);

  // Vérification que l'API est bien exposée
  console.log('[Preload] 6. Vérification de l\'exposition de l\'API:', {
    isExposed: 'electronAPI' in window,
    methods: window.electronAPI ? Object.keys(window.electronAPI) : 'non défini'
  });

  console.log('[Preload] 7. Script de préchargement terminé avec succès');

} catch (error) {
  console.error('[Preload] ERREUR dans le script de préchargement:', error);
}
