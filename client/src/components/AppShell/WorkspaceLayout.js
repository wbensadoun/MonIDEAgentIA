import React from 'react';
import FileExplorer from '../FileExplorer';
import CodeEditor from '../CodeEditor';
import LivePreview from '../LivePreview';
import TerminalPanel from '../TerminalPanel';
import GitPanel from '../GitPanel';
import VisualWorkflowEditor from '../VisualWorkflowEditor';
import AIChat from '../AIChat';

const WorkspaceLayout = ({
  layoutRef,
  leftWidth,
  rightWidth,
  middleWidth,
  isLeftCollapsed,
  isRightCollapsed,
  dragging,
  onDragStart,
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
  workflowProps,
  aiChatProps
}) => (
  <div ref={layoutRef} className="workspace">
    {!isLeftCollapsed && (
      <aside
        className="panel nav-panel"
        style={{ width: `${leftWidth}%` }}
      >
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
          onToggleFolder={onToggleFolder}
          onFileClick={onFileClick}
          onNewItemNameChange={onNewItemNameChange}
          isReadOnly={isReadOnlyMode}
        />
      </aside>
    )}

    {!isLeftCollapsed && (
      <div
        className={`panel-resizer ${dragging === 'left' ? 'panel-resizer-active' : ''}`}
        onMouseDown={(event) => onDragStart(event, 'left')}
      />
    )}

    <main
      className="panel center-panel"
      style={{ width: `${middleWidth}%` }}
    >
      <div className="center-tabs">
        <div className="tab-group">
          <button
            onClick={() => onCenterViewChange('code')}
            className={`tab ${centerView === 'code' ? 'is-active' : ''}`}
          >
            Code
          </button>
          <button
            onClick={() => onCenterViewChange('preview')}
            className={`tab ${centerView === 'preview' ? 'is-active' : ''}`}
          >
            Aperçu
          </button>
          <button
            onClick={() => onCenterViewChange('terminal')}
            className={`tab ${centerView === 'terminal' ? 'is-active' : ''}`}
          >
            Terminal
          </button>
          <button
            onClick={() => onCenterViewChange('git')}
            className={`tab ${centerView === 'git' ? 'is-active' : ''}`}
            style={{ color: centerView === 'git' ? '#00c49a' : undefined }}
          >
            ⎇ Git
          </button>
          <button
            onClick={() => onCenterViewChange('workflows')}
            className={`tab ${centerView === 'workflows' ? 'is-active' : ''}`}
            style={{ color: centerView === 'workflows' ? '#a78bfa' : undefined }}
          >
            ⚡ Flux
          </button>
        </div>
        <div className="tab-actions">
          <button
            onClick={onToggleFocusMode}
            className={`btn btn-ghost ${isFocusMode ? 'is-active' : ''}`}
          >
            Focus
          </button>
        </div>
      </div>

      <div className="center-body">
        {centerView === 'code' && <CodeEditor {...editorProps} />}
        {centerView === 'preview' && <LivePreview {...previewProps} />}
        {centerView === 'terminal' && <TerminalPanel {...terminalProps} />}
        {centerView === 'git' && <GitPanel {...gitPanelProps} />}
        <div
          style={{
            display: centerView === 'workflows' ? 'flex' : 'none',
            flex: 1,
            minHeight: 0
          }}
        >
          <VisualWorkflowEditor {...workflowProps} />
        </div>
      </div>
    </main>

    {!isRightCollapsed && (
      <div
        className={`panel-resizer ${dragging === 'right' ? 'panel-resizer-active' : ''}`}
        onMouseDown={(event) => onDragStart(event, 'right')}
      />
    )}

    {!isRightCollapsed && (
      <aside
        className="panel ai-panel"
        style={{ width: `${rightWidth}%` }}
      >
        <AIChat {...aiChatProps} />
      </aside>
    )}
  </div>
);

export default WorkspaceLayout;
