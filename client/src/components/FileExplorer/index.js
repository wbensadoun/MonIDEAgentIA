import React, { useMemo, useState } from 'react';
import './FileExplorer.css';

const FileIcon = () => (
  <svg className="file-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
  </svg>
);

const FolderIcon = () => (
  <svg className="folder-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
  </svg>
);

const ChevronIcon = ({ isExpanded }) => (
  <svg
    className={`chevron-icon ${isExpanded ? 'is-expanded' : ''}`}
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
  >
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
  </svg>
);

const FileItem = ({ item, depth = 0, activeFile, expandedFolders, onToggleFolder, onFileClick, onDelete }) => {
  const isExpanded = expandedFolders.has(item.path);
  const isActive = activeFile === (item.path || item.name);
  const paddingLeft = depth * 18;

  return (
    <div key={item.path || item.name}>
      <div
        className="file-item-row"
        style={{ paddingLeft: `${paddingLeft}px` }}
      >
        <div className="file-item-main">
          {item.type === 'directory' && (
            <button
              onClick={() => onToggleFolder(item)}
              className="file-item-toggle"
            >
              <ChevronIcon isExpanded={isExpanded} />
            </button>
          )}

          <button
            onClick={() => {
              if (item.type === 'file') {
                onFileClick(item.path || item.name);
              } else {
                onToggleFolder(item);
              }
            }}
            className={`file-item-button ${isActive ? 'is-active' : ''}`}
          >
            {item.type === 'directory' ? <FolderIcon /> : <FileIcon />}
            <span className="file-item-label">{item.name}</span>
          </button>
        </div>

        <button
          onClick={() => onDelete(item.path || item.name, item.type)}
          className="file-item-delete"
        >
          <svg className="file-delete-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>

      {item.type === 'directory' && isExpanded && item.children && item.children.length > 0 && (
        <div className="file-children">
          {item.children.map(child => (
            <FileItem
              key={child.path || child.name}
              item={child}
              depth={depth + 1}
              activeFile={activeFile}
              expandedFolders={expandedFolders}
              onToggleFolder={onToggleFolder}
              onFileClick={onFileClick}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const flattenFiles = (items, acc = []) => {
  (items || []).forEach((item) => {
    if (item.type === 'file') {
      acc.push(item);
    }
    if (item.type === 'directory' && Array.isArray(item.children)) {
      flattenFiles(item.children, acc);
    }
  });
  return acc;
};

const FileExplorer = ({
  projectItems,
  currentProjectPath,
  activeFile,
  expandedFolders,
  newItemName,
  isElectronApiAvailable,
  onOpenFolder,
  onCreateItem,
  onDeleteItem,
  onToggleFolder,
  onFileClick,
  onNewItemNameChange
}) => {
  const [filterQuery, setFilterQuery] = useState('');

  const flatFiles = useMemo(() => flattenFiles(projectItems, []), [projectItems]);

  const filteredFiles = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    if (!q) return [];
    return flatFiles.filter((file) => {
      const name = (file.name || '').toLowerCase();
      const path = (file.path || '').toLowerCase();
      return name.includes(q) || path.includes(q);
    });
  }, [flatFiles, filterQuery]);

  const projectName = currentProjectPath
    ? currentProjectPath.split(/[\\/]/).pop()
    : 'Aucun projet';

  const handleCreate = async (type) => {
    if (!onCreateItem) return;
    const ok = await onCreateItem(type, newItemName);
    if (ok && onNewItemNameChange) {
      onNewItemNameChange('');
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && newItemName) {
      handleCreate(newItemName.includes('.') ? 'file' : 'directory');
    }
  };

  return (
    <div className="nav-root">
      <div className="nav-header">
        <div className="nav-brand">
          <div className="nav-icon">
            <svg className="nav-icon-svg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
          </div>
          <div className="nav-brand-text">
            <div className="nav-title">Navigator</div>
            <div className="nav-subtitle">{projectName}</div>
          </div>
        </div>
        <div className="nav-actions">
          <button
            onClick={onOpenFolder}
            className="btn btn-primary"
            disabled={!isElectronApiAvailable}
          >
            Ouvrir
          </button>
          <button
            onClick={() => handleCreate('file')}
            className="btn btn-ghost"
            disabled={!isElectronApiAvailable || !newItemName}
          >
            + Fichier
          </button>
        </div>
      </div>

      <div className="nav-section">
        <div className="nav-section-title">Créer</div>
        <div className="nav-create">
          <input
            type="text"
            className="input-surface"
            placeholder="Nom du fichier ou dossier"
            value={newItemName}
            onChange={(e) => onNewItemNameChange(e.target.value)}
            onKeyPress={handleKeyPress}
          />
          <div className="nav-create-actions">
            <button
              onClick={() => handleCreate('file')}
              className="btn btn-success"
              disabled={!isElectronApiAvailable || !newItemName}
            >
              Fichier
            </button>
            <button
              onClick={() => handleCreate('directory')}
              className="btn btn-accent"
              disabled={!isElectronApiAvailable || !newItemName}
            >
              Dossier
            </button>
          </div>
        </div>
      </div>

      <div className="nav-section">
        <div className="nav-section-title">Filtrer</div>
        <input
          type="text"
          className="input-surface"
          placeholder="Rechercher un fichier..."
          value={filterQuery}
          onChange={(e) => setFilterQuery(e.target.value)}
        />
        {filterQuery && (
          <div className="nav-hint">{filteredFiles.length} rÃ©sultat(s)</div>
        )}
      </div>

      <div className="nav-tree custom-scrollbar">
        {!currentProjectPath ? (
          <div className="nav-empty">
            Ouvrez un dossier pour commencer.
          </div>
        ) : filterQuery ? (
          filteredFiles.length === 0 ? (
            <div className="nav-empty">
              Aucun fichier trouvÃ©.
            </div>
          ) : (
            <div className="nav-results">
              {filteredFiles.map((file) => (
                <button
                  key={file.path || file.name}
                  className="nav-result"
                  onClick={() => onFileClick(file.path || file.name)}
                >
                  <FileIcon />
                  <span className="nav-result-label">{file.path || file.name}</span>
                </button>
              ))}
            </div>
          )
        ) : projectItems.length === 0 ? (
          <div className="nav-empty">
            Dossier vide.
          </div>
        ) : (
          <div className="tree-view">
            {projectItems.map(item => (
              <FileItem
                key={item.path || item.name}
                item={item}
                activeFile={activeFile}
                expandedFolders={expandedFolders}
                onToggleFolder={onToggleFolder}
                onFileClick={onFileClick}
                onDelete={onDeleteItem}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default FileExplorer;
