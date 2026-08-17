import { useCallback, useEffect, useRef, useState } from 'react';
import { normalizeOpenTabs } from '../utils/tabs';

export const WORKSPACE_LAYOUT_VERSION = 3;
export const DEFAULT_LEFT_WIDTH = 280;
export const DEFAULT_RIGHT_WIDTH = 360;
export const MIN_LEFT_WIDTH = 200;
export const MIN_EDITOR_WIDTH = 350;
export const MIN_RIGHT_WIDTH = 280;
export const RESIZER_WIDTH = 10;
export const KEYBOARD_RESIZE_STEP = 20;

export const clamp = (value, min, max) => Math.min(Math.max(min, max), Math.max(min, value));

// centerView values that still have a pane in the center (plan-ia-onglets.md
// §④ moved git/ai-changes/brain out to the Activity Bar/Panel; §⑤ added
// 'chat' for chat tabs).
const VALID_CENTER_VIEWS = new Set(['code', 'preview', 'workflows', 'chat']);

const viewportWidth = () => (
  typeof window === 'undefined' ? 1280 : Math.max(0, window.innerWidth - 48)
);

// Stable reference so callers that don't manage chat-tab state (e.g. this
// hook's own tests) don't hand useEffect a brand-new function every render —
// that would re-fire the session-load effect on every render, which sets
// state unconditionally and loops forever.
const noop = () => {};

export const migrateLegacyWidth = (value, totalWidth, fallback) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  // Layout versions 1 and 2 persisted panel widths as percentages.
  return Math.round((clamp(numeric, 0, 100) / 100) * totalWidth);
};

export const fitSideWidths = ({ availableWidth, leftWidth, rightWidth, leftMin, rightMin }) => {
  const excess = Math.max(0, leftWidth + rightWidth - availableWidth);
  if (!excess) return { leftWidth, rightWidth };
  const leftCapacity = Math.max(0, leftWidth - leftMin);
  const rightCapacity = Math.max(0, rightWidth - rightMin);
  const capacity = leftCapacity + rightCapacity;
  if (!capacity) return { leftWidth, rightWidth };
  const shrink = Math.min(excess, capacity);
  const leftShrink = Math.min(leftCapacity, Math.round(shrink * (leftCapacity / capacity)));
  const rightShrink = Math.min(rightCapacity, shrink - leftShrink);
  return {
    leftWidth: leftWidth - leftShrink,
    rightWidth: rightWidth - rightShrink
  };
};

/**
 * Shared pointer-capture resize primitive used by both workbench layouts.
 * `data` is snapshotted at pointerdown, avoiding stale React state during drag.
 */
export const usePointerResize = ({ onResize, cursor = 'col-resize' }) => {
  const callbackRef = useRef(onResize);
  const dragRef = useRef(null);
  const previousBodyStyleRef = useRef(null);
  const [resizeData, setResizeData] = useState(null);
  callbackRef.current = onResize;

  const restoreBody = useCallback(() => {
    if (!previousBodyStyleRef.current || typeof document === 'undefined') return;
    document.body.style.userSelect = previousBodyStyleRef.current.userSelect;
    document.body.style.cursor = previousBodyStyleRef.current.cursor;
    previousBodyStyleRef.current = null;
  }, []);

  const endPointerResize = useCallback((event) => {
    const drag = dragRef.current;
    if (!drag || (event?.pointerId != null && event.pointerId !== drag.pointerId)) return;
    try {
      if (drag.target?.hasPointerCapture?.(drag.pointerId)) {
        drag.target.releasePointerCapture(drag.pointerId);
      }
    } catch {
      // The browser may already have released capture after pointercancel.
    }
    dragRef.current = null;
    setResizeData(null);
    restoreBody();
  }, [restoreBody]);

  const beginPointerResize = useCallback((event, data) => {
    if (event.button != null && event.button !== 0) return;
    event.preventDefault();
    const target = event.currentTarget;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      target,
      data
    };
    setResizeData(data);
    try {
      target.setPointerCapture?.(event.pointerId);
    } catch {
      // Capture is an enhancement in older embedded Chromium builds.
    }
    if (typeof document !== 'undefined') {
      previousBodyStyleRef.current = {
        userSelect: document.body.style.userSelect,
        cursor: document.body.style.cursor
      };
      document.body.style.userSelect = 'none';
      document.body.style.cursor = cursor;
    }
  }, [cursor]);

  const handlePointerMove = useCallback((event) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    callbackRef.current?.({
      deltaX: event.clientX - drag.startX,
      deltaY: event.clientY - drag.startY,
      data: drag.data,
      event
    });
  }, []);

  useEffect(() => () => {
    dragRef.current = null;
    restoreBody();
  }, [restoreBody]);

  return {
    isResizing: resizeData !== null,
    resizeData,
    resizeHandleProps: {
      onPointerMove: handlePointerMove,
      onPointerUp: endPointerResize,
      onPointerCancel: endPointerResize,
      onLostPointerCapture: endPointerResize
    },
    beginPointerResize
  };
};

const useWorkspaceSessionLayout = ({
  currentProjectPath,
  openTabs,
  activeFile,
  setOpenTabs,
  setActiveFile,
  centerView,
  setCenterView,
  // plan-ia-onglets.md §⑤ 5.5.3 — quel onglet de chat est actif, au même
  // titre qu'activeFile pour les onglets de fichier : plusieurs onglets
  // chat peuvent coexister, il faut savoir lequel restaurer après redémarrage.
  activeChatSessionId = null,
  setActiveChatSessionId = noop
}) => {
  const [leftWidth, setLeftWidth] = useState(DEFAULT_LEFT_WIDTH);
  const [rightWidth, setRightWidth] = useState(DEFAULT_RIGHT_WIDTH);
  const [isLeftCollapsed, setIsLeftCollapsed] = useState(false);
  const [isRightCollapsed, setIsRightCollapsed] = useState(false);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [isChatMaximized, setIsChatMaximized] = useState(false);
  const [layoutWidth, setLayoutWidth] = useState(viewportWidth);
  const [loadedProjectPath, setLoadedProjectPath] = useState(null);

  const layoutNodeRef = useRef(null);
  const [layoutNode, setLayoutNode] = useState(null);
  const layoutRef = useCallback((node) => {
    layoutNodeRef.current = node;
    setLayoutNode(previous => (previous === node ? previous : node));
  }, []);
  const focusBackupRef = useRef({ leftCollapsed: false, rightCollapsed: false });
  const maximizeBackupRef = useRef({ rightCollapsed: false });

  const visibleResizerCount = (leftCollapsed = isLeftCollapsed, rightCollapsed = isRightCollapsed) => (
    Number(!leftCollapsed) + Number(!rightCollapsed)
  );

  const fittedWidths = fitSideWidths({
    availableWidth: layoutWidth - MIN_EDITOR_WIDTH - visibleResizerCount() * RESIZER_WIDTH,
    leftWidth: isLeftCollapsed ? 0 : leftWidth,
    rightWidth: isRightCollapsed ? 0 : rightWidth,
    leftMin: isLeftCollapsed ? 0 : MIN_LEFT_WIDTH,
    rightMin: isRightCollapsed ? 0 : MIN_RIGHT_WIDTH
  });
  const renderedLeftWidth = isLeftCollapsed ? leftWidth : fittedWidths.leftWidth;
  const renderedRightWidth = isRightCollapsed ? rightWidth : fittedWidths.rightWidth;

  const maxLeftWidth = Math.max(
    MIN_LEFT_WIDTH,
    layoutWidth - MIN_EDITOR_WIDTH - (isRightCollapsed ? 0 : renderedRightWidth)
      - visibleResizerCount() * RESIZER_WIDTH
  );
  const maxRightWidth = Math.max(
    MIN_RIGHT_WIDTH,
    layoutWidth - MIN_EDITOR_WIDTH - (isLeftCollapsed ? 0 : renderedLeftWidth)
      - visibleResizerCount() * RESIZER_WIDTH
  );

  useEffect(() => {
    const node = layoutNode;
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
  }, [layoutNode]);

  useEffect(() => {
    if (!activeFile) return;
    setOpenTabs(prev => (
      prev.some(tab => tab.type === 'file' && tab.path === activeFile)
        ? prev
        : [...prev, { type: 'file', path: activeFile }]
    ));
  }, [activeFile, setOpenTabs]);

  useEffect(() => {
    setLoadedProjectPath(null);
    if (!currentProjectPath) return;

    // A project without a saved session must not inherit another project's
    // dimensions or visibility state.
    setLeftWidth(DEFAULT_LEFT_WIDTH);
    setRightWidth(DEFAULT_RIGHT_WIDTH);
    setIsLeftCollapsed(false);
    setIsRightCollapsed(false);
    setIsFocusMode(false);
    setIsChatMaximized(false);
    focusBackupRef.current = { leftCollapsed: false, rightCollapsed: false };

    try {
      const key = `vibeIDE_session:${currentProjectPath}`;
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const parsed = JSON.parse(raw);

      // Vigilance point (plan-ia-onglets.md §③): a session saved before this
      // step persisted openFiles as string[]. normalizeOpenTabs accepts both
      // that legacy shape and the current Tab[] so an existing user's tabs
      // restore without error or loss either way.
      const rawTabs = Array.isArray(parsed.openTabs) ? parsed.openTabs : parsed.openFiles;
      if (Array.isArray(rawTabs)) setOpenTabs(normalizeOpenTabs(rawTabs));
      if (typeof parsed.activeFile === 'string') setActiveFile(parsed.activeFile);
      if (typeof parsed.activeChatSessionId === 'string') setActiveChatSessionId(parsed.activeChatSessionId);
      // Sessions saved before plan-ia-onglets.md §④ may carry a centerView of
      // 'git' | 'ai-changes' | 'brain' — those views moved out of the center
      // and no longer have a pane there. Falling back to 'code' keeps restore
      // from landing on a blank center instead of erroring.
      if (VALID_CENTER_VIEWS.has(parsed.centerView)) setCenterView(parsed.centerView);

      const savedVersion = Number(parsed.layoutDensityVersion || 0);
      const totalWidth = layoutNodeRef.current?.getBoundingClientRect().width || viewportWidth();
      const readWidth = (width, backup, fallback, minimum) => {
        const candidate = Number(width) > 0 ? width : backup;
        const numeric = savedVersion < WORKSPACE_LAYOUT_VERSION
          ? migrateLegacyWidth(candidate, totalWidth, fallback)
          : Number(candidate);
        return Number.isFinite(numeric) && numeric > 0 ? Math.max(minimum, Math.round(numeric)) : fallback;
      };

      setLeftWidth(readWidth(parsed.leftWidth, parsed.leftBackup, DEFAULT_LEFT_WIDTH, MIN_LEFT_WIDTH));
      setRightWidth(readWidth(parsed.rightWidth, parsed.rightBackup, DEFAULT_RIGHT_WIDTH, MIN_RIGHT_WIDTH));
      if (typeof parsed.isLeftCollapsed === 'boolean') setIsLeftCollapsed(parsed.isLeftCollapsed);
      if (typeof parsed.isRightCollapsed === 'boolean') setIsRightCollapsed(parsed.isRightCollapsed);
      if (typeof parsed.isFocusMode === 'boolean') setIsFocusMode(parsed.isFocusMode);
      if (typeof parsed.isChatMaximized === 'boolean') setIsChatMaximized(parsed.isChatMaximized);
      if (parsed.focusBackup && typeof parsed.focusBackup === 'object') {
        focusBackupRef.current = {
          leftCollapsed: Boolean(parsed.focusBackup.leftCollapsed),
          rightCollapsed: Boolean(parsed.focusBackup.rightCollapsed)
        };
      }
    } catch {
      // Ignore broken session data and retain safe defaults.
    } finally {
      // This state update is batched with the hydrated values. The persistence
      // effect therefore cannot overwrite a legacy session with stale values.
      setLoadedProjectPath(currentProjectPath);
    }
  }, [currentProjectPath, setActiveFile, setCenterView, setOpenTabs, setActiveChatSessionId]);

  useEffect(() => {
    if (!currentProjectPath || loadedProjectPath !== currentProjectPath) return;
    try {
      const key = `vibeIDE_session:${currentProjectPath}`;
      const payload = {
        openTabs,
        activeFile,
        activeChatSessionId,
        centerView,
        leftWidth,
        rightWidth,
        // Keep compatibility with older builds while storing pixels in v3.
        leftBackup: leftWidth,
        rightBackup: rightWidth,
        layoutDensityVersion: WORKSPACE_LAYOUT_VERSION,
        isLeftCollapsed,
        isRightCollapsed,
        isFocusMode,
        isChatMaximized,
        focusBackup: focusBackupRef.current
      };
      localStorage.setItem(key, JSON.stringify(payload));
    } catch {
      // localStorage may be unavailable in hardened browser contexts.
    }
  }, [
    currentProjectPath, loadedProjectPath, openTabs, activeFile, activeChatSessionId, centerView,
    leftWidth, rightWidth, isLeftCollapsed, isRightCollapsed, isFocusMode, isChatMaximized
  ]);

  const applyResize = useCallback(({ deltaX, data }) => {
    if (data.type === 'left') {
      setLeftWidth(clamp(Math.round(data.startWidth + deltaX), MIN_LEFT_WIDTH, data.maxWidth));
    } else {
      setRightWidth(clamp(Math.round(data.startWidth - deltaX), MIN_RIGHT_WIDTH, data.maxWidth));
    }
  }, []);
  const pointerResize = usePointerResize({ onResize: applyResize });

  const handleDragStart = useCallback((event, type) => {
    pointerResize.beginPointerResize(event, {
      type,
      startWidth: type === 'left' ? renderedLeftWidth : renderedRightWidth,
      maxWidth: type === 'left' ? maxLeftWidth : maxRightWidth
    });
  }, [renderedLeftWidth, renderedRightWidth, maxLeftWidth, maxRightWidth, pointerResize]);

  const resizeStep = useCallback((type, deltaPx) => {
    if (type === 'left') {
      setLeftWidth(width => clamp(width + deltaPx, MIN_LEFT_WIDTH, maxLeftWidth));
    } else {
      setRightWidth(width => clamp(width + deltaPx, MIN_RIGHT_WIDTH, maxRightWidth));
    }
  }, [maxLeftWidth, maxRightWidth]);

  const collapseLeft = useCallback(() => setIsLeftCollapsed(true), []);
  const collapseRight = useCallback(() => setIsRightCollapsed(true), []);

  const toggleLeftPanel = useCallback(() => {
    setIsLeftCollapsed(value => !value);
    setIsFocusMode(false);
    setIsChatMaximized(false);
  }, []);

  const toggleRightPanel = useCallback(() => {
    setIsRightCollapsed(value => !value);
    setIsFocusMode(false);
    setIsChatMaximized(false);
  }, []);

  const toggleChatMaximize = useCallback(() => {
    setIsChatMaximized(value => {
      if (value) {
        setIsRightCollapsed(maximizeBackupRef.current.rightCollapsed);
      } else {
        maximizeBackupRef.current = { rightCollapsed: isRightCollapsed };
        setIsRightCollapsed(false);
      }
      return !value;
    });
    setIsFocusMode(false);
  }, [isRightCollapsed]);

  const toggleFocusMode = useCallback(() => {
    setIsChatMaximized(false);
    setIsFocusMode(value => {
      if (value) {
        setIsLeftCollapsed(focusBackupRef.current.leftCollapsed);
        setIsRightCollapsed(focusBackupRef.current.rightCollapsed);
      } else {
        focusBackupRef.current = {
          leftCollapsed: isLeftCollapsed,
          rightCollapsed: isRightCollapsed
        };
        collapseLeft();
        collapseRight();
      }
      return !value;
    });
  }, [collapseLeft, collapseRight, isLeftCollapsed, isRightCollapsed]);

  const occupiedWidth = (isLeftCollapsed ? 0 : renderedLeftWidth)
    + (isRightCollapsed ? 0 : renderedRightWidth)
    + visibleResizerCount() * RESIZER_WIDTH;

  return {
    layoutRef,
    leftWidth: renderedLeftWidth,
    rightWidth: renderedRightWidth,
    middleWidth: Math.max(MIN_EDITOR_WIDTH, layoutWidth - occupiedWidth),
    leftMinWidth: MIN_LEFT_WIDTH,
    leftMaxWidth: maxLeftWidth,
    rightMinWidth: MIN_RIGHT_WIDTH,
    rightMaxWidth: maxRightWidth,
    editorMinWidth: MIN_EDITOR_WIDTH,
    isLeftCollapsed,
    isRightCollapsed,
    isFocusMode,
    isChatMaximized,
    dragging: pointerResize.resizeData?.type || null,
    resizeHandleProps: pointerResize.resizeHandleProps,
    handleDragStart,
    resizeStep,
    toggleLeftPanel,
    toggleRightPanel,
    toggleChatMaximize,
    toggleFocusMode
  };
};

export default useWorkspaceSessionLayout;
