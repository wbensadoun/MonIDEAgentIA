import React, { useState, useCallback, useRef, useEffect } from 'react';
import FileExplorer from '../FileExplorer';
import WorkspacePanel from '../WorkspacePanel';
import CodeEditor from '../CodeEditor';
import LivePreview from '../LivePreview';
import TerminalPanel from '../TerminalPanel';
import GitPanel from '../GitPanel';
import VisualWorkflowEditor from '../VisualWorkflowEditor';
import AIChat from '../AIChat';
import AIChangesPanel from '../AIChangesPanel';
import BrainGraphPanel from '../BrainGraphPanel';
import AgentVerse from '../../agentverse/index';

/* ============================
   Activity Bar icons
   ============================ */
const IconFiles = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{width:20,height:20}}>
    <path d="M3 3h8l2 2h8v14H3z"/>
  </svg>
);
const IconProjects = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{width:20,height:20}}>
    <rect x="2" y="7" width="20" height="14" rx="2"/>
    <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>
    <line x1="12" y1="12" x2="12" y2="17"/>
    <line x1="9" y1="14.5" x2="15" y2="14.5"/>
  </svg>
);
const IconSearch = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{width:20,height:20}}>
    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
  </svg>
);
const IconGitAB = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{width:20,height:20}}>
    <circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/>
  </svg>
);
const IconBrainAB = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{width:20,height:20}}>
    <circle cx="7" cy="8" r="3"/><circle cx="17" cy="8" r="3"/><circle cx="12" cy="16" r="3"/>
    <path d="M9.5 9.8 11 13.2"/><path d="M14.5 9.8 13 13.2"/>
    <path d="M10 16h-2a4 4 0 0 1-4-4"/><path d="M14 16h2a4 4 0 0 0 4-4"/>
  </svg>
);
const IconFlowAB = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{width:20,height:20}}>
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
  </svg>
);
const IconAIChat = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{width:20,height:20}}>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    <circle cx="9" cy="10" r="1" fill="currentColor" stroke="none"/>
    <circle cx="12" cy="10" r="1" fill="currentColor" stroke="none"/>
    <circle cx="15" cy="10" r="1" fill="currentColor" stroke="none"/>
  </svg>
);
const IconMarketAB = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{width:20,height:20}}>
    <path d="M3 9l1.2-4.2A1 1 0 0 1 5.16 4h13.68a1 1 0 0 1 .96.8L21 9"/>
    <path d="M3 9h18v2a2.5 2.5 0 0 1-5 0 2.5 2.5 0 0 1-5 0 2.5 2.5 0 0 1-5 0 2.5 2.5 0 0 1-3 0z"/>
    <path d="M5 13v6a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-6"/>
    <path d="M9 20v-4h6v4"/>
  </svg>
);
const IconSettingsAB = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{width:20,height:20}}>
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
  </svg>
);

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
const IconAgents = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{width:13,height:13}}>
    <circle cx="9" cy="8" r="3" />
    <path d="M3 20a6 6 0 0 1 12 0" />
    <path d="M16 3.5a3 3 0 0 1 0 5.5" />
    <path d="M18.5 14a6 6 0 0 1 2.5 5" />
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
  onToggleLeftPanel,
  onToggleRightPanel,
  onOpenSearch,
  onOpenSettings,
}) => {
  const [sidebarTab, setSidebarTab] = useState('files');
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

  const handleActivityClick = useCallback((action) => {
    if (action === 'files' || action === 'projects') {
      if (isLeftCollapsed) {
        onToggleLeftPanel();
        setSidebarTab(action);
      } else if (sidebarTab === action) {
        onToggleLeftPanel();
      } else {
        setSidebarTab(action);
      }
    } else if (action === 'search') {
      onOpenSearch?.();
    } else if (action === 'ai') {
      onToggleRightPanel();
    } else if (action === 'settings') {
      onOpenSettings?.();
    } else {
      onCenterViewChange(action);
    }
  }, [isLeftCollapsed, sidebarTab, onToggleLeftPanel, onToggleRightPanel, onCenterViewChange, onOpenSearch, onOpenSettings]);

  const abItems = [
    { id: 'files',     Icon: IconFiles,    title: 'Explorateur' },
    { id: 'projects',  Icon: IconProjects, title: 'Projets' },
    { id: 'search',    Icon: IconSearch,   title: 'Rechercher (Ctrl+Shift+F)' },
    { id: 'git',       Icon: IconGitAB,    title: 'Git' },
    { id: 'brain',     Icon: IconBrainAB,  title: 'Brain' },
    { id: 'workflows', Icon: IconFlowAB,   title: 'Flux' },
    { id: 'agents',    Icon: IconMarketAB, title: 'Marketplace — templates multi-agents' },
    { id: 'ai',        Icon: IconAIChat,   title: 'AI Chat' },
  ];

  const getAbActive = (id) => {
    if (id === 'files') return !isLeftCollapsed && sidebarTab === 'files';
    if (id === 'projects') return !isLeftCollapsed && sidebarTab === 'projects';
    if (id === 'ai') return !isRightCollapsed;
    if (['git', 'brain', 'workflows', 'agents'].includes(id)) return centerView === id;
    return false;
  };

  return (
    <div ref={layoutRef} className="workspace">
      {/* Activity Bar */}
      <div className="activity-bar">
        <div className="activity-bar-top">
          {abItems.map(({ id, Icon, title }) => (
            <button
              key={id}
              className={`activity-bar-btn${getAbActive(id) ? ' is-active' : ''}`}
              title={title}
              onClick={() => handleActivityClick(id)}
            >
              <Icon />
            </button>
          ))}
        </div>
        <div className="activity-bar-bottom">
          <button
            className="activity-bar-btn"
            title="Paramètres"
            onClick={() => handleActivityClick('settings')}
          >
            <IconSettingsAB />
          </button>
        </div>
      </div>

      {/* Sidebar gauche — Explorateur */}
      {!isLeftCollapsed && (
        <aside
          className="ide-sidebar-left"
          style={{ width: `${leftWidth}%` }}
        >
          <div className="sidebar-tabs">
            <button
              type="button"
              className={`sidebar-tab ${sidebarTab === 'files' ? 'is-active' : ''}`}
              onClick={() => setSidebarTab('files')}
            >
              Fichiers
            </button>
            <button
              type="button"
              className={`sidebar-tab ${sidebarTab === 'projects' ? 'is-active' : ''}`}
              onClick={() => setSidebarTab('projects')}
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
      )}

      {/* Resizer gauche */}
      {!isLeftCollapsed && (
        <div
          className={`panel-resizer ${dragging === 'left' ? 'panel-resizer-active' : ''}`}
          onMouseDown={(e) => onDragStart(e, 'left')}
        />
      )}

      {/* Panneau central */}
      <main ref={centerRef} className="ide-center" style={{ width: `${middleWidth}%` }}>
        {/* Tabs (sans Terminal) */}
        <div className="center-tabs">
          {[
            { id: 'code', label: 'Code', Icon: IconCode },
            { id: 'preview', label: 'Aperçu', Icon: IconEye },
            { id: 'git', label: 'Git', Icon: IconGit },
            { id: 'ai-changes', label: 'AI Changes', Icon: IconAudit },
            { id: 'brain', label: 'Brain', Icon: IconBrain },
            { id: 'agents', label: 'Agents', Icon: IconAgents },
            { id: 'workflows', label: 'Flux', Icon: IconFlow },
          ].map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => onCenterViewChange(id)}
              className={`center-tab ${centerView === id ? 'is-active' : ''}`}
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
          {centerView === 'code' && <CodeEditor {...editorProps} />}
          {centerView === 'preview' && <LivePreview {...previewProps} />}
          {centerView === 'git' && <GitPanel {...gitPanelProps} />}
          {centerView === 'ai-changes' && <AIChangesPanel {...aiChangesPanelProps} />}
          {centerView === 'brain' && <BrainGraphPanel {...brainGraphProps} />}
          {centerView === 'agents' && (
            <AgentVerse onViewChanges={() => onCenterViewChange('ai-changes')} />
          )}
          <div style={{ display: centerView === 'workflows' ? 'flex' : 'none', flex: 1, minHeight: 0 }}>
            <VisualWorkflowEditor {...workflowProps} />
          </div>
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
