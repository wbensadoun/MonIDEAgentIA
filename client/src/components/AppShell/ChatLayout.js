import React, { useCallback, useEffect, useRef, useState } from 'react';
import WorkspaceSidebar from './WorkspaceSidebar';
import AIChat from '../AIChat';
import AgentSwarmPanel from '../AgentSwarmPanel';
import {
  clamp,
  KEYBOARD_RESIZE_STEP,
  migrateLegacyWidth,
  RESIZER_WIDTH,
  fitSideWidths,
  usePointerResize
} from '../../hooks/useWorkspaceSessionLayout';

export const CHAT_LAYOUT_VERSION = 2;
export const CHAT_SIDEBAR_DEFAULT_WIDTH = 280;
export const CHAT_SIDEBAR_MIN_WIDTH = 200;
export const CHAT_SIDEBAR_MAX_WIDTH = 480;
export const CHAT_MAIN_MIN_WIDTH = 350;
export const SWARM_DEFAULT_WIDTH = 320;
export const SWARM_MIN_WIDTH = 260;
export const SWARM_MAX_WIDTH = 520;

const SIDEBAR_STORAGE_KEY = 'code_companion_chatSidebarWidth';
const SWARM_STORAGE_KEY = 'code_companion_chatSwarmWidth';
const VERSION_STORAGE_KEY = 'code_companion_chatLayoutVersion';

const availableViewportWidth = () => (
  typeof window === 'undefined' ? 1280 : Math.max(0, window.innerWidth - 48)
);

const readInitialWidth = (key, fallback, minimum, maximum, migratePercentage = false) => {
  try {
    const saved = localStorage.getItem(key);
    if (saved == null) return fallback;
    const version = Number(localStorage.getItem(VERSION_STORAGE_KEY) || 0);
    const numeric = migratePercentage && version < CHAT_LAYOUT_VERSION
      ? migrateLegacyWidth(saved, availableViewportWidth(), fallback)
      : Number(saved);
    return Number.isFinite(numeric) && numeric > 0
      ? clamp(Math.round(numeric), minimum, maximum)
      : fallback;
  } catch {
    return fallback;
  }
};

/** Chat-focused workbench with pixel-sized, persistent side regions. */
const ChatLayout = ({
  workspacePanelProps,
  aiChatProps,
  isSidebarCollapsed = false,
  isSwarmOpen = false,
  onToggleSwarmPanel
}) => {
  const layoutRef = useRef(null);
  const [layoutWidth, setLayoutWidth] = useState(availableViewportWidth);
  const [sidebarWidth, setSidebarWidth] = useState(() => readInitialWidth(
    SIDEBAR_STORAGE_KEY,
    CHAT_SIDEBAR_DEFAULT_WIDTH,
    CHAT_SIDEBAR_MIN_WIDTH,
    CHAT_SIDEBAR_MAX_WIDTH,
    true
  ));
  const [swarmWidth, setSwarmWidth] = useState(() => readInitialWidth(
    SWARM_STORAGE_KEY,
    SWARM_DEFAULT_WIDTH,
    SWARM_MIN_WIDTH,
    SWARM_MAX_WIDTH
  ));

  useEffect(() => {
    const node = layoutRef.current;
    if (!node) return undefined;
    const measure = () => {
      const width = node.getBoundingClientRect().width || node.clientWidth;
      if (width > 0) setLayoutWidth(Math.round(width));
    };
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(measure);
      observer.observe(node);
      return () => observer.disconnect();
    }
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, String(sidebarWidth));
      localStorage.setItem(SWARM_STORAGE_KEY, String(swarmWidth));
      localStorage.setItem(VERSION_STORAGE_KEY, String(CHAT_LAYOUT_VERSION));
    } catch {
      // localStorage may be disabled.
    }
  }, [sidebarWidth, swarmWidth]);

  const resizerCount = Number(!isSidebarCollapsed) + Number(isSwarmOpen);
  const fittedWidths = fitSideWidths({
    availableWidth: layoutWidth - CHAT_MAIN_MIN_WIDTH - resizerCount * RESIZER_WIDTH,
    leftWidth: isSidebarCollapsed ? 0 : sidebarWidth,
    rightWidth: isSwarmOpen ? swarmWidth : 0,
    leftMin: isSidebarCollapsed ? 0 : CHAT_SIDEBAR_MIN_WIDTH,
    rightMin: isSwarmOpen ? SWARM_MIN_WIDTH : 0
  });
  const renderedSidebarWidth = isSidebarCollapsed ? sidebarWidth : fittedWidths.leftWidth;
  const renderedSwarmWidth = isSwarmOpen ? fittedWidths.rightWidth : swarmWidth;
  const sidebarMaxWidth = Math.max(
    CHAT_SIDEBAR_MIN_WIDTH,
    Math.min(
      CHAT_SIDEBAR_MAX_WIDTH,
      layoutWidth - CHAT_MAIN_MIN_WIDTH - (isSwarmOpen ? renderedSwarmWidth : 0) - resizerCount * RESIZER_WIDTH
    )
  );
  const swarmMaxWidth = Math.max(
    SWARM_MIN_WIDTH,
    Math.min(
      SWARM_MAX_WIDTH,
      layoutWidth - CHAT_MAIN_MIN_WIDTH - (isSidebarCollapsed ? 0 : renderedSidebarWidth) - resizerCount * RESIZER_WIDTH
    )
  );

  const resizeSidebar = useCallback(({ deltaX, data }) => {
    setSidebarWidth(clamp(
      Math.round(data.startWidth + deltaX),
      CHAT_SIDEBAR_MIN_WIDTH,
      data.maxWidth
    ));
  }, []);
  const sidebarResize = usePointerResize({ onResize: resizeSidebar });

  const resizeSwarm = useCallback(({ deltaX, data }) => {
    setSwarmWidth(clamp(
      Math.round(data.startWidth - deltaX),
      SWARM_MIN_WIDTH,
      data.maxWidth
    ));
  }, []);
  const swarmResize = usePointerResize({ onResize: resizeSwarm });

  const handleSidebarResizeKey = useCallback((delta) => {
    setSidebarWidth(width => clamp(
      width + delta,
      CHAT_SIDEBAR_MIN_WIDTH,
      sidebarMaxWidth
    ));
  }, [sidebarMaxWidth]);

  const handleSwarmResizeKey = useCallback((delta) => {
    setSwarmWidth(width => clamp(width + delta, SWARM_MIN_WIDTH, swarmMaxWidth));
  }, [swarmMaxWidth]);

  return (
    <div ref={layoutRef} className="workspace">
      {!isSidebarCollapsed && (
        <>
          <WorkspaceSidebar
            sidebarVisibility="projectsOnly"
            style={{ width: `${renderedSidebarWidth}px`, minWidth: `${CHAT_SIDEBAR_MIN_WIDTH}px` }}
            workspacePanelProps={workspacePanelProps}
          />
          <div
            className={`panel-resizer ${sidebarResize.isResizing ? 'panel-resizer-active' : ''}`}
            role="separator"
            aria-orientation="vertical"
            aria-label="Redimensionner le panneau de gauche"
            aria-valuemin={CHAT_SIDEBAR_MIN_WIDTH}
            aria-valuemax={Math.max(renderedSidebarWidth, sidebarMaxWidth)}
            aria-valuenow={renderedSidebarWidth}
            tabIndex={0}
            onPointerDown={(event) => sidebarResize.beginPointerResize(event, {
              startWidth: renderedSidebarWidth,
              maxWidth: sidebarMaxWidth
            })}
            {...sidebarResize.resizeHandleProps}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft') {
                event.preventDefault();
                handleSidebarResizeKey(-KEYBOARD_RESIZE_STEP);
              } else if (event.key === 'ArrowRight') {
                event.preventDefault();
                handleSidebarResizeKey(KEYBOARD_RESIZE_STEP);
              }
            }}
          />
        </>
      )}

      <main
        className="chat-fullscreen"
        aria-label="Chat principal"
        style={{ minWidth: `${CHAT_MAIN_MIN_WIDTH}px` }}
      >
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
          <div
            className={`panel-resizer ${swarmResize.isResizing ? 'panel-resizer-active' : ''}`}
            role="separator"
            aria-orientation="vertical"
            aria-label="Redimensionner le panneau des agents"
            aria-valuemin={SWARM_MIN_WIDTH}
            aria-valuemax={Math.max(renderedSwarmWidth, swarmMaxWidth)}
            aria-valuenow={renderedSwarmWidth}
            tabIndex={0}
            onPointerDown={(event) => swarmResize.beginPointerResize(event, {
              startWidth: renderedSwarmWidth,
              maxWidth: swarmMaxWidth
            })}
            {...swarmResize.resizeHandleProps}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft') {
                event.preventDefault();
                handleSwarmResizeKey(KEYBOARD_RESIZE_STEP);
              } else if (event.key === 'ArrowRight') {
                event.preventDefault();
                handleSwarmResizeKey(-KEYBOARD_RESIZE_STEP);
              }
            }}
          />
          <AgentSwarmPanel
            multiAIState={aiChatProps?.multiAIState}
            width={renderedSwarmWidth}
            onClose={onToggleSwarmPanel}
          />
        </>
      )}
    </div>
  );
};

export default ChatLayout;
