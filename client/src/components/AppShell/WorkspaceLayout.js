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
  onImportOsFiles,
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
