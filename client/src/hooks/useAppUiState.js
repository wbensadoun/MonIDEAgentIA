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
      return localStorage.getItem('code_companion_theme') || 'midnight';
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
  // Which tool the bottom Panel shows — Terminal or Brain (plan-ia-onglets.md §④).
  const [bottomPanelTab, setBottomPanelTab] = useState('terminal');
  const [runtimeDevPort, setRuntimeDevPort] = useState('');

  useEffect(() => {
    try {
      localStorage.setItem('code_companion_theme', theme);
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

  // Paramètres : onglet singleton, plus une modale (plan-ia-onglets.md §④).
  // L'ouvrir bascule aussi le centre dessus ; le fermer y renonce seulement
  // s'il y était (sinon on couperait la vue d'un autre onglet).
  const openSettings = useCallback(() => {
    setSettingsOpen(true);
    setCenterView('settings');
  }, []);
  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    setCenterView((prev) => (prev === 'settings' ? 'code' : prev));
  }, []);

  useEffect(() => {
    if (!isElectronApiAvailable) return undefined;
    if (!window.electronAPI || typeof window.electronAPI.onMenuOpenSettings !== 'function') return undefined;
    const offMenuOpenSettings = window.electronAPI.onMenuOpenSettings(() => {
      openSettings();
    });
    return () => {
      if (typeof offMenuOpenSettings === 'function') offMenuOpenSettings();
    };
  }, [isElectronApiAvailable, openSettings]);

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
    openSettings,
    closeSettings,
    workflowManagerOpen,
    setWorkflowManagerOpen,
    openWorkflowManager: () => setWorkflowManagerOpen(true),
    closeWorkflowManager: () => setWorkflowManagerOpen(false),
    centerView,
    setCenterView,
    isTerminalOpen,
    setIsTerminalOpen,
    toggleTerminal,
    bottomPanelTab,
    setBottomPanelTab,
    runtimeDevPort,
    setRuntimeDevPort,
    previewUrl: `http://localhost:${previewPort}`,
    handleTogglePreview,
    handlePreviewRefresh
  };
};

export default useAppUiState;
