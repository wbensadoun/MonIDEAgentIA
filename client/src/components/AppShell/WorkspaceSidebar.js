import React, { useState } from 'react';
import FileExplorer from '../FileExplorer';
import WorkspacePanel from '../WorkspacePanel';

const WorkspaceSidebar = ({
  sidebarVisibility = 'full',
  style,
  width,
  // FileExplorer props
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
  onImportOsFiles,
  onToggleFolder,
  onFileClick,
  onNewItemNameChange,
  isReadOnlyMode,
  // WorkspacePanel props
  workspacePanelProps,
}) => {
  const [sidebarTab, setSidebarTab] = useState('files');

  // When 'projectsOnly', render only WorkspacePanel without tab bar
  if (sidebarVisibility === 'projectsOnly') {
    return (
      <aside
        className="ide-sidebar-left"
        style={{ width: width || '20%', ...style }}
      >
        <div className="sidebar-tab-body custom-scrollbar">
          <WorkspacePanel {...workspacePanelProps} />
        </div>
      </aside>
    );
  }

  // When 'full' (default), render tab bar and switch between FileExplorer and WorkspacePanel
  return (
    <aside
      className="ide-sidebar-left"
      style={{ width: width || '20%', ...style }}
    >
      <div className="sidebar-tabs" role="tablist">
        <button
          type="button"
          className={`sidebar-tab ${sidebarTab === 'files' ? 'is-active' : ''}`}
          onClick={() => setSidebarTab('files')}
          role="tab"
          aria-selected={sidebarTab === 'files'}
        >
          Fichiers
        </button>
        <button
          type="button"
          className={`sidebar-tab ${sidebarTab === 'projects' ? 'is-active' : ''}`}
          onClick={() => setSidebarTab('projects')}
          role="tab"
          aria-selected={sidebarTab === 'projects'}
        >
          Projets
        </button>
      </div>
      <div className="sidebar-tab-body custom-scrollbar">
        {sidebarTab === 'files' ? (
          <FileExplorer
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
            onImportOsFiles={onImportOsFiles}
            onToggleFolder={onToggleFolder}
            onFileClick={onFileClick}
            onNewItemNameChange={onNewItemNameChange}
            isReadOnly={isReadOnlyMode}
          />
        ) : (
          <WorkspacePanel {...workspacePanelProps} />
        )}
      </div>
    </aside>
  );
};

export default WorkspaceSidebar;
