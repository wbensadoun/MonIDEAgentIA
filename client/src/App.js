import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import './App.css';
import ErrorBoundary from './components/ErrorBoundary';
import Settings from './components/Settings';
import useElectronAPI from './hooks/useElectronAPI';
import useFileOperations from './hooks/useFileOperations';
import useAI from './hooks/useAI';
import useWorkflows from './hooks/useWorkflows';
import WorkflowManager from './components/WorkflowManager';
import AppTopbar from './components/AppShell/AppTopbar';
import WorkspaceLayout from './components/AppShell/WorkspaceLayout';
import StatusBar from './components/AppShell/StatusBar';
import OnboardingModal from './components/AppShell/OnboardingModal';
import { isNavigatorDescendant, isSameNavigatorPath, joinNavigatorPath, replaceNavigatorPathPrefix } from './utils/navigatorPaths';
import {
  DEFAULT_OLLAMA_MODEL,
  SUGGESTED_OLLAMA_MODELS,
  normalizeOllamaModelLabel
} from './utils/ollamaModels';
import {
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_KIMI_MODEL,
  getRemoteModelOptions,
  normalizeRemoteModelName
} from './utils/remoteModels';

const DEFAULT_LEFT_WIDTH = 20;
const DEFAULT_RIGHT_WIDTH = 22;
const LAYOUT_DENSITY_VERSION = 2;

const AppContent = () => {
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem('futurIA_theme') || 'midnight';
    } catch {
      return 'midnight';
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('futurIA_theme', theme);
    } catch {
      // ignore
    }
    document.body.className = `theme-${theme}`;
  }, [theme]);

  const [currentProjectPath, setCurrentProjectPath] = useState('');
  const [workspaces, setWorkspaces] = useState(() => {
    try {
      const raw = localStorage.getItem('vibeIDE_workspaces');
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const [projectRunState, setProjectRunState] = useState({});
  const [conversationsRefreshKey, setConversationsRefreshKey] = useState(0);
  const [pendingConversationLoad, setPendingConversationLoad] = useState(null);
  const [activeFile, setActiveFile] = useState('');
  const [code, setCode] = useState('');
  const [openFiles, setOpenFiles] = useState([]);
  const [revealRequest, setRevealRequest] = useState(null);
  const [newItemName, setNewItemName] = useState('');
  const [aiProvider, setAiProvider] = useState('gemini');
  const [executionMode, setExecutionMode] = useState('agent');
  const [runPreset, setRunPreset] = useState('default');
  const [multiAgentFormationKey, setMultiAgentFormationKey] = useState('product-ui');
  const [disabledAgentKeys, setDisabledAgentKeys] = useState([]);
  const [thinkingMode, setThinkingMode] = useState(false);
  const [deepContextEnabled, setDeepContextEnabled] = useState(() => {
    try {
      return localStorage.getItem('aiDeepContext') === '1';
    } catch {
      return false;
    }
  });
  const [previewStatus, setPreviewStatus] = useState('stopped');
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [workflowManagerOpen, setWorkflowManagerOpen] = useState(false);
  const [centerView, setCenterView] = useState('code');
  const [isTerminalOpen, setIsTerminalOpen] = useState(false);
  const [devPort, setDevPort] = useState('3004');
  const [runtimeDevPort, setRuntimeDevPort] = useState('');
  const [permissionMode, setPermissionMode] = useState('edit_terminal');
  const [contextMode, setContextMode] = useState('auto');
  const [contextMaxFiles, setContextMaxFiles] = useState(120);
  const [geminiModel, setGeminiModel] = useState(DEFAULT_GEMINI_MODEL);
  const [claudeModel, setClaudeModel] = useState(DEFAULT_CLAUDE_MODEL);
  const [kimiModel, setKimiModel] = useState(DEFAULT_KIMI_MODEL);
  const [providerApiKeys, setProviderApiKeys] = useState({
    geminiApiKey: '',
    claudeApiKey: '',
    kimiApiKey: ''
  });
  const [ollamaModel, setOllamaModel] = useState(DEFAULT_OLLAMA_MODEL);
  const [ollamaModelArchitect, setOllamaModelArchitect] = useState(DEFAULT_OLLAMA_MODEL);
  const [ollamaModelCoder, setOllamaModelCoder] = useState(DEFAULT_OLLAMA_MODEL);
  const [ollamaModelTester, setOllamaModelTester] = useState(DEFAULT_OLLAMA_MODEL);
  const [ollamaModels, setOllamaModels] = useState([]);
  // Catalogue Ollama dynamique (famille + tailles depuis la librairie publique)
  const [ollamaFamily, setOllamaFamily] = useState('');
  const [ollamaSizes, setOllamaSizes] = useState([]);
  const [recommendedOllamaSize, setRecommendedOllamaSize] = useState('');
  const [aiDraftPreview, setAiDraftPreview] = useState(null);
  const [gitDiffPreview, setGitDiffPreview] = useState(null);
  const [agentRuns, setAgentRuns] = useState([]);
  const [activeAgentRun, setActiveAgentRun] = useState(null);
  const [selectedAgentRunId, setSelectedAgentRunId] = useState('');
  const [isAgentRunsLoading, setIsAgentRunsLoading] = useState(false);
  const [qualityGateConfig, setQualityGateConfig] = useState({
    onApply: false,
    lint: true,
    test: false,
    build: false,
    blockOnFail: true
  });
  const [showOnboarding, setShowOnboarding] = useState(false);
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
  const [symbolOpen, setSymbolOpen] = useState(false);
  const [symbolQuery, setSymbolQuery] = useState('');
  const [symbolIndex, setSymbolIndex] = useState(0);
  const [symbolResults, setSymbolResults] = useState([]);
  const [isSymbolLoading, setIsSymbolLoading] = useState(false);
  const [libraryNonce, setLibraryNonce] = useState(0);
  const [availableAgents, setAvailableAgents] = useState([]);
  const [availableSkills, setAvailableSkills] = useState([]);
  const [activeAgent, setActiveAgent] = useState(null);
  const [activeSkill, setActiveSkill] = useState(null);

  const layoutRef = useRef(null);
  const commandInputRef = useRef(null);
  const filePaletteInputRef = useRef(null);
  const searchInputRef = useRef(null);
  const symbolInputRef = useRef(null);
  const fileListCacheRef = useRef({ projectPath: '', files: [] });
  const saveTimerRef = useRef(null);
  const pendingSaveRef = useRef({ projectPath: '', filePath: '', content: '' });
  const sessionLoadedRef = useRef(false);

  const { isAvailable: isElectronApiAvailable, message, showMessage } = useElectronAPI();

  // Persist the workspaces list
  useEffect(() => {
    try {
      localStorage.setItem('vibeIDE_workspaces', JSON.stringify(workspaces));
    } catch {
      // ignore
    }
  }, [workspaces]);

  // Auto-register the active project into the workspaces list
  useEffect(() => {
    if (!currentProjectPath) return;
    const name = currentProjectPath.split(/[\\/]/).pop() || currentProjectPath;
    setWorkspaces((prev) => {
      const existing = prev.find((w) => w.path === currentProjectPath);
      if (existing) {
        return prev.map((w) => (w.path === currentProjectPath ? { ...w, lastOpenedAt: Date.now() } : w));
      }
      return [...prev, { path: currentProjectPath, name, lastOpenedAt: Date.now() }];
    });
  }, [currentProjectPath]);

  useEffect(() => {
    if (!isElectronApiAvailable || currentProjectPath) return;
    if (!window.electronAPI?.authorizeProjectPath) return;

    let cancelled = false;
    const restoreLastProject = async () => {
      let lastProjectPath = '';
      try {
        lastProjectPath = localStorage.getItem('lastProjectPath') || '';
      } catch {
        lastProjectPath = '';
      }
      if (!lastProjectPath) return;

      try {
        const response = await window.electronAPI.authorizeProjectPath(lastProjectPath);
        if (cancelled) return;
        if (response?.success && response.path) {
          setCurrentProjectPath(response.path);
          return;
        }
        try {
          localStorage.removeItem('lastProjectPath');
        } catch {
          // ignore
        }
        if (response?.error) {
          showMessage(`Projet non restaure: ${response.error}`, 3500);
        }
      } catch (error) {
        if (!cancelled) {
          showMessage(`Projet non restaure: ${error.message}`, 3500);
        }
      }
    };

    restoreLastProject();
    return () => {
      cancelled = true;
    };
  }, [currentProjectPath, isElectronApiAvailable, showMessage]);

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
    renameItem,
    moveItem,
    deleteItem,
    openFolder
  } = useFileOperations(currentProjectPath, isElectronApiAvailable, showMessage, setActiveFile, permissionMode);

  const multiAgentRunOptions = useMemo(() => ({
    formationKey: multiAgentFormationKey,
    disabledAgentKeys
  }), [disabledAgentKeys, multiAgentFormationKey]);

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
    pendingFileChanges,
    activePendingChangeId,
    activeAgentRunId,
    agentRunRefreshKey,
    selectPendingChangeByIndex,
    applyPendingChangeByIndex,
    rejectPendingChangeByIndex,
    applyAllPendingChanges,
    rejectAllPendingChanges,
    updatePendingChangeContent,
    pendingSnapshotId,
    contextEstimate,
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
    availableSkills,
    permissionMode,
    qualityGateConfig,
    contextMode,
    contextMaxFiles,
    executionMode,
    runPreset,
    multiAgentRunOptions
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

  // Derive the active project's run status for the workspace dots.
  // run = an agent is generating ; wait = changes pending validation ; idle = nothing.
  useEffect(() => {
    if (!currentProjectPath) return;
    let status = 'idle';
    if (isLoading || multiAIState?.isActive) {
      status = 'run';
    } else if (Array.isArray(pendingFileChanges) && pendingFileChanges.length > 0) {
      status = 'wait';
    }
    setProjectRunState((prev) => {
      if (prev[currentProjectPath] === status) return prev;
      return { ...prev, [currentProjectPath]: status };
    });
  }, [currentProjectPath, isLoading, multiAIState, pendingFileChanges]);

  // When a run finishes (a conversation may have been saved), refresh the panel list.
  useEffect(() => {
    if (!isLoading) {
      setConversationsRefreshKey((k) => k + 1);
    }
  }, [isLoading, activeConversationFile]);

  // Load a conversation once we have switched to its owning project.
  useEffect(() => {
    if (!pendingConversationLoad) return;
    if (pendingConversationLoad.path !== currentProjectPath) return;
    loadConversationByFile(pendingConversationLoad.fileName);
    setPendingConversationLoad(null);
  }, [pendingConversationLoad, currentProjectPath, loadConversationByFile]);

  const handleSelectProject = useCallback(async (projectPath) => {
    if (!projectPath || projectPath === currentProjectPath) return;
    // Re-authorize silently if needed (no-op if already trusted this session)
    if (isElectronApiAvailable && window.electronAPI?.authorizeProjectPath) {
      try {
        const res = await window.electronAPI.authorizeProjectPath(projectPath);
        if (!res?.success) {
          showMessage(`Projet non autorisé: ${res?.error || 'refusé'}`, 4000);
          return;
        }
      } catch (error) {
        showMessage(`Erreur autorisation: ${error.message}`, 4000);
        return;
      }
    }
    setCurrentProjectPath(projectPath);
    setOpenFiles([]);
    setActiveFile('');
    setRevealRequest(null);
    setGitDiffPreview(null);
    try {
      localStorage.setItem('lastProjectPath', projectPath);
    } catch {
      // ignore
    }
  }, [currentProjectPath, isElectronApiAvailable, showMessage]);

  const handleOpenConversation = useCallback(async (projectPath, fileName) => {
    if (projectPath === currentProjectPath) {
      loadConversationByFile(fileName);
      return;
    }
    // Switch project first, then the effect above loads the conversation.
    await handleSelectProject(projectPath);
    setPendingConversationLoad({ path: projectPath, fileName });
  }, [currentProjectPath, handleSelectProject, loadConversationByFile]);

  const handleRemoveProject = useCallback((projectPath) => {
    setWorkspaces((prev) => prev.filter((w) => w.path !== projectPath));
    setProjectRunState((prev) => {
      if (!(projectPath in prev)) return prev;
      const next = { ...prev };
      delete next[projectPath];
      return next;
    });
  }, []);

  const clamp = useCallback((value, min, max) => {
    return Math.min(max, Math.max(min, value));
  }, []);

  const projectName = currentProjectPath
    ? currentProjectPath.split(/[\\/]/).pop()
    : 'Aucun projet';
  const isReadOnlyMode = permissionMode === 'read_only';
  const resolvedOllamaModel = normalizeOllamaModelLabel(ollamaModel);
  const resolvedOllamaArchitect = normalizeOllamaModelLabel(ollamaModelArchitect, resolvedOllamaModel);
  const resolvedOllamaCoder = normalizeOllamaModelLabel(ollamaModelCoder, resolvedOllamaModel);
  const resolvedOllamaTester = normalizeOllamaModelLabel(ollamaModelTester, resolvedOllamaModel);

  const ollamaTopbarLabel = useMemo(() => {
    if (aiProvider === 'ollama') {
      return `🦙 ${resolvedOllamaModel}`;
    }

    if (aiProvider === 'ollama-multi') {
      if (
        resolvedOllamaArchitect === resolvedOllamaCoder &&
        resolvedOllamaArchitect === resolvedOllamaTester
      ) {
        return `🦙 Multi ${resolvedOllamaArchitect}`;
      }

      return `🦙 A:${resolvedOllamaArchitect} C:${resolvedOllamaCoder} T:${resolvedOllamaTester}`;
    }

    return '';
  }, [
    aiProvider,
    resolvedOllamaArchitect,
    resolvedOllamaCoder,
    resolvedOllamaModel,
    resolvedOllamaTester
  ]);

  const ollamaStatusLabel = useMemo(() => {
    if (aiProvider === 'ollama') {
      return resolvedOllamaModel;
    }

    if (aiProvider === 'ollama-multi') {
      return `arch=${resolvedOllamaArchitect} | coder=${resolvedOllamaCoder} | test=${resolvedOllamaTester}`;
    }

    return '';
  }, [
    aiProvider,
    resolvedOllamaArchitect,
    resolvedOllamaCoder,
    resolvedOllamaModel,
    resolvedOllamaTester
  ]);

  // Modele recommande = famille recente + taille adaptee a la machine.
  const recommendedOllamaModel = useMemo(() => (
    ollamaFamily && recommendedOllamaSize ? `${ollamaFamily}:${recommendedOllamaSize}` : ''
  ), [ollamaFamily, recommendedOllamaSize]);

  const availableOllamaModels = useMemo(() => {
    // Source principale: tailles dynamiques de la famille recente (jamais ":latest").
    const dynamicModels = ollamaFamily
      ? ollamaSizes.map((size) => `${ollamaFamily}:${size}`)
      : [];
    // Modeles installes localement, en excluant tout tag ":latest".
    const installedModels = ollamaModels
      .map((model) => String(model || '').trim())
      .filter((model) => model && !/:latest$/i.test(model));
    // Secours (hors-ligne) seulement si aucune source dynamique/installee.
    const fallback = dynamicModels.length === 0 && installedModels.length === 0
      ? SUGGESTED_OLLAMA_MODELS
      : [];
    return Array.from(new Set([
      ...dynamicModels,
      ...installedModels,
      ...fallback,
      normalizeOllamaModelLabel(ollamaModel),
      normalizeOllamaModelLabel(ollamaModelArchitect, ollamaModel),
      normalizeOllamaModelLabel(ollamaModelCoder, ollamaModel),
      normalizeOllamaModelLabel(ollamaModelTester, ollamaModel)
    ].filter(Boolean)));
  }, [
    ollamaModel,
    ollamaModelArchitect,
    ollamaModelCoder,
    ollamaModelTester,
    ollamaModels,
    ollamaFamily,
    ollamaSizes
  ]);

  const activeModelField = useMemo(() => {
    if (aiProvider === 'claude') return 'claudeModel';
    if (aiProvider === 'kimi') return 'kimiModel';
    if (aiProvider === 'ollama') return 'ollamaModel';
    if (aiProvider === 'gemini') return 'geminiModel';
    return '';
  }, [aiProvider]);

  const activeModelValue = useMemo(() => {
    if (aiProvider === 'claude') return claudeModel || DEFAULT_CLAUDE_MODEL;
    if (aiProvider === 'kimi') return kimiModel || DEFAULT_KIMI_MODEL;
    if (aiProvider === 'ollama') return resolvedOllamaModel;
    if (aiProvider === 'gemini') return geminiModel || DEFAULT_GEMINI_MODEL;
    return '';
  }, [aiProvider, claudeModel, geminiModel, kimiModel, resolvedOllamaModel]);

  const availableActiveModels = useMemo(() => {
    if (aiProvider === 'ollama') return availableOllamaModels;
    if (aiProvider === 'gemini') return getRemoteModelOptions('gemini', geminiModel);
    if (aiProvider === 'claude') return getRemoteModelOptions('claude', claudeModel);
    if (aiProvider === 'kimi') return getRemoteModelOptions('kimi', kimiModel);
    return [];
  }, [aiProvider, availableOllamaModels, claudeModel, geminiModel, kimiModel]);

  useEffect(() => {
    if (!activeFile) return;
    setOpenFiles(prev => (prev.includes(activeFile) ? prev : [...prev, activeFile]));
  }, [activeFile]);

  useEffect(() => {
    fileListCacheRef.current = { projectPath: '', files: [] };
    setProjectFileList([]);
  }, [currentProjectPath]);

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
      const normalizeSavedWidth = (value, oldMin, oldMax, nextDefault) => {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return null;
        if (shouldAdoptNewDensity && numeric >= oldMin && numeric <= oldMax) {
          return nextDefault;
        }
        return numeric;
      };

      const savedLeftWidth = normalizeSavedWidth(parsed.leftWidth, 20, 24, DEFAULT_LEFT_WIDTH);
      const savedRightWidth = normalizeSavedWidth(parsed.rightWidth, 26, 30, DEFAULT_RIGHT_WIDTH);
      const savedLeftBackup = normalizeSavedWidth(parsed.leftBackup, 20, 24, DEFAULT_LEFT_WIDTH);
      const savedRightBackup = normalizeSavedWidth(parsed.rightBackup, 26, 30, DEFAULT_RIGHT_WIDTH);

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
  }, [currentProjectPath]);

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
  }, [dragging, dragStartX, startWidths, clamp]);

  useEffect(() => {
    const loadFileContent = async () => {
      if (gitDiffPreview?.filePath && gitDiffPreview.filePath === activeFile) {
        return;
      }

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
  }, [activeFile, currentProjectPath, gitDiffPreview, isElectronApiAvailable, showMessage]);

  const handleCodeChange = useCallback((newCode) => {
    if (isReadOnlyMode) {
      showMessage('Mode lecture seule actif: edition desactivee.', 2500);
      return;
    }
    if (newCode === code) return;
    setCode(newCode);
    if (!isElectronApiAvailable || !activeFile || !currentProjectPath) return;
    scheduleSave(currentProjectPath, activeFile, newCode);
  }, [isReadOnlyMode, showMessage, code, isElectronApiAvailable, activeFile, currentProjectPath, scheduleSave]);

  const handleStreamingDraftChange = useCallback((draft) => {
    if (draft) {
      setGitDiffPreview(null);
    }

    setAiDraftPreview((prev) => {
      if (!draft) {
        return prev ? null : prev;
      }

      if (
        prev &&
        prev.filePath === draft.filePath &&
        prev.code === draft.code &&
        prev.language === draft.language &&
        prev.agent === draft.agent
      ) {
        return prev;
      }

      return {
        filePath: String(draft.filePath || '').trim(),
        code: String(draft.code || ''),
        language: String(draft.language || '').trim(),
        agent: String(draft.agent || '').trim()
      };
    });

    if (draft && centerView !== 'code') {
      setCenterView('code');
    }
  }, [centerView]);

  useEffect(() => {
    if (isDiffMode && gitDiffPreview) {
      setGitDiffPreview(null);
    }
  }, [gitDiffPreview, isDiffMode]);

  const handleOpenFolder = useCallback(async () => {
    const path = await openFolder();
    if (path) {
      setCurrentProjectPath(path);
      setOpenFiles([]);
      setActiveFile('');
      setRevealRequest(null);
      setGitDiffPreview(null);
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
    const offMenuOpenFolder = window.electronAPI.onMenuOpenFolder(() => {
      handleOpenFolder();
    });
    return () => {
      if (typeof offMenuOpenFolder === 'function') offMenuOpenFolder();
    };
  }, [isElectronApiAvailable, handleOpenFolder]);

  useEffect(() => {
    if (!isElectronApiAvailable) return;
    if (!window.electronAPI || typeof window.electronAPI.onMenuOpenSettings !== 'function') return;
    const offMenuOpenSettings = window.electronAPI.onMenuOpenSettings(() => {
      setSettingsOpen(true);
    });
    return () => {
      if (typeof offMenuOpenSettings === 'function') offMenuOpenSettings();
    };
  }, [isElectronApiAvailable]);

  useEffect(() => {
    if (!isElectronApiAvailable) return;

    const applySettings = (settings) => {
      if (!settings || typeof settings !== 'object') return;

      if (settings.devPort) {
        setDevPort(String(settings.devPort));
      }

      if (settings.defaultProvider) {
        setAiProvider(String(settings.defaultProvider));
      }

      setGeminiModel(normalizeRemoteModelName(settings.geminiModel, DEFAULT_GEMINI_MODEL));
      setClaudeModel(normalizeRemoteModelName(settings.claudeModel, DEFAULT_CLAUDE_MODEL));
      setKimiModel(normalizeRemoteModelName(settings.kimiModel, DEFAULT_KIMI_MODEL));
      setProviderApiKeys({
        geminiApiKey: String(settings.geminiApiKey || '').trim(),
        claudeApiKey: String(settings.claudeApiKey || '').trim(),
        kimiApiKey: String(settings.kimiApiKey || '').trim()
      });
      setOllamaModel(normalizeOllamaModelLabel(settings.ollamaModel));
      setOllamaModelArchitect(normalizeOllamaModelLabel(settings.ollamaModelArchitect, settings.ollamaModel));
      setOllamaModelCoder(normalizeOllamaModelLabel(settings.ollamaModelCoder, settings.ollamaModel));
      setOllamaModelTester(normalizeOllamaModelLabel(settings.ollamaModelTester, settings.ollamaModel));

      if (typeof settings.thinkingMode === 'boolean') {
        setThinkingMode(settings.thinkingMode);
      }

      setPermissionMode(settings.permissionMode || 'edit_terminal');

      if (settings.contextMode) {
        setContextMode(String(settings.contextMode));
      }

      if (Number.isFinite(Number(settings.contextMaxFiles))) {
        setContextMaxFiles(Number(settings.contextMaxFiles));
      }

      setQualityGateConfig({
        onApply: !!settings.qualityGateOnApply,
        lint: settings.qualityGateLint !== false,
        test: !!settings.qualityGateTest,
        build: !!settings.qualityGateBuild,
        blockOnFail: settings.qualityGateBlockOnFail !== false
      });

      if (typeof settings.onboardingCompleted === 'boolean') {
        setShowOnboarding(!settings.onboardingCompleted);
      }
    };

    const loadSettings = async () => {
      if (!window.electronAPI?.loadSettings) return;
      try {
        const res = await window.electronAPI.loadSettings();
        if (res?.success && res.settings) {
          applySettings(res.settings);
        }
      } catch {
        // silent
      }
    };

    const onSettingsUpdated = (event) => {
      applySettings(event?.detail);
    };

    loadSettings();
    window.addEventListener('settings-updated', onSettingsUpdated);
    return () => window.removeEventListener('settings-updated', onSettingsUpdated);
  }, [isElectronApiAvailable]);

  useEffect(() => {
    if (!isElectronApiAvailable || !window.electronAPI?.listOllamaModels) return;
    if (aiProvider !== 'ollama' && aiProvider !== 'ollama-multi') return;

    let mounted = true;
    const loadOllamaModels = async () => {
      try {
        const response = await window.electronAPI.listOllamaModels();
        if (!mounted) return;
        if (response?.success && Array.isArray(response.models)) {
          setOllamaModels(
            response.models
              .map((model) => String(model?.name || model || '').trim())
              .filter(Boolean)
          );
        } else {
          setOllamaModels([]);
        }
      } catch {
        if (mounted) setOllamaModels([]);
      }
    };

    loadOllamaModels();
    return () => {
      mounted = false;
    };
  }, [aiProvider, isElectronApiAvailable]);

  // Catalogue dynamique: famille la plus recente + tailles publiees + taille recommandee.
  // Rafraichi au montage, au changement de provider, et sur "update" (event UpdateChecker).
  useEffect(() => {
    if (!isElectronApiAvailable || !window.electronAPI?.resolveOllamaFamily) return undefined;
    if (aiProvider !== 'ollama' && aiProvider !== 'ollama-multi') return undefined;

    let mounted = true;
    const loadCatalog = async (force = false) => {
      try {
        const famResp = await window.electronAPI.resolveOllamaFamily('qwen', force);
        if (!mounted || !famResp?.success || !famResp.family) return;
        setOllamaFamily(famResp.family);

        const sizesResp = await window.electronAPI.fetchOllamaLibrarySizes(famResp.family, force);
        if (!mounted || !sizesResp?.success || !Array.isArray(sizesResp.sizes)) return;
        setOllamaSizes(sizesResp.sizes);

        if (sizesResp.sizes.length > 0 && window.electronAPI?.recommendOllamaSize) {
          const recoResp = await window.electronAPI.recommendOllamaSize(sizesResp.sizes);
          if (mounted && recoResp?.success && recoResp.recommended) {
            setRecommendedOllamaSize(recoResp.recommended);
          }
        }
      } catch {
        // Hors-ligne: on garde la liste de secours (SUGGESTED_OLLAMA_MODELS).
      }
    };

    loadCatalog(false);
    const onRefresh = () => loadCatalog(true);
    window.addEventListener('ollama-models-refreshed', onRefresh);
    return () => {
      mounted = false;
      window.removeEventListener('ollama-models-refreshed', onRefresh);
    };
  }, [aiProvider, isElectronApiAvailable]);

  const saveSettingsPatch = useCallback(async (patch, successMessage = '') => {
    if (!isElectronApiAvailable || !window.electronAPI?.loadSettings || !window.electronAPI?.saveSettings) {
      return false;
    }

    try {
      const current = await window.electronAPI.loadSettings();
      const nextSettings = {
        ...(current?.settings || {}),
        ...patch
      };
      const result = await window.electronAPI.saveSettings(nextSettings);
      if (!result?.success) {
        throw new Error(result?.error || 'Sauvegarde impossible');
      }
      window.dispatchEvent(new CustomEvent('settings-updated', { detail: nextSettings }));
      if (successMessage) {
        showMessage(successMessage, 1800);
      }
      return true;
    } catch (error) {
      showMessage(`Erreur settings: ${error.message}`, 3500);
      return false;
    }
  }, [isElectronApiAvailable, showMessage]);

  const handleAiProviderChange = useCallback(async (provider) => {
    const nextProvider = String(provider || 'gemini');
    setAiProvider(nextProvider);
    await saveSettingsPatch({ defaultProvider: nextProvider }, `Assistant: ${nextProvider}`);
  }, [saveSettingsPatch]);

  const handleOllamaSettingChange = useCallback(async (field, value) => {
    const normalizedValue = normalizeOllamaModelLabel(value);
    if (field === 'ollamaModel') {
      setOllamaModel(normalizedValue);
    } else if (field === 'ollamaModelArchitect') {
      setOllamaModelArchitect(normalizedValue);
    } else if (field === 'ollamaModelCoder') {
      setOllamaModelCoder(normalizedValue);
    } else if (field === 'ollamaModelTester') {
      setOllamaModelTester(normalizedValue);
    }

    await saveSettingsPatch({ [field]: normalizedValue }, `Modele Ollama: ${normalizedValue}`);
  }, [saveSettingsPatch]);

  const handleActiveModelChange = useCallback(async (value) => {
    if (!activeModelField) return;

    if (activeModelField === 'ollamaModel') {
      await handleOllamaSettingChange(activeModelField, value);
      return;
    }

    const normalizedValue = normalizeRemoteModelName(value);
    if (!normalizedValue) return;

    if (activeModelField === 'geminiModel') {
      setGeminiModel(normalizedValue);
    } else if (activeModelField === 'claudeModel') {
      setClaudeModel(normalizedValue);
    } else if (activeModelField === 'kimiModel') {
      setKimiModel(normalizedValue);
    }

    await saveSettingsPatch({ [activeModelField]: normalizedValue }, `Modele IA: ${normalizedValue}`);
  }, [activeModelField, handleOllamaSettingChange, saveSettingsPatch]);


  useEffect(() => {
    setRuntimeDevPort('');
  }, [currentProjectPath]);

  const clearGitDiffPreview = useCallback(() => {
    setGitDiffPreview(null);
  }, []);

  const openFile = useCallback((filePath, opts = {}) => {
    if (!filePath) return;
    if (!opts?.preserveGitPreview) {
      clearGitDiffPreview();
    }
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
  }, [clearGitDiffPreview]);

  const handleGitPanelOpenFile = useCallback((entry, _sectionId) => {
    const filePath = String(entry?.file || '').trim();
    if (!filePath) return;

    if (entry?.deleted) {
      showMessage('Ce fichier est supprime dans le working tree. Ouvrez le diff Git pour l\'inspecter.', 3000);
      return;
    }

    setCenterView('code');
    openFile(filePath);
  }, [openFile, showMessage]);

  const handleOpenGitDiff = useCallback(async (entry, sectionId) => {
    if (!currentProjectPath || !isElectronApiAvailable || typeof window.electronAPI?.gitReadFileState !== 'function') {
      showMessage('Inspection Git indisponible.', 3000);
      return;
    }

    const filePath = String(entry?.file || '').trim();
    if (!filePath) return;

    try {
      const response = await window.electronAPI.gitReadFileState(currentProjectPath, filePath);
      if (!response?.success) {
        showMessage(`Diff Git: ${response?.error || 'erreur inconnue'}`, 4000);
        return;
      }

      let originalCode = '';
      let modifiedCode = '';
      let baseLabel = 'HEAD';
      let targetLabel = 'working tree';

      if (sectionId === 'staged') {
        originalCode = response.existsInHead ? response.headContent : '';
        modifiedCode = response.existsInIndex ? response.indexContent : '';
        baseLabel = response.existsInHead ? 'HEAD' : 'empty';
        targetLabel = response.existsInIndex ? 'index' : 'deleted';
      } else {
        originalCode = response.existsInIndex
          ? response.indexContent
          : (response.existsInHead ? response.headContent : '');
        modifiedCode = response.existsInWorking ? response.workingContent : '';
        baseLabel = response.existsInIndex ? 'index' : (response.existsInHead ? 'HEAD' : 'empty');
        targetLabel = response.existsInWorking ? 'working tree' : 'deleted';
      }

      setGitDiffPreview({
        filePath: response.filePath,
        originalCode,
        modifiedCode,
        sectionId,
        baseLabel,
        targetLabel,
        comparisonKey: `${sectionId}:${response.filePath}:${String(entry?.previousFile || '')}`,
        existsInWorking: !!response.existsInWorking
      });
      setCenterView('code');

      if (response.existsInWorking) {
        openFile(response.filePath, { preserveGitPreview: true });
      }
    } catch (error) {
      showMessage(`Diff Git: ${error.message}`, 4000);
    }
  }, [currentProjectPath, isElectronApiAvailable, openFile, showMessage]);

  const loadAgentRun = useCallback(async (runId) => {
    if (!currentProjectPath || !isElectronApiAvailable || !window.electronAPI?.agentGetRun || !runId) {
      setActiveAgentRun(null);
      return null;
    }
    const res = await window.electronAPI.agentGetRun(currentProjectPath, runId);
    if (res?.success && res.run) {
      setActiveAgentRun(res.run);
      setSelectedAgentRunId(res.run.id);
      return res.run;
    }
    setActiveAgentRun(null);
    return null;
  }, [currentProjectPath, isElectronApiAvailable]);

  const loadAgentRuns = useCallback(async (preferredRunId = selectedAgentRunId) => {
    if (!currentProjectPath || !isElectronApiAvailable || !window.electronAPI?.agentListRuns) {
      setAgentRuns([]);
      setActiveAgentRun(null);
      setSelectedAgentRunId('');
      return;
    }

    setIsAgentRunsLoading(true);
    try {
      const res = await window.electronAPI.agentListRuns(currentProjectPath);
      const runs = res?.success && Array.isArray(res.runs) ? res.runs : [];
      setAgentRuns(runs);
      const nextRunId = preferredRunId && runs.some((run) => run.id === preferredRunId)
        ? preferredRunId
        : runs[0]?.id || '';
      setSelectedAgentRunId(nextRunId);
      if (nextRunId) {
        await loadAgentRun(nextRunId);
      } else {
        setActiveAgentRun(null);
      }
    } finally {
      setIsAgentRunsLoading(false);
    }
  }, [currentProjectPath, isElectronApiAvailable, loadAgentRun, selectedAgentRunId]);

  const handleSelectAgentRun = useCallback((runId) => {
    setSelectedAgentRunId(runId);
    loadAgentRun(runId);
  }, [loadAgentRun]);

  const refreshAgentRunAfterMutation = useCallback(async (runId = selectedAgentRunId) => {
    await loadAgentRuns(runId);
  }, [loadAgentRuns, selectedAgentRunId]);

  useEffect(() => {
    loadAgentRuns('');
  }, [currentProjectPath, loadAgentRuns]);

  useEffect(() => {
    if (!activeAgentRunId) return;
    loadAgentRuns(activeAgentRunId);
    setCenterView('ai-changes');
  }, [activeAgentRunId, agentRunRefreshKey, loadAgentRuns]);

  useEffect(() => {
    if (!isElectronApiAvailable || !window.electronAPI?.onAgentAction) return;
    const off = window.electronAPI.onAgentAction((event) => {
      if (!event?.runId) return;
      loadAgentRuns(event.runId);
    });
    return () => {
      if (typeof off === 'function') off();
    };
  }, [isElectronApiAvailable, loadAgentRuns]);

  const syncNavigatorReferences = useCallback((previousPath, nextPath) => {
    if (!previousPath || !nextPath) return;

    setOpenFiles((prev) => {
      const mapped = prev.map((filePath) => replaceNavigatorPathPrefix(filePath, previousPath, nextPath));
      return Array.from(new Set(mapped));
    });
    setActiveFile((prev) => replaceNavigatorPathPrefix(prev, previousPath, nextPath));
    setRevealRequest((prev) => {
      if (!prev?.file) return prev;
      const nextFile = replaceNavigatorPathPrefix(prev.file, previousPath, nextPath);
      return nextFile === prev.file ? prev : { ...prev, file: nextFile };
    });
    setAiDraftPreview((prev) => {
      if (!prev?.filePath) return prev;
      const nextFile = replaceNavigatorPathPrefix(prev.filePath, previousPath, nextPath);
      return nextFile === prev.filePath ? prev : { ...prev, filePath: nextFile };
    });
    setGitDiffPreview((prev) => {
      if (!prev?.filePath) return prev;
      const nextFile = replaceNavigatorPathPrefix(prev.filePath, previousPath, nextPath);
      return nextFile === prev.filePath ? prev : { ...prev, filePath: nextFile };
    });
  }, []);

  const removeNavigatorReferences = useCallback((deletedPath) => {
    if (!deletedPath) return;

    setOpenFiles((prev) => {
      const next = prev.filter((filePath) => (
        !isSameNavigatorPath(filePath, deletedPath) &&
        !isNavigatorDescendant(filePath, deletedPath)
      ));

      setActiveFile((currentActiveFile) => {
        if (
          !currentActiveFile ||
          (!isSameNavigatorPath(currentActiveFile, deletedPath) &&
            !isNavigatorDescendant(currentActiveFile, deletedPath))
        ) {
          return currentActiveFile;
        }
        return next[0] || '';
      });

      return next;
    });

    setRevealRequest((prev) => {
      if (!prev?.file) return prev;
      if (isSameNavigatorPath(prev.file, deletedPath) || isNavigatorDescendant(prev.file, deletedPath)) {
        return null;
      }
      return prev;
    });

    setAiDraftPreview((prev) => {
      if (!prev?.filePath) return prev;
      if (isSameNavigatorPath(prev.filePath, deletedPath) || isNavigatorDescendant(prev.filePath, deletedPath)) {
        return null;
      }
      return prev;
    });
    setGitDiffPreview((prev) => {
      if (!prev?.filePath) return prev;
      if (isSameNavigatorPath(prev.filePath, deletedPath) || isNavigatorDescendant(prev.filePath, deletedPath)) {
        return null;
      }
      return prev;
    });
  }, []);

  const closeFileTab = useCallback((filePath) => {
    if (!filePath) return;
    if (String(gitDiffPreview?.filePath || '') === String(filePath)) {
      clearGitDiffPreview();
    }
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
  }, [activeFile, clearGitDiffPreview, gitDiffPreview?.filePath]);

  const handleExplorerCreateItem = useCallback(async (type, itemName, parentPath = '') => {
    const requestedPath = parentPath ? joinNavigatorPath(parentPath, itemName, parentPath) : itemName;
    return createNewItem(type, requestedPath);
  }, [createNewItem]);

  const handleExplorerRenameItem = useCallback(async (itemPath, nextPath, itemType) => {
    const result = await renameItem(itemPath, nextPath, itemType);
    if (result?.success) {
      syncNavigatorReferences(itemPath, nextPath);
    }
    return result;
  }, [renameItem, syncNavigatorReferences]);

  const handleExplorerMoveItem = useCallback(async (itemPath, nextPath, itemType) => {
    const result = await moveItem(itemPath, nextPath, itemType);
    if (result?.success) {
      syncNavigatorReferences(itemPath, nextPath);
    }
    return result;
  }, [moveItem, syncNavigatorReferences]);

  const handleExplorerDeleteItem = useCallback(async (itemPath, itemType) => {
    const result = await deleteItem(itemPath, itemType);
    if (result?.success) {
      removeNavigatorReferences(itemPath);
    }
    return result;
  }, [deleteItem, removeNavigatorReferences]);

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
        handleAiProviderChange(aiProvider === 'ollama' || aiProvider === 'ollama-multi' ? 'ollama-multi' : 'multi');
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
    handleAiProviderChange,
    aiProvider,
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
      clearTimeout(t);
    };
  }, [searchQuery, searchOpen, currentProjectPath, isElectronApiAvailable, showMessage]);

  useEffect(() => {
    if (!symbolOpen) return;

    const q = symbolQuery.trim();
    if (!q) {
      setSymbolResults([]);
      setIsSymbolLoading(false);
      return;
    }

    if (!currentProjectPath || !isElectronApiAvailable || !window.electronAPI?.searchSymbols) {
      return;
    }

    let cancelled = false;
    setIsSymbolLoading(true);

    const t = setTimeout(async () => {
      try {
        const res = await window.electronAPI.searchSymbols(currentProjectPath, q, {
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
      clearTimeout(t);
    };
  }, [symbolQuery, symbolOpen, currentProjectPath, isElectronApiAvailable, showMessage]);

  useEffect(() => {
    const handleGlobalKeys = (e) => {
      const target = e?.target;
      const tagName = String(target?.tagName || '').toLowerCase();
      if (target?.isContentEditable || tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
        return;
      }

      const key = String(e?.key || '').toLowerCase();
      if (!key) return;

      if ((e.ctrlKey || e.metaKey) && key === 'k') {
        e.preventDefault();
        setCommandOpen(true);
        setFilePaletteOpen(false);
        setSearchOpen(false);
        setSymbolOpen(false);
      }
      if ((e.ctrlKey || e.metaKey) && key === 'p') {
        e.preventDefault();
        setFilePaletteOpen(true);
        setCommandOpen(false);
        setSearchOpen(false);
        setSymbolOpen(false);
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && key === 'f') {
        e.preventDefault();
        setSearchOpen(true);
        setCommandOpen(false);
        setFilePaletteOpen(false);
        setSymbolOpen(false);
      }
      if ((e.ctrlKey || e.metaKey) && key === 't') {
        e.preventDefault();
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

  const handleSymbolKey = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!symbolResults.length) return;
      setSymbolIndex((prev) => Math.min(prev + 1, symbolResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!symbolResults.length) return;
      setSymbolIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (!symbolResults.length) return;
      const item = symbolResults[symbolIndex] || symbolResults[0];
      runSymbolPick(item);
    } else if (e.key === 'Escape') {
      setSymbolOpen(false);
    }
  };

  const completeOnboarding = useCallback(async () => {
    setShowOnboarding(false);
    if (!isElectronApiAvailable || !window.electronAPI?.loadSettings || !window.electronAPI?.saveSettings) {
      return;
    }

    try {
      const current = await window.electronAPI.loadSettings();
      const nextSettings = {
        ...(current?.settings || {}),
        onboardingCompleted: true
      };
      await window.electronAPI.saveSettings(nextSettings);
      window.dispatchEvent(new CustomEvent('settings-updated', { detail: nextSettings }));
      showMessage('Onboarding termine.', 2000);
    } catch {
      // silent
    }
  }, [isElectronApiAvailable, showMessage]);

  const middleWidth = Math.max(0, 100 - leftWidth - rightWidth);
  const previewPort = String(runtimeDevPort || devPort || '3004');
  const previewUrl = `http://localhost:${previewPort}`;
  const displayedActiveFile = aiDraftPreview?.filePath || gitDiffPreview?.filePath || activeFile;
  const displayedCode = aiDraftPreview?.code ?? gitDiffPreview?.modifiedCode ?? code;
  const displayedPreviousCode = gitDiffPreview?.originalCode ?? previousCode;
  const isStreamingCodePreview = Boolean(aiDraftPreview?.filePath);
  const activeDiffSource = gitDiffPreview ? 'git' : (isDiffMode ? 'ai' : null);
  const isEditorDiffMode = Boolean(gitDiffPreview) || isDiffMode;
  const editorReadOnly = isReadOnlyMode || isStreamingCodePreview || Boolean(gitDiffPreview);
  const aiModelSelection = useMemo(() => ({
    geminiModel,
    claudeModel,
    kimiModel,
    ollamaModel: resolvedOllamaModel,
    ollamaModelCoder: resolvedOllamaCoder,
    resolvedOllamaModel,
    resolvedOllamaCoder,
    ...providerApiKeys
  }), [
    claudeModel,
    geminiModel,
    kimiModel,
    providerApiKeys,
    resolvedOllamaCoder,
    resolvedOllamaModel
  ]);
  const editorProps = {
    openFiles,
    activeFile: displayedActiveFile,
    code: displayedCode,
    previousCode: displayedPreviousCode,
    onCodeChange: handleCodeChange,
    onUndo: handleUndo,
    onAcceptDiff: handleAcceptDiff,
    isDiffMode: isEditorDiffMode,
    diffSource: activeDiffSource,
    diffOriginalLabel: gitDiffPreview?.baseLabel,
    diffModifiedLabel: gitDiffPreview?.targetLabel,
    onCloseDiff: clearGitDiffPreview,
    onSelectFile: openFile,
    onCloseFile: closeFileTab,
    revealRequest,
    forceReadOnly: editorReadOnly,
    currentProjectPath,
    aiProvider,
    aiModels: aiModelSelection
  };
  const previewPanelProps = {
    projectId: currentProjectPath || 'default',
    status: previewStatus,
    onRefresh: handlePreviewRefresh,
    previewUrl,
    className: 'flex-1'
  };
  const terminalPanelProps = {
    currentProjectPath,
    isElectronApiAvailable,
    showMessage,
    permissionMode,
    preferredDevPort: devPort,
    onDevPortResolved: setRuntimeDevPort
  };
  const workspacePanelProps = {
    workspaces,
    currentProjectPath,
    projectRunState,
    isElectronApiAvailable,
    activeConversationFile,
    conversationsRefreshKey,
    onSelectProject: handleSelectProject,
    onOpenConversation: handleOpenConversation,
    onOpenProject: handleOpenFolder,
    onRemoveProject: handleRemoveProject,
    onNewConversation: startNewConversation
  };
  const gitPanelProps = {
    currentProjectPath,
    isElectronApiAvailable,
    showMessage,
    permissionMode,
    onOpenFile: handleGitPanelOpenFile,
    onOpenGitDiff: handleOpenGitDiff,
    activeComparisonKey: gitDiffPreview?.comparisonKey || ''
  };
  const aiChangesPanelProps = {
    currentProjectPath,
    runs: agentRuns,
    activeRun: activeAgentRun,
    selectedRunId: selectedAgentRunId,
    isLoading: isAgentRunsLoading,
    permissionMode,
    pendingFileChanges,
    onSelectRun: handleSelectAgentRun,
    onRefresh: () => loadAgentRuns(selectedAgentRunId),
    onRunChanged: refreshAgentRunAfterMutation,
    onSelectPendingChange: selectPendingChangeByIndex,
    onApplyPendingChange: applyPendingChangeByIndex,
    onRejectPendingChange: rejectPendingChangeByIndex,
    onUpdatePendingChangeContent: updatePendingChangeContent,
    onAfterDiskChange: loadProjectItems,
    showMessage
  };
  const brainGraphPanelProps = {
    currentProjectPath,
    isElectronApiAvailable,
    showMessage,
    activeFile,
    onOpenFile: openFile
  };
  const workflowPanelProps = {
    currentProjectPath,
    isElectronApiAvailable,
    showMessage,
    aiProvider,
    aiModels: aiModelSelection
  };
  const aiChatProps = {
    prompt,
    conversationHistory: aiConversationHistory,
    isLoading,
    currentProjectPath,
    isElectronApiAvailable,
    onPromptChange: setPrompt,
    onSend: generateAIResponse,
    onSaveConversation: saveConversation,
    aiProvider,
    onProviderChange: handleAiProviderChange,
    executionMode,
    onExecutionModeChange: setExecutionMode,
    runPreset,
    onRunPresetChange: setRunPreset,
    multiAgentFormationKey,
    onMultiAgentFormationChange: setMultiAgentFormationKey,
    disabledAgentKeys,
    onDisabledAgentKeysChange: setDisabledAgentKeys,
    thinkingMode,
    onThinkingModeChange: setThinkingMode,
    deepContextEnabled,
    onDeepContextEnabledChange: setDeepContextEnabled,
    onPasteImage: addImageMessage,
    multiAIState,
    conversations,
    activeConversationFile,
    isConversationLoading,
    onNewConversation: startNewConversation,
    onSelectConversation: loadConversationByFile,
    onStopGeneration: stopGeneration,
    workflows,
    findWorkflow,
    getWorkflow,
    parseSlashCommand,
    activeFile,
    agents: availableAgents,
    skills: availableSkills,
    activeAgent,
    activeSkill,
    onActiveAgentChange: setActiveAgent,
    onActiveSkillChange: setActiveSkill,
    globalSkillsCount: availableSkills.filter((skill) => skill.scope === 'global').length,
    pendingImages,
    onRemovePendingImage: (idx) => setPendingImages((prev) => prev.filter((_, i) => i !== idx)),
    pendingMessage,
    pendingFileChanges,
    activePendingChangeId,
    onSelectPendingChange: selectPendingChangeByIndex,
    onApplyPendingChange: applyPendingChangeByIndex,
    onRejectPendingChange: rejectPendingChangeByIndex,
    onApplyAllPendingChanges: applyAllPendingChanges,
    onRejectAllPendingChanges: rejectAllPendingChanges,
    pendingSnapshotId,
    contextEstimate,
    permissionMode,
    projectFileList,
    onStreamingDraftChange: handleStreamingDraftChange,
    resolvedOllamaModel,
    resolvedOllamaArchitect,
    resolvedOllamaCoder,
    resolvedOllamaTester,
    availableOllamaModels,
    onOllamaSettingChange: handleOllamaSettingChange,
    isExpertMode
  };

  return (
    <div className="app-shell">
      {message && (
        <div className="toast">
          <span className="toast-dot"></span>
          <span>{message}</span>
        </div>
      )}

      <AppTopbar
        projectName={projectName}
        currentProjectPath={currentProjectPath}
        displayedActiveFile={displayedActiveFile}
        isStreamingCodePreview={isStreamingCodePreview}
        gitDiffPreview={gitDiffPreview}
        onOpenCommandPalette={() => setCommandOpen(true)}
        isExpertMode={isExpertMode}
        onToggleExpertMode={() => setIsExpertMode((prev) => !prev)}
        aiProvider={aiProvider}
        onAiProviderChange={handleAiProviderChange}
        activeModelValue={activeModelValue}
        availableActiveModels={availableActiveModels}
        onActiveModelChange={handleActiveModelChange}
        thinkingMode={thinkingMode}
        onThinkingModeChange={setThinkingMode}
        deepContextEnabled={deepContextEnabled}
        onDeepContextEnabledChange={setDeepContextEnabled}
        isElectronApiAvailable={isElectronApiAvailable}
        isLoading={isLoading}
        multiAIState={multiAIState}
        resolvedOllamaModel={resolvedOllamaModel}
        resolvedOllamaArchitect={resolvedOllamaArchitect}
        resolvedOllamaCoder={resolvedOllamaCoder}
        resolvedOllamaTester={resolvedOllamaTester}
        availableOllamaModels={availableOllamaModels}
        recommendedOllamaModel={recommendedOllamaModel}
        onOllamaSettingChange={handleOllamaSettingChange}
        ollamaTopbarLabel={ollamaTopbarLabel}
        ollamaStatusLabel={ollamaStatusLabel}
        showMessage={showMessage}
        onOpenFolder={handleOpenFolder}
        previewStatus={previewStatus}
        onTogglePreview={handleTogglePreview}
        onToggleLeftPanel={toggleLeftPanel}
        isLeftCollapsed={isLeftCollapsed}
        onToggleRightPanel={toggleRightPanel}
        isRightCollapsed={isRightCollapsed}
        onOpenWorkflowManager={() => setWorkflowManagerOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        theme={theme}
        onThemeChange={setTheme}
        isTerminalOpen={isTerminalOpen}
        onToggleTerminal={() => setIsTerminalOpen(prev => !prev)}
      />

      <WorkspaceLayout
        layoutRef={layoutRef}
        leftWidth={leftWidth}
        rightWidth={rightWidth}
        middleWidth={middleWidth}
        isLeftCollapsed={isLeftCollapsed}
        isRightCollapsed={isRightCollapsed}
        dragging={dragging}
        onDragStart={handleDragStart}
        projectItems={projectItems}
        currentProjectPath={currentProjectPath}
        activeFile={activeFile}
        expandedFolders={expandedFolders}
        newItemName={newItemName}
        isElectronApiAvailable={isElectronApiAvailable}
        onOpenFolder={handleOpenFolder}
        onCreateItem={handleExplorerCreateItem}
        onRenameItem={handleExplorerRenameItem}
        onMoveItem={handleExplorerMoveItem}
        onDeleteItem={handleExplorerDeleteItem}
        onToggleFolder={toggleFolderExpansion}
        onFileClick={openFile}
        onNewItemNameChange={setNewItemName}
        isReadOnlyMode={isReadOnlyMode}
        centerView={centerView}
        onCenterViewChange={setCenterView}
        isFocusMode={isFocusMode}
        onToggleFocusMode={toggleFocusMode}
        editorProps={editorProps}
        previewProps={previewPanelProps}
        terminalProps={terminalPanelProps}
        gitPanelProps={gitPanelProps}
        aiChangesPanelProps={aiChangesPanelProps}
        brainGraphProps={brainGraphPanelProps}
        workflowProps={workflowPanelProps}
        aiChatProps={aiChatProps}
        workspacePanelProps={workspacePanelProps}
        isTerminalOpen={isTerminalOpen}
        onToggleTerminal={() => setIsTerminalOpen(prev => !prev)}
      />

      <StatusBar
        centerView={centerView}
        previewStatus={previewStatus}
        isStreamingCodePreview={isStreamingCodePreview}
        aiDraftPreview={aiDraftPreview}
        gitDiffPreview={gitDiffPreview}
        aiProvider={aiProvider}
        thinkingMode={thinkingMode}
        deepContextEnabled={deepContextEnabled}
        contextMode={contextMode}
        ollamaStatusLabel={ollamaStatusLabel}
        multiAIState={multiAIState}
        permissionMode={permissionMode}
        projectName={projectName}
        pendingAIChangeCount={pendingFileChanges.length}
      />

      {showOnboarding && (
        <OnboardingModal
          onOpenSettings={() => setSettingsOpen(true)}
          onComplete={completeOnboarding}
        />
      )}

      {settingsOpen && (
        <Settings
          isOpen={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          isElectronApiAvailable={isElectronApiAvailable}
          showMessage={showMessage}
          theme={theme}
          onThemeChange={setTheme}
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

      {symbolOpen && (
        <div className="command-overlay" onClick={() => setSymbolOpen(false)}>
          <div className="command-modal is-wide" onClick={(e) => e.stopPropagation()}>
            <div className="command-input-row">
              <input
                ref={symbolInputRef}
                value={symbolQuery}
                onChange={(e) => setSymbolQuery(e.target.value)}
                onKeyDown={handleSymbolKey}
                placeholder="Rechercher un symbole..."
                className="command-input"
              />
              <span className="command-hint">Ctrl+T</span>
            </div>

            <div className="command-list custom-scrollbar is-tall">
              {isSymbolLoading && (
                <div className="command-empty">Indexation des symboles...</div>
              )}
              {!isSymbolLoading && symbolQuery.trim() && symbolResults.length === 0 && (
                <div className="command-empty">Aucun symbole</div>
              )}
              {!isSymbolLoading && symbolResults.length > 0 && symbolResults.map((result, index) => (
                <button
                  key={`${result.file}:${result.line}:${result.column}:${result.symbol}`}
                  className={`command-item search-item ${index === symbolIndex ? 'is-active' : ''}`}
                  onClick={() => runSymbolPick(result)}
                >
                  <div className="search-left">
                    <div className="search-meta">{result.kind} · {result.file}:{result.line}</div>
                    <div className="search-snippet">{result.symbol} — {result.text}</div>
                  </div>
                  <span className="command-shortcut">Entrée</span>
                </button>
              ))}
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
