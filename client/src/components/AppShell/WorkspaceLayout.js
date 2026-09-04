import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import WorkspaceSidebar from './WorkspaceSidebar';
import CodeEditor from '../CodeEditor';
import LivePreview from '../LivePreview';
import TerminalPanel from '../TerminalPanel';
import VisualWorkflowEditor from '../VisualWorkflowEditor';
import AIChat from '../AIChat';
import BrainGraphPanel from '../BrainGraphPanel';
import Settings from '../Settings';
import ChatSessionPane from './ChatSessionPane';
import { IconEye, IconSettings, IconBrain, IconTerminal, IconMaximize, IconX, IconMaximize2, IconMinimize2, IconChat } from '../ComponentLibrary/icons';
import { IconButton } from '../ComponentLibrary/Toolbar';
import { getLanguageForFile } from '../../utils/editorLanguage';

const DEFAULT_TERMINAL_HEIGHT = 250;
const MIN_TERMINAL_HEIGHT = 100;
const MAX_TERMINAL_HEIGHT_RATIO = 0.7;

const FALLBACK_FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button',
  'input',
  'select',
  'textarea',
  'iframe',
  'object',
  'embed',
  '[contenteditable]',
  '[tabindex]'
].join(',');

// Current Electron builds support `inert`. This fallback keeps the same
// keyboard contract in older browsers and in DOM-based tests.
const useInertFallback = (containerRef, inactive) => {
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !inactive || (typeof HTMLElement !== 'undefined' && 'inert' in HTMLElement.prototype)) {
      return undefined;
    }

    const disableElement = (element) => {
      if (!(element instanceof HTMLElement) || element.dataset.workbenchPreviousTabindex !== undefined) return;
      element.dataset.workbenchPreviousTabindex = element.hasAttribute('tabindex')
        ? element.getAttribute('tabindex')
        : '';
      element.setAttribute('tabindex', '-1');
    };
    const disableTree = (root) => {
      if (root.matches?.(FALLBACK_FOCUSABLE_SELECTOR)) disableElement(root);
      root.querySelectorAll?.(FALLBACK_FOCUSABLE_SELECTOR).forEach(disableElement);
    };
    const restore = () => {
      container.querySelectorAll('[data-workbench-previous-tabindex]').forEach((element) => {
        const previous = element.dataset.workbenchPreviousTabindex;
        if (previous === '') element.removeAttribute('tabindex');
        else element.setAttribute('tabindex', previous);
        delete element.dataset.workbenchPreviousTabindex;
      });
    };

    disableTree(container);
    const observer = new MutationObserver((records) => {
      records.forEach((record) => record.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) disableTree(node);
      }));
    });
    observer.observe(container, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      restore();
    };
  }, [containerRef, inactive]);
};

const PersistentPane = ({ id, active, children }) => {
  const paneRef = useRef(null);
  useInertFallback(paneRef, !active);

  return (
    <div
      ref={paneRef}
      id={`workspace-pane-${id}`}
      className={`center-view-pane ${active ? 'is-active' : ''}`}
      role="tabpanel"
      aria-labelledby={`workspace-tab-${id}`}
      aria-hidden={!active}
      inert={active ? undefined : ''}
      tabIndex={active ? 0 : -1}
    >
      {children}
    </div>
  );
};

const WorkspaceLayout = ({
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
  dragging,
  resizeHandleProps,
  onDragStart,
  onResizeStep,
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
  allowDangerousActions,
  centerView,
  onCenterViewChange,
  isFocusMode,
  isChatMaximized,
  onToggleFocusMode,
  editorProps,
  previewProps,
  terminalProps,
  gitPanelProps,
  aiChangesPanelProps,
  extensionsPanelProps,
  brainGraphProps,
  workflowProps,
  aiChatProps,
  chatTabsProps,
  workspacePanelProps,
  isTerminalOpen,
  onToggleTerminal,
  bottomPanelTab = 'terminal',
  onBottomPanelTabChange,
  activeSidebarSection = 'explorer',
  settingsProps,
  isSettingsOpen,
  onCloseSettings,
}) => {
  const [terminalHeight, setTerminalHeight] = useState(() => {
    try {
      const saved = localStorage.getItem('code_companion_terminalHeight');
      return saved ? Math.max(MIN_TERMINAL_HEIGHT, Number(saved)) : DEFAULT_TERMINAL_HEIGHT;
    } catch { return DEFAULT_TERMINAL_HEIGHT; }
  });
  const [isTerminalMaximized, setIsTerminalMaximized] = useState(false);
  const termDragRef = useRef(null);
  const centerRef = useRef(null);
  const editorTabRefs = useRef([]);

  // Tab[] (plan-ia-onglets.md §2/§③/§⑤): { type: 'file', path } |
  // { type: 'preview' } | { type: 'settings' } | { type: 'chat', sessionId }.
  const openTabs = useMemo(() => editorProps?.openTabs || [], [editorProps?.openTabs]);
  const openFileTabs = useMemo(() => openTabs.filter((tab) => tab.type === 'file'), [openTabs]);
  const openChatTabs = useMemo(() => openTabs.filter((tab) => tab.type === 'chat'), [openTabs]);
  const dirtyFiles = editorProps?.dirtyFiles;
  const activeEditorFile = editorProps?.activeFile;
  const sessionsById = useMemo(() => {
    const map = new Map();
    (chatTabsProps?.sessions || []).forEach((session) => map.set(session.id, session));
    return map;
  }, [chatTabsProps?.sessions]);
  const activeChatSessionId = chatTabsProps?.activeChatSessionId ?? null;

  // Un seul bandeau d'onglets pour tout le document actif : les fichiers
  // ouverts + Aperçu (singleton, toujours présent) + les onglets de chat
  // (n exemplaires, un par session ouverte — plan-ia-onglets.md §⑤ 5.5.1).
  // Git/AI Changes/Flux ont quitté ce bandeau pour l'Activity Bar/Panel (§④).
  const editorTabItems = useMemo(() => ([
    ...openFileTabs.map((tab) => ({
      type: 'file',
      filePath: tab.path,
      label: String(tab.path).split(/[\\/]/).pop() || String(tab.path),
      isActive: centerView === 'code' && String(tab.path) === String(activeEditorFile),
    })),
    {
      type: 'preview',
      label: 'Aperçu',
      isActive: centerView === 'preview',
    },
    // Paramètres : singleton, n'apparaît dans le bandeau que quand il est
    // ouvert (plan-ia-onglets.md §④) — contrairement à Aperçu, toujours présent.
    ...(isSettingsOpen ? [{
      type: 'settings',
      label: 'Paramètres',
      isActive: centerView === 'settings',
    }] : []),
    ...openChatTabs.map((tab) => ({
      type: 'chat',
      sessionId: tab.sessionId,
      // Une session supprimée reste affichable/fermable dans son onglet
      // (fermer ≠ perdre l'onglet avant que l'utilisateur agisse) : le
      // libellé retombe sur un texte neutre plutôt que de disparaître.
      label: sessionsById.get(tab.sessionId)?.title || 'Session supprimée',
      isActive: centerView === 'chat' && tab.sessionId === activeChatSessionId,
    }))
  ]), [openFileTabs, activeEditorFile, centerView, isSettingsOpen, openChatTabs, sessionsById, activeChatSessionId]);

  const activateEditorTab = useCallback((tab) => {
    if (tab.type === 'file') {
      editorProps?.onSelectFile && editorProps.onSelectFile(tab.filePath);
      onCenterViewChange('code');
    } else if (tab.type === 'settings') {
      onCenterViewChange('settings');
    } else if (tab.type === 'chat') {
      chatTabsProps?.onActivateChatTab && chatTabsProps.onActivateChatTab(tab.sessionId);
    } else {
      onCenterViewChange('preview');
    }
  }, [editorProps, onCenterViewChange, chatTabsProps]);

  const breadcrumbLanguage = useMemo(() => getLanguageForFile(activeEditorFile), [activeEditorFile]);
  const breadcrumbLineCount = useMemo(() => String(editorProps?.code || '').split('\n').length, [editorProps]);
  const breadcrumbDiffLabel = useMemo(() => {
    if (!editorProps?.isDiffMode) return '';
    if (editorProps?.diffSource === 'git') {
      const base = String(editorProps?.diffOriginalLabel || 'before').trim();
      const target = String(editorProps?.diffModifiedLabel || 'after').trim();
      return `${base} -> ${target}`;
    }
    return 'Diff IA';
  }, [editorProps]);

  useEffect(() => {
    try {
      localStorage.setItem('code_companion_terminalHeight', String(terminalHeight));
    } catch (e) {
      // Ignore localStorage errors
    }
  }, [terminalHeight]);

  // Vertical resizer for bottom terminal
  const handleTermDragStart = useCallback((e) => {
    e.preventDefault();
    termDragRef.current = {
      startY: e.clientY,
      startHeight: terminalHeight,
    };

    const onMouseMove = (ev) => {
      if (ev.buttons === 0) { onMouseUp(); return; } // filet: bouton relâché hors document
      if (!termDragRef.current) return;
      const delta = termDragRef.current.startY - ev.clientY;
      const maxH = centerRef.current
        ? centerRef.current.clientHeight * MAX_TERMINAL_HEIGHT_RATIO
        : 600;
      const newH = Math.min(maxH, Math.max(MIN_TERMINAL_HEIGHT, termDragRef.current.startHeight + delta));
      setTerminalHeight(newH);
    };
    const onMouseUp = () => {
      termDragRef.current = null;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'row-resize';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [terminalHeight]);

  const toggleMaximize = useCallback(() => {
    setIsTerminalMaximized(prev => !prev);
  }, []);

  const effectiveTerminalHeight = isTerminalMaximized
    ? (centerRef.current ? centerRef.current.clientHeight - 36 : 600)
    : terminalHeight;

  const handleEditorTabKeyDown = (event, index) => {
    const count = editorTabItems.length;
    let nextIndex;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % count;
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + count) % count;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = count - 1;
    else return;

    event.preventDefault();
    const nextTab = editorTabItems[nextIndex];
    activateEditorTab(nextTab);
    editorTabRefs.current[nextIndex]?.focus();
  };

  return (
    <div ref={layoutRef} className="workspace">
      {/* Sidebar gauche — Explorateur */}
      {!isLeftCollapsed && !isChatMaximized && (
        <WorkspaceSidebar
          sidebarVisibility="full"
          style={{ width: `${leftWidth}px`, minWidth: `${leftMinWidth}px` }}
          activeSection={activeSidebarSection}
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
          isReadOnlyMode={isReadOnlyMode}
          allowDangerousActions={allowDangerousActions}
          workspacePanelProps={workspacePanelProps}
          gitPanelProps={gitPanelProps}
          aiChangesPanelProps={aiChangesPanelProps}
          extensionsPanelProps={extensionsPanelProps}
        />
      )}

      {/* Resizer gauche */}
      {!isLeftCollapsed && !isChatMaximized && (
        <div
          className={`panel-resizer ${dragging === 'left' ? 'panel-resizer-active' : ''}`}
          onPointerDown={(e) => onDragStart(e, 'left')}
          {...resizeHandleProps}
          role="separator"
          aria-orientation="vertical"
          aria-label="Redimensionner le panneau de gauche"
          aria-valuemin={leftMinWidth}
          aria-valuemax={Math.max(leftWidth, leftMaxWidth)}
          aria-valuenow={Math.round(leftWidth)}
          tabIndex={0}
          onKeyDown={(e) => {
            if (!onResizeStep) return;
            if (e.key === 'ArrowLeft') { e.preventDefault(); onResizeStep('left', -20); }
            else if (e.key === 'ArrowRight') { e.preventDefault(); onResizeStep('left', 20); }
          }}
        />
      )}

      {/* Panneau central */}
      {!isChatMaximized && <main
        ref={centerRef}
        className="ide-center"
        style={{ width: `${middleWidth}px`, minWidth: `${editorMinWidth}px` }}
        tabIndex={-1}
      >
        {/* Onglets du document actif : fichiers ouverts + Aperçu (singleton).
            Remonté de CodeEditor — un seul bandeau pour toute l'IDE. */}
        <div className="editor-tabs custom-scrollbar" role="tablist" aria-label="Onglets du document">
          {openFileTabs.length === 0 && (
            <div className="editor-tabs-empty">Ouvrez un fichier (Ctrl+P)</div>
          )}
          {editorTabItems.map((tab, index) => {
            if (tab.type === 'file') {
              const isDirty = Boolean(dirtyFiles && typeof dirtyFiles.has === 'function' && dirtyFiles.has(tab.filePath));
              return (
                <button
                  key={tab.filePath}
                  ref={(element) => { editorTabRefs.current[index] = element; }}
                  id={tab.isActive ? 'workspace-tab-code' : undefined}
                  type="button"
                  role="tab"
                  aria-selected={tab.isActive}
                  aria-controls="workspace-pane-code"
                  tabIndex={tab.isActive ? 0 : -1}
                  className={`editor-tab ${tab.isActive ? 'is-active' : ''}`}
                  onClick={() => activateEditorTab(tab)}
                  onKeyDown={(event) => handleEditorTabKeyDown(event, index)}
                  title={String(tab.filePath)}
                >
                  <span className="editor-tab-name">{tab.label}</span>
                  {isDirty && (
                    <span className="editor-tab-dot" aria-label="Modifications non enregistrees" title="Modifications non enregistrees" />
                  )}
                  <span
                    className="editor-tab-close"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      editorProps?.onCloseFile && editorProps.onCloseFile(tab.filePath);
                    }}
                    role="button"
                    aria-label={`Fermer ${tab.label}`}
                  >
                    ×
                  </span>
                </button>
              );
            }
            if (tab.type === 'settings') {
              return (
                <button
                  key="settings"
                  ref={(element) => { editorTabRefs.current[index] = element; }}
                  id={tab.isActive ? 'workspace-tab-settings' : undefined}
                  type="button"
                  role="tab"
                  aria-selected={tab.isActive}
                  aria-controls="workspace-pane-settings"
                  tabIndex={tab.isActive ? 0 : -1}
                  className={`editor-tab ${tab.isActive ? 'is-active' : ''}`}
                  onClick={() => activateEditorTab(tab)}
                  onKeyDown={(event) => handleEditorTabKeyDown(event, index)}
                >
                  <IconSettings />
                  <span className="editor-tab-name">{tab.label}</span>
                  <span
                    className="editor-tab-close"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onCloseSettings && onCloseSettings();
                    }}
                    role="button"
                    aria-label={`Fermer ${tab.label}`}
                  >
                    ×
                  </span>
                </button>
              );
            }
            if (tab.type === 'chat') {
              return (
                <button
                  key={`chat:${tab.sessionId}`}
                  ref={(element) => { editorTabRefs.current[index] = element; }}
                  id={tab.isActive ? `workspace-tab-chat-${tab.sessionId}` : undefined}
                  type="button"
                  role="tab"
                  aria-selected={tab.isActive}
                  aria-controls="workspace-pane-chat"
                  tabIndex={tab.isActive ? 0 : -1}
                  className={`editor-tab ${tab.isActive ? 'is-active' : ''}`}
                  onClick={() => activateEditorTab(tab)}
                  onKeyDown={(event) => handleEditorTabKeyDown(event, index)}
                  title={tab.label}
                >
                  <IconChat />
                  <span className="editor-tab-name">{tab.label}</span>
                  <span
                    className="editor-tab-close"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      // Fermer l'onglet NE supprime JAMAIS la session
                      // (plan-ia-onglets.md §⑤ 5.5.3) : elle reste dans
                      // l'historique du panneau, rouvrable via ⛶.
                      chatTabsProps?.onCloseChatTab && chatTabsProps.onCloseChatTab(tab.sessionId);
                    }}
                    role="button"
                    aria-label={`Fermer ${tab.label}`}
                  >
                    ×
                  </span>
                </button>
              );
            }
            return (
              <button
                key="preview"
                ref={(element) => { editorTabRefs.current[index] = element; }}
                id="workspace-tab-preview"
                type="button"
                role="tab"
                aria-selected={tab.isActive}
                aria-controls="workspace-pane-preview"
                tabIndex={tab.isActive ? 0 : -1}
                className={`editor-tab ${tab.isActive ? 'is-active' : ''}`}
                onClick={() => activateEditorTab(tab)}
                onKeyDown={(event) => handleEditorTabKeyDown(event, index)}
              >
                <IconEye />
                <span className="editor-tab-name">{tab.label}</span>
              </button>
            );
          })}

          <div className="editor-tabs-spacer" />

          <button
            type="button"
            onClick={onToggleFocusMode}
            className={`editor-tabs-action ${isFocusMode ? 'is-active' : ''}`}
            title={isFocusMode ? 'Quitter le mode focus' : 'Mode focus'}
          >
            <IconMaximize />
            Focus
          </button>
        </div>

        {/* Fil d'Ariane : décrit le document actif (fichier), donc n'a de sens
            que pour un onglet de code. Remonté de CodeEditor/index.js. */}
        {centerView === 'code' && (
          <div className="editor-breadcrumb">
            <span className="editor-breadcrumb-seg">Éditeur</span>
            <span className="editor-breadcrumb-sep">›</span>
            <span className="editor-breadcrumb-seg is-active">
              {activeEditorFile ? String(activeEditorFile) : 'Aucun fichier ouvert'}
            </span>
            <div className="editor-breadcrumb-right">
              <span>{breadcrumbLanguage}</span>
              <span>{breadcrumbLineCount} lignes</span>
              {breadcrumbDiffLabel && <span className="editor-breadcrumb-diff">{breadcrumbDiffLabel}</span>}
            </div>
          </div>
        )}

        {/* Corps principal */}
        <div className="center-body" style={isTerminalOpen && isTerminalMaximized ? { flex: '0 0 0', overflow: 'hidden' } : undefined}>
          {/* Always-mounted panes for views with costly init or precious ephemeral
              state (Monaco, iframe preview, React Flow viewport) — cross-faded
              via CSS instead of remounted on every switch. See D3. */}
          <div
            className={`center-view-stack ${['code', 'preview', 'workflows', 'settings', 'chat'].includes(centerView) ? 'is-visible' : ''}`}
            aria-hidden={!['code', 'preview', 'workflows', 'settings', 'chat'].includes(centerView)}
          >
            <PersistentPane id="code" active={centerView === 'code'}>
              <CodeEditor {...editorProps} />
            </PersistentPane>
            <PersistentPane id="preview" active={centerView === 'preview'}>
              <LivePreview {...previewProps} />
            </PersistentPane>
            <PersistentPane id="workflows" active={centerView === 'workflows'}>
              <VisualWorkflowEditor {...workflowProps} />
            </PersistentPane>
            {/* Paramètres : monté seulement une fois ouvert (évite de charger
                Settings au démarrage), puis conservé comme les autres panes
                persistantes pour ne pas perdre l'état du formulaire en
                changeant d'onglet (plan-ia-onglets.md §④). */}
            {isSettingsOpen && (
              <PersistentPane id="settings" active={centerView === 'settings'}>
                <Settings {...settingsProps} isOpen onClose={onCloseSettings} />
              </PersistentPane>
            )}
            {/* Onglet de chat actif : contenu de lecture d'une session
                (plan-ia-onglets.md §⑤ 5.5.3). Monté seulement quand au moins
                un onglet de chat est ouvert ; un seul pane, son contenu suit
                activeChatSessionId (comme CodeEditor suit activeFile pour les
                fichiers) plutôt qu'un pane par onglet — le transcript est une
                simple relecture de données déjà en mémoire, pas de coût
                d'init à préserver comme Monaco/l'iframe de preview. */}
            {openChatTabs.length > 0 && (
              <PersistentPane id="chat" active={centerView === 'chat'}>
                <ChatSessionPane
                  session={sessionsById.get(activeChatSessionId) || null}
                  isActiveInPanel={activeChatSessionId === chatTabsProps?.activePanelSessionId}
                  onSwitchPanelToSession={chatTabsProps?.onSwitchPanelToSession}
                />
              </PersistentPane>
            )}
          </div>
        </div>

        {/* Panel du bas : Terminal + Brain, avec un vrai bandeau (ni l'un ni
            l'autre n'est un onglet de document — ce sont des outils). Brain
            réutilise PersistentPane pour ne pas perdre son layout de graphe
            en basculant vers Terminal, comme Monaco/l'iframe au-dessus. */}
        {isTerminalOpen && (
          <div
            className="bottom-terminal-wrapper"
            style={{ height: effectiveTerminalHeight }}
          >
            {/* Resize handle */}
            {!isTerminalMaximized && (
              <div
                className={`bottom-terminal-resizer ${termDragRef.current ? 'is-dragging' : ''}`}
                onMouseDown={handleTermDragStart}
                role="separator"
                aria-orientation="horizontal"
                aria-label="Redimensionner le terminal"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setTerminalHeight((h) => Math.min(
                      centerRef.current ? centerRef.current.clientHeight * MAX_TERMINAL_HEIGHT_RATIO : 600,
                      h + 20,
                    ));
                  } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setTerminalHeight((h) => Math.max(MIN_TERMINAL_HEIGHT, h - 20));
                  }
                }}
              />
            )}

            <div className="bottom-terminal-header">
              <div className="bottom-terminal-header-left">
                <button
                  id="workspace-tab-terminal"
                  type="button"
                  className={`bottom-terminal-title-btn ${bottomPanelTab === 'terminal' ? 'is-active' : ''}`}
                  onClick={() => onBottomPanelTabChange && onBottomPanelTabChange('terminal')}
                >
                  <IconTerminal />
                  Terminal
                </button>
                <button
                  id="workspace-tab-brain"
                  type="button"
                  className={`bottom-terminal-title-btn ${bottomPanelTab === 'brain' ? 'is-active' : ''}`}
                  onClick={() => onBottomPanelTabChange && onBottomPanelTabChange('brain')}
                >
                  <IconBrain />
                  Brain
                </button>
              </div>
              <div className="bottom-terminal-header-right">
                <IconButton
                  icon={isTerminalMaximized ? <IconMinimize2 size={12} /> : <IconMaximize2 size={12} />}
                  onClick={toggleMaximize}
                  title={isTerminalMaximized ? 'Restaurer' : 'Maximiser'}
                  size="sm"
                />
                <IconButton
                  icon={<IconX size={12} />}
                  onClick={onToggleTerminal}
                  title="Fermer le panel"
                  size="sm"
                />
              </div>
            </div>

            <div className="bottom-terminal-content">
              <PersistentPane id="terminal" active={bottomPanelTab === 'terminal'}>
                <TerminalPanel {...terminalProps} />
              </PersistentPane>
              <PersistentPane id="brain" active={bottomPanelTab === 'brain'}>
                <BrainGraphPanel {...brainGraphProps} />
              </PersistentPane>
            </div>
          </div>
        )}
      </main>}

      {/* Resizer droit */}
      {!isRightCollapsed && !isChatMaximized && (
        <div
          className={`panel-resizer ${dragging === 'right' ? 'panel-resizer-active' : ''}`}
          onPointerDown={(e) => onDragStart(e, 'right')}
          {...resizeHandleProps}
          role="separator"
          aria-orientation="vertical"
          aria-label="Redimensionner le panneau de droite"
          aria-valuemin={rightMinWidth}
          aria-valuemax={Math.max(rightWidth, rightMaxWidth)}
          aria-valuenow={Math.round(rightWidth)}
          tabIndex={0}
          onKeyDown={(e) => {
            if (!onResizeStep) return;
            if (e.key === 'ArrowLeft') { e.preventDefault(); onResizeStep('right', 20); }
            else if (e.key === 'ArrowRight') { e.preventDefault(); onResizeStep('right', -20); }
          }}
        />
      )}

      {/* Sidebar droite — AI Chat */}
      {!isRightCollapsed && (
        <aside
          className={`ide-sidebar-right${isChatMaximized ? ' is-maximized' : ''}`}
          style={isChatMaximized
            ? { width: '100%', minWidth: `${rightMinWidth}px` }
            : { width: `${rightWidth}px`, minWidth: `${rightMinWidth}px` }}
        >
          <AIChat {...aiChatProps} />
        </aside>
      )}
    </div>
  );
};

export default WorkspaceLayout;
