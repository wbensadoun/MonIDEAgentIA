import { useCallback, useEffect, useState } from 'react';
import useUIStore from '../stores/uiStore';

const useAppUiState = ({
  currentProjectPath,
  isElectronApiAvailable,
  devPort,
  showMessage
}) => {
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem('futurIA_theme') || 'midnight';
    } catch {
      return 'midnight';
    }
  });
  const [isExpertMode, setIsExpertMode] = useState(() => {
    try {
      return localStorage.getItem('vibeIDE_expertMode') === '1';
    } catch {
      return false;
    }
  });
  const [previewStatus, setPreviewStatus] = useState('stopped');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [workflowManagerOpen, setWorkflowManagerOpen] = useState(false);
  const [centerView, setCenterView] = useState('code');
  const [isTerminalOpen, setIsTerminalOpen] = useState(false);
  const [runtimeDevPort, setRuntimeDevPort] = useState('');

  useEffect(() => {
    try {
      localStorage.setItem('futurIA_theme', theme);
    } catch {
      // ignore
    }
    document.body.className = `theme-${theme}`;
  }, [theme]);

  useEffect(() => {
    try {
      localStorage.setItem('vibeIDE_expertMode', isExpertMode ? '1' : '0');
    } catch {
      // ignore
    }
  }, [isExpertMode]);

  useEffect(() => {
    if (!isElectronApiAvailable) return undefined;
    if (!window.electronAPI || typeof window.electronAPI.onMenuOpenSettings !== 'function') return undefined;
    const offMenuOpenSettings = window.electronAPI.onMenuOpenSettings(() => {
      setSettingsOpen(true);
    });
    return () => {
      if (typeof offMenuOpenSettings === 'function') offMenuOpenSettings();
    };
  }, [isElectronApiAvailable]);

  useEffect(() => {
    setRuntimeDevPort('');
  }, [currentProjectPath]);

  const handleTogglePreview = useCallback(() => {
    if (previewStatus === 'running') {
      setPreviewStatus('stopped');
      showMessage('Preview arretee', 2000);
    } else {
      setPreviewStatus('running');
      showMessage('Preview demarree', 2000);
    }
  }, [previewStatus, showMessage]);

  const handlePreviewRefresh = useCallback(() => {
    showMessage('Preview rafraichie', 1500);
  }, [showMessage]);

  const toggleExpertMode = useCallback(() => {
    setIsExpertMode((prev) => !prev);
  }, []);

  const toggleTerminal = useCallback(() => {
    setIsTerminalOpen((prev) => !prev);
  }, []);

  const previewPort = String(runtimeDevPort || devPort || '3004');

  // Sync key UI state to uiStore for deep components
  useEffect(() => { useUIStore.getState().setTheme(theme); }, [theme]);
  useEffect(() => { useUIStore.getState().setCenterView(centerView); }, [centerView]);
  useEffect(() => { useUIStore.getState().setSettingsOpen(settingsOpen); }, [settingsOpen]);
  useEffect(() => { useUIStore.getState().setIsTerminalOpen(isTerminalOpen); }, [isTerminalOpen]);

  return {
    theme,
    setTheme,
    isExpertMode,
    toggleExpertMode,
    previewStatus,
    settingsOpen,
    setSettingsOpen,
    openSettings: () => setSettingsOpen(true),
    closeSettings: () => setSettingsOpen(false),
    workflowManagerOpen,
    setWorkflowManagerOpen,
    openWorkflowManager: () => setWorkflowManagerOpen(true),
    closeWorkflowManager: () => setWorkflowManagerOpen(false),
    centerView,
    setCenterView,
    isTerminalOpen,
    setIsTerminalOpen,
    toggleTerminal,
    runtimeDevPort,
    setRuntimeDevPort,
    previewUrl: `http://localhost:${previewPort}`,
    handleTogglePreview,
    handlePreviewRefresh
  };
};

export default useAppUiState;
