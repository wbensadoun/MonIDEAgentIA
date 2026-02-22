import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import './App.css';
import ErrorBoundary from './components/ErrorBoundary';
import FileExplorer from './components/FileExplorer';
import CodeEditor from './components/CodeEditor';
import AIChat from './components/AIChat';
import LivePreview from './components/LivePreview';
import Settings from './components/Settings';
import TerminalPanel from './components/TerminalPanel';
import useElectronAPI from './hooks/useElectronAPI';
import useFileOperations from './hooks/useFileOperations';
import useAI from './hooks/useAI';
import useWorkflows from './hooks/useWorkflows';
import WorkflowManager from './components/WorkflowManager';
import GitPanel from './components/GitPanel';
import VisualWorkflowEditor from './components/VisualWorkflowEditor';

const AppContent = () => {
  const [currentProjectPath, setCurrentProjectPath] = useState(() => {
    try {
      return localStorage.getItem('lastProjectPath') || '';
    } catch {
      return '';
    }
  });
  const [activeFile, setActiveFile] = useState('');
  const [code, setCode] = useState('');
  const [openFiles, setOpenFiles] = useState([]);
  const [revealRequest, setRevealRequest] = useState(null);
  const [newItemName, setNewItemName] = useState('');
  const [aiProvider, setAiProvider] = useState('gemini');
  const [thinkingMode, setThinkingMode] = useState(false);
  const [deepContextEnabled, setDeepContextEnabled] = useState(() => {
    try {
      return localStorage.getItem('aiDeepContext') === '1';
    } catch {
      return false;
    }
  });
  const [previewStatus, setPreviewStatus] = useState('stopped');
  const [leftWidth, setLeftWidth] = useState(22);
  const [rightWidth, setRightWidth] = useState(28);
  const [leftBackup, setLeftBackup] = useState(22);
  const [rightBackup, setRightBackup] = useState(28);
  const [isLeftCollapsed, setIsLeftCollapsed] = useState(false);
  const [isRightCollapsed, setIsRightCollapsed] = useState(false);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [dragging, setDragging] = useState(null);
  const [dragStartX, setDragStartX] = useState(0);
  const [startWidths, setStartWidths] = useState({ left: 22, right: 28 });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [workflowManagerOpen, setWorkflowManagerOpen] = useState(false);
  const [centerView, setCenterView] = useState('code');
  const [devPort, setDevPort] = useState('3004');
  const [isExpertMode, setIsExpertMode] = useState(() => {
    try {
      return localStorage.getItem('vibeIDE_expertMode') === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('vibeIDE_expertMode', isExpertMode ? '1' : '0');
    } catch {
      // ignore
    }
  }, [isExpertMode]);

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
  const [libraryNonce, setLibraryNonce] = useState(0);
  const [availableAgents, setAvailableAgents] = useState([]);
  const [availableSkills, setAvailableSkills] = useState([]);
  const [activeAgent, setActiveAgent] = useState(null);
  const [activeSkill, setActiveSkill] = useState(null);

  const layoutRef = useRef(null);
  const commandInputRef = useRef(null);
  const filePaletteInputRef = useRef(null);
  const searchInputRef = useRef(null);
  const fileListCacheRef = useRef({ projectPath: '', files: [] });
  const saveTimerRef = useRef(null);
  const pendingSaveRef = useRef({ projectPath: '', filePath: '', content: '' });

  const { isAvailable: isElectronApiAvailable, message, showMessage } = useElectronAPI();

  const bumpLibraryNonce = useCallback(() => {
    setLibraryNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    const loadLibraries = async () => {
      if (!isElectronApiAvailable || !window.electronAPI?.listAgents || !window.electronAPI?.listSkills) {
        setAvailableAgents([]);
        setAvailableSkills([]);
        setActiveAgent(null);
        setActiveSkill(null);
        return;
      }

      try {
        const [agentsRes, skillsRes] = await Promise.all([
          window.electronAPI.listAgents(currentProjectPath),
          window.electronAPI.listSkills(currentProjectPath),
        ]);

        const agents = agentsRes?.success && Array.isArray(agentsRes.agents) ? agentsRes.agents : [];
        const skills = skillsRes?.success && Array.isArray(skillsRes.skills) ? skillsRes.skills : [];

        setAvailableAgents(agents);
        setAvailableSkills(skills);

        setActiveAgent((prev) => {
          if (!prev) return null;
          const exists = agents.some((a) => a.name === prev.name && a.scope === prev.scope);
          return exists ? prev : null;
        });

        setActiveSkill((prev) => {
          if (!prev) return null;
          const exists = skills.some((s) => s.name === prev.name && s.scope === prev.scope);
          return exists ? prev : null;
        });
      } catch {
        setAvailableAgents([]);
        setAvailableSkills([]);
      }
    };

    loadLibraries();
  }, [isElectronApiAvailable, currentProjectPath, libraryNonce]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  const scheduleSave = useCallback((projectPath, filePath, content) => {
    pendingSaveRef.current = { projectPath, filePath, content };

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = setTimeout(async () => {
      const pending = pendingSaveRef.current;
      if (!pending.projectPath || !pending.filePath) return;

      try {
        await window.electronAPI.writeFile(pending.projectPath, pending.filePath, pending.content);
      } catch (error) {
        console.error('Erreur sauvegarde:', error);
      }
    }, 450);
  }, []);

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
        includeGit: false,
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
    try {
      localStorage.setItem('aiDeepContext', deepContextEnabled ? '1' : '0');
    } catch {
      // ignore
    }
  }, [deepContextEnabled]);

  const {
    projectItems,
    expandedFolders,
    loadProjectItems,
    toggleFolderExpansion,
    createNewItem,
    deleteItem,
    openFolder
  } = useFileOperations(currentProjectPath, isElectronApiAvailable, showMessage, setActiveFile);

  const {
    prompt,
    setPrompt,
    isLoading,
    aiConversationHistory,
    previousCode,
    generateAIResponse,
    addImageMessage,
    saveConversation,
    handleUndo,
    isDiffMode,
    handleAcceptDiff,
    multiAIState,
    conversations,
    activeConversationFile,
    isConversationLoading,
    startNewConversation,
    loadConversationByFile,
    stopGeneration,
    pendingImages,
    setPendingImages,
    pendingMessage
  } = useAI(
    currentProjectPath,
    code,
    setCode,
    activeFile,
    isElectronApiAvailable,
    showMessage,
    setActiveFile,
    loadProjectItems,
    aiProvider,
    thinkingMode,
    deepContextEnabled,
    activeAgent,
    activeSkill,
    availableSkills
  );

  const {
    workflows,
    isLoading: isWorkflowsLoading,
    saveWorkflow,
    deleteWorkflow,
    getWorkflow,
    findWorkflow,
    parseSlashCommand
  } = useWorkflows(currentProjectPath, isElectronApiAvailable);

  const clamp = useCallback((value, min, max) => {
    return Math.min(max, Math.max(min, value));
  }, []);

  const projectName = currentProjectPath
    ? currentProjectPath.split(/[\\/]/).pop()
    : 'Aucun projet';

  useEffect(() => {
    if (!activeFile) return;
    setOpenFiles(prev => (prev.includes(activeFile) ? prev : [...prev, activeFile]));
  }, [activeFile]);

  useEffect(() => {
    fileListCacheRef.current = { projectPath: '', files: [] };
    setProjectFileList([]);
  }, [currentProjectPath]);

  useEffect(() => {
    try {
      localStorage.setItem('aiDeepContext', deepContextEnabled ? '1' : '0');
    } catch {
      // silencieux
    }
  }, [deepContextEnabled]);

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
      const minLeft = 16;
      const minRight = 18;
      const minMiddle = 30;

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
  }, [dragging, dragStartX, startWidths, clamp]);

  useEffect(() => {
    const loadFileContent = async () => {
      if (activeFile && currentProjectPath && isElectronApiAvailable) {
        try {
          const response = await window.electronAPI.readFile(currentProjectPath, activeFile);
          if (response.success) {
            setCode(response.content);
            showMessage(`Fichier "${activeFile}" charge.`, 2000);
          } else {
            setCode('');
            showMessage(`Erreur: ${response.error}`, 5000);
          }
        } catch (error) {
          showMessage(`Erreur: ${error.message}`, 5000);
        }
      } else {
        setCode('');
      }
    };
    loadFileContent();
  }, [activeFile, currentProjectPath, isElectronApiAvailable, showMessage]);

  const handleCodeChange = useCallback((newCode) => {
    if (newCode === code) return;
    setCode(newCode);
    if (!isElectronApiAvailable || !activeFile || !currentProjectPath) return;
    scheduleSave(currentProjectPath, activeFile, newCode);
  }, [code, isElectronApiAvailable, activeFile, currentProjectPath, scheduleSave]);

  const handleOpenFolder = useCallback(async () => {
    const path = await openFolder();
    if (path) {
      setCurrentProjectPath(path);
      setOpenFiles([]);
      setActiveFile('');
      setRevealRequest(null);
      try {
        localStorage.setItem('lastProjectPath', path);
      } catch (error) {
        console.warn('Failed to save project path:', error);
      }
    }
  }, [openFolder]);

  useEffect(() => {
    if (!isElectronApiAvailable) return;
    if (!window.electronAPI || typeof window.electronAPI.onMenuOpenFolder !== 'function') return;
    window.electronAPI.onMenuOpenFolder(() => {
      handleOpenFolder();
    });
  }, [isElectronApiAvailable, handleOpenFolder]);

  useEffect(() => {
    if (!isElectronApiAvailable) return;
    if (!window.electronAPI || typeof window.electronAPI.onMenuOpenSettings !== 'function') return;
    window.electronAPI.onMenuOpenSettings(() => {
      setSettingsOpen(true);
    });
  }, [isElectronApiAvailable]);

  useEffect(() => {
    const loadSettingsForPreview = async () => {
      if (!isElectronApiAvailable || !window.electronAPI?.loadSettings) return;
      try {
        const res = await window.electronAPI.loadSettings();
        if (res?.success && res.settings?.devPort) {
          setDevPort(String(res.settings.devPort));
        }
      } catch (e) {
        // silent
      }
    };
    loadSettingsForPreview();
  }, [isElectronApiAvailable]);

  const openFile = useCallback((filePath, opts = {}) => {
    if (!filePath) return;
    setOpenFiles(prev => (prev.includes(filePath) ? prev : [...prev, filePath]));
    setActiveFile(filePath);

    if (opts && typeof opts === 'object' && opts.reveal) {
      const reveal = opts.reveal;
      setRevealRequest({
        file: filePath,
        line: reveal.line,
        column: reveal.column,
        key: Date.now()
      });
    }
  }, []);

  const closeFileTab = useCallback((filePath) => {
    if (!filePath) return;
    setOpenFiles(prev => {
      const idx = prev.indexOf(filePath);
      if (idx === -1) return prev;
      const next = prev.filter(f => f !== filePath);

      if (String(filePath) === String(activeFile)) {
        const fallback = next[idx - 1] || next[idx] || '';
        setActiveFile(fallback);
        if (!fallback) {
          setCode('');
        }
      }

      return next;
    });
  }, [activeFile]);

  const handleDragStart = useCallback((e, type) => {
    e.preventDefault();
    setDragging(type);
    setDragStartX(e.clientX);
    setStartWidths({ left: leftWidth, right: rightWidth });
  }, [leftWidth, rightWidth]);

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
    setLeftWidth(leftBackup || 22);
    setIsLeftCollapsed(false);
  }, [leftBackup]);

  const expandRight = useCallback(() => {
    setRightWidth(rightBackup || 28);
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
      label: 'Vue Terminal',
      action: () => setCenterView('terminal')
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
    previewStatus,
    handleTogglePreview,
    startNewConversation,
    saveConversation,
    deepContextEnabled,
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

      // Fichiers récents = tabs ouverts (ordre inverse)
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

      // Petit bonus si le fichier se termine par le token
      const lastToken = tokens[tokens.length - 1];
      if (lastToken && hay.endsWith(lastToken)) score -= 3;

      // Bonus si le nom de fichier matche
      const base = hay.split('/').pop() || hay;
      if (tokens.some(t => base.startsWith(t))) score -= 6;

      // Préférer les chemins courts
      score += Math.min(60, hay.length * 0.05);
      return score;
    };

    const scored = [];
    for (const filePath of projectFileList) {
      const s = scoreCandidate(filePath);
      if (s === null) continue;
      scored.push({ id: filePath, label: String(filePath), score: s });
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
    if (!searchOpen) return;

    const q = searchQuery.trim();
    if (!q) {
      setSearchResults([]);
      setIsSearchLoading(false);
      return;
    }

    if (!currentProjectPath || !isElectronApiAvailable || !window.electronAPI?.searchInProject) {
      return;
    }

    let cancelled = false;
    setIsSearchLoading(true);

    const t = setTimeout(async () => {
      try {
        const res = await window.electronAPI.searchInProject(currentProjectPath, q, {
          includeHidden: true,
          includeSecrets: false,
          includeGit: false,
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
      clearTimeout(t);
    };
  }, [searchQuery, searchOpen, currentProjectPath, isElectronApiAvailable, showMessage]);

  useEffect(() => {
    const handleGlobalKeys = (e) => {
      const key = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && key === 'k') {
        e.preventDefault();
        setCommandOpen(true);
        setFilePaletteOpen(false);
        setSearchOpen(false);
      }
      if ((e.ctrlKey || e.metaKey) && key === 'p') {
        e.preventDefault();
        setFilePaletteOpen(true);
        setCommandOpen(false);
        setSearchOpen(false);
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && key === 'f') {
        e.preventDefault();
        setSearchOpen(true);
        setCommandOpen(false);
        setFilePaletteOpen(false);
      }
      if (key === 'escape') {
        setCommandOpen(false);
        setFilePaletteOpen(false);
        setSearchOpen(false);
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

  const handleCommandKey = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!filteredCommands.length) return;
      setCommandIndex((prev) => Math.min(prev + 1, filteredCommands.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!filteredCommands.length) return;
      setCommandIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (!filteredCommands.length) return;
      const cmd = filteredCommands[commandIndex] || filteredCommands[0];
      runCommand(cmd);
    } else if (e.key === 'Escape') {
      setCommandOpen(false);
    }
  };

  const handleFilePaletteKey = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!filteredFiles.length) return;
      setFilePaletteIndex((prev) => Math.min(prev + 1, filteredFiles.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!filteredFiles.length) return;
      setFilePaletteIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (!filteredFiles.length) return;
      const item = filteredFiles[filePaletteIndex] || filteredFiles[0];
      runFilePick(item?.id);
    } else if (e.key === 'Escape') {
      setFilePaletteOpen(false);
    }
  };

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
  }, [openFile]);

  const handleSearchKey = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!searchResults.length) return;
      setSearchIndex((prev) => Math.min(prev + 1, searchResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!searchResults.length) return;
      setSearchIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (!searchResults.length) return;
      const item = searchResults[searchIndex] || searchResults[0];
      runSearchPick(item);
    } else if (e.key === 'Escape') {
      setSearchOpen(false);
    }
  };

  const middleWidth = Math.max(0, 100 - leftWidth - rightWidth);
  const previewUrl = `http://localhost:${devPort}`;

  return (
    <div className="app-shell">
      {message && (
        <div className="toast">
          <span className="toast-dot"></span>
          <span>{message}</span>
        </div>
      )}

      <header className="topbar">
        <div className="topbar-left">
          <div className="brand">
            <div className="brand-mark">V</div>
            <div className="brand-text">
              <div className="brand-title">Vibe IDE</div>
              <div className="brand-subtitle">Studio IA</div>
            </div>
          </div>
          <div className="status-chip">
            <span className={`status-dot ${currentProjectPath ? 'is-on' : 'is-off'}`}></span>
            <span className="status-chip-text">{projectName}</span>
          </div>
          {activeFile && (
            <div className="status-chip subtle">
              <span className="status-chip-text">{activeFile}</span>
            </div>
          )}
        </div>

        <div className="topbar-center" style={{ display: 'flex', gap: '8px', flex: 1, justifyContent: 'center' }}>
          <button className="command-trigger" onClick={() => setCommandOpen(true)} style={{ maxWidth: '300px' }}>
            Ctrl+K pour les commandes
          </button>

          {isExpertMode && (
            <div className="ai-expert-controls" style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <select
                value={aiProvider}
                onChange={(e) => setAiProvider(e.target.value)}
                className="ai-select-mini"
                disabled={!isElectronApiAvailable || isLoading}
                title="Modèle IA"
              >
                <option value="gemini">Gemini</option>
                <option value="claude">Claude</option>
                <option value="kimi">Kimi K2.5</option>
                <option value="multi">Multi-IA (5 Agents)</option>
                <option value="ollama">🦙 Ollama</option>
                <option value="ollama-multi">🦙🦙 Multi-Ollama</option>
              </select>


              <label className="ai-toggle-mini" title="Mode réflexion">
                <input
                  type="checkbox"
                  checked={thinkingMode}
                  onChange={e => setThinkingMode(e.target.checked)}
                  disabled={!isElectronApiAvailable || isLoading}
                />
                Réflexion
              </label>

              <label className="ai-toggle-mini" title="Deep Context (scan projet)">
                <input
                  type="checkbox"
                  checked={deepContextEnabled}
                  onChange={e => setDeepContextEnabled(e.target.checked)}
                  disabled={!isElectronApiAvailable || isLoading}
                />
                Contexte
              </label>
            </div>
          )}
        </div>

        <div className="topbar-right">
          <button
            onClick={() => setIsExpertMode(!isExpertMode)}
            className={`btn btn-pill ${isExpertMode ? 'btn-live' : 'btn-idle'}`}
            style={{ marginRight: '8px' }}
            title={isExpertMode ? 'Désactiver le mode Expert pour simplifier l\'interface' : 'Activer le mode Expert pour plus d\'options IA'}
          >
            {isExpertMode ? '🧑‍💻 Expert' : '🌱 Novice'}
          </button>

          <button
            onClick={handleOpenFolder}
            className="btn btn-ghost"
            disabled={!isElectronApiAvailable}
          >
            Ouvrir
          </button>
          <button
            onClick={handleTogglePreview}
            className={`btn btn-pill ${previewStatus === 'running' ? 'btn-live' : 'btn-idle'}`}
          >
            {previewStatus === 'running' ? 'Aperçu Actif' : 'Lancer Aperçu'}
          </button>
          <button
            onClick={toggleLeftPanel}
            className={`btn btn-ghost ${isLeftCollapsed ? 'is-active' : ''}`}
          >
            Nav
          </button>
          <button
            onClick={toggleRightPanel}
            className={`btn btn-ghost ${isRightCollapsed ? 'is-active' : ''}`}
          >
            IA
          </button>
          {isExpertMode && (
            <button onClick={() => setWorkflowManagerOpen(true)} className="btn btn-ghost">
              Workflows
            </button>
          )}
          <button
            onClick={() => setSettingsOpen(true)}
            className="btn btn-ghost"
          >
            Paramètres
          </button>
        </div>
      </header>

      <div ref={layoutRef} className="workspace">
        {!isLeftCollapsed && (
          <aside
            className="panel nav-panel"
            style={{ width: `${leftWidth}%` }}
          >
            <FileExplorer
              projectItems={projectItems}
              currentProjectPath={currentProjectPath}
              activeFile={activeFile}
              expandedFolders={expandedFolders}
              newItemName={newItemName}
              isElectronApiAvailable={isElectronApiAvailable}
              onOpenFolder={handleOpenFolder}
              onCreateItem={createNewItem}
              onDeleteItem={deleteItem}
              onToggleFolder={toggleFolderExpansion}
              onFileClick={openFile}
              onNewItemNameChange={setNewItemName}
            />
          </aside>
        )}

        {!isLeftCollapsed && (
          <div
            className={`panel-resizer ${dragging === 'left' ? 'panel-resizer-active' : ''}`}
            onMouseDown={(e) => handleDragStart(e, 'left')}
          ></div>
        )}

        <main
          className="panel center-panel"
          style={{ width: `${middleWidth}%` }}
        >
          <div className="center-tabs">
            <div className="tab-group">
              <button
                onClick={() => setCenterView('code')}
                className={`tab ${centerView === 'code' ? 'is-active' : ''}`}
              >
                Code
              </button>
              <button
                onClick={() => setCenterView('preview')}
                className={`tab ${centerView === 'preview' ? 'is-active' : ''}`}
              >
                Aperçu
              </button>
              <button
                onClick={() => setCenterView('terminal')}
                className={`tab ${centerView === 'terminal' ? 'is-active' : ''}`}
              >
                Terminal
              </button>
              <button
                onClick={() => setCenterView('git')}
                className={`tab ${centerView === 'git' ? 'is-active' : ''}`}
                style={{ color: centerView === 'git' ? '#00c49a' : undefined }}
              >
                ⎇ Git
              </button>
              <button
                onClick={() => setCenterView('workflows')}
                className={`tab ${centerView === 'workflows' ? 'is-active' : ''}`}
                style={{ color: centerView === 'workflows' ? '#a78bfa' : undefined }}
              >
                ⚡ Flux
              </button>
            </div>
            <div className="tab-actions">
              <button
                onClick={toggleFocusMode}
                className={`btn btn-ghost ${isFocusMode ? 'is-active' : ''}`}
              >
                Focus
              </button>
            </div>
          </div>

          <div className="center-body">
            {centerView === 'code' && (
              <CodeEditor
                openFiles={openFiles}
                activeFile={activeFile}
                code={code}
                previousCode={previousCode}
                onCodeChange={handleCodeChange}
                onUndo={handleUndo}
                onAcceptDiff={handleAcceptDiff}
                isDiffMode={isDiffMode}
                onSelectFile={openFile}
                onCloseFile={closeFileTab}
                revealRequest={revealRequest}
              />
            )}
            {centerView === 'preview' && (
              <LivePreview
                projectId={currentProjectPath || 'default'}
                status={previewStatus}
                onRefresh={handlePreviewRefresh}
                previewUrl={previewUrl}
                className="flex-1"
              />
            )}
            {centerView === 'terminal' && (
              <TerminalPanel
                currentProjectPath={currentProjectPath}
                isElectronApiAvailable={isElectronApiAvailable}
                showMessage={showMessage}
              />
            )}
            {centerView === 'git' && (
              <GitPanel
                currentProjectPath={currentProjectPath}
                isElectronApiAvailable={isElectronApiAvailable}
                showMessage={showMessage}
              />
            )}
            {centerView === 'workflows' && (
              <VisualWorkflowEditor
                currentProjectPath={currentProjectPath}
                isElectronApiAvailable={isElectronApiAvailable}
                showMessage={showMessage}
              />
            )}
          </div>
        </main>

        {!isRightCollapsed && (
          <div
            className={`panel-resizer ${dragging === 'right' ? 'panel-resizer-active' : ''}`}
            onMouseDown={(e) => handleDragStart(e, 'right')}
          ></div>
        )}

        {!isRightCollapsed && (
          <aside
            className="panel ai-panel"
            style={{ width: `${rightWidth}%` }}
          >
            <AIChat
              prompt={prompt}
              conversationHistory={aiConversationHistory}
              isLoading={isLoading}
              currentProjectPath={currentProjectPath}
              isElectronApiAvailable={isElectronApiAvailable}
              onPromptChange={setPrompt}
              onSend={generateAIResponse}
              onSaveConversation={saveConversation}
              aiProvider={aiProvider}
              onProviderChange={setAiProvider}
              thinkingMode={thinkingMode}
              onThinkingModeChange={setThinkingMode}
              deepContextEnabled={deepContextEnabled}
              onDeepContextEnabledChange={setDeepContextEnabled}
              onPasteImage={addImageMessage}
              multiAIState={multiAIState}
              conversations={conversations}
              activeConversationFile={activeConversationFile}
              isConversationLoading={isConversationLoading}
              onNewConversation={startNewConversation}
              onSelectConversation={loadConversationByFile}
              onStopGeneration={stopGeneration}
              workflows={workflows}
              findWorkflow={findWorkflow}
              getWorkflow={getWorkflow}
              parseSlashCommand={parseSlashCommand}
              activeFile={activeFile}
              agents={availableAgents}
              skills={availableSkills}
              activeAgent={activeAgent}
              activeSkill={activeSkill}
              onActiveAgentChange={setActiveAgent}
              onActiveSkillChange={setActiveSkill}
              globalSkillsCount={availableSkills.filter(s => s.scope === 'global').length}
              pendingImages={pendingImages}
              onRemovePendingImage={(idx) => setPendingImages(prev => prev.filter((_, i) => i !== idx))}
              pendingMessage={pendingMessage}
              projectFileList={projectFileList}
            />
          </aside>
        )}
      </div>

      <footer className="statusbar">
        <div className="status-group">
          <span className="status-label">Vue</span>
          <span className="status-value">{centerView}</span>
        </div>
        <div className="status-group">
          <span className="status-label">Preview</span>
          <span className={`status-value ${previewStatus === 'running' ? 'status-live' : ''}`}>
            {previewStatus}
          </span>
        </div>
        <div className="status-group">
          <span className="status-label">IA</span>
          <span className="status-value">{aiProvider}{thinkingMode ? ' +Think' : ''}{deepContextEnabled ? ' +Ctx' : ''}</span>
        </div>
        <div className="status-group">
          <span className="status-label">Projet</span>
          <span className="status-value">{projectName}</span>
        </div>
      </footer>

      {settingsOpen && (
        <Settings
          isOpen={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          isElectronApiAvailable={isElectronApiAvailable}
          showMessage={showMessage}
        />
      )}

      {workflowManagerOpen && (
        <WorkflowManager
          workflows={workflows}
          isLoading={isWorkflowsLoading}
          onSave={saveWorkflow}
          onDelete={deleteWorkflow}
          onTrigger={async (workflow) => {
            const fullWorkflow = await getWorkflow(workflow.name, workflow.scope);
            if (fullWorkflow) {
              setPrompt(`/${workflow.name}`);
              showMessage(`Workflow "/${workflow.name}" charge.`, 3000);
            }
            setWorkflowManagerOpen(false);
          }}
          onClose={() => setWorkflowManagerOpen(false)}
          currentProjectPath={currentProjectPath}
          showMessage={showMessage}
          isElectronApiAvailable={isElectronApiAvailable}
          onLibraryUpdated={bumpLibraryNonce}
        />
      )}

      {commandOpen && (
        <div className="command-overlay" onClick={() => setCommandOpen(false)}>
          <div className="command-modal" onClick={(e) => e.stopPropagation()}>
            <div className="command-input-row">
              <input
                ref={commandInputRef}
                value={commandQuery}
                onChange={(e) => setCommandQuery(e.target.value)}
                onKeyDown={handleCommandKey}
                placeholder="Chercher une commande, une vue, une action..."
                className="command-input"
              />
              <span className="command-hint">Ctrl+K</span>
            </div>
            <div className="command-list custom-scrollbar">
              {filteredCommands.length === 0 && (
                <div className="command-empty">Aucune commande</div>
              )}
              {filteredCommands.map((cmd, index) => (
                <button
                  key={cmd.id}
                  className={`command-item ${index === commandIndex ? 'is-active' : ''}`}
                  onClick={() => runCommand(cmd)}
                >
                  <span className="command-label">{cmd.label}</span>
                  {cmd.hint && <span className="command-shortcut">{cmd.hint}</span>}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {filePaletteOpen && (
        <div className="command-overlay" onClick={() => setFilePaletteOpen(false)}>
          <div className="command-modal" onClick={(e) => e.stopPropagation()}>
            <div className="command-input-row">
              <input
                ref={filePaletteInputRef}
                value={filePaletteQuery}
                onChange={(e) => setFilePaletteQuery(e.target.value)}
                onKeyDown={handleFilePaletteKey}
                placeholder="Ouvrir un fichier (fuzzy)..."
                className="command-input"
              />
              <span className="command-hint">Ctrl+P</span>
            </div>
            <div className="command-list custom-scrollbar">
              {isProjectFileListLoading && (
                <div className="command-empty">Indexation...</div>
              )}
              {!isProjectFileListLoading && filteredFiles.length === 0 && (
                <div className="command-empty">Aucun fichier</div>
              )}
              {!isProjectFileListLoading && filteredFiles.length > 0 && filteredFiles.map((item, index) => {
                const full = String(item.id || '');
                const base = full.split(/[\\/]/).pop() || full;
                const hint = item.hint === 'tab' ? 'tab' : full.replace(/\\/g, '/');
                return (
                  <button
                    key={item.id}
                    className={`command-item ${index === filePaletteIndex ? 'is-active' : ''}`}
                    onClick={() => runFilePick(item.id)}
                  >
                    <span className="command-label">{base}</span>
                    <span className="command-shortcut">{hint}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {searchOpen && (
        <div className="command-overlay" onClick={() => setSearchOpen(false)}>
          <div className="command-modal is-wide" onClick={(e) => e.stopPropagation()}>
            <div className="command-input-row">
              <input
                ref={searchInputRef}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleSearchKey}
                placeholder="Rechercher dans le projet..."
                className="command-input"
              />
              <span className="command-hint">Ctrl+Shift+F</span>
            </div>

            <div className="command-list custom-scrollbar is-tall">
              {isSearchLoading && (
                <div className="command-empty">Recherche...</div>
              )}
              {!isSearchLoading && searchQuery.trim() && searchResults.length === 0 && (
                <div className="command-empty">Aucun résultat</div>
              )}
              {!isSearchLoading && searchResults.length > 0 && searchResults.map((r, index) => {
                const loc = `${r.file}:${r.line}:${r.column}`;
                const snippet = String(r.text || '');
                return (
                  <button
                    key={`${loc}-${index}`}
                    className={`command-item search-item ${index === searchIndex ? 'is-active' : ''}`}
                    onClick={() => runSearchPick(r)}
                  >
                    <div className="search-left">
                      <div className="search-meta">{loc}</div>
                      <div className="search-snippet">{snippet}</div>
                    </div>
                    <span className="command-shortcut">Entrée</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const App = () => (
  <ErrorBoundary>
    <AppContent />
  </ErrorBoundary>
);

export default App;
