import React, { useState } from 'react';
import './App.css';
import ErrorBoundary from './components/ErrorBoundary';
import FeatureErrorBoundary from './components/FeatureErrorBoundary';
import Settings from './components/Settings';
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
import WorkflowManager from './components/WorkflowManager';
import AppTopbar from './components/AppShell/AppTopbar';
import ActivityBar from './components/AppShell/ActivityBar';
import WorkspaceLayout from './components/AppShell/WorkspaceLayout';
import ChatLayout from './components/AppShell/ChatLayout';
import AgentsLayout from './components/AppShell/AgentsLayout';
import StatusBar from './components/AppShell/StatusBar';
import OnboardingModal from './components/AppShell/OnboardingModal';
import CommandCenterOverlays from './components/AppShell/CommandCenterOverlays';
import useProjectStore from './stores/projectStore';

const AppContent = () => {
  // currentProjectPath in global store — accessible from any component
  const currentProjectPath = useProjectStore(state => state.currentProjectPath);
  const setCurrentProjectPath = useProjectStore(state => state.setCurrentProjectPath);
  const [newItemName, setNewItemName] = useState('');
  // Which content the left sidebar shows in 'ide' viewMode — driven by the
  // ActivityBar rail (Explorer / Search / Source Control).
  const [activeSidebarSection, setActiveSidebarSection] = useState('explorer');

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
    handlePermissionModeChange
  } = useAIModelSettings({ isElectronApiAvailable, showMessage });
  const {
    theme,
    setTheme,
    isExpertMode,
    toggleExpertMode,
    previewStatus,
    settingsOpen,
    setSettingsOpen,
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
    setRuntimeDevPort,
    viewMode,
    setViewMode,
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
    openFiles,
    setOpenFiles,
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
    openFiles,
    activeFile,
    setOpenFiles,
    setActiveFile,
    centerView,
    setCenterView
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

  // ---- Mise en page vue Chat : sidebar gauche (projets) + panneau agents
  // droit. Raisonne en simple visible/masque (les largeurs de la vue IDE sont
  // gerees en pixels par useWorkspaceSessionLayout), donc un etat
  // local ici plutot que dans ce hook partage — remonte au niveau racine
  // (et non laisse local a ChatLayout) pour que la topbar puisse piloter
  // les memes toggles que la vue IDE (isLeftCollapsed/isRightCollapsed).
  const [isChatSidebarCollapsed, setIsChatSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem('futurIA_chatSidebarCollapsed') === 'true';
    } catch {
      return false;
    }
  });
  React.useEffect(() => {
    try {
      localStorage.setItem('futurIA_chatSidebarCollapsed', String(isChatSidebarCollapsed));
    } catch {
      // ignore
    }
  }, [isChatSidebarCollapsed]);
  const toggleChatSidebar = React.useCallback(() => {
    setIsChatSidebarCollapsed((prev) => !prev);
  }, []);

  const [isSwarmPanelOpen, setIsSwarmPanelOpen] = useState(() => {
    try {
      return localStorage.getItem('futurIA_chatSwarmOpen') === 'true';
    } catch {
      return false;
    }
  });
  React.useEffect(() => {
    try {
      localStorage.setItem('futurIA_chatSwarmOpen', String(isSwarmPanelOpen));
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
    setCenterView,
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
    openFiles,
    openFile,
    setCenterView,
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
    setSettingsOpen,
    startNewConversation,
    saveConversation,
    deepContextEnabled,
    setDeepContextEnabled
  });
  const displayedPreviousCode = gitDiffPreview?.originalCode ?? previousCode;
  const activeDiffSource = gitDiffPreview ? 'git' : (isDiffMode ? 'ai' : null);
  const isEditorDiffMode = Boolean(gitDiffPreview) || isDiffMode;
  const editorProps = {
    openFiles,
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
    thinkingMode,
    onThinkingModeChange: setThinkingMode,
    deepContextEnabled,
    onDeepContextEnabledChange: setDeepContextEnabled,
    onPasteImage: addImageMessage,
    multiAIState,
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
    onOpenAgentManager: () => setViewMode('agents')
  };

  return (
    <div className={`app-shell${viewMode === 'agents' ? ' app-shell--agents' : ''}`}>
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
          onToggleChatSidebar={toggleChatSidebar}
          isChatSidebarCollapsed={isChatSidebarCollapsed}
          onToggleSwarmPanel={toggleSwarmPanel}
          isSwarmPanelOpen={isSwarmPanelOpen}
          onOpenWorkflowManager={openWorkflowManager}
          onOpenSettings={openSettings}
          theme={theme}
          onThemeChange={setTheme}
          isTerminalOpen={isTerminalOpen}
          onToggleTerminal={toggleTerminal}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
        />
      </FeatureErrorBoundary>

      <div className="app-body">
        <ActivityBar
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          activeSidebarSection={activeSidebarSection}
          onSidebarSectionChange={setActiveSidebarSection}
          isLeftCollapsed={isLeftCollapsed}
          onExpandLeftPanel={() => { if (isLeftCollapsed) toggleLeftPanel(); }}
          onOpenSettings={openSettings}
        />
        <FeatureErrorBoundary feature="workspace">
        {viewMode === 'ide' && (
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
            brainGraphProps={brainGraphPanelProps}
            workflowProps={workflowPanelProps}
            aiChatProps={aiChatProps}
            workspacePanelProps={workspacePanelProps}
            isTerminalOpen={isTerminalOpen}
            onToggleTerminal={toggleTerminal}
            activeSidebarSection={activeSidebarSection}
          />
        )}
        {viewMode === 'chat' && (
          <ChatLayout
            workspacePanelProps={workspacePanelProps}
            aiChatProps={aiChatProps}
            isSidebarCollapsed={isChatSidebarCollapsed}
            isSwarmOpen={isSwarmPanelOpen}
            onToggleSwarmPanel={toggleSwarmPanel}
          />
        )}
        {viewMode === 'agents' && (
          <AgentsLayout
            workspacePanelProps={workspacePanelProps}
            onViewChanges={() => {
              setCenterView('ai-changes');
              setViewMode('ide');
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
        viewMode={viewMode}
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
            onOpenSettings={openSettings}
            onComplete={completeOnboarding}
          />
        </FeatureErrorBoundary>
      )}

      {settingsOpen && (
        <FeatureErrorBoundary feature="settings">
          <Settings
            isOpen={settingsOpen}
            onClose={closeSettings}
            isElectronApiAvailable={isElectronApiAvailable}
            showMessage={showMessage}
            theme={theme}
            onThemeChange={setTheme}
            autoRoute={autoRoute}
            onAutoRouteChange={setAutoRoute}
            routerClassifierProvider={routerClassifierProvider}
            onRouterClassifierProviderChange={setRouterClassifierProvider}
            routerClassifierModel={routerClassifierModel}
            onRouterClassifierModelChange={setRouterClassifierModel}
            routerComplexityThreshold={routerComplexityThreshold}
            onRouterComplexityThresholdChange={setRouterComplexityThreshold}
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
