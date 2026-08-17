import { useEffect, useRef } from 'react';

const useWorkspaceSyncEffects = ({
  activeAgentRunId,
  agentRunRefreshKey,
  setActiveSidebarSection,
  isLeftCollapsed,
  toggleLeftPanel,
  isDiffMode,
  gitDiffPreview,
  clearGitDiffPreview,
  isElectronApiAvailable,
  handleOpenFolder
}) => {
  // Read via ref so the effect below still fires only on a new/refreshed
  // agent run (its original trigger) and not every time the user toggles
  // the left panel by hand in the meantime.
  const sidebarRef = useRef({ setActiveSidebarSection, isLeftCollapsed, toggleLeftPanel });
  sidebarRef.current = { setActiveSidebarSection, isLeftCollapsed, toggleLeftPanel };

  useEffect(() => {
    if (!activeAgentRunId) return;
    // AI Changes vit dans l'Activity Bar/sidebar, pas dans centerView
    // (plan-ia-onglets.md §④) : on ouvre cette vue au lieu de basculer un
    // onglet du centre.
    const { setActiveSidebarSection: setSection, isLeftCollapsed: collapsed, toggleLeftPanel: expand } = sidebarRef.current;
    setSection('ai-changes');
    if (collapsed) expand();
  }, [activeAgentRunId, agentRunRefreshKey]);

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
