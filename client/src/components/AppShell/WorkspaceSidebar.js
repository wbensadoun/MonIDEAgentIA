import React, { useMemo, useState } from 'react';
import FileExplorer from '../FileExplorer';
import WorkspacePanel from '../WorkspacePanel';
import GitPanel from '../GitPanel';
import AIChangesPanel from '../AIChangesPanel';
import { IconFolder, IconSearch, IconGit, IconAudit, IconChevronDown } from '../ComponentLibrary/icons';

/** Flattens the project tree into a flat list of files, keeping the full path. */
const flattenFileList = (items, acc = []) => {
  (items || []).forEach((item) => {
    if (item.type === 'file') {
      acc.push(item);
    } else if (item.type === 'directory' && Array.isArray(item.children)) {
      flattenFileList(item.children, acc);
    }
  });
  return acc;
};

/**
 * Reusable collapsible section header — chevron + icon + label + optional
 * count badge. Shared across Explorer / Search / Git so every left-sidebar
 * section reads consistently instead of the old plain-text tab pair.
 */
const SidebarSectionHeader = ({ icon: Icon, label, count, isOpen, onToggle }) => (
  <button
    type="button"
    className="sidebar-section-header"
    onClick={onToggle}
    aria-expanded={isOpen}
  >
    <IconChevronDown size={13} className={`sidebar-section-chevron ${isOpen ? '' : 'is-collapsed'}`} />
    <Icon size={14} />
    <span className="sidebar-section-title">{label}</span>
    {typeof count === 'number' && count > 0 && (
      <span className="sidebar-section-badge">{count}</span>
    )}
  </button>
);

/** Minimal, real (not mocked) filename search over the already-loaded project tree. */
const FileSearchSection = ({ projectItems, activeFile, onFileClick, isReadOnlyMode }) => {
  const [query, setQuery] = useState('');
  const allFiles = useMemo(() => flattenFileList(projectItems), [projectItems]);
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return allFiles
      .filter((f) => (f.name || '').toLowerCase().includes(q) || (f.path || '').toLowerCase().includes(q))
      .slice(0, 200);
  }, [allFiles, query]);

  return (
    <div className="sidebar-search">
      <input
        type="text"
        className="sidebar-search-input"
        placeholder="Rechercher un fichier par nom..."
        aria-label="Rechercher un fichier par nom"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        disabled={isReadOnlyMode && allFiles.length === 0}
        autoFocus
      />
      {query.trim() && (
        <div className="sidebar-search-meta">
          {results.length} resultat{results.length !== 1 ? 's' : ''}
        </div>
      )}
      <div className="sidebar-search-results custom-scrollbar">
        {query.trim() && results.length === 0 && (
          <div className="sidebar-search-empty">Aucun fichier ne correspond.</div>
        )}
        {results.map((file) => {
          const itemPath = file.path || file.name;
          return (
            <button
              key={itemPath}
              type="button"
              className={`sidebar-search-result ${itemPath === activeFile ? 'is-active' : ''}`}
              onClick={() => onFileClick(itemPath)}
              title={itemPath}
            >
              <span className="sidebar-search-result-name">{file.name}</span>
              <span className="sidebar-search-result-path">{itemPath}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

const WorkspaceSidebar = ({
  sidebarVisibility = 'full',
  style,
  width,
  activeSection = 'explorer',
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
  // GitPanel props (only used when activeSection === 'git')
  gitPanelProps,
  // AIChangesPanel props (only used when activeSection === 'ai-changes')
  aiChangesPanelProps,
}) => {
  const [showProjects, setShowProjects] = useState(false);
  const [isSectionOpen, setIsSectionOpen] = useState(true);
  // Hooks must run unconditionally on every render (rules of hooks) — the
  // 'projectsOnly' early return below happens after this, not before.
  const fileCount = useMemo(() => flattenFileList(projectItems).length, [projectItems]);

  // When 'projectsOnly', render only WorkspacePanel without tab bar
  // (used by the standalone Chat/Agents full-page layouts).
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

  const sectionConfig = {
    explorer: { icon: IconFolder, label: 'Explorateur', count: fileCount },
    search: { icon: IconSearch, label: 'Recherche' },
    git: { icon: IconGit, label: 'Source Control' },
    'ai-changes': { icon: IconAudit, label: 'AI Changes' },
  }[activeSection] || { icon: IconFolder, label: 'Explorateur', count: fileCount };

  return (
    <aside
      className="ide-sidebar-left"
      style={{ width: width || '20%', ...style }}
    >
      <SidebarSectionHeader
        icon={sectionConfig.icon}
        label={sectionConfig.label}
        count={sectionConfig.count}
        isOpen={isSectionOpen}
        onToggle={() => setIsSectionOpen((v) => !v)}
      />

      {isSectionOpen && (
        <div className="sidebar-tab-body custom-scrollbar">
          {activeSection === 'search' && (
            <FileSearchSection
              projectItems={projectItems}
              activeFile={activeFile}
              onFileClick={onFileClick}
              isReadOnlyMode={isReadOnlyMode}
            />
          )}

          {activeSection === 'git' && <GitPanel {...gitPanelProps} />}

          {activeSection === 'ai-changes' && <AIChangesPanel {...aiChangesPanelProps} />}

          {activeSection === 'explorer' && (
            <>
              {/* Secondary switch preserving the previous Fichiers/Projets
                  split, now nested inside the Explorer section instead of
                  competing with it as an equal-weight top-level tab. */}
              <div className="sidebar-subnav" role="tablist">
                <button
                  type="button"
                  className={`sidebar-subnav-btn ${!showProjects ? 'is-active' : ''}`}
                  onClick={() => setShowProjects(false)}
                  role="tab"
                  aria-selected={!showProjects}
                >
                  Fichiers
                </button>
                <button
                  type="button"
                  className={`sidebar-subnav-btn ${showProjects ? 'is-active' : ''}`}
                  onClick={() => setShowProjects(true)}
                  role="tab"
                  aria-selected={showProjects}
                >
                  Projets
                </button>
              </div>

              {!showProjects ? (
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
            </>
          )}
        </div>
      )}
    </aside>
  );
};

export default WorkspaceSidebar;
