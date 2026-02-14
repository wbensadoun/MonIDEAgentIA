// preload.js
console.log('[Preload] 1. Démarrage du script de préchargement');

// Vérifier que nous avons accès à l'API Electron
try {
  console.log('[Preload] 2. Chargement des modules Electron...');
  const { contextBridge, ipcRenderer } = require('electron');

  console.log('[Preload] 3. Modules Electron chargés avec succès');

  // Création de l'objet API à exposer
  const electronAPI = {
    // Nouvelle API pour ouvrir un dialogue de sélection de dossier
    openFolderDialog: () => ipcRenderer.invoke('open-folder-dialog'),

    // Événements menu (émis par le processus main)
    onMenuOpenFolder: (callback) => {
      if (typeof callback !== 'function') return;
      ipcRenderer.removeAllListeners('menu-open-folder');
      ipcRenderer.on('menu-open-folder', () => callback());
    },

    onMenuOpenSettings: (callback) => {
      if (typeof callback !== 'function') return;
      ipcRenderer.removeAllListeners('menu-open-settings');
      ipcRenderer.on('menu-open-settings', () => callback());
    },

    // API pour lister tous les fichiers et dossiers dans un chemin donné
    getAllFiles: (folderPath) => ipcRenderer.invoke('get-all-files', folderPath),

    // API pour lister les fichiers d'un projet (flat list) - utile pour Ctrl+P / index
    listProjectFiles: (projectPath, options) => ipcRenderer.invoke('list-project-files', projectPath, options),

    // API pour rechercher dans le projet (recherche globale)
    searchInProject: (projectPath, query, options) => ipcRenderer.invoke('search-in-project', projectPath, query, options),

    // API pour charger les enfants d'un dossier spécifique
    getFolderChildren: (projectPath, folderPath) => ipcRenderer.invoke('get-folder-children', projectPath, folderPath),

    // API pour lire le contenu d'un fichier
    readFile: (projectPath, filename) => ipcRenderer.invoke('read-file', projectPath, filename),

    // API pour écrire/créer un fichier
    writeFile: (projectPath, filename, content) => ipcRenderer.invoke('write-file', projectPath, filename, content),

    // API pour supprimer un fichier
    deleteFile: (projectPath, filename) => ipcRenderer.invoke('delete-file', projectPath, filename),

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
    validateApiKey: (provider, apiKey) => ipcRenderer.invoke('validate-api-key', provider, apiKey),

    // Terminal / Process Runner
    startProcess: (payload) => ipcRenderer.invoke('start-process', payload),
    stopProcess: (id) => ipcRenderer.invoke('stop-process', id),
    onProcessOutput: (callback) => {
      if (typeof callback !== 'function') return;
      ipcRenderer.on('process-output', (_event, data) => callback(data));
    },
    onProcessExit: (callback) => {
      if (typeof callback !== 'function') return;
      ipcRenderer.on('process-exit', (_event, data) => callback(data));
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

    // Agents APIs
    listAgents: (projectPath) => ipcRenderer.invoke('list-agents', projectPath),
    getAgent: (name, scope, projectPath) => ipcRenderer.invoke('get-agent', name, scope, projectPath),
    saveAgent: (name, content, scope, projectPath) => ipcRenderer.invoke('save-agent', name, content, scope, projectPath),
    deleteAgent: (name, scope, projectPath) => ipcRenderer.invoke('delete-agent', name, scope, projectPath),

    // Skills APIs
    listSkills: (projectPath) => ipcRenderer.invoke('list-skills', projectPath),
    getSkill: (name, scope, projectPath) => ipcRenderer.invoke('get-skill', name, scope, projectPath),
    installSkillFromUrl: (url, scope, projectPath, options) => ipcRenderer.invoke('install-skill-from-url', url, scope, projectPath, options),

    // VoltAgent catalogs & packs
    getVoltAgentCatalog: (catalogId) => ipcRenderer.invoke('get-voltagent-catalog', catalogId),
    syncVoltAgentSubagents: (options) => ipcRenderer.invoke('sync-voltagent-subagents', options),
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
