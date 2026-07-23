import { useCallback, useEffect, useRef, useState } from 'react';

const DEFAULT_LEFT_WIDTH = 20;
const DEFAULT_RIGHT_WIDTH = 22;
const LAYOUT_DENSITY_VERSION = 2;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const normalizeSavedWidth = (value, oldMin, oldMax, nextDefault, shouldAdoptNewDensity) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  if (shouldAdoptNewDensity && numeric >= oldMin && numeric <= oldMax) {
    return nextDefault;
  }
  return numeric;
};

const useWorkspaceSessionLayout = ({
  currentProjectPath,
  openFiles,
  activeFile,
  setOpenFiles,
  setActiveFile,
  centerView,
  setCenterView
}) => {
  const [leftWidth, setLeftWidth] = useState(DEFAULT_LEFT_WIDTH);
  const [rightWidth, setRightWidth] = useState(DEFAULT_RIGHT_WIDTH);
  const [leftBackup, setLeftBackup] = useState(DEFAULT_LEFT_WIDTH);
  const [rightBackup, setRightBackup] = useState(DEFAULT_RIGHT_WIDTH);
  const [isLeftCollapsed, setIsLeftCollapsed] = useState(false);
  const [isRightCollapsed, setIsRightCollapsed] = useState(false);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [dragging, setDragging] = useState(null);
  const [dragStartX, setDragStartX] = useState(0);
  const [startWidths, setStartWidths] = useState({ left: DEFAULT_LEFT_WIDTH, right: DEFAULT_RIGHT_WIDTH });

  const layoutRef = useRef(null);
  const sessionLoadedRef = useRef(false);

  useEffect(() => {
    if (!activeFile) return;
    setOpenFiles(prev => (prev.includes(activeFile) ? prev : [...prev, activeFile]));
  }, [activeFile, setOpenFiles]);

  useEffect(() => {
    sessionLoadedRef.current = false;
    if (!currentProjectPath) return;

    try {
      const key = `vibeIDE_session:${currentProjectPath}`;
      const raw = localStorage.getItem(key);
      if (!raw) {
        sessionLoadedRef.current = true;
        return;
      }
      const parsed = JSON.parse(raw);

      if (Array.isArray(parsed.openFiles)) setOpenFiles(parsed.openFiles);
      if (typeof parsed.activeFile === 'string') setActiveFile(parsed.activeFile);
      if (typeof parsed.centerView === 'string') setCenterView(parsed.centerView);

      const savedLayoutVersion = Number(parsed.layoutDensityVersion || 0);
      const shouldAdoptNewDensity = savedLayoutVersion < LAYOUT_DENSITY_VERSION;
      const savedLeftWidth = normalizeSavedWidth(parsed.leftWidth, 20, 24, DEFAULT_LEFT_WIDTH, shouldAdoptNewDensity);
      const savedRightWidth = normalizeSavedWidth(parsed.rightWidth, 26, 30, DEFAULT_RIGHT_WIDTH, shouldAdoptNewDensity);
      const savedLeftBackup = normalizeSavedWidth(parsed.leftBackup, 20, 24, DEFAULT_LEFT_WIDTH, shouldAdoptNewDensity);
      const savedRightBackup = normalizeSavedWidth(parsed.rightBackup, 26, 30, DEFAULT_RIGHT_WIDTH, shouldAdoptNewDensity);

      if (savedLeftWidth !== null) setLeftWidth(savedLeftWidth);
      if (savedRightWidth !== null) setRightWidth(savedRightWidth);
      if (savedLeftBackup !== null) setLeftBackup(savedLeftBackup);
      if (savedRightBackup !== null) setRightBackup(savedRightBackup);
      if (typeof parsed.isLeftCollapsed === 'boolean') setIsLeftCollapsed(parsed.isLeftCollapsed);
      if (typeof parsed.isRightCollapsed === 'boolean') setIsRightCollapsed(parsed.isRightCollapsed);
      if (typeof parsed.isFocusMode === 'boolean') setIsFocusMode(parsed.isFocusMode);
    } catch {
      // ignore broken session
    } finally {
      sessionLoadedRef.current = true;
    }
  }, [currentProjectPath, setActiveFile, setCenterView, setOpenFiles]);

  useEffect(() => {
    if (!currentProjectPath) return;
    if (!sessionLoadedRef.current) return;
    try {
      const key = `vibeIDE_session:${currentProjectPath}`;
      const payload = {
        openFiles,
        activeFile,
        centerView,
        leftWidth,
        rightWidth,
        leftBackup,
        rightBackup,
        layoutDensityVersion: LAYOUT_DENSITY_VERSION,
        isLeftCollapsed,
        isRightCollapsed,
        isFocusMode
      };
      localStorage.setItem(key, JSON.stringify(payload));
    } catch {
      // ignore
    }
  }, [
    currentProjectPath,
    openFiles,
    activeFile,
    centerView,
    leftWidth,
    rightWidth,
    leftBackup,
    rightBackup,
    isLeftCollapsed,
    isRightCollapsed,
    isFocusMode
  ]);

  useEffect(() => {
    if (!dragging) return;

    const handleMouseMove = (e) => {
      if (e.buttons === 0) {
        setDragging(null);
        return;
      }

      if (!layoutRef.current) return;
      const rect = layoutRef.current.getBoundingClientRect();
      const totalWidth = rect.width;
      if (!totalWidth) return;

      const deltaPercent = ((e.clientX - dragStartX) / totalWidth) * 100;
      const minLeft = 15;
      const minRight = 18;
      const minMiddle = 42;

      if (dragging === 'left') {
        let newLeft = clamp(startWidths.left + deltaPercent, minLeft, 100 - minMiddle - startWidths.right);
        const middle = 100 - newLeft - startWidths.right;
        if (middle < minMiddle) {
          newLeft = 100 - minMiddle - startWidths.right;
        }
        setLeftWidth(newLeft);
        setLeftBackup(newLeft);
      } else if (dragging === 'right') {
        let newRight = clamp(startWidths.right - deltaPercent, minRight, 100 - minMiddle - startWidths.left);
        const middle = 100 - startWidths.left - newRight;
        if (middle < minMiddle) {
          newRight = 100 - minMiddle - startWidths.left;
        }
        setRightWidth(newRight);
        setRightBackup(newRight);
      }
    };

    const handleMouseUp = () => {
      setDragging(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragging, dragStartX, startWidths]);

  const handleDragStart = useCallback((e, type) => {
    e.preventDefault();
    setDragging(type);
    setDragStartX(e.clientX);
    setStartWidths({ left: leftWidth, right: rightWidth });
  }, [leftWidth, rightWidth]);

  /** Keyboard-accessible equivalent of a mouse drag: nudge a panel by `deltaPercent`. */
  const resizeStep = useCallback((type, deltaPercent) => {
    const minLeft = 15;
    const minRight = 18;
    const minMiddle = 42;

    if (type === 'left') {
      let newLeft = clamp(leftWidth + deltaPercent, minLeft, 100 - minMiddle - rightWidth);
      const middle = 100 - newLeft - rightWidth;
      if (middle < minMiddle) newLeft = 100 - minMiddle - rightWidth;
      setLeftWidth(newLeft);
      setLeftBackup(newLeft);
    } else if (type === 'right') {
      let newRight = clamp(rightWidth - deltaPercent, minRight, 100 - minMiddle - leftWidth);
      const middle = 100 - leftWidth - newRight;
      if (middle < minMiddle) newRight = 100 - minMiddle - leftWidth;
      setRightWidth(newRight);
      setRightBackup(newRight);
    }
  }, [leftWidth, rightWidth]);

  const collapseLeft = useCallback(() => {
    setLeftBackup(leftWidth || leftBackup);
    setLeftWidth(0);
    setIsLeftCollapsed(true);
  }, [leftWidth, leftBackup]);

  const collapseRight = useCallback(() => {
    setRightBackup(rightWidth || rightBackup);
    setRightWidth(0);
    setIsRightCollapsed(true);
  }, [rightWidth, rightBackup]);

  const expandLeft = useCallback(() => {
    setLeftWidth(leftBackup || DEFAULT_LEFT_WIDTH);
    setIsLeftCollapsed(false);
  }, [leftBackup]);

  const expandRight = useCallback(() => {
    setRightWidth(rightBackup || DEFAULT_RIGHT_WIDTH);
    setIsRightCollapsed(false);
  }, [rightBackup]);

  const toggleLeftPanel = useCallback(() => {
    if (isLeftCollapsed) {
      expandLeft();
    } else {
      collapseLeft();
    }
    setIsFocusMode(false);
  }, [isLeftCollapsed, expandLeft, collapseLeft]);

  const toggleRightPanel = useCallback(() => {
    if (isRightCollapsed) {
      expandRight();
    } else {
      collapseRight();
    }
    setIsFocusMode(false);
  }, [isRightCollapsed, expandRight, collapseRight]);

  const toggleFocusMode = useCallback(() => {
    if (!isFocusMode) {
      collapseLeft();
      collapseRight();
      setIsFocusMode(true);
    } else {
      expandLeft();
      expandRight();
      setIsFocusMode(false);
    }
  }, [isFocusMode, collapseLeft, collapseRight, expandLeft, expandRight]);

  return {
    layoutRef,
    leftWidth,
    rightWidth,
    middleWidth: Math.max(0, 100 - leftWidth - rightWidth),
    isLeftCollapsed,
    isRightCollapsed,
    isFocusMode,
    dragging,
    handleDragStart,
    resizeStep,
    toggleLeftPanel,
    toggleRightPanel,
    toggleFocusMode
  };
};

export default useWorkspaceSessionLayout;
