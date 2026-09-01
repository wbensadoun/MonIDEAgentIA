import { useCallback, useEffect, useState } from 'react';

const readStoredWorkspaces = () => {
  try {
    const raw = localStorage.getItem('vibeIDE_workspaces');
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const persistLastProjectPath = (projectPath) => {
  try {
    localStorage.setItem('lastProjectPath', projectPath);
  } catch {
    // ignore
  }
};

const getProjectName = (projectPath) => (
  projectPath
    ? projectPath.split(/[\\/]/).pop()
    : 'Aucun projet'
);

const useProjectWorkspace = ({
  currentProjectPath,
  currentProjectId,
  setCurrentProjectPath,
  setCurrentProjectId,
  isElectronApiAvailable,
  showMessage,
  openFolder,
  resetEditorSession,
  isLoading,
  multiAIState,
  pendingFileChanges,
  activeConversationFile,
  loadConversationByFile
}) => {
  const [workspaces, setWorkspaces] = useState(readStoredWorkspaces);
  const [projectRunState, setProjectRunState] = useState({});
  const [conversationsRefreshKey, setConversationsRefreshKey] = useState(0);
  const [pendingConversationLoad, setPendingConversationLoad] = useState(null);

  useEffect(() => {
    try {
      localStorage.setItem('vibeIDE_workspaces', JSON.stringify(workspaces));
    } catch {
      // ignore
    }
  }, [workspaces]);

  useEffect(() => {
    if (!currentProjectPath) return;
    const name = currentProjectPath.split(/[\\/]/).pop() || currentProjectPath;
    setWorkspaces((prev) => {
      const existing = prev.find((workspace) => workspace.path === currentProjectPath);
      if (existing) {
        return prev.map((workspace) => (
          workspace.path === currentProjectPath
            ? { ...workspace, lastOpenedAt: Date.now() }
            : workspace
        ));
      }
      return [...prev, { path: currentProjectPath, name, lastOpenedAt: Date.now() }];
    });
  }, [currentProjectPath]);

  useEffect(() => {
    if (!isElectronApiAvailable || currentProjectPath) return undefined;
    if (!window.electronAPI?.authorizeProjectPath) return undefined;

    let cancelled = false;
    const restoreLastProject = async () => {
      let lastProjectPath = '';
      try {
        lastProjectPath = localStorage.getItem('lastProjectPath') || '';
      } catch {
        lastProjectPath = '';
      }
      if (!lastProjectPath) return;

      try {
        const response = await window.electronAPI.authorizeProjectPath(lastProjectPath);
        if (cancelled) return;
        if (response?.success && response.path) {
          setCurrentProjectPath(response.path);
          resetEditorSession();
          return;
        }
        try {
          localStorage.removeItem('lastProjectPath');
        } catch {
          // ignore
        }
        if (response?.error) {
          showMessage(`Projet non restaure: ${response.error}`, 3500);
        }
      } catch (error) {
        if (!cancelled) {
          showMessage(`Projet non restaure: ${error.message}`, 3500);
        }
      }
    };

    restoreLastProject();
    return () => {
      cancelled = true;
    };
  }, [
    currentProjectPath,
    isElectronApiAvailable,
    resetEditorSession,
    setCurrentProjectPath,
    showMessage
  ]);

  useEffect(() => {
    if (!currentProjectPath) return;
    let status = 'idle';
    if (isLoading || multiAIState?.isActive) {
      status = 'run';
    } else if (Array.isArray(pendingFileChanges) && pendingFileChanges.length > 0) {
      status = 'wait';
    }
    setProjectRunState((prev) => {
      if (prev[currentProjectPath] === status) return prev;
      return { ...prev, [currentProjectPath]: status };
    });
  }, [currentProjectPath, isLoading, multiAIState, pendingFileChanges]);

  useEffect(() => {
    if (!isLoading) {
      setConversationsRefreshKey((key) => key + 1);
    }
  }, [isLoading, activeConversationFile]);

  useEffect(() => {
    if (!pendingConversationLoad) return;
    if (pendingConversationLoad.path !== currentProjectPath) return;
    loadConversationByFile(pendingConversationLoad.fileName);
    setPendingConversationLoad(null);
  }, [pendingConversationLoad, currentProjectPath, loadConversationByFile]);

  const handleSelectProject = useCallback(async (projectPath) => {
    if (!projectPath || projectPath === currentProjectPath) return false;
    if (isElectronApiAvailable && window.electronAPI?.authorizeProjectPath) {
      try {
        const response = await window.electronAPI.authorizeProjectPath(projectPath);
        if (!response?.success) {
          showMessage(`Projet non autorise: ${response?.error || 'refuse'}`, 4000);
          return false;
        }
      } catch (error) {
        showMessage(`Erreur autorisation: ${error.message}`, 4000);
        return false;
      }
    }

    setCurrentProjectPath(projectPath);
    resetEditorSession();
    persistLastProjectPath(projectPath);
    return true;
  }, [
    currentProjectPath,
    isElectronApiAvailable,
    resetEditorSession,
    setCurrentProjectPath,
    showMessage
  ]);

  const handleOpenFolder = useCallback(async () => {
    const projectPath = await openFolder();
    if (!projectPath) return;

    setCurrentProjectPath(projectPath);
    resetEditorSession();
    persistLastProjectPath(projectPath);
  }, [openFolder, resetEditorSession, setCurrentProjectPath]);

  const handleOpenConversation = useCallback(async (projectPath, fileName) => {
    if (projectPath === currentProjectPath) {
      loadConversationByFile(fileName);
      return;
    }

    const selected = await handleSelectProject(projectPath);
    if (selected) {
      setPendingConversationLoad({ path: projectPath, fileName });
    }
  }, [currentProjectPath, handleSelectProject, loadConversationByFile]);

  const handleRemoveProject = useCallback(async (projectPath) => {
    // Removing a workspace from the UI must revoke its main-process trust
    // first. Otherwise a stale retrieval ID could remain usable after the
    // project disappeared from the renderer's list.
    if (isElectronApiAvailable && typeof window.electronAPI?.closeProject === 'function') {
      try {
        const response = await window.electronAPI.closeProject(projectPath);
        const historicalWorkspace = response?.code === 'PROJECT_NOT_OPEN'
          || response?.error === 'Projet non ouvert.';
        if (!response?.success && !historicalWorkspace) {
          showMessage(`Projet non ferme: ${response?.error || 'refuse'}`, 3500);
          return false;
        }
      } catch (error) {
        showMessage(`Erreur fermeture projet: ${error?.message || 'refuse'}`, 3500);
        return false;
      }
    }
    setWorkspaces((prev) => prev.filter((workspace) => workspace.path !== projectPath));
    setProjectRunState((prev) => {
      if (!(projectPath in prev)) return prev;
      const next = { ...prev };
      delete next[projectPath];
      return next;
    });
    if (projectPath === currentProjectPath) {
      setCurrentProjectPath('');
      if (typeof setCurrentProjectId === 'function') setCurrentProjectId('');
      resetEditorSession();
      persistLastProjectPath('');
    }
    return true;
  }, [currentProjectId, currentProjectPath, isElectronApiAvailable, resetEditorSession, setCurrentProjectId, setCurrentProjectPath, showMessage]);

  return {
    workspaces,
    projectRunState,
    conversationsRefreshKey,
    projectName: getProjectName(currentProjectPath),
    handleSelectProject,
    handleOpenFolder,
    handleOpenConversation,
    handleRemoveProject
  };
};

export default useProjectWorkspace;
