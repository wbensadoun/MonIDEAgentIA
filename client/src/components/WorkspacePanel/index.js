import React, { useCallback, useEffect, useMemo, useState } from 'react';
import './WorkspacePanel.css';

const formatStamp = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'hier';
  const diffDays = Math.round((now - d) / 86400000);
  if (diffDays < 7) return d.toLocaleDateString('fr-FR', { weekday: 'short' });
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'numeric' });
};

const statusLabel = (status) => {
  if (status === 'run') return 'en cours';
  if (status === 'wait') return 'en attente';
  return '';
};

const WorkspacePanel = ({
  workspaces = [],
  currentProjectPath,
  projectRunState = {},
  isElectronApiAvailable,
  activeConversationFile,
  conversationsRefreshKey = 0,
  onSelectProject,
  onOpenConversation,
  onOpenProject,
  onRemoveProject,
  onNewConversation
}) => {
  const [expanded, setExpanded] = useState({});
  const [conversationsByPath, setConversationsByPath] = useState({});
  const [loadingPaths, setLoadingPaths] = useState({});

  const loadConversations = useCallback(async (projectPath) => {
    if (!projectPath || !isElectronApiAvailable || !window.electronAPI?.listConversations) return;
    setLoadingPaths((prev) => ({ ...prev, [projectPath]: true }));
    try {
      const res = await window.electronAPI.listConversations(projectPath);
      if (res?.success && Array.isArray(res.conversations)) {
        setConversationsByPath((prev) => ({ ...prev, [projectPath]: res.conversations }));
      } else {
        setConversationsByPath((prev) => ({ ...prev, [projectPath]: [] }));
      }
    } catch {
      setConversationsByPath((prev) => ({ ...prev, [projectPath]: [] }));
    } finally {
      setLoadingPaths((prev) => ({ ...prev, [projectPath]: false }));
    }
  }, [isElectronApiAvailable]);

  // Auto-expand the active project on mount / when it changes
  useEffect(() => {
    if (!currentProjectPath) return;
    setExpanded((prev) => (prev[currentProjectPath] ? prev : { ...prev, [currentProjectPath]: true }));
    loadConversations(currentProjectPath);
  }, [currentProjectPath, loadConversations]);

  // Refresh active project's conversations when something signals a change (save, run end)
  useEffect(() => {
    if (currentProjectPath) loadConversations(currentProjectPath);
  }, [conversationsRefreshKey, currentProjectPath, loadConversations]);

  const toggleProject = useCallback((projectPath) => {
    setExpanded((prev) => {
      const next = { ...prev, [projectPath]: !prev[projectPath] };
      if (next[projectPath] && !conversationsByPath[projectPath]) {
        loadConversations(projectPath);
      }
      return next;
    });
  }, [conversationsByPath, loadConversations]);

  const sortedWorkspaces = useMemo(() => {
    return [...workspaces].sort((a, b) => Number(b.lastOpenedAt || 0) - Number(a.lastOpenedAt || 0));
  }, [workspaces]);

  const runningCount = useMemo(
    () => Object.values(projectRunState).filter((s) => s === 'run').length,
    [projectRunState]
  );

  return (
    <div className="ws-root">
      <div className="ws-header">
        <span className="ws-header-title">
          Espaces de travail · {workspaces.length}
          {runningCount > 0 && <span className="ws-header-running"> · {runningCount} actif(s)</span>}
        </span>
        <button
          type="button"
          className="ws-add"
          title={isElectronApiAvailable ? 'Ouvrir un projet' : 'Disponible uniquement dans l\'application de bureau'}
          onClick={() => onOpenProject && onOpenProject()}
          disabled={!isElectronApiAvailable}
        >
          +
        </button>
      </div>

      <div className="ws-tree custom-scrollbar">
        {sortedWorkspaces.length === 0 && (
          <div className="ws-empty">
            Aucun projet ouvert.
            <button type="button" className="ws-empty-btn" onClick={() => onOpenProject && onOpenProject()}>
              Ouvrir un projet
            </button>
          </div>
        )}

        {sortedWorkspaces.map((ws) => {
          const isActive = ws.path === currentProjectPath;
          const isOpen = !!expanded[ws.path];
          const status = projectRunState[ws.path] || 'idle';
          const convs = conversationsByPath[ws.path] || [];
          const isLoadingConvs = !!loadingPaths[ws.path];
          return (
            <div key={ws.path} className="ws-project-block">
              <div
                className={`ws-project ${isActive ? 'is-active' : ''}`}
                onClick={() => onSelectProject && onSelectProject(ws.path)}
                title={ws.path}
              >
                <button
                  type="button"
                  className={`ws-caret ${isOpen ? 'is-open' : ''}`}
                  onClick={(e) => { e.stopPropagation(); toggleProject(ws.path); }}
                  aria-label={isOpen ? 'Replier' : 'Déplier'}
                >
                  ▾
                </button>
                <span className={`ws-dot ws-dot-${status}`} title={statusLabel(status)} />
                <span className="ws-project-icon">{isOpen ? '📂' : '📁'}</span>
                <span className="ws-project-name">{ws.name}</span>
                {status === 'run' && <span className="ws-project-meta">run</span>}
                {status === 'wait' && <span className="ws-project-meta is-wait">wait</span>}
                <button
                  type="button"
                  className="ws-project-remove"
                  title="Retirer de la liste"
                  onClick={(e) => { e.stopPropagation(); onRemoveProject && onRemoveProject(ws.path); }}
                >
                  ×
                </button>
              </div>

              {isOpen && (
                <div className="ws-sessions">
                  {isActive && (
                    <button
                      type="button"
                      className="ws-session ws-session-new"
                      onClick={() => onNewConversation && onNewConversation()}
                    >
                      <span className="ws-session-icon">＋</span>
                      <span className="ws-session-name">Nouvelle session</span>
                    </button>
                  )}
                  {isLoadingConvs && <div className="ws-sessions-hint">Chargement…</div>}
                  {!isLoadingConvs && convs.length === 0 && (
                    <div className="ws-sessions-hint">Aucune conversation</div>
                  )}
                  {convs.map((conv) => {
                    const isActiveConv = isActive && conv.fileName === activeConversationFile;
                    return (
                      <div
                        key={conv.fileName}
                        className={`ws-session ${isActiveConv ? 'is-active' : ''}`}
                        onClick={() => onOpenConversation && onOpenConversation(ws.path, conv.fileName)}
                        title={conv.title}
                      >
                        <span className="ws-dot ws-dot-idle" />
                        <span className="ws-session-icon">💬</span>
                        <span className="ws-session-name">{conv.title}</span>
                        <span className="ws-session-time">{formatStamp(conv.createdAt)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="ws-footer">
        <button
          type="button"
          className="ws-open-btn"
          title={isElectronApiAvailable ? 'Ouvrir un projet' : 'Disponible uniquement dans l\'application de bureau'}
          onClick={() => onOpenProject && onOpenProject()}
          disabled={!isElectronApiAvailable}
        >
          ＋ Ouvrir un projet
        </button>
      </div>
    </div>
  );
};

export default WorkspacePanel;
