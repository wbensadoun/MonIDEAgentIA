import React, { Suspense } from 'react';
import WorkspaceSidebar from './WorkspaceSidebar';
import LazyAgentVerse from './lazyAgentVerse';

/**
 * Full-page AgentVerse layout with a sidebar for project navigation.
 *
 * Structure: flex row
 * - Left: WorkspaceSidebar (projects only)
 * - Right: main with lazy-loaded AgentVerse
 *
 * Props:
 * - workspacePanelProps: props passed to WorkspacePanel (via WorkspaceSidebar)
 * - onViewChanges: callback when AgentVerse needs to switch views
 * - sidebarWidth: optional sidebar width (default '20%')
 * - All WorkspaceSidebar props (FileExplorer + WorkspacePanel props)
 */
const AgentsLayout = ({
  workspacePanelProps,
  onViewChanges,
  sidebarWidth = '20%',
  // WorkspaceSidebar props (FileExplorer side — may be empty/unused with projectsOnly)
  projectItems,
  currentProjectPath,
  activeFile,
  expandedFolders,
  newItemName,
  isElectronApiAvailable,
  onOpenFolder,
  onCreateItem,
  onRenameItem,
  onMoveItem,
  onDeleteItem,
  onToggleFolder,
  onFileClick,
  onNewItemNameChange,
  isReadOnlyMode,
}) => {
  return (
    <div className="workspace">
      {/* Left Sidebar — Projects Only */}
      <WorkspaceSidebar
        sidebarVisibility="projectsOnly"
        style={{ width: sidebarWidth }}
        projectItems={projectItems}
        currentProjectPath={currentProjectPath}
        activeFile={activeFile}
        expandedFolders={expandedFolders}
        newItemName={newItemName}
        isElectronApiAvailable={isElectronApiAvailable}
        onOpenFolder={onOpenFolder}
        onCreateItem={onCreateItem}
        onRenameItem={onRenameItem}
        onMoveItem={onMoveItem}
        onDeleteItem={onDeleteItem}
        onToggleFolder={onToggleFolder}
        onFileClick={onFileClick}
        onNewItemNameChange={onNewItemNameChange}
        isReadOnlyMode={isReadOnlyMode}
        workspacePanelProps={workspacePanelProps}
      />

      {/* Main Content — AgentVerse */}
      <main className="agents-fullscreen" aria-label="AgentVerse">
        <Suspense
          fallback={
            <div
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--text-dim)',
                fontSize: '14px',
              }}
            >
              Chargement de AgentVerse...
            </div>
          }
        >
          <LazyAgentVerse onViewChanges={onViewChanges} />
        </Suspense>
      </main>
    </div>
  );
};

export default AgentsLayout;
