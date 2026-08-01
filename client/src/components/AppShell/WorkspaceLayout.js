import React, { useState, useCallback, useRef, useEffect } from 'react';
import WorkspaceSidebar from './WorkspaceSidebar';
import CodeEditor from '../CodeEditor';
import LivePreview from '../LivePreview';
import TerminalPanel from '../TerminalPanel';
import GitPanel from '../GitPanel';
import VisualWorkflowEditor from '../VisualWorkflowEditor';
import AIChat from '../AIChat';
import AIChangesPanel from '../AIChangesPanel';
import BrainGraphPanel from '../BrainGraphPanel';
import { IconCode, IconEye, IconGit, IconAudit, IconFlow, IconBrain, IconMaximize, IconX, IconMaximize2, IconMinimize2 } from '../ComponentLibrary/icons';
import { IconButton } from '../ComponentLibrary/Toolbar';

const DEFAULT_TERMINAL_HEIGHT = 250;
const MIN_TERMINAL_HEIGHT = 100;
const MAX_TERMINAL_HEIGHT_RATIO = 0.7;

const CENTER_TABS = [
  { id: 'code', label: 'Code', Icon: IconCode },
  { id: 'preview', label: 'Aperçu', Icon: IconEye },
  { id: 'git', label: 'Git', Icon: IconGit },
  { id: 'ai-changes', label: 'AI Changes', Icon: IconAudit },
  { id: 'brain', label: 'Brain', Icon: IconBrain },
  { id: 'workflows', label: 'Flux', Icon: IconFlow },
];

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

const TransientPane = ({ id, active, children }) => (
  <div
    id={`workspace-pane-${id}`}
    className={`center-transient-pane ${active ? 'is-active' : ''}`}
    role="tabpanel"
    aria-labelledby={`workspace-tab-${id}`}
    aria-hidden={!active}
    inert={active ? undefined : ''}
    tabIndex={active ? 0 : -1}
  >
    {children}
  </div>
);

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
  brainGraphProps,
  workflowProps,
  aiChatProps,
  workspacePanelProps,
  isTerminalOpen,
  onToggleTerminal,
  activeSidebarSection = 'explorer',
}) => {
  const [terminalHeight, setTerminalHeight] = useState(() => {
    try {
      const saved = localStorage.getItem('futurIA_terminalHeight');
      return saved ? Math.max(MIN_TERMINAL_HEIGHT, Number(saved)) : DEFAULT_TERMINAL_HEIGHT;
    } catch { return DEFAULT_TERMINAL_HEIGHT; }
  });
  const [isTerminalMaximized, setIsTerminalMaximized] = useState(false);
  const termDragRef = useRef(null);
  const centerRef = useRef(null);
  const centerTabRefs = useRef([]);

  useEffect(() => {
    try {
      localStorage.setItem('futurIA_terminalHeight', String(terminalHeight));
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

  const handleCenterTabKeyDown = (event, index) => {
    let nextIndex;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % CENTER_TABS.length;
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + CENTER_TABS.length) % CENTER_TABS.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = CENTER_TABS.length - 1;
    else return;

    event.preventDefault();
    const nextTab = CENTER_TABS[nextIndex];
    onCenterViewChange(nextTab.id);
    centerTabRefs.current[nextIndex]?.focus();
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
          workspacePanelProps={workspacePanelProps}
          gitPanelProps={gitPanelProps}
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
        {/* Tabs (sans Terminal) */}
        <div className="center-tabs" role="tablist" aria-label="Vues du workspace">
          {CENTER_TABS.map(({ id, label, Icon }, index) => (
            <button
              key={id}
              ref={(element) => { centerTabRefs.current[index] = element; }}
              id={`workspace-tab-${id}`}
              onClick={() => onCenterViewChange(id)}
              onKeyDown={(event) => handleCenterTabKeyDown(event, index)}
              className={`center-tab ${centerView === id ? 'is-active' : ''}`}
              role="tab"
              aria-selected={centerView === id}
              aria-controls={`workspace-pane-${id}`}
              tabIndex={centerView === id ? 0 : -1}
            >
              <Icon />
              {label}
            </button>
          ))}

          <div className="center-tab-spacer" />

          <button
            onClick={onToggleFocusMode}
            className={`center-tab-action ${isFocusMode ? 'is-active' : ''}`}
            title={isFocusMode ? 'Quitter le mode focus' : 'Mode focus'}
          >
            <IconMaximize />
            Focus
          </button>
        </div>

        {/* Corps principal */}
        <div className="center-body" style={isTerminalOpen && isTerminalMaximized ? { flex: '0 0 0', overflow: 'hidden' } : undefined}>
          {/* Always-mounted panes for views with costly init or precious ephemeral
              state (Monaco, iframe preview, graph layout, React Flow viewport) —
              cross-faded via CSS instead of remounted on every switch. See D3. */}
          <div
            className={`center-view-stack ${['code', 'preview', 'brain', 'workflows'].includes(centerView) ? 'is-visible' : ''}`}
            aria-hidden={!['code', 'preview', 'brain', 'workflows'].includes(centerView)}
          >
            <PersistentPane id="code" active={centerView === 'code'}>
              <CodeEditor {...editorProps} />
            </PersistentPane>
            <PersistentPane id="preview" active={centerView === 'preview'}>
              <LivePreview {...previewProps} />
            </PersistentPane>
            <PersistentPane id="brain" active={centerView === 'brain'}>
              <BrainGraphPanel {...brainGraphProps} />
            </PersistentPane>
            <PersistentPane id="workflows" active={centerView === 'workflows'}>
              <VisualWorkflowEditor {...workflowProps} />
            </PersistentPane>
          </div>
          {/* Cheap/stateless views — plain conditional mount is fine here. */}
          <TransientPane id="git" active={centerView === 'git'}>
            {centerView === 'git' && <GitPanel {...gitPanelProps} />}
          </TransientPane>
          <TransientPane id="ai-changes" active={centerView === 'ai-changes'}>
            {centerView === 'ai-changes' && <AIChangesPanel {...aiChangesPanelProps} />}
          </TransientPane>
        </div>

        {/* Bottom Terminal Panel */}
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

            {/* Terminal Panel (Header + Content) */}
            <TerminalPanel
              {...terminalProps}
              headerRightControls={
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
                    title="Fermer le terminal"
                    size="sm"
                  />
                </div>
              }
            />
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
