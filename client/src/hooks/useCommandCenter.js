import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const useCommandCenter = ({
  currentProjectPath,
  isElectronApiAvailable,
  showMessage,
  openFiles,
  openFile,
  setCenterView,
  handleOpenFolder,
  isLeftCollapsed,
  isRightCollapsed,
  isFocusMode,
  toggleLeftPanel,
  toggleRightPanel,
  toggleFocusMode,
  setIsTerminalOpen,
  setExecutionMode,
  handleAiProviderChange,
  aiProvider,
  previewStatus,
  handleTogglePreview,
  setWorkflowManagerOpen,
  setSettingsOpen,
  startNewConversation,
  saveConversation,
  deepContextEnabled,
  setDeepContextEnabled
}) => {
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const [commandIndex, setCommandIndex] = useState(0);
  const [filePaletteOpen, setFilePaletteOpen] = useState(false);
  const [filePaletteQuery, setFilePaletteQuery] = useState('');
  const [filePaletteIndex, setFilePaletteIndex] = useState(0);
  const [projectFileList, setProjectFileList] = useState([]);
  const [isProjectFileListLoading, setIsProjectFileListLoading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchIndex, setSearchIndex] = useState(0);
  const [searchResults, setSearchResults] = useState([]);
  const [isSearchLoading, setIsSearchLoading] = useState(false);
  const [symbolOpen, setSymbolOpen] = useState(false);
  const [symbolQuery, setSymbolQuery] = useState('');
  const [symbolIndex, setSymbolIndex] = useState(0);
  const [symbolResults, setSymbolResults] = useState([]);
  const [isSymbolLoading, setIsSymbolLoading] = useState(false);

  const commandInputRef = useRef(null);
  const filePaletteInputRef = useRef(null);
  const searchInputRef = useRef(null);
  const symbolInputRef = useRef(null);
  const fileListCacheRef = useRef({ projectPath: '', files: [] });

  const ensureProjectFileList = useCallback(async () => {
    if (!currentProjectPath || !isElectronApiAvailable || !window.electronAPI?.listProjectFiles) {
      return [];
    }

    const cached = fileListCacheRef.current;
    if (cached.projectPath === currentProjectPath && Array.isArray(cached.files) && cached.files.length > 0) {
      if (projectFileList.length === 0) {
        setProjectFileList(cached.files);
      }
      return cached.files;
    }

    setIsProjectFileListLoading(true);
    try {
      const res = await window.electronAPI.listProjectFiles(currentProjectPath, {
        includeHidden: true,
        includeSecrets: false,
        includeGit: true,
        includeNodeModules: false,
        includeBuild: false,
        maxFiles: 60000,
        maxDepth: 60
      });

      if (res?.success && Array.isArray(res.files)) {
        fileListCacheRef.current = { projectPath: currentProjectPath, files: res.files };
        setProjectFileList(res.files);
        return res.files;
      }

      const msg = res?.error ? String(res.error) : 'Indexation impossible';
      showMessage(`Index fichiers: ${msg}`, 4000);
      return [];
    } catch (error) {
      showMessage(`Index fichiers: ${error.message}`, 4000);
      return [];
    } finally {
      setIsProjectFileListLoading(false);
    }
  }, [currentProjectPath, isElectronApiAvailable, projectFileList.length, showMessage]);

  useEffect(() => {
    fileListCacheRef.current = { projectPath: '', files: [] };
    setProjectFileList([]);
  }, [currentProjectPath]);

  const commands = useMemo(() => ([
    {
      id: 'open-folder',
      label: 'Ouvrir un dossier',
      hint: 'Ctrl+O',
      action: handleOpenFolder
    },
    {
      id: 'quick-open',
      label: 'Ouvrir un fichier...',
      hint: 'Ctrl+P',
      action: () => {
        setFilePaletteOpen(true);
        setSearchOpen(false);
      }
    },
    {
      id: 'global-search',
      label: 'Recherche globale',
      hint: 'Ctrl+Shift+F',
      action: () => {
        setSearchOpen(true);
        setFilePaletteOpen(false);
        setSymbolOpen(false);
      }
    },
    {
      id: 'symbol-search',
      label: 'Recherche de symboles',
      hint: 'Ctrl+T',
      action: () => {
        setSymbolOpen(true);
        setSearchOpen(false);
        setFilePaletteOpen(false);
      }
    },
    {
      id: 'toggle-left',
      label: isLeftCollapsed ? 'Afficher le Navigator' : 'Masquer le Navigator',
      action: toggleLeftPanel
    },
    {
      id: 'toggle-right',
      label: isRightCollapsed ? 'Afficher le panneau IA' : 'Masquer le panneau IA',
      action: toggleRightPanel
    },
    {
      id: 'focus',
      label: isFocusMode ? 'Quitter le mode Focus' : 'Mode Focus',
      action: toggleFocusMode
    },
    {
      id: 'view-code',
      label: 'Vue Code',
      action: () => setCenterView('code')
    },
    {
      id: 'view-preview',
      label: 'Vue Preview',
      action: () => setCenterView('preview')
    },
    {
      id: 'view-terminal',
      label: 'Toggle Terminal',
      action: () => setIsTerminalOpen(prev => !prev)
    },
    {
      id: 'view-git',
      label: 'Vue Git',
      action: () => setCenterView('git')
    },
    {
      id: 'view-brain',
      label: 'Vue Brain Graph',
      action: () => setCenterView('brain')
    },
    {
      id: 'mode-plan',
      label: 'Mode IA Plan',
      action: () => setExecutionMode('plan')
    },
    {
      id: 'mode-multi-agent',
      label: 'Mode IA Multi-Agent',
      action: () => {
        setExecutionMode('multi-agent');
        handleAiProviderChange('multi');
      }
    },
    {
      id: 'toggle-preview',
      label: previewStatus === 'running' ? 'Arreter la Preview' : 'Demarrer la Preview',
      action: handleTogglePreview
    },
    {
      id: 'workflow',
      label: 'Ouvrir Workflows',
      action: () => setWorkflowManagerOpen(true)
    },
    {
      id: 'settings',
      label: 'Ouvrir Settings',
      action: () => setSettingsOpen(true)
    },
    {
      id: 'new-conv',
      label: 'Nouvelle conversation IA',
      action: () => startNewConversation && startNewConversation()
    },
    {
      id: 'save-conv',
      label: 'Sauver la conversation IA',
      action: () => saveConversation && saveConversation()
    },
    {
      id: 'toggle-ai-context',
      label: deepContextEnabled ? 'IA: Contexte projet OFF' : 'IA: Contexte projet ON',
      action: () => {
        setDeepContextEnabled(prev => {
          const next = !prev;
          showMessage(`IA: Contexte projet ${next ? 'ON' : 'OFF'}`, 2000);
          return next;
        });
      }
    }
  ]), [
    handleOpenFolder,
    isLeftCollapsed,
    isRightCollapsed,
    isFocusMode,
    toggleLeftPanel,
    toggleRightPanel,
    toggleFocusMode,
    setCenterView,
    setIsTerminalOpen,
    setExecutionMode,
    handleAiProviderChange,
    aiProvider,
    previewStatus,
    handleTogglePreview,
    setWorkflowManagerOpen,
    setSettingsOpen,
    startNewConversation,
    saveConversation,
    deepContextEnabled,
    setDeepContextEnabled,
    showMessage
  ]);

  const filteredCommands = useMemo(() => {
    const q = commandQuery.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((cmd) => cmd.label.toLowerCase().includes(q));
  }, [commandQuery, commands]);

  useEffect(() => {
    if (!commandOpen) return;
    setCommandIndex(0);
    setTimeout(() => commandInputRef.current?.focus(), 0);
  }, [commandOpen]);

  useEffect(() => {
    if (commandIndex >= filteredCommands.length) {
      setCommandIndex(0);
    }
  }, [filteredCommands, commandIndex]);

  const filteredFiles = useMemo(() => {
    const qRaw = filePaletteQuery.trim();
    if (!qRaw) {
      const seen = new Set();
      const items = [];

      for (let i = openFiles.length - 1; i >= 0; i -= 1) {
        const filePath = openFiles[i];
        if (!filePath || seen.has(filePath)) continue;
        seen.add(filePath);
        items.push({ id: filePath, label: String(filePath), hint: 'tab' });
        if (items.length >= 40) break;
      }

      for (const filePath of projectFileList) {
        if (!filePath || seen.has(filePath)) continue;
        seen.add(filePath);
        items.push({ id: filePath, label: String(filePath) });
        if (items.length >= 120) break;
      }

      return items;
    }

    const q = qRaw.toLowerCase();
    const tokens = q.split(/\s+/).filter(Boolean);
    const normalize = (value) => String(value || '').replace(/\\/g, '/').toLowerCase();
    const scoreCandidate = (candidate) => {
      const hay = normalize(candidate);
      let score = 0;

      for (const token of tokens) {
        const idx = hay.indexOf(token);
        if (idx === -1) return null;
        score += idx * 4 + token.length;
      }

      const lastToken = tokens[tokens.length - 1];
      if (lastToken && hay.endsWith(lastToken)) score -= 3;

      const base = hay.split('/').pop() || hay;
      if (tokens.some(t => base.startsWith(t))) score -= 6;

      score += Math.min(60, hay.length * 0.05);
      return score;
    };

    const scored = [];
    for (const filePath of projectFileList) {
      const score = scoreCandidate(filePath);
      if (score === null) continue;
      scored.push({ id: filePath, label: String(filePath), score });
    }

    scored.sort((a, b) => a.score - b.score);
    return scored.slice(0, 180);
  }, [filePaletteQuery, projectFileList, openFiles]);

  useEffect(() => {
    if (!filePaletteOpen) return;
    setFilePaletteIndex(0);
    ensureProjectFileList();
    setTimeout(() => filePaletteInputRef.current?.focus(), 0);
  }, [filePaletteOpen, ensureProjectFileList]);

  useEffect(() => {
    if (filePaletteIndex >= filteredFiles.length) {
      setFilePaletteIndex(0);
    }
  }, [filteredFiles, filePaletteIndex]);

  useEffect(() => {
    if (!searchOpen) return;
    setSearchIndex(0);
    setTimeout(() => searchInputRef.current?.focus(), 0);
  }, [searchOpen]);

  useEffect(() => {
    if (searchIndex >= searchResults.length) {
      setSearchIndex(0);
    }
  }, [searchResults, searchIndex]);

  useEffect(() => {
    if (!symbolOpen) return;
    setSymbolIndex(0);
    setTimeout(() => symbolInputRef.current?.focus(), 0);
  }, [symbolOpen]);

  useEffect(() => {
    if (symbolIndex >= symbolResults.length) {
      setSymbolIndex(0);
    }
  }, [symbolResults, symbolIndex]);

  useEffect(() => {
    if (!searchOpen) return;

    const query = searchQuery.trim();
    if (!query) {
      setSearchResults([]);
      setIsSearchLoading(false);
      return;
    }

    if (!currentProjectPath || !isElectronApiAvailable || !window.electronAPI?.searchInProject) {
      return;
    }

    let cancelled = false;
    setIsSearchLoading(true);

    const timer = setTimeout(async () => {
      try {
        const res = await window.electronAPI.searchInProject(currentProjectPath, query, {
          includeHidden: true,
          includeSecrets: false,
          includeGit: true,
          includeNodeModules: false,
          includeBuild: false,
          caseSensitive: false,
          maxMatches: 1200,
          maxFileSize: 800000,
          maxDepth: 60
        });

        if (cancelled) return;

        if (res?.success && Array.isArray(res.results)) {
          setSearchResults(res.results);
        } else {
          setSearchResults([]);
          const msg = res?.error ? String(res.error) : 'Recherche impossible';
          showMessage(`Recherche: ${msg}`, 3500);
        }
      } catch (error) {
        if (cancelled) return;
        setSearchResults([]);
        showMessage(`Recherche: ${error.message}`, 3500);
      } finally {
        if (!cancelled) setIsSearchLoading(false);
      }
    }, 220);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchQuery, searchOpen, currentProjectPath, isElectronApiAvailable, showMessage]);

  useEffect(() => {
    if (!symbolOpen) return;

    const query = symbolQuery.trim();
    if (!query) {
      setSymbolResults([]);
      setIsSymbolLoading(false);
      return;
    }

    if (!currentProjectPath || !isElectronApiAvailable || !window.electronAPI?.searchSymbols) {
      return;
    }

    let cancelled = false;
    setIsSymbolLoading(true);

    const timer = setTimeout(async () => {
      try {
        const res = await window.electronAPI.searchSymbols(currentProjectPath, query, {
          maxResults: 250,
          maxDepth: 40
        });

        if (cancelled) return;

        if (res?.success && Array.isArray(res.results)) {
          setSymbolResults(res.results);
        } else {
          setSymbolResults([]);
          const msg = res?.error ? String(res.error) : 'Recherche de symboles impossible';
          showMessage(`Symboles: ${msg}`, 3500);
        }
      } catch (error) {
        if (cancelled) return;
        setSymbolResults([]);
        showMessage(`Symboles: ${error.message}`, 3500);
      } finally {
        if (!cancelled) setIsSymbolLoading(false);
      }
    }, 180);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [symbolQuery, symbolOpen, currentProjectPath, isElectronApiAvailable, showMessage]);

  useEffect(() => {
    const handleGlobalKeys = (event) => {
      const target = event?.target;
      const tagName = String(target?.tagName || '').toLowerCase();
      if (target?.isContentEditable || tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
        return;
      }

      const key = String(event?.key || '').toLowerCase();
      if (!key) return;

      if ((event.ctrlKey || event.metaKey) && key === 'k') {
        event.preventDefault();
        setCommandOpen(true);
        setFilePaletteOpen(false);
        setSearchOpen(false);
        setSymbolOpen(false);
      }
      if ((event.ctrlKey || event.metaKey) && key === 'p') {
        event.preventDefault();
        setFilePaletteOpen(true);
        setCommandOpen(false);
        setSearchOpen(false);
        setSymbolOpen(false);
      }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && key === 'f') {
        event.preventDefault();
        setSearchOpen(true);
        setCommandOpen(false);
        setFilePaletteOpen(false);
        setSymbolOpen(false);
      }
      if ((event.ctrlKey || event.metaKey) && key === 't') {
        event.preventDefault();
        setSymbolOpen(true);
        setCommandOpen(false);
        setFilePaletteOpen(false);
        setSearchOpen(false);
      }
      if (key === 'escape') {
        setCommandOpen(false);
        setFilePaletteOpen(false);
        setSearchOpen(false);
        setSymbolOpen(false);
      }
    };

    window.addEventListener('keydown', handleGlobalKeys);
    return () => window.removeEventListener('keydown', handleGlobalKeys);
  }, []);

  const runCommand = useCallback((cmd) => {
    if (!cmd || typeof cmd.action !== 'function') return;
    cmd.action();
    setCommandOpen(false);
    setCommandQuery('');
  }, []);

  const runFilePick = useCallback((filePath) => {
    if (!filePath) return;
    openFile(filePath);
    setFilePaletteOpen(false);
    setFilePaletteQuery('');
  }, [openFile]);

  const runSearchPick = useCallback((result) => {
    if (!result || !result.file) return;
    openFile(result.file, {
      reveal: {
        line: result.line,
        column: result.column
      }
    });
    setCenterView('code');
    setSearchOpen(false);
  }, [openFile, setCenterView]);

  const runSymbolPick = useCallback((result) => {
    if (!result || !result.file) return;
    openFile(result.file, {
      reveal: {
        line: result.line,
        column: result.column
      }
    });
    setCenterView('code');
    setSymbolOpen(false);
  }, [openFile, setCenterView]);

  const handleCommandKey = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!filteredCommands.length) return;
      setCommandIndex((prev) => Math.min(prev + 1, filteredCommands.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!filteredCommands.length) return;
      setCommandIndex((prev) => Math.max(prev - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (!filteredCommands.length) return;
      const cmd = filteredCommands[commandIndex] || filteredCommands[0];
      runCommand(cmd);
    } else if (event.key === 'Escape') {
      setCommandOpen(false);
    }
  };

  const handleFilePaletteKey = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!filteredFiles.length) return;
      setFilePaletteIndex((prev) => Math.min(prev + 1, filteredFiles.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!filteredFiles.length) return;
      setFilePaletteIndex((prev) => Math.max(prev - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (!filteredFiles.length) return;
      const item = filteredFiles[filePaletteIndex] || filteredFiles[0];
      runFilePick(item?.id);
    } else if (event.key === 'Escape') {
      setFilePaletteOpen(false);
    }
  };

  const handleSearchKey = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!searchResults.length) return;
      setSearchIndex((prev) => Math.min(prev + 1, searchResults.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!searchResults.length) return;
      setSearchIndex((prev) => Math.max(prev - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (!searchResults.length) return;
      const item = searchResults[searchIndex] || searchResults[0];
      runSearchPick(item);
    } else if (event.key === 'Escape') {
      setSearchOpen(false);
    }
  };

  const handleSymbolKey = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!symbolResults.length) return;
      setSymbolIndex((prev) => Math.min(prev + 1, symbolResults.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!symbolResults.length) return;
      setSymbolIndex((prev) => Math.max(prev - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (!symbolResults.length) return;
      const item = symbolResults[symbolIndex] || symbolResults[0];
      runSymbolPick(item);
    } else if (event.key === 'Escape') {
      setSymbolOpen(false);
    }
  };

  return {
    projectFileList,
    openCommandPalette: () => setCommandOpen(true),
    overlayProps: {
      commandOpen,
      commandInputRef,
      commandQuery,
      setCommandQuery,
      handleCommandKey,
      filteredCommands,
      commandIndex,
      runCommand,
      closeCommand: () => setCommandOpen(false),
      filePaletteOpen,
      filePaletteInputRef,
      filePaletteQuery,
      setFilePaletteQuery,
      handleFilePaletteKey,
      isProjectFileListLoading,
      filteredFiles,
      filePaletteIndex,
      runFilePick,
      closeFilePalette: () => setFilePaletteOpen(false),
      searchOpen,
      searchInputRef,
      searchQuery,
      setSearchQuery,
      handleSearchKey,
      isSearchLoading,
      searchResults,
      searchIndex,
      runSearchPick,
      closeSearch: () => setSearchOpen(false),
      symbolOpen,
      symbolInputRef,
      symbolQuery,
      setSymbolQuery,
      handleSymbolKey,
      isSymbolLoading,
      symbolResults,
      symbolIndex,
      runSymbolPick,
      closeSymbol: () => setSymbolOpen(false)
    }
  };
};

export default useCommandCenter;
