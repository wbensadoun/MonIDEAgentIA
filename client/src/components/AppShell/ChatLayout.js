import React, { useCallback, useEffect, useRef, useState } from 'react';
import WorkspaceSidebar from './WorkspaceSidebar';
import AIChat from '../AIChat';

const DEFAULT_SIDEBAR_WIDTH = 20;
const MIN_SIDEBAR_WIDTH = 15;
const MAX_SIDEBAR_WIDTH = 45;
const STORAGE_KEY = 'futurIA_chatSidebarWidth';

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
  aiChatProps
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

  return (
    <div ref={layoutRef} className="workspace">
      {/* Left Sidebar: Projects/Workspace Panel */}
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

      {/* Right Main: Full-screen Chat */}
      <main className="chat-fullscreen">
        <div className="chat-fullscreen-inner">
          <AIChat {...aiChatProps} />
        </div>
      </main>
    </div>
  );
};

export default ChatLayout;
