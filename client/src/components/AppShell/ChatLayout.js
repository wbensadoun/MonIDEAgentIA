import React, { useCallback, useEffect, useRef, useState } from 'react';
import WorkspaceSidebar from './WorkspaceSidebar';
import AIChat from '../AIChat';
import AgentSwarmPanel from '../AgentSwarmPanel';

const DEFAULT_SIDEBAR_WIDTH = 20;
const MIN_SIDEBAR_WIDTH = 15;
const MAX_SIDEBAR_WIDTH = 45;
const STORAGE_KEY = 'futurIA_chatSidebarWidth';

// Panneau des agents (droite) : largeur en pixels (pas en %), le panneau
// gauche est déjà en %, mais un panneau étroit type "sidebar d'outil" se
// raisonne mieux en px fixes qu'en fraction de l'écran.
const SWARM_DEFAULT_WIDTH = 320;
const SWARM_MIN_WIDTH = 260;
const SWARM_MAX_WIDTH = 520;
const SWARM_WIDTH_KEY = 'futurIA_chatSwarmWidth';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/**
 * ChatLayout — Full-page flex row layout for chat-focused UI
 *
 * Structure:
 * - Left sidebar: WorkspaceSidebar (projects only, no file explorer),
 *   resizable via drag/keyboard just like WorkspaceLayout's left panel
 *   (previously hardcoded to a fixed 20% with no resizer at all).
 * - Right main: Full-screen AIChat interface, fills the remaining space.
 *
 * Props:
 *   - workspacePanelProps: Object with WorkspacePanel configuration
 *   - aiChatProps: Object with AIChat configuration
 */
const ChatLayout = ({
  workspacePanelProps,
  aiChatProps,
  isSidebarCollapsed = false,
  isSwarmOpen = false,
  onToggleSwarmPanel
}) => {
  const layoutRef = useRef(null);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(STORAGE_KEY));
      return Number.isFinite(saved) && saved > 0
        ? clamp(saved, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH)
        : DEFAULT_SIDEBAR_WIDTH;
    } catch {
      return DEFAULT_SIDEBAR_WIDTH;
    }
  });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ startX: 0, startWidth: DEFAULT_SIDEBAR_WIDTH });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(sidebarWidth));
    } catch {
      // ignore
    }
  }, [sidebarWidth]);

  useEffect(() => {
    if (!isDragging) return undefined;

    const handleMouseMove = (e) => {
      if (e.buttons === 0) {
        setIsDragging(false);
        return;
      }
      if (!layoutRef.current) return;
      const totalWidth = layoutRef.current.getBoundingClientRect().width;
      if (!totalWidth) return;

      const deltaPercent = ((e.clientX - dragStartRef.current.startX) / totalWidth) * 100;
      setSidebarWidth(clamp(dragStartRef.current.startWidth + deltaPercent, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH));
    };
    const handleMouseUp = () => setIsDragging(false);

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  const handleDragStart = useCallback((e) => {
    e.preventDefault();
    dragStartRef.current = { startX: e.clientX, startWidth: sidebarWidth };
    setIsDragging(true);
  }, [sidebarWidth]);

  const handleResizeStep = useCallback((deltaPercent) => {
    setSidebarWidth((w) => clamp(w + deltaPercent, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH));
  }, []);

  // ---- Panneau des agents (droite) : largeur uniquement — l'etat
  // ouvert/ferme vit maintenant dans App.js (isSwarmOpen/onToggleSwarmPanel
  // props) pour que la topbar puisse piloter le meme toggle. ----
  const [swarmWidth, setSwarmWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(SWARM_WIDTH_KEY));
      return Number.isFinite(saved) && saved > 0
        ? clamp(saved, SWARM_MIN_WIDTH, SWARM_MAX_WIDTH)
        : SWARM_DEFAULT_WIDTH;
    } catch {
      return SWARM_DEFAULT_WIDTH;
    }
  });
  const [isSwarmDragging, setIsSwarmDragging] = useState(false);
  const swarmDragStartRef = useRef({ startX: 0, startWidth: SWARM_DEFAULT_WIDTH });

  useEffect(() => {
    try {
      localStorage.setItem(SWARM_WIDTH_KEY, String(swarmWidth));
    } catch {
      // ignore
    }
  }, [swarmWidth]);

  useEffect(() => {
    if (!isSwarmDragging) return undefined;

    const handleMouseMove = (e) => {
      if (e.buttons === 0) {
        setIsSwarmDragging(false);
        return;
      }
      // Le panneau est à droite : glisser la poignée vers la GAUCHE doit
      // l'agrandir, donc le delta de largeur est l'inverse du delta de souris.
      const deltaPx = swarmDragStartRef.current.startX - e.clientX;
      setSwarmWidth(clamp(swarmDragStartRef.current.startWidth + deltaPx, SWARM_MIN_WIDTH, SWARM_MAX_WIDTH));
    };
    const handleMouseUp = () => setIsSwarmDragging(false);

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isSwarmDragging]);

  const handleSwarmDragStart = useCallback((e) => {
    e.preventDefault();
    swarmDragStartRef.current = { startX: e.clientX, startWidth: swarmWidth };
    setIsSwarmDragging(true);
  }, [swarmWidth]);

  const handleSwarmResizeStep = useCallback((deltaPx) => {
    setSwarmWidth((w) => clamp(w + deltaPx, SWARM_MIN_WIDTH, SWARM_MAX_WIDTH));
  }, []);

  return (
    <div ref={layoutRef} className="workspace">
      {/* Left Sidebar: Projects/Workspace Panel */}
      {!isSidebarCollapsed && (
        <>
          <WorkspaceSidebar
            sidebarVisibility="projectsOnly"
            style={{ width: `${sidebarWidth}%` }}
            workspacePanelProps={workspacePanelProps}
          />

          {/* Resizer — same visual/interaction pattern as WorkspaceLayout's left panel */}
          <div
            className={`panel-resizer ${isDragging ? 'panel-resizer-active' : ''}`}
            onMouseDown={handleDragStart}
            role="separator"
            aria-orientation="vertical"
            aria-label="Redimensionner le panneau de gauche"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft') { e.preventDefault(); handleResizeStep(-2); }
              else if (e.key === 'ArrowRight') { e.preventDefault(); handleResizeStep(2); }
            }}
          />
        </>
      )}

      {/* Right Main: Full-screen Chat */}
      <main className="chat-fullscreen">
        <div className="chat-fullscreen-inner">
          <AIChat
            {...aiChatProps}
            isSwarmPanelOpen={isSwarmOpen}
            onToggleSwarmPanel={onToggleSwarmPanel}
          />
        </div>
      </main>

      {isSwarmOpen && (
        <>
          {/* Resizer miroir de celui de gauche, mais inversé (voir handleSwarmDragStart) */}
          <div
            className={`panel-resizer ${isSwarmDragging ? 'panel-resizer-active' : ''}`}
            onMouseDown={handleSwarmDragStart}
            role="separator"
            aria-orientation="vertical"
            aria-label="Redimensionner le panneau des agents"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft') { e.preventDefault(); handleSwarmResizeStep(20); }
              else if (e.key === 'ArrowRight') { e.preventDefault(); handleSwarmResizeStep(-20); }
            }}
          />
          <AgentSwarmPanel
            multiAIState={aiChatProps?.multiAIState}
            width={swarmWidth}
            onClose={onToggleSwarmPanel}
          />
        </>
      )}
    </div>
  );
};

export default ChatLayout;
