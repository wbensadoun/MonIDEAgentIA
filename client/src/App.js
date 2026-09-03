import React, { useState } from 'react';
import './App.css';
import ErrorBoundary from './components/ErrorBoundary';
import FeatureErrorBoundary from './components/FeatureErrorBoundary';
import useElectronAPI from './hooks/useElectronAPI';
import useFileOperations from './hooks/useFileOperations';
import useAI from './hooks/useAI';
import useWorkflows from './hooks/useWorkflows';
import useAIModelSettings from './hooks/useAIModelSettings';
import useWorkspaceSessionLayout from './hooks/useWorkspaceSessionLayout';
import useAgentLibrary from './hooks/useAgentLibrary';
import useAgentRuns from './hooks/useAgentRuns';
import useCommandCenter from './hooks/useCommandCenter';
import useEditorSession from './hooks/useEditorSession';
import useProjectWorkspace from './hooks/useProjectWorkspace';
import useAppUiState from './hooks/useAppUiState';
import useRunConfiguration from './hooks/useRunConfiguration';
import useExplorerItemActions from './hooks/useExplorerItemActions';
import useWorkspaceSyncEffects from './hooks/useWorkspaceSyncEffects';
import { createChatTab, isSameTab } from './utils/tabs';
import WorkflowManager from './components/WorkflowManager';
import AppTopbar from './components/AppShell/AppTopbar';
import ActivityBar from './components/AppShell/ActivityBar';
import WorkspaceLayout from './components/AppShell/WorkspaceLayout';
import AgentsLayout from './components/AppShell/AgentsLayout';
import StatusBar from './components/AppShell/StatusBar';
import OnboardingModal from './components/AppShell/OnboardingModal';
import CommandCenterOverlays from './components/AppShell/CommandCenterOverlays';
import Dialog from './components/ComponentLibrary/Dialog';
import useProjectStore from './stores/projectStore';

const AppContent = () => {
  // currentProjectPath in global store — accessible from any component
  const currentProjectPath = useProjectStore(state => state.currentProjectPath);
  const setCurrentProjectPath = useProjectStore(state => state.setCurrentProjectPath);
  const [newItemName, setNewItemName] = useState('');
  // Which content the left sidebar shows in 'ide' viewMode — driven by the
  // ActivityBar rail (Explorer / Search / Source Control).
  const [activeSidebarSection, setActiveSidebarSection] = useState('explorer');
  const [isAgentverseOpen, setIsAgentverseOpen] = useState(false);

  const { isAvailable: isElectronApiAvailable, message, showMessage } = useElectronAPI();
  const {
    aiProvider,
    thinkingMode,
    setThinkingMode,
    deepContextEnabled,
    setDeepContextEnabled,
    devPort,
    permissionMode,
    contextMode,
    contextMaxFiles,
    qualityGateConfig,
    showOnboarding,
    completeOnboarding,
    dismissOnboarding,
    isReadOnlyMode,
    resolvedOllamaModel,
    recommendedOllamaModel,
    availableOllamaModels,
    activeModelValue,
    availableActiveModels,
    ollamaTopbarLabel,
    ollamaStatusLabel,
    aiModelSelection,
    handleAiProviderChange,
    handleOllamaSettingChange,
    handleActiveModelChange,
    handlePermissionModeChange,
    saveSettingsPatch
  } = useAIModelSettings({ isElectronApiAvailable, showMessage });
  const {
    theme,
    setTheme,
    isExpertMode,
    toggleExpertMode,
    previewStatus,
    settingsOpen,
    openSettings,
    closeSettings,
    workflowManagerOpen,
    setWorkflowManagerOpen,
    openWorkflowManager,
    closeWorkflowManager,
    centerView,
    setCenterView,
    isTerminalOpen,
    setIsTerminalOpen,
    toggleTerminal,
    bottomPanelTab,
    setBottomPanelTab,
    setRuntimeDevPort,
    previewUrl,
    handleTogglePreview,
    handlePreviewRefresh
  } = useAppUiState({
    currentProjectPath,
    isElectronApiAvailable,
    devPort,
    showMessage
  });
  const {
    activeFile,
    setActiveFile,
    code,
    setCode,
    openTabs,
    setOpenTabs,
    dirtyFiles,
    revealRequest,
    aiDraftPreview,
    gitDiffPreview,
    displayedActiveFile,
    displayedCode,
    isStreamingCodePreview,
    editorReadOnly,
    clearGitDiffPreview,
    resetEditorSession,
    openFile,
    closeFileTab,
    handleCodeChange,
    handleStreamingDraftChange,
    handleGitPanelOpenFile,
    handleOpenGitDiff,
    syncNavigatorReferences,
    removeNavigatorReferences
  } = useEditorSession({
    currentProjectPath,
    isElectronApiAvailable,
    showMessage,
    isReadOnlyMode,
    centerView,
    setCenterView
  });
  // Quel onglet de chat est actif (plan-ia-onglets.md §⑤ 5.5.3) — au meme
  // titre qu'activeFile pour les fichiers : plusieurs onglets de chat
  // peuvent coexister, celui-ci dit lequel le bandeau met en surbrillance.
  const [activeChatSessionId, setActiveChatSessionId] = useState(null);

  const {
    layoutRef,
    leftWidth,
    rightWidth,
    middleWidth,
    leftMinWidth,
    leftMaxWidth,
    rightMinWidth,
    rightMaxWidth,
    editorMinWidth,
    isLeftCollapsed,
    isRightCollapsed,
    isFocusMode,
    isChatMaximized,
    dragging,
    resizeHandleProps,
    handleDragStart,
    resizeStep,
    toggleLeftPanel,
    toggleRightPanel,
    toggleChatMaximize,
    toggleFocusMode
  } = useWorkspaceSessionLayout({
    currentProjectPath,
    openTabs,
    activeFile,
    setOpenTabs,
    setActiveFile,
    centerView,
    setCenterView,
    activeChatSessionId,
    setActiveChatSessionId
  });
  const {
    availableAgents,
    availableSkills,
    activeAgent,
    activeSkill,
    setActiveAgent,
    setActiveSkill,
    bumpLibraryNonce
  } = useAgentLibrary({ currentProjectPath, isElectronApiAvailable });

  const {
    executionMode,
    setExecutionMode,
    autoRoute,
    setAutoRoute,
    routerDecision,
    setRouterDecision,
    routerClassifierProvider,
    setRouterClassifierProvider,
    routerClassifierModel,
    setRouterClassifierModel,
    routerComplexityThreshold,
    setRouterComplexityThreshold,
    reasoningEffort,
    setReasoningEffort,
    multiAgentRunOptions
  } = useRunConfiguration();

  const {
    projectItems,
    expandedFolders,
    loadProjectItems,
    toggleFolderExpansion,
    createNewItem,
    importFileContent,
    renameItem,
    moveItem,
    deleteItem,
    openFolder
  } = useFileOperations(currentProjectPath, isElectronApiAvailable, showMessage, setActiveFile, permissionMode);

  const {
    handleExplorerCreateItem,
    handleExplorerRenameItem,
    handleExplorerMoveItem,
    handleExplorerDeleteItem
  } = useExplorerItemActions({
    createNewItem,
    renameItem,
    moveItem,
    deleteItem,
    syncNavigatorReferences,
    removeNavigatorReferences
  });

  const handleExplorerImportOsFiles = React.useCallback(async (files, targetDirPath = '') => {
    if (!isElectronApiAvailable) {
      showMessage('Import depuis le systeme indisponible hors Electron.', 4000);
      return;
    }
    if (!Array.isArray(files) || files.length === 0) return;

    let successCount = 0;
    for (const file of files) {
      try {
        const content = await file.text();
        const destPath = targetDirPath ? `${targetDirPath}/${file.name}` : file.name;
        const result = await importFileContent(destPath, content);
        if (result?.success) successCount += 1;
      } catch (error) {
        showMessage(`Import "${file.name}": ${error.message}`, 4000);
      }
    }

    if (successCount > 0) {
      await loadProjectItems();
      showMessage(`${successCount} fichier(s) importe(s).`, 2500);
    }
  }, [isElectronApiAvailable, importFileContent, loadProjectItems, showMessage]);

  const {
    prompt,
    setPrompt,
    isLoading,
    aiConversationHistory,
    previousCode,
    generateAIResponse,
    addImageMessage,
    saveConversation,
    handleUndo,
    isDiffMode,
    handleAcceptDiff,
    pendingFileChanges,
    activePendingChangeId,
    activeAgentRunId,
    agentRunRefreshKey,
    selectPendingChangeByIndex,
    applyPendingChangeByIndex,
    rejectPendingChangeByIndex,
    applyAllPendingChanges,
    rejectAllPendingChanges,
    updatePendingChangeContent,
    pendingSnapshotId,
    contextEstimate,
    multiAIState,
    sessions,
    activeSessionId,
    switchSession,
    renameSession,
    duplicateSession,
    deleteSession,
    conversations,
    activeConversationFile,
    isConversationLoading,
    startNewConversation,
    loadConversationByFile,
    stopGeneration,
    pendingImages,
    setPendingImages,
    pendingMessage
  } = useAI(
    currentProjectPath,
    code,
    setCode,
    activeFile,
    isElectronApiAvailable,
    showMessage,
    setActiveFile,
    loadProjectItems,
    aiProvider,
    thinkingMode,
    deepContextEnabled,
    activeAgent,
    activeSkill,
    availableSkills,
    permissionMode,
    qualityGateConfig,
    contextMode,
    contextMaxFiles,
    executionMode,
    multiAgentRunOptions,
    autoRoute,
    setRouterDecision,
    availableAgents,
    routerClassifierProvider,
    routerClassifierModel,
    routerComplexityThreshold
  );

  // ---- Sessions de chat -> onglets (plan-ia-onglets.md §⑤ 5.5.3) ----------
  // Les onglets de chat sont des Tab[] { type:'chat', sessionId } comme les
  // autres (§9 : un seul systeme d'onglets, pas un second pour le chat).
  // Regle d'identite : ouvrir une session deja presente en onglet bascule
  // dessus au lieu d'en creer un second (isSameTab compare sessionId).
  const openChatTab = React.useCallback((sessionId) => {
    if (!sessionId) return;
    const tab = createChatTab(sessionId);
    setOpenTabs((prev) => (prev.some((t) => isSameTab(t, tab)) ? prev : [...prev, tab]));
    setActiveChatSessionId(sessionId);
    setCenterView('chat');
  }, [setOpenTabs, setCenterView]);

  // Fermer un onglet (le x) NE SUPPRIME JAMAIS la session : elle reste dans
  // `sessions`/l'historique, rouvrable a tout moment. Seule requestDeleteSession
  // (menu contextuel + confirmation) efface une session pour de bon.
  const closeChatTab = React.useCallback((sessionId) => {
    setOpenTabs((prev) => {
      const idx = prev.findIndex((tab) => tab.type === 'chat' && tab.sessionId === sessionId);
      if (idx === -1) return prev;
      const next = prev.filter((_, i) => i !== idx);
      if (sessionId === activeChatSessionId) {
        const neighbor = next[idx - 1] || next[idx];
        if (neighbor?.type === 'chat') {
          setActiveChatSessionId(neighbor.sessionId);
        } else {
          setActiveChatSessionId(null);
          setCenterView((prevView) => (prevView === 'chat' ? 'code' : prevView));
        }
      }
      return next;
    });
  }, [activeChatSessionId, setOpenTabs, setCenterView]);

  // Basculer le panneau droit vers une session (clic sur une ligne de
  // l'historique, ou bouton "reprendre ici" depuis un onglet). Le panneau ne
  // suit JAMAIS l'ouverture d'un onglet (5.5.3) : ceci est toujours une
  // action explicite distincte de openChatTab.
  const switchPanelToSession = React.useCallback((sessionId) => {
    switchSession(sessionId);
  }, [switchSession]);

  const [sessionDialog, setSessionDialog] = useState(null);
  const [isSessionDialogPending, setIsSessionDialogPending] = useState(false);

  const requestRenameSession = React.useCallback((sessionId) => {
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) return;
    setSessionDialog({
      mode: 'rename',
      sessionId,
      value: session.title || '',
    });
  }, [sessions]);

  const requestDuplicateSession = React.useCallback((sessionId) => {
    duplicateSession(sessionId);
  }, [duplicateSession]);

  // Supprimer une session : confirmation explicite obligatoire (5.5.3 —
  // "aucune session n'est perdue sans action explicite"). Si elle est
  // ouverte en onglet, ferme aussi cet onglet apres confirmation.
  const requestDeleteSession = React.useCallback((sessionId) => {
    const session = sessions.find((s) => s.id === sessionId);
    const label = session?.title || 'cette conversation';
    setSessionDialog({
      mode: 'delete',
      sessionId,
      label,
    });
  }, [sessions]);

  const submitSessionDialog = React.useCallback(async () => {
    if (!sessionDialog || isSessionDialogPending) return;
    setIsSessionDialogPending(true);
    try {
      if (sessionDialog.mode === 'rename') {
        const nextTitle = String(sessionDialog.value || '').trim();
        if (nextTitle) renameSession(sessionDialog.sessionId, nextTitle);
      } else {
        const wasOpenInTab = openTabs.some(
          (t) => t.type === 'chat' && t.sessionId === sessionDialog.sessionId
        );
        if (wasOpenInTab) closeChatTab(sessionDialog.sessionId);
        deleteSession(sessionDialog.sessionId);
      }
      setSessionDialog(null);
    } finally {
      setIsSessionDialogPending(false);
    }
  }, [closeChatTab, deleteSession, isSessionDialogPending, openTabs, renameSession, sessionDialog]);

  // ---- Mise en page vue Chat : sidebar gauche (projets) + panneau agents
  // droit. Raisonne en simple visible/masque (les largeurs de la vue IDE sont
  // gerees en pixels par useWorkspaceSessionLayout), donc un etat
  // local ici plutot que dans ce hook partage — remonte au niveau racine
  // (et non laisse local a ChatLayout) pour que la topbar puisse piloter
  // les memes toggles que la vue IDE (isLeftCollapsed/isRightCollapsed).
  const [isChatSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem('code_companion_chatSidebarCollapsed') === 'true';
    } catch {
      return false;
    }
  });
  React.useEffect(() => {
    try {
      localStorage.setItem('code_companion_chatSidebarCollapsed', String(isChatSidebarCollapsed));
    } catch {
      // ignore
    }
  }, [isChatSidebarCollapsed]);
  // Legacy: toggleChatSidebar no longer used after removing chat-specific viewMode

  const [isSwarmPanelOpen, setIsSwarmPanelOpen] = useState(() => {
    try {
      return localStorage.getItem('code_companion_chatSwarmOpen') === 'true';
    } catch {
      return false;
    }
  });
  React.useEffect(() => {
    try {
      localStorage.setItem('code_companion_chatSwarmOpen', String(isSwarmPanelOpen));
    } catch {
      // ignore
    }
  }, [isSwarmPanelOpen]);
  const toggleSwarmPanel = React.useCallback(() => {
    setIsSwarmPanelOpen((prev) => !prev);
  }, []);

  // Auto-ouverture du panneau agents au demarrage d'un run multi-agents —
  // detecte la transition de multiAIState.startedAt via un ref, pour ne
  // rouvrir qu'une fois par run et ne jamais lutter contre une fermeture
  // manuelle pendant le meme run.
  const swarmStartedAtRef = React.useRef(multiAIState?.startedAt ?? null);
  React.useEffect(() => {
    const startedAt = multiAIState?.startedAt ?? null;
    if (startedAt && startedAt !== swarmStartedAtRef.current) {
      setIsSwarmPanelOpen(true);
    }
    swarmStartedAtRef.current = startedAt;
  }, [multiAIState?.startedAt]);

  const {
    workspaces,
    projectRunState,
    conversationsRefreshKey,
    projectName,
    handleSelectProject,
    handleOpenFolder,
    handleOpenConversation,
    handleRemoveProject
  } = useProjectWorkspace({
    currentProjectPath,
    setCurrentProjectPath,
    isElectronApiAvailable,
    showMessage,
    openFolder,
    resetEditorSession,
    isLoading,
    multiAIState,
    pendingFileChanges,
    activeConversationFile,
    loadConversationByFile
  });

  const {
    agentRuns,
    activeAgentRun,
    selectedAgentRunId,
    isAgentRunsLoading,
    loadAgentRuns,
    handleSelectAgentRun,
    refreshAgentRunAfterMutation
  } = useAgentRuns({
    currentProjectPath,
    isElectronApiAvailable,
    activeAgentRunId,
    agentRunRefreshKey
  });

  const {
    workflows,
    isLoading: isWorkflowsLoading,
    saveWorkflow,
    deleteWorkflow,
    getWorkflow,
    findWorkflow,
    parseSlashCommand
  } = useWorkflows(currentProjectPath, isElectronApiAvailable);

  useWorkspaceSyncEffects({
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
  });

  const {
    projectFileList,
    openCommandPalette,
    overlayProps: commandCenterOverlayProps
  } = useCommandCenter({
    currentProjectPath,
    isElectronApiAvailable,
    showMessage,
    openTabs,
    openFile,
    setCenterView,
    setActiveSidebarSection,
    setBottomPanelTab,
    handleOpenFolder,
    isLeftCollapsed,
    isRightCollapsed,
    isFocusMode,
    toggleLeftPanel,
    toggleRightPanel,
    toggleFocusMode,
    setIsTerminalOpen,
    setExecutionMode,
    previewStatus,
    handleTogglePreview,
    setWorkflowManagerOpen,
    openSettings,
    closeSettings,
    isSettingsOpen: settingsOpen,
    activeFile,
    centerView,
    closeFileTab,
    startNewConversation,
    saveConversation,
    deepContextEnabled,
    setDeepContextEnabled,
    activeChatSessionId,
    onActivateChatTab: (sessionId) => { setActiveChatSessionId(sessionId); setCenterView('chat'); },
    onCloseChatTab: closeChatTab
  });
  const displayedPreviousCode = gitDiffPreview?.originalCode ?? previousCode;
  const activeDiffSource = gitDiffPreview ? 'git' : (isDiffMode ? 'ai' : null);
  const isEditorDiffMode = Boolean(gitDiffPreview) || isDiffMode;
  const editorProps = {
    openTabs,
    dirtyFiles,
    activeFile: displayedActiveFile,
    code: displayedCode,
    previousCode: displayedPreviousCode,
    onCodeChange: handleCodeChange,
    onUndo: handleUndo,
    onAcceptDiff: handleAcceptDiff,
    isDiffMode: isEditorDiffMode,
    diffSource: activeDiffSource,
    diffOriginalLabel: gitDiffPreview?.baseLabel,
    diffModifiedLabel: gitDiffPreview?.targetLabel,
    onCloseDiff: clearGitDiffPreview,
    onSelectFile: openFile,
    onCloseFile: closeFileTab,
    revealRequest,
    forceReadOnly: editorReadOnly,
    currentProjectPath,
    aiProvider,
    aiModels: aiModelSelection
  };
  const previewPanelProps = {
    projectId: currentProjectPath || 'default',
    status: previewStatus,
    onRefresh: handlePreviewRefresh,
    previewUrl,
    className: 'flex-1'
  };
  const terminalPanelProps = {
    currentProjectPath,
    isElectronApiAvailable,
    showMessage,
    permissionMode,
    preferredDevPort: devPort,
    onDevPortResolved: setRuntimeDevPort
  };
  const workspacePanelProps = {
    workspaces,
    currentProjectPath,
    projectRunState,
    isElectronApiAvailable,
    activeConversationFile,
    conversationsRefreshKey,
    onSelectProject: handleSelectProject,
    onOpenConversation: handleOpenConversation,
    onOpenProject: handleOpenFolder,
    onRemoveProject: handleRemoveProject,
    onNewConversation: startNewConversation
  };
  // Contenu des onglets de chat dans le bandeau central (plan-ia-onglets.md
  // §⑤ 5.5.3). activePanelSessionId sert a afficher "session active du
  // panneau" au lieu du bouton "reprendre ici" quand c'est deja le cas.
  const chatTabsProps = {
    sessions,
    activeChatSessionId,
    activePanelSessionId: activeSessionId,
    onActivateChatTab: (sessionId) => { setActiveChatSessionId(sessionId); setCenterView('chat'); },
    onCloseChatTab: closeChatTab,
    onSwitchPanelToSession: switchPanelToSession
  };
  const gitPanelProps = {
    currentProjectPath,
    isElectronApiAvailable,
    showMessage,
    permissionMode,
    onOpenFile: handleGitPanelOpenFile,
    onOpenGitDiff: handleOpenGitDiff,
    activeComparisonKey: gitDiffPreview?.comparisonKey || ''
  };
  const aiChangesPanelProps = {
    currentProjectPath,
    runs: agentRuns,
    activeRun: activeAgentRun,
    selectedRunId: selectedAgentRunId,
    isLoading: isAgentRunsLoading,
    permissionMode,
    pendingFileChanges,
    onSelectRun: handleSelectAgentRun,
    onRefresh: () => loadAgentRuns(selectedAgentRunId),
    onRunChanged: refreshAgentRunAfterMutation,
    onSelectPendingChange: selectPendingChangeByIndex,
    onApplyPendingChange: applyPendingChangeByIndex,
    onRejectPendingChange: rejectPendingChangeByIndex,
    onUpdatePendingChangeContent: updatePendingChangeContent,
    onAfterDiskChange: loadProjectItems,
    showMessage
  };
  const brainGraphPanelProps = {
    currentProjectPath,
    isElectronApiAvailable,
    showMessage,
    activeFile,
    onOpenFile: openFile
  };
  const workflowPanelProps = {
    currentProjectPath,
    isElectronApiAvailable,
    showMessage,
    aiProvider,
    aiModels: aiModelSelection
  };
  const aiChatProps = {
    prompt,
    conversationHistory: aiConversationHistory,
    isLoading,
    currentProjectPath,
    isElectronApiAvailable,
    onPromptChange: setPrompt,
    onSend: generateAIResponse,
    onSaveConversation: saveConversation,
    aiProvider,
    onProviderChange: handleAiProviderChange,
    executionMode,
    onExecutionModeChange: setExecutionMode,
    autoRoute,
    onAutoRouteChange: setAutoRoute,
    routerDecision,
    routerClassifierProvider,
    onRouterClassifierProviderChange: setRouterClassifierProvider,
    routerClassifierModel,
    onRouterClassifierModelChange: setRouterClassifierModel,
    routerComplexityThreshold,
    onRouterComplexityThresholdChange: setRouterComplexityThreshold,
    reasoningEffort,
    onReasoningEffortChange: (effort) => {
      setReasoningEffort(effort);
      saveSettingsPatch({ reasoningEffort: effort });
    },
    thinkingMode,
    onThinkingModeChange: setThinkingMode,
    deepContextEnabled,
    onDeepContextEnabledChange: setDeepContextEnabled,
    onPasteImage: addImageMessage,
    multiAIState,
    sessions,
    activeSessionId,
    onSwitchSession: switchPanelToSession,
    onOpenSessionTab: openChatTab,
    onRenameSession: requestRenameSession,
    onDuplicateSession: requestDuplicateSession,
    onDeleteSession: requestDeleteSession,
    conversations,
    activeConversationFile,
    isConversationLoading,
    onNewConversation: startNewConversation,
    onSelectConversation: loadConversationByFile,
    onStopGeneration: stopGeneration,
    workflows,
    findWorkflow,
    getWorkflow,
    parseSlashCommand,
    activeFile,
    agents: availableAgents,
    skills: availableSkills,
    activeAgent,
    activeSkill,
    onActiveAgentChange: setActiveAgent,
    onActiveSkillChange: setActiveSkill,
    globalSkillsCount: availableSkills.filter((skill) => skill.scope === 'global').length,
    pendingImages,
    onRemovePendingImage: (idx) => setPendingImages((prev) => prev.filter((_, i) => i !== idx)),
    pendingMessage,
    pendingFileChanges,
    activePendingChangeId,
    onSelectPendingChange: selectPendingChangeByIndex,
    onApplyPendingChange: applyPendingChangeByIndex,
    onRejectPendingChange: rejectPendingChangeByIndex,
    onApplyAllPendingChanges: applyAllPendingChanges,
    onRejectAllPendingChanges: rejectAllPendingChanges,
    pendingSnapshotId,
    contextEstimate,
    permissionMode,
    onPermissionModeChange: handlePermissionModeChange,
    projectFileList,
    onStreamingDraftChange: handleStreamingDraftChange,
    resolvedOllamaModel,
    availableOllamaModels,
    onOllamaSettingChange: handleOllamaSettingChange,
    activeModelValue,
    availableActiveModels,
    onActiveModelChange: handleActiveModelChange,
    isExpertMode,
    isDeveloperMode: isExpertMode,
    onOpenAgentManager: () => setIsAgentverseOpen(true)
  };

  // Paramètres : contenu d'onglet singleton, hébergé par WorkspaceLayout
  // (plan-ia-onglets.md §④) — plus une modale rendue à part.
  const settingsProps = {
    isElectronApiAvailable,
    showMessage,
    theme,
    onThemeChange: setTheme,
    autoRoute,
    onAutoRouteChange: setAutoRoute,
    routerClassifierProvider,
    onRouterClassifierProviderChange: setRouterClassifierProvider,
    routerClassifierModel,
    onRouterClassifierModelChange: setRouterClassifierModel,
    routerComplexityThreshold,
    onRouterComplexityThresholdChange: setRouterComplexityThreshold,
    onOpenExtensions: () => {
      closeSettings();
      setActiveSidebarSection('extensions');
      if (isLeftCollapsed) toggleLeftPanel();
    }
  };

  return (
    <div className={`app-shell${isAgentverseOpen ? ' app-shell--agents' : ''}`}>
      {sessionDialog && (
        <Dialog
          ariaLabel={sessionDialog.mode === 'rename' ? 'Renommer la conversation' : 'Supprimer la conversation'}
          onClose={() => !isSessionDialogPending && setSessionDialog(null)}
          closeOnBackdrop={!isSessionDialogPending}
          overlayClassName="modal-overlay"
          className="session-dialog"
        >
          {sessionDialog.mode === 'rename' ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                submitSessionDialog();
              }}
            >
              <div className="modal-header">
                <h2 className="modal-title">Renommer la conversation</h2>
              </div>
              <div className="session-dialog__body">
                <label className="session-dialog__label" htmlFor="session-rename-title">
                  Nom
                </label>
                <input
                  id="session-rename-title"
                  className="session-dialog__input"
                  value={sessionDialog.value}
                  onChange={(event) =>
                    setSessionDialog((prev) => ({ ...prev, value: event.target.value }))
                  }
                  autoFocus
                  autoComplete="off"
                  disabled={isSessionDialogPending}
                />
              </div>
              <div className="session-dialog__actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setSessionDialog(null)}
                  disabled={isSessionDialogPending}
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={isSessionDialogPending || !sessionDialog.value.trim()}
                >
                  Renommer
                </button>
              </div>
            </form>
          ) : (
            <div>
              <div className="modal-header">
                <h2 className="modal-title">Supprimer la conversation</h2>
              </div>
              <div className="session-dialog__body">
                <p>Supprimer définitivement « {sessionDialog.label} » ? Cette action est irréversible.</p>
              </div>
              <div className="session-dialog__actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setSessionDialog(null)}
                  disabled={isSessionDialogPending}
                >
                  Annuler
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={submitSessionDialog}
                  disabled={isSessionDialogPending}
                >
                  Supprimer
                </button>
              </div>
            </div>
          )}
        </Dialog>
      )}
      {message && (
        <div className="toast">
          <span className="toast-dot"></span>
          <span>{message}</span>
        </div>
      )}

      <FeatureErrorBoundary feature="topbar">
        <AppTopbar
          projectName={projectName}
          currentProjectPath={currentProjectPath}
          displayedActiveFile={displayedActiveFile}
          isStreamingCodePreview={isStreamingCodePreview}
          gitDiffPreview={gitDiffPreview}
          onOpenCommandPalette={openCommandPalette}
          isExpertMode={isExpertMode}
          onToggleExpertMode={toggleExpertMode}
          aiProvider={aiProvider}
          onAiProviderChange={handleAiProviderChange}
          activeModelValue={activeModelValue}
          availableActiveModels={availableActiveModels}
          onActiveModelChange={handleActiveModelChange}
          thinkingMode={thinkingMode}
          onThinkingModeChange={setThinkingMode}
          deepContextEnabled={deepContextEnabled}
          onDeepContextEnabledChange={setDeepContextEnabled}
          isElectronApiAvailable={isElectronApiAvailable}
          isLoading={isLoading}
          multiAIState={multiAIState}
          autoRoute={autoRoute}
          onAutoRouteChange={setAutoRoute}
          resolvedOllamaModel={resolvedOllamaModel}
          availableOllamaModels={availableOllamaModels}
          recommendedOllamaModel={recommendedOllamaModel}
          onOllamaSettingChange={handleOllamaSettingChange}
          ollamaTopbarLabel={ollamaTopbarLabel}
          ollamaStatusLabel={ollamaStatusLabel}
          showMessage={showMessage}
          onOpenFolder={handleOpenFolder}
          previewStatus={previewStatus}
          onTogglePreview={handleTogglePreview}
          onToggleLeftPanel={toggleLeftPanel}
          isLeftCollapsed={isLeftCollapsed}
          onToggleRightPanel={toggleRightPanel}
          isRightCollapsed={isRightCollapsed}
          isChatMaximized={isChatMaximized}
          onToggleChatMaximize={toggleChatMaximize}
          onToggleSwarmPanel={toggleSwarmPanel}
          isSwarmPanelOpen={isSwarmPanelOpen}
          onOpenWorkflowManager={openWorkflowManager}
          onOpenSettings={openSettings}
          theme={theme}
          onThemeChange={setTheme}
          isTerminalOpen={isTerminalOpen}
          onToggleTerminal={toggleTerminal}
        />
      </FeatureErrorBoundary>

      <div className="app-body">
        <ActivityBar
          activeSidebarSection={activeSidebarSection}
          onSidebarSectionChange={setActiveSidebarSection}
          isLeftCollapsed={isLeftCollapsed}
          onExpandLeftPanel={() => { if (isLeftCollapsed) toggleLeftPanel(); }}
          onOpenSettings={openSettings}
          isAgentverseOpen={isAgentverseOpen}
          onAgentverseToggle={setIsAgentverseOpen}
          isRightCollapsed={isRightCollapsed}
          onToggleRightPanel={toggleRightPanel}
          centerView={centerView}
          onOpenWorkflows={() => setCenterView('workflows')}
        />
        <FeatureErrorBoundary feature="workspace">
        {!isAgentverseOpen && (
          <WorkspaceLayout
            layoutRef={layoutRef}
            leftWidth={leftWidth}
            rightWidth={rightWidth}
            middleWidth={middleWidth}
            leftMinWidth={leftMinWidth}
            leftMaxWidth={leftMaxWidth}
            rightMinWidth={rightMinWidth}
            rightMaxWidth={rightMaxWidth}
            editorMinWidth={editorMinWidth}
            isLeftCollapsed={isLeftCollapsed}
            isRightCollapsed={isRightCollapsed}
            dragging={dragging}
            resizeHandleProps={resizeHandleProps}
            onDragStart={handleDragStart}
            onResizeStep={resizeStep}
            projectItems={projectItems}
            currentProjectPath={currentProjectPath}
            activeFile={activeFile}
            expandedFolders={expandedFolders}
            newItemName={newItemName}
            isElectronApiAvailable={isElectronApiAvailable}
            onOpenFolder={handleOpenFolder}
            onCreateItem={handleExplorerCreateItem}
            onRenameItem={handleExplorerRenameItem}
            onMoveItem={handleExplorerMoveItem}
            onDeleteItem={handleExplorerDeleteItem}
            onImportOsFiles={handleExplorerImportOsFiles}
            onToggleFolder={toggleFolderExpansion}
            onFileClick={openFile}
            onNewItemNameChange={setNewItemName}
            isReadOnlyMode={isReadOnlyMode}
            centerView={centerView}
            onCenterViewChange={setCenterView}
            isFocusMode={isFocusMode}
            isChatMaximized={isChatMaximized}
            onToggleFocusMode={toggleFocusMode}
            editorProps={editorProps}
            previewProps={previewPanelProps}
            terminalProps={terminalPanelProps}
            gitPanelProps={gitPanelProps}
            aiChangesPanelProps={aiChangesPanelProps}
            extensionsPanelProps={{
              isElectronApiAvailable,
              showMessage,
              onOpenPackManager: () => setWorkflowManagerOpen(true)
            }}
            brainGraphProps={brainGraphPanelProps}
            workflowProps={workflowPanelProps}
            aiChatProps={aiChatProps}
            chatTabsProps={chatTabsProps}
            workspacePanelProps={workspacePanelProps}
            isTerminalOpen={isTerminalOpen}
            onToggleTerminal={toggleTerminal}
            bottomPanelTab={bottomPanelTab}
            onBottomPanelTabChange={setBottomPanelTab}
            activeSidebarSection={activeSidebarSection}
            settingsProps={settingsProps}
            isSettingsOpen={settingsOpen}
            onCloseSettings={closeSettings}
          />
        )}
        {isAgentverseOpen && (
          <AgentsLayout
            workspacePanelProps={workspacePanelProps}
            onViewChanges={() => {
              setActiveSidebarSection('ai-changes');
              if (isLeftCollapsed) toggleLeftPanel();
              setIsAgentverseOpen(false);
            }}
            projectItems={projectItems}
            currentProjectPath={currentProjectPath}
            activeFile={activeFile}
            expandedFolders={expandedFolders}
            newItemName={newItemName}
            isElectronApiAvailable={isElectronApiAvailable}
            onOpenFolder={handleOpenFolder}
            onCreateItem={handleExplorerCreateItem}
            onRenameItem={handleExplorerRenameItem}
            onMoveItem={handleExplorerMoveItem}
            onDeleteItem={handleExplorerDeleteItem}
            onToggleFolder={toggleFolderExpansion}
            onFileClick={openFile}
            onNewItemNameChange={setNewItemName}
            isReadOnlyMode={isReadOnlyMode}
          />
        )}
        </FeatureErrorBoundary>
      </div>

      <FeatureErrorBoundary feature="statusbar">
      <StatusBar
        centerView={centerView}
        previewStatus={previewStatus}
        isStreamingCodePreview={isStreamingCodePreview}
        aiDraftPreview={aiDraftPreview}
        gitDiffPreview={gitDiffPreview}
        aiProvider={aiProvider}
        thinkingMode={thinkingMode}
        deepContextEnabled={deepContextEnabled}
        contextMode={contextMode}
        ollamaStatusLabel={ollamaStatusLabel}
        multiAIState={multiAIState}
        permissionMode={permissionMode}
        projectName={projectName}
        pendingAIChangeCount={pendingFileChanges.length}
      />

      </FeatureErrorBoundary>

      {showOnboarding && (
        <FeatureErrorBoundary feature="onboarding">
          <OnboardingModal
            onOpenSettings={() => {
              openSettings();
              dismissOnboarding();
            }}
            onComplete={completeOnboarding}
          />
        </FeatureErrorBoundary>
      )}

      {workflowManagerOpen && (
        <FeatureErrorBoundary feature="workflow-manager">
          <WorkflowManager
            workflows={workflows}
            isLoading={isWorkflowsLoading}
            onSave={saveWorkflow}
            onDelete={deleteWorkflow}
            onTrigger={async (workflow) => {
              const fullWorkflow = await getWorkflow(workflow.name, workflow.scope);
              if (fullWorkflow) {
                setPrompt(`/${workflow.name}`);
                showMessage(`Workflow "/${workflow.name}" charge.`, 3000);
              }
              closeWorkflowManager();
            }}
            onClose={closeWorkflowManager}
            currentProjectPath={currentProjectPath}
            showMessage={showMessage}
            isElectronApiAvailable={isElectronApiAvailable}
            onLibraryUpdated={bumpLibraryNonce}
          />
        </FeatureErrorBoundary>
      )}

      <CommandCenterOverlays {...commandCenterOverlayProps} />
    </div>
  );
};

const App = () => (
  <ErrorBoundary>
    <AppContent />
  </ErrorBoundary>
);

export default App;
