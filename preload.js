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

    // API pour lister tous les fichiers et dossiers dans un chemin donné
    getAllFiles: (folderPath) => ipcRenderer.invoke('get-all-files', folderPath),
    
    // API pour charger les enfants d'un dossier spécifique
    getFolderChildren: (folderPath) => ipcRenderer.invoke('get-folder-children', folderPath),

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
    getAllProjectFiles: (projectPath) => ipcRenderer.invoke('getAllProjectFiles', projectPath),

    // API pour l'appel Gemini avec contexte complet du projet
    getGeminiCompletion: (history, currentCode, allProjectFiles) => ipcRenderer.invoke('get-gemini-completion', history, currentCode, allProjectFiles),

    // API pour sauvegarder une conversation
    saveConversation: (projectPath, conversationHistory) => ipcRenderer.invoke('saveConversation', projectPath, conversationHistory),

    // Nouvelles API pour la gestion avancée des fichiers
    editFile: (projectPath, filename, searchText, replaceText) => ipcRenderer.invoke('editFile', projectPath, filename, searchText, replaceText),
    renameFile: (projectPath, oldFilename, newFilename) => ipcRenderer.invoke('renameFile', projectPath, oldFilename, newFilename),
    copyFile: (projectPath, sourceFilename, destFilename) => ipcRenderer.invoke('copyFile', projectPath, sourceFilename, destFilename),
    moveFile: (projectPath, sourceFilename, destFilename) => ipcRenderer.invoke('moveFile', projectPath, sourceFilename, destFilename),
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
