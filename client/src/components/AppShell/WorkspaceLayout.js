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


/* Icônes tabs centre */
const IconCode = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{width:13,height:13}}>
    <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
  </svg>
);
const IconEye = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{width:13,height:13}}>
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
  </svg>
);
const IconGit = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{width:13,height:13}}>
    <circle cx="18" cy="18" r="3" /><circle cx="6" cy="6" r="3" /><path d="M6 21V9a9 9 0 0 0 9 9" />
  </svg>
);
const IconAudit = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{width:13,height:13}}>
    <path d="M9 11l2 2 4-4" />
    <path d="M21 12a9 9 0 1 1-3-6.7" />
    <path d="M21 3v6h-6" />
  </svg>
);
const IconFlow = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{width:13,height:13}}>
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </svg>
);
const IconBrain = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{width:13,height:13}}>
    <circle cx="7" cy="8" r="3" />
    <circle cx="17" cy="8" r="3" />
    <circle cx="12" cy="16" r="3" />
    <path d="M9.5 9.8 11 13.2" />
    <path d="M14.5 9.8 13 13.2" />
    <path d="M10 16h-2a4 4 0 0 1-4-4" />
    <path d="M14 16h2a4 4 0 0 0 4-4" />
  </svg>
);
const IconMaximize = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{width:12,height:12}}>
    <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
  </svg>
);
const IconX = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{width:12,height:12}}>
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);
const IconMaximize2 = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{width:12,height:12}}>
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
  </svg>
);
const IconMinimize2 = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{width:12,height:12}}>
    <polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" /><line x1="14" y1="10" x2="21" y2="3" /><line x1="3" y1="21" x2="10" y2="14" />
  </svg>
);

const DEFAULT_TERMINAL_HEIGHT = 250;
const MIN_TERMINAL_HEIGHT = 100;
const MAX_TERMINAL_HEIGHT_RATIO = 0.7;

const WorkspaceLayout = ({
  layoutRef,
  leftWidth,
  rightWidth,
  middleWidth,
  isLeftCollapsed,
  isRightCollapsed,
  dragging,
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
  onToggleFolder,
  onFileClick,
  onNewItemNameChange,
  isReadOnlyMode,
  centerView,
  onCenterViewChange,
  isFocusMode,
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

  return (
    <div ref={layoutRef} className="workspace">
      {/* Sidebar gauche — Explorateur */}
      {!isLeftCollapsed && (
        <WorkspaceSidebar
          sidebarVisibility="full"
          style={{ width: `${leftWidth}%` }}
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
      )}

      {/* Resizer gauche */}
      {!isLeftCollapsed && (
        <div
          className={`panel-resizer ${dragging === 'left' ? 'panel-resizer-active' : ''}`}
          onMouseDown={(e) => onDragStart(e, 'left')}
          role="separator"
          aria-orientation="vertical"
          aria-label="Redimensionner le panneau de gauche"
          tabIndex={0}
          onKeyDown={(e) => {
            if (!onResizeStep) return;
            if (e.key === 'ArrowLeft') { e.preventDefault(); onResizeStep('left', -2); }
            else if (e.key === 'ArrowRight') { e.preventDefault(); onResizeStep('left', 2); }
          }}
        />
      )}

      {/* Panneau central */}
      <main ref={centerRef} className="ide-center" style={{ width: `${middleWidth}%` }}>
        {/* Tabs (sans Terminal) */}
        <div className="center-tabs" role="tablist">
          {[
            { id: 'code', label: 'Code', Icon: IconCode },
            { id: 'preview', label: 'Aperçu', Icon: IconEye },
            { id: 'git', label: 'Git', Icon: IconGit },
            { id: 'ai-changes', label: 'AI Changes', Icon: IconAudit },
            { id: 'brain', label: 'Brain', Icon: IconBrain },
            { id: 'workflows', label: 'Flux', Icon: IconFlow },
          ].map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => onCenterViewChange(id)}
              className={`center-tab ${centerView === id ? 'is-active' : ''}`}
              role="tab"
              aria-selected={centerView === id}
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
          >
            <div className={`center-view-pane ${centerView === 'code' ? 'is-active' : ''}`} aria-hidden={centerView !== 'code'}>
              <CodeEditor {...editorProps} />
            </div>
            <div className={`center-view-pane ${centerView === 'preview' ? 'is-active' : ''}`} aria-hidden={centerView !== 'preview'}>
              <LivePreview {...previewProps} />
            </div>
            <div className={`center-view-pane ${centerView === 'brain' ? 'is-active' : ''}`} aria-hidden={centerView !== 'brain'}>
              <BrainGraphPanel {...brainGraphProps} />
            </div>
            <div className={`center-view-pane ${centerView === 'workflows' ? 'is-active' : ''}`} aria-hidden={centerView !== 'workflows'}>
              <VisualWorkflowEditor {...workflowProps} />
            </div>
          </div>
          {/* Cheap/stateless views — plain conditional mount is fine here. */}
          {centerView === 'git' && <GitPanel {...gitPanelProps} />}
          {centerView === 'ai-changes' && <AIChangesPanel {...aiChangesPanelProps} />}
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
                  <button
                    className="bottom-terminal-action"
                    onClick={toggleMaximize}
                    title={isTerminalMaximized ? 'Restaurer' : 'Maximiser'}
                  >
                    {isTerminalMaximized ? <IconMinimize2 /> : <IconMaximize2 />}
                  </button>
                  <button
                    className="bottom-terminal-action"
                    onClick={onToggleTerminal}
                    title="Fermer le terminal"
                  >
                    <IconX />
                  </button>
                </div>
              }
            />
          </div>
        )}
      </main>

      {/* Resizer droit */}
      {!isRightCollapsed && (
        <div
          className={`panel-resizer ${dragging === 'right' ? 'panel-resizer-active' : ''}`}
          onMouseDown={(e) => onDragStart(e, 'right')}
          role="separator"
          aria-orientation="vertical"
          aria-label="Redimensionner le panneau de droite"
          tabIndex={0}
          onKeyDown={(e) => {
            if (!onResizeStep) return;
            if (e.key === 'ArrowLeft') { e.preventDefault(); onResizeStep('right', -2); }
            else if (e.key === 'ArrowRight') { e.preventDefault(); onResizeStep('right', 2); }
          }}
        />
      )}

      {/* Sidebar droite — AI Chat */}
      {!isRightCollapsed && (
        <aside
          className="ide-sidebar-right"
          style={{ width: `${rightWidth}%` }}
        >
          <AIChat {...aiChatProps} />
        </aside>
      )}
    </div>
  );
};

export default WorkspaceLayout;
