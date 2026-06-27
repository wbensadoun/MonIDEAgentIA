import { useEffect } from 'react';

const useWorkspaceSyncEffects = ({
  activeAgentRunId,
  agentRunRefreshKey,
  setCenterView,
  isDiffMode,
  gitDiffPreview,
  clearGitDiffPreview,
  isElectronApiAvailable,
  handleOpenFolder
}) => {
  useEffect(() => {
    if (!activeAgentRunId) return;
    setCenterView('ai-changes');
  }, [activeAgentRunId, agentRunRefreshKey, setCenterView]);

  useEffect(() => {
    if (isDiffMode && gitDiffPreview) {
      clearGitDiffPreview();
    }
  }, [clearGitDiffPreview, gitDiffPreview, isDiffMode]);

  useEffect(() => {
    if (!isElectronApiAvailable) return undefined;
    if (!window.electronAPI || typeof window.electronAPI.onMenuOpenFolder !== 'function') return undefined;
    const offMenuOpenFolder = window.electronAPI.onMenuOpenFolder(() => {
      handleOpenFolder();
    });
    return () => {
      if (typeof offMenuOpenFolder === 'function') offMenuOpenFolder();
    };
  }, [isElectronApiAvailable, handleOpenFolder]);
};

export default useWorkspaceSyncEffects;
