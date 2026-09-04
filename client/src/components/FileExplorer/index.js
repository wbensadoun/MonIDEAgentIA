import React, { useCallback, useEffect, useMemo, useState } from 'react';
import './FileExplorer.css';
import Dialog from '../ComponentLibrary/Dialog';
import Button from '../ComponentLibrary/Button';
import {
  getNavigatorBaseName,
  getNavigatorDirName,
  isNavigatorDescendant,
  isSameNavigatorPath,
  joinNavigatorPath,
} from '../../utils/navigatorPaths';

const FileIcon = () => (
  <svg className="file-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
    />
  </svg>
);

const FolderIcon = () => (
  <svg className="folder-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
    />
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

const countTree = (items) => {
  let files = 0;
  let directories = 0;

  const walk = (nodes) => {
    (nodes || []).forEach((item) => {
      if (item.type === 'file') files += 1;
      if (item.type === 'directory') {
        directories += 1;
        if (Array.isArray(item.children)) walk(item.children);
      }
    });
  };

  walk(items);
  return { files, directories };
};

const createContextAction = (id, label, onClick, danger = false) => ({
  id,
  label,
  onClick,
  danger,
});

const FileItem = ({
  item,
  depth = 0,
  activeFile,
  expandedFolders,
  renameState,
  dragState,
  isReadOnly = false,
  onToggleFolder,
  onFileClick,
  onDelete,
  onRenameChange,
  onRenameCommit,
  onRenameCancel,
  onOpenContextMenu,
  onCreateInside,
  onDragStart,
  onDragEnterDirectory,
  onDropIntoDirectory,
}) => {
  const itemPath = item.path || item.name;
  const isExpanded = expandedFolders.has(item.path);
  const isActive = activeFile === itemPath;
  const isRenaming = renameState.path && isSameNavigatorPath(renameState.path, itemPath);
  const isDirectoryDropTarget =
    item.type === 'directory' &&
    dragState.overPath &&
    isSameNavigatorPath(dragState.overPath, itemPath);
  const paddingLeft = depth * 18;

  return (
    <div key={itemPath}>
      <div
        className={`file-item-row ${isDirectoryDropTarget ? 'is-drop-target' : ''} ${dragState.draggedPath && isSameNavigatorPath(dragState.draggedPath, itemPath) ? 'is-dragging' : ''}`}
        style={{ paddingLeft: `${paddingLeft}px` }}
        draggable={!isReadOnly}
        onDragStart={(event) => onDragStart(event, item)}
        onContextMenu={(event) => onOpenContextMenu(event, item)}
        onDragEnter={(event) => {
          if (item.type === 'directory') {
            event.stopPropagation();
            onDragEnterDirectory(event, item);
          }
        }}
        onDragOver={(event) => {
          if (item.type !== 'directory') return;
          event.preventDefault();
          event.stopPropagation();
        }}
        onDrop={(event) => {
          if (item.type === 'directory') {
            event.stopPropagation();
            onDropIntoDirectory(event, item);
          }
        }}
      >
        <div className="file-item-main">
          {item.type === 'directory' && (
            <Button
              type="button"
              onClick={() => onToggleFolder(item)}
              className="file-item-toggle"
              aria-label={isExpanded ? 'Replier le dossier' : 'Déplier le dossier'}
              aria-expanded={isExpanded}
            >
              <ChevronIcon isExpanded={isExpanded} />
            </Button>
          )}

          <Button
            type="button"
            onClick={() => {
              if (isRenaming) return;
              if (item.type === 'file') {
                onFileClick(itemPath);
              } else {
                onToggleFolder(item);
              }
            }}
            className={`file-item-button ${isActive ? 'is-active' : ''}`}
          >
            {item.type === 'directory' ? <FolderIcon /> : <FileIcon />}
            {isRenaming ? (
              <input
                autoFocus
                className="file-item-rename-input"
                value={renameState.value}
                onChange={(event) => onRenameChange(event.target.value)}
                onClick={(event) => event.stopPropagation()}
                onBlur={onRenameCommit}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    onRenameCommit();
                  } else if (event.key === 'Escape') {
                    event.preventDefault();
                    onRenameCancel();
                  }
                }}
              />
            ) : (
              <span className="file-item-label">{item.name}</span>
            )}
          </Button>
        </div>

        <div className="file-item-actions">
          {item.type === 'directory' && !isReadOnly && (
            <>
              <Button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onCreateInside('file', item);
                }}
                className="file-item-mini"
                title="Nouveau fichier"
              >
                +F
              </Button>
              <Button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onCreateInside('directory', item);
                }}
                className="file-item-mini"
                title="Nouveau dossier"
              >
                +D
              </Button>
            </>
          )}
          <Button
            type="button"
            onClick={() => onDelete(itemPath, item.type)}
            className="file-item-delete"
            disabled={isReadOnly}
            title={isReadOnly ? 'Mode lecture seule' : 'Supprimer'}
          >
            <svg className="file-delete-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
          </Button>
        </div>
      </div>

      {item.type === 'directory' && isExpanded && item.children && item.children.length > 0 && (
        <div className="file-children">
          {item.children.map((child) => (
            <FileItem
              key={child.path || child.name}
              item={child}
              depth={depth + 1}
              activeFile={activeFile}
              expandedFolders={expandedFolders}
              renameState={renameState}
              dragState={dragState}
              onToggleFolder={onToggleFolder}
              onFileClick={onFileClick}
              onDelete={onDelete}
              onRenameChange={onRenameChange}
              onRenameCommit={onRenameCommit}
              onRenameCancel={onRenameCancel}
              onOpenContextMenu={onOpenContextMenu}
              onCreateInside={onCreateInside}
              onDragStart={onDragStart}
              onDragEnterDirectory={onDragEnterDirectory}
              onDropIntoDirectory={onDropIntoDirectory}
              isReadOnly={isReadOnly}
            />
          ))}
        </div>
      )}
    </div>
  );
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
  onRenameItem,
  onMoveItem,
  onDeleteItem,
  onImportOsFiles,
  onToggleFolder,
  onFileClick,
  onNewItemNameChange,
  isReadOnly = false,
  allowDangerousActions = false,
}) => {
  const [filterQuery, setFilterQuery] = useState('');
  const [renameState, setRenameState] = useState({ path: '', value: '', type: '' });
  const [contextMenu, setContextMenu] = useState(null);
  const [createDialog, setCreateDialog] = useState(null);
  const [isCreating, setIsCreating] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [dragState, setDragState] = useState({
    draggedPath: '',
    draggedType: '',
    overPath: '',
    overRoot: false,
  });

  const flatFiles = useMemo(() => flattenFiles(projectItems, []), [projectItems]);
  const treeStats = useMemo(() => countTree(projectItems), [projectItems]);

  const filteredFiles = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    if (!q) return [];
    return flatFiles.filter((file) => {
      const name = (file.name || '').toLowerCase();
      const path = (file.path || '').toLowerCase();
      return name.includes(q) || path.includes(q);
    });
  }, [flatFiles, filterQuery]);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  useEffect(() => {
    const handleWindowPointer = () => setContextMenu(null);
    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        setContextMenu(null);
        setRenameState((prev) => (prev.path ? { path: '', value: '', type: '' } : prev));
      }
    };

    window.addEventListener('pointerdown', handleWindowPointer);
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('pointerdown', handleWindowPointer);
      window.removeEventListener('keydown', handleEscape);
    };
  }, []);

  const performCreate = useCallback(
    async (type, name, parentPath = '') => {
      if (!onCreateItem) return false;
      const ok = await onCreateItem(type, name, parentPath);
      if (ok && !parentPath && onNewItemNameChange) {
        onNewItemNameChange('');
      }
      if (ok) setContextMenu(null);
      return ok;
    },
    [onCreateItem, onNewItemNameChange]
  );

  const handleCreate = useCallback(
    async (type, parentPath = '') => {
      if (!onCreateItem) return;
      if (parentPath) {
        setCreateDialog({ type, parentPath, value: '' });
        setContextMenu(null);
        return;
      }

      const name = String(newItemName || '').trim();
      if (!name) return;
      await performCreate(type, name, parentPath);
    },
    [newItemName, onCreateItem, performCreate]
  );

  const submitCreate = useCallback(async () => {
    if (!createDialog || isCreating) return;
    const name = String(createDialog.value || '').trim();
    if (!name) return;

    setIsCreating(true);
    try {
      const ok = await performCreate(createDialog.type, name, createDialog.parentPath);
      if (ok) setCreateDialog(null);
    } finally {
      setIsCreating(false);
    }
  }, [createDialog, isCreating, performCreate]);

  const beginRename = useCallback((item) => {
    const itemPath = item?.path || item?.name || '';
    setRenameState({
      path: itemPath,
      value: item?.name || getNavigatorBaseName(itemPath),
      type: item?.type || 'file',
    });
    setContextMenu(null);
  }, []);

  const commitRename = useCallback(async () => {
    if (!renameState.path || !onRenameItem) return;
    const nextName = String(renameState.value || '').trim();
    if (!nextName) {
      setRenameState({ path: '', value: '', type: '' });
      return;
    }

    const currentName = getNavigatorBaseName(renameState.path);
    if (nextName === currentName) {
      setRenameState({ path: '', value: '', type: '' });
      return;
    }

    const parentDir = getNavigatorDirName(renameState.path);
    const nextPath = parentDir
      ? joinNavigatorPath(parentDir, nextName, renameState.path)
      : nextName;
    const result = await onRenameItem(renameState.path, nextPath, renameState.type || 'file');
    if (result?.success) {
      setRenameState({ path: '', value: '', type: '' });
    }
  }, [onRenameItem, renameState]);

  const cancelRename = useCallback(() => {
    setRenameState({ path: '', value: '', type: '' });
  }, []);

  const requestDelete = useCallback((itemPath, itemType) => {
    if (allowDangerousActions) {
      onDeleteItem(itemPath, itemType);
      return;
    }
    setDeleteDialog({ path: itemPath, type: itemType });
    setContextMenu(null);
  }, [allowDangerousActions, onDeleteItem]);

  const confirmDelete = useCallback(async () => {
    if (!deleteDialog || isDeleting || !onDeleteItem) return;
    setIsDeleting(true);
    try {
      await onDeleteItem(deleteDialog.path, deleteDialog.type);
      setDeleteDialog(null);
    } finally {
      setIsDeleting(false);
    }
  }, [deleteDialog, isDeleting, onDeleteItem]);

  const canDropIntoDirectory = useCallback((draggedPath, targetPath) => {
    if (!draggedPath || !targetPath) return false;
    if (isSameNavigatorPath(draggedPath, targetPath)) return false;
    if (isNavigatorDescendant(targetPath, draggedPath)) return false;
    const destinationPath = joinNavigatorPath(
      targetPath,
      getNavigatorBaseName(draggedPath),
      targetPath
    );
    return !isSameNavigatorPath(destinationPath, draggedPath);
  }, []);

  const handleDragStart = useCallback(
    (event, item) => {
      if (isReadOnly) {
        event.preventDefault();
        return;
      }
      const itemPath = item?.path || item?.name;
      if (!itemPath) {
        event.preventDefault();
        return;
      }
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', itemPath);
      setDragState({
        draggedPath: itemPath,
        draggedType: item?.type || 'file',
        overPath: '',
        overRoot: false,
      });
    },
    [isReadOnly]
  );

  const resetDragState = useCallback(() => {
    setDragState({ draggedPath: '', draggedType: '', overPath: '', overRoot: false });
  }, []);

  const handleDragEnterDirectory = useCallback(
    (event, item) => {
      if (!dragState.draggedPath || item?.type !== 'directory') return;
      if (!canDropIntoDirectory(dragState.draggedPath, item.path)) return;
      event.preventDefault();
      setDragState((prev) => ({ ...prev, overPath: item.path || '', overRoot: false }));
    },
    [canDropIntoDirectory, dragState.draggedPath]
  );

  const handleDropIntoDirectory = useCallback(
    async (event, item) => {
      event.preventDefault();
      // Drop de fichiers venant de l'OS (pas de dragState interne) -> import dans ce dossier
      const osFiles = event.dataTransfer?.files;
      if (!dragState.draggedPath && osFiles && osFiles.length > 0) {
        resetDragState();
        if (onImportOsFiles) await onImportOsFiles(Array.from(osFiles), item?.path || '');
        return;
      }
      if (!dragState.draggedPath || item?.type !== 'directory' || !onMoveItem) {
        resetDragState();
        return;
      }
      if (!canDropIntoDirectory(dragState.draggedPath, item.path)) {
        resetDragState();
        return;
      }

      const destinationPath = joinNavigatorPath(
        item.path,
        getNavigatorBaseName(dragState.draggedPath),
        item.path
      );
      await onMoveItem(dragState.draggedPath, destinationPath, dragState.draggedType);
      resetDragState();
    },
    [
      canDropIntoDirectory,
      dragState.draggedPath,
      dragState.draggedType,
      onImportOsFiles,
      onMoveItem,
      resetDragState,
    ]
  );

  const handleRootDrop = useCallback(
    async (event) => {
      event.preventDefault();
      // Drop de fichiers venant de l'OS (pas de dragState interne) -> import a la racine du projet
      const osFiles = event.dataTransfer?.files;
      if (!dragState.draggedPath && osFiles && osFiles.length > 0) {
        resetDragState();
        if (onImportOsFiles) await onImportOsFiles(Array.from(osFiles), '');
        return;
      }
      if (!dragState.draggedPath || !onMoveItem) {
        resetDragState();
        return;
      }
      const destinationPath = getNavigatorBaseName(dragState.draggedPath);
      if (isSameNavigatorPath(destinationPath, dragState.draggedPath)) {
        resetDragState();
        return;
      }
      await onMoveItem(dragState.draggedPath, destinationPath, dragState.draggedType);
      resetDragState();
    },
    [dragState.draggedPath, dragState.draggedType, onImportOsFiles, onMoveItem, resetDragState]
  );

  const handleOpenContextMenu = useCallback((event, item) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      item: item || null,
    });
  }, []);

  const contextActions = useMemo(() => {
    const item = contextMenu?.item || null;
    const itemPath = item?.path || item?.name || '';
    const actions = [];

    if (item?.type === 'file') {
      actions.push(
        createContextAction('open', 'Ouvrir', () => {
          onFileClick(itemPath);
          closeContextMenu();
        })
      );
    }

    if (item?.type === 'directory') {
      actions.push(
        createContextAction(
          'toggle',
          expandedFolders.has(item.path) ? 'Replier' : 'Deplier',
          () => {
            onToggleFolder(item);
            closeContextMenu();
          }
        )
      );
      if (!isReadOnly) {
        actions.push(
          createContextAction('new-file', 'Nouveau fichier', () => handleCreate('file', itemPath))
        );
        actions.push(
          createContextAction('new-folder', 'Nouveau dossier', () =>
            handleCreate('directory', itemPath)
          )
        );
      }
    }

    if (!item && !isReadOnly) {
      actions.push(
        createContextAction('new-root-file', 'Nouveau fichier', () => handleCreate('file'))
      );
      actions.push(
        createContextAction('new-root-folder', 'Nouveau dossier', () => handleCreate('directory'))
      );
    }

    if (item && !isReadOnly) {
      actions.push(createContextAction('rename', 'Renommer', () => beginRename(item)));
      actions.push(
        createContextAction(
          'delete',
          'Supprimer',
          () => {
            requestDelete(itemPath, item.type);
          },
          true
        )
      );
    }

    return actions;
  }, [
    beginRename,
    closeContextMenu,
    contextMenu,
    expandedFolders,
    handleCreate,
    isReadOnly,
    onFileClick,
    onToggleFolder,
    requestDelete,
  ]);

  return (
    <div className="nav-root">
      {deleteDialog && (
        <Dialog
          ariaLabel={`Supprimer ${deleteDialog.type === 'file' ? 'le fichier' : 'le dossier'}`}
          onClose={() => !isDeleting && setDeleteDialog(null)}
          closeOnBackdrop={!isDeleting}
          overlayClassName="modal-overlay"
          className="session-dialog"
        >
          <div className="modal-header">
            <h2 className="modal-title">Confirmer la suppression</h2>
          </div>
          <div className="session-dialog__body">
            <p>
              Supprimer définitivement « {deleteDialog.path} » ? Cette action est irréversible.
            </p>
          </div>
          <div className="session-dialog__actions">
            <Button
              type="button"
              className="btn btn-ghost"
              onClick={() => setDeleteDialog(null)}
              disabled={isDeleting}
            >
              Annuler
            </Button>
            <Button
              type="button"
              className="btn btn-danger"
              onClick={confirmDelete}
              disabled={isDeleting}
            >
              {isDeleting ? 'Suppression…' : 'Supprimer'}
            </Button>
          </div>
        </Dialog>
      )}
      {createDialog && (
        <Dialog
          ariaLabel={`Créer un ${createDialog.type === 'file' ? 'fichier' : 'dossier'}`}
          onClose={() => !isCreating && setCreateDialog(null)}
          closeOnBackdrop={false}
          overlayClassName="nav-dialog-overlay"
          className="nav-dialog"
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submitCreate();
            }}
          >
            <h2 className="nav-dialog-title">
              Nouveau {createDialog.type === 'file' ? 'fichier' : 'dossier'}
            </h2>
            <label className="nav-dialog-label" htmlFor="file-explorer-create-name">
              Nom
            </label>
            <input
              id="file-explorer-create-name"
              className="nav-dialog-input"
              value={createDialog.value}
              onChange={(event) =>
                setCreateDialog((prev) => ({ ...prev, value: event.target.value }))
              }
              autoFocus
              autoComplete="off"
              disabled={isCreating}
            />
            <div className="nav-dialog-actions">
              <Button
                type="button"
                className="nav-dialog-button is-secondary"
                onClick={() => setCreateDialog(null)}
                disabled={isCreating}
              >
                Annuler
              </Button>
              <Button
                type="submit"
                className="nav-dialog-button is-primary"
                disabled={isCreating || !createDialog.value.trim()}
              >
                {isCreating ? 'Création…' : 'Créer'}
              </Button>
            </div>
          </form>
        </Dialog>
      )}
      {/* Header compact EXPLORER */}
      <div className="nav-header">
        <span className="nav-header-title">Explorateur</span>
        <div className="nav-header-actions">
          {!isReadOnly && (
            <>
              <Button
                type="button"
                onClick={() => handleCreate('file')}
                className="nav-header-btn"
                title="Nouveau fichier"
                disabled={!isElectronApiAvailable}
              >
                +
              </Button>
              <Button
                type="button"
                onClick={() => handleCreate('directory')}
                className="nav-header-btn"
                title="Nouveau dossier"
                disabled={!isElectronApiAvailable}
              >
                ⊕
              </Button>
            </>
          )}
          {isReadOnly && (
            <span className="nav-meta-chip is-warning" style={{ fontSize: 9 }}>
              Lecture seule
            </span>
          )}
        </div>
      </div>

      {/* Filtre rapide */}
      <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <input
          type="text"
          className="input-surface"
          placeholder="Filtrer les fichiers..."
          value={filterQuery}
          onChange={(e) => setFilterQuery(e.target.value)}
          style={{ fontSize: 11, padding: '4px 8px' }}
        />
        {filterQuery && (
          <div className="nav-hint" style={{ marginTop: 3 }}>
            {filteredFiles.length} résultat(s)
          </div>
        )}
      </div>

      {/* Infos discrètes */}
      {currentProjectPath && !filterQuery && (
        <div className="nav-subline">
          <span className="nav-meta-chip">{treeStats.files} fichiers</span>
          <span className="nav-meta-chip">{treeStats.directories} dossiers</span>
        </div>
      )}

      {/* Champ création rapide (si nom saisi en dehors) — conservé pour compat */}
      {newItemName !== undefined && newItemName !== null && (
        <div style={{ display: 'none' }}>
          <input
            value={newItemName}
            onChange={(e) => onNewItemNameChange && onNewItemNameChange(e.target.value)}
          />
        </div>
      )}

      <div
        className={`nav-tree custom-scrollbar ${dragState.overRoot ? 'is-root-drop-target' : ''}`}
        onContextMenu={(event) => {
          if (event.target !== event.currentTarget) return;
          handleOpenContextMenu(event, null);
        }}
        onDragOver={(event) => {
          if (filterQuery) return;
          const isOsFileDrag =
            !dragState.draggedPath && event.dataTransfer?.types?.includes('Files');
          if (!dragState.draggedPath && !isOsFileDrag) return;
          event.preventDefault();
          setDragState((prev) => ({ ...prev, overPath: '', overRoot: true }));
        }}
        onDrop={handleRootDrop}
        onDragEnd={resetDragState}
      >
        {!currentProjectPath ? (
          <div className="nav-empty">Ouvrez un dossier pour commencer.</div>
        ) : filterQuery ? (
          filteredFiles.length === 0 ? (
            <div className="nav-empty">Aucun fichier trouve.</div>
          ) : (
            <div className="nav-results">
              {filteredFiles.map((file) => (
                <Button
                  key={file.path || file.name}
                  type="button"
                  className="nav-result"
                  onClick={() => onFileClick(file.path || file.name)}
                  onContextMenu={(event) => handleOpenContextMenu(event, file)}
                >
                  <FileIcon />
                  <span className="nav-result-label">{file.path || file.name}</span>
                </Button>
              ))}
            </div>
          )
        ) : projectItems.length === 0 ? (
          <div className="nav-empty">Dossier vide.</div>
        ) : (
          <div className="tree-view">
            {projectItems.map((item) => (
              <FileItem
                key={item.path || item.name}
                item={item}
                activeFile={activeFile}
                expandedFolders={expandedFolders}
                renameState={renameState}
                dragState={dragState}
                onToggleFolder={onToggleFolder}
                onFileClick={onFileClick}
                onDelete={requestDelete}
                onBeginRename={beginRename}
                onRenameChange={(value) => setRenameState((prev) => ({ ...prev, value }))}
                onRenameCommit={commitRename}
                onRenameCancel={cancelRename}
                onOpenContextMenu={handleOpenContextMenu}
                onCreateInside={(type, folderItem) =>
                  handleCreate(type, folderItem.path || folderItem.name || '')
                }
                onDragStart={handleDragStart}
                onDragEnterDirectory={handleDragEnterDirectory}
                onDropIntoDirectory={handleDropIntoDirectory}
                isReadOnly={isReadOnly}
              />
            ))}
          </div>
        )}
      </div>

      {/* Bouton Ouvrir dossier en bas */}
      <Button
        type="button"
        onClick={onOpenFolder}
        className="nav-open-folder-btn"
        disabled={!isElectronApiAvailable}
        title="Ouvrir un dossier de projet"
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
        Ouvrir dossier
      </Button>

      {contextMenu && contextActions.length > 0 && (
        <div
          className="nav-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          {contextActions.map((action) => (
            <Button
              key={action.id}
              type="button"
              className={`nav-context-item ${action.danger ? 'is-danger' : ''}`}
              onClick={action.onClick}
            >
              {action.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
};

export default FileExplorer;
