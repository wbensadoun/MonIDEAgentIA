import { useState, useCallback, useEffect } from 'react';

export const useFileOperations = (
  currentProjectPath,
  isElectronApiAvailable,
  showMessage,
  setActiveFile,
  permissionMode = 'edit_terminal'
) => {
  const [projectItems, setProjectItems] = useState([]);
  const [expandedFolders, setExpandedFolders] = useState(new Set());
  const [allowDangerousActions, setAllowDangerousActions] = useState(false);
  const isReadOnly = permissionMode === 'read_only';

  const loadProjectItems = useCallback(async () => {
    if (!isElectronApiAvailable || !currentProjectPath) {
      setProjectItems([]);
      return;
    }
    
    try {
      const response = await window.electronAPI.getAllFiles(currentProjectPath);
      if (response.success) {
        const sortedItems = response.items.sort((a, b) => {
          if (a.type === 'directory' && b.type === 'file') return -1;
          if (a.type === 'file' && b.type === 'directory') return 1;
          return a.name.localeCompare(b.name);
        });
        setProjectItems(sortedItems);
      } else {
        showMessage(`Erreur lors du chargement: ${response.error}`, 5000);
      }
    } catch (error) {
      showMessage(`Erreur IPC: ${error.message}`, 5000);
    }
  }, [currentProjectPath, isElectronApiAvailable, showMessage]);

  useEffect(() => {
    const loadDangerousFlag = async () => {
      if (!isElectronApiAvailable || !window.electronAPI?.loadSettings) return;
      try {
        const res = await window.electronAPI.loadSettings();
        if (res.success && res.settings && typeof res.settings.allowDangerousActions === 'boolean') {
          setAllowDangerousActions(res.settings.allowDangerousActions);
        }
      } catch (e) {
        // silencieux
      }
    };
    loadDangerousFlag();
  }, [isElectronApiAvailable]);

  const loadFolderChildren = useCallback(async (folderPath, itemPath) => {
    if (!isElectronApiAvailable || !currentProjectPath || !folderPath) return;
    try {
      const response = await window.electronAPI.getFolderChildren(currentProjectPath, folderPath);
      if (response.success) {
        setProjectItems(prevItems => {
          const updateItemChildren = (items) => {
            return items.map(item => {
              if (item.path === itemPath) {
                return { ...item, children: response.children };
              } else if (item.children && item.children.length > 0) {
                return { ...item, children: updateItemChildren(item.children) };
              }
              return item;
            });
          };
          return updateItemChildren(prevItems);
        });
      }
    } catch (error) {
      console.error('Erreur chargement enfants:', error);
    }
  }, [currentProjectPath, isElectronApiAvailable]);

  const toggleFolderExpansion = useCallback(async (item) => {
    setExpandedFolders(prev => {
      const newSet = new Set(prev);
      if (newSet.has(item.path)) {
        newSet.delete(item.path);
      } else {
        newSet.add(item.path);
      }
      return newSet;
    });

    const childrenCount = Array.isArray(item.children) ? item.children.length : 0;
    if (childrenCount === 0 && item.hasChildren) {
      await loadFolderChildren(item.fullPath || item.path, item.path);
    }
  }, [loadFolderChildren]);

  const createNewItem = useCallback(async (type, itemName) => {
    if (isReadOnly) {
      showMessage('Mode lecture seule actif: creation bloquee.', 3000);
      return false;
    }

    const name = String(itemName || '').trim();
    if (!name) {
      showMessage(`Veuillez entrer un nom pour le nouveau ${type === 'file' ? 'fichier' : 'dossier'}.`);
      return false;
    }
    if (!currentProjectPath) {
      showMessage("Veuillez d'abord ouvrir un dossier de projet.", 5000);
      return false;
    }
    if (!isElectronApiAvailable) {
      showMessage("Erreur: Electron non disponible.", 10000);
      return false;
    }

    try {
      let response;
      if (type === 'file') {
        response = await window.electronAPI.createNewFile(currentProjectPath, name, '');
      } else {
        response = await window.electronAPI.createDirectory(currentProjectPath, name);
      }

      if (response.success) {
        await loadProjectItems();
        if (type === 'file') {
          setActiveFile(name);
        }
        showMessage(`${type === 'file' ? 'Fichier' : 'Dossier'} "${name}" créé.`);
        return true;
      } else {
        showMessage(`Erreur: ${response.error}`, 5000);
        return false;
      }
    } catch (error) {
      showMessage(`Erreur IPC: ${error.message}`, 5000);
      return false;
    }
  }, [currentProjectPath, isElectronApiAvailable, showMessage, loadProjectItems, setActiveFile, isReadOnly]);

  const deleteItem = useCallback(async (itemName, type) => {
    if (isReadOnly) {
      showMessage('Mode lecture seule actif: suppression bloquee.', 3000);
      return;
    }

    if (!allowDangerousActions) {
      if (!window.confirm(`Supprimer ${type === 'file' ? 'le fichier' : 'le dossier'} "${itemName}" ?`)) {
        return;
      }
    }
    if (!isElectronApiAvailable || !currentProjectPath) {
      showMessage("Erreur: Electron non disponible.", 10000);
      return;
    }

    try {
      let response;
      if (type === 'file') {
        response = await window.electronAPI.deleteFile(currentProjectPath, itemName);
      } else {
        response = await window.electronAPI.deleteDirectory(currentProjectPath, itemName);
      }

      if (response.success) {
        await loadProjectItems();
        showMessage(`${type === 'file' ? 'Fichier' : 'Dossier'} "${itemName}" supprimé.`);
      } else {
        showMessage(`Erreur: ${response.error}`, 5000);
      }
    } catch (error) {
      showMessage(`Erreur IPC: ${error.message}`, 5000);
    }
  }, [currentProjectPath, isElectronApiAvailable, showMessage, loadProjectItems, allowDangerousActions, isReadOnly]);

  const openFolder = useCallback(async () => {
    if (!isElectronApiAvailable) {
      showMessage("Erreur: Electron non disponible.", 10000);
      return null;
    }
    try {
      const response = await window.electronAPI.openFolderDialog();
      if (response.success && response.path) {
        showMessage(`Dossier ouvert: "${response.path}"`);
        return response.path;
      } else if (response.error) {
        showMessage(`Erreur: ${response.error}`, 5000);
        return null;
      }
    } catch (error) {
      showMessage(`Erreur IPC: ${error.message}`, 5000);
      return null;
    }
  }, [isElectronApiAvailable, showMessage]);

  useEffect(() => {
    loadProjectItems();
  }, [loadProjectItems]);

  return {
    projectItems,
    expandedFolders,
    loadProjectItems,
    toggleFolderExpansion,
    createNewItem,
    deleteItem,
    openFolder
  };
};

export default useFileOperations;
