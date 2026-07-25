import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import './AIChat.css';
import { LiveFilesPanel } from '../LoadingAnimations';
import SyntaxHighlightedCode from './SyntaxHighlightedCode';
import { EXECUTION_MODES } from '../../utils/agentModes';
import AIDecisionBadge from './AIDecisionBadge';
import { AUTONOMY_LEVELS, toLegacyPermission } from './AutonomyControls';

const WORKFLOW_STREAM_REGEX = /\*\*WORKFLOW:/i;
const DIFF_STREAM_REGEX = /<<<<\s*SEARCH/i;
const FILE_STREAM_REGEX = /(?:^|\n)FILE:\s*.+/i;
const FILE_BLOCK_STREAM_REGEX = /\*\*FICHIER:\s*(.+?)\*\*\s*```([\w-]*)?\s*([\s\S]*?)(?:```|$)/gi;
const WORKFLOW_BLOCK_STREAM_REGEX = /\*\*WORKFLOW:\s*(.+?)\*\*\s*```(?:json)?\s*([\s\S]*?)(?:```|$)/gi;
const WORKFLOW_STREAM_STEPS = [
  { key: 'analysis', label: 'Analyse du besoin', detail: 'Lecture du prompt et extraction des actions' },
  { key: 'nodes', label: 'Creation des noeuds', detail: 'Placement trigger, actions et sorties' },
  { key: 'links', label: 'Cablage des liens', detail: 'Connexion des transitions entre etapes' },
  { key: 'checks', label: 'Verification', detail: 'Controle de coherence du flux' },
  { key: 'final', label: 'Finalisation', detail: 'Workflow pret pour import visuel' }
];

const extractLastStreamingMatch = (regex, text) => {
  if (!text) return null;
  const safeText = String(text);
  const nextRegex = new RegExp(regex.source, regex.flags);
  let lastMatch = null;
  let match;
  while ((match = nextRegex.exec(safeText)) !== null) {
    lastMatch = match;
    if (match.index === nextRegex.lastIndex) {
      nextRegex.lastIndex += 1;
    }
  }
  return lastMatch;
};

const extractStreamingFileDraft = (text) => {
  const match = extractLastStreamingMatch(FILE_BLOCK_STREAM_REGEX, text);
  if (!match) return null;
  return {
    filePath: String(match[1] || '').trim(),
    language: String(match[2] || '').trim(),
    code: String(match[3] || '').replace(/^\s*\n/, '')
  };
};

// Liste tous les fichiers cités dans le stream pour l'affichage live.
// Le dernier est en cours d'écriture, les précédents sont écrits.
const FILE_HEADER_STREAM_REGEX = /\*\*FICHIER:\s*(.+?)\*\*/gi;
const extractStreamingFiles = (text) => {
  if (!text) return [];
  const re = new RegExp(FILE_HEADER_STREAM_REGEX.source, FILE_HEADER_STREAM_REGEX.flags);
  const paths = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const p = String(m[1] || '').trim();
    if (p && paths[paths.length - 1] !== p) paths.push(p);
  }
  return paths.map((p, i) => ({ path: p, status: i === paths.length - 1 ? 'writing' : 'done' }));
};

const filterUserVisibleText = (text) => {
  if (!text) return '';
  // Remove internal workflow construction details
  // Remove lines starting with "Construction du workflow", "Trigger", "AI", "Output", "Analyse du besoin", etc.
  return text
    .split('\n')
    .filter(line => {
      const trimmed = line.trim();
      // Filter out technical workflow steps and internal details
      if (/^(Construction du workflow|Trigger|AI|Output|Analyse du besoin|Creation des noeuds|Cablage des liens|Verification|Finalisation|Etape active:)/i.test(trimmed)) {
        return false;
      }
      // Filter out JSON blocks for workflows
      if (trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('"')) {
        return false;
      }
      // Filter out opening/closing braces and commas that are part of JSON
      if (/^[{}[\],]*$/.test(trimmed)) {
        return false;
      }
      return true;
    })
    .join('\n')
    .trim();
};

const extractStreamingWorkflowDraft = (text) => {
  const match = extractLastStreamingMatch(WORKFLOW_BLOCK_STREAM_REGEX, text);
  if (!match) return null;
  return {
    name: String(match[1] || '').trim(),
    json: String(match[2] || '').replace(/^\s*\n/, '')
  };
};

// Inverse of AutonomyControls' toLegacyPermission() adapter — lets the
// legacy read_only/edit_only/edit_terminal permissionMode prop (the real
// source of truth read by useFileOperations/useAIPendingChanges) drive the
// new restricted/normal/permissive AutonomyControls UI without introducing
// a second, disconnected state.
const fromLegacyPermission = (mode) => {
  if (mode === 'read_only') return 'restricted';
  if (mode === 'edit_only') return 'normal';
  return 'permissive'; // edit_terminal (and default)
};

// ─── AgentModePill ──────────────────────────────────────────────────────────
// Single fused control replacing the old separate ModePill (Ask/Plan/Agent)
// + the "Agent" persona picker: one dropdown, top section = execution modes,
// bottom section = custom agent personas (mirrors VS Code's Agent selector).
const AgentModePill = ({
  executionMode,
  onExecutionModeChange,
  activeAgent,
  onActiveAgentChange,
  agents,
  onOpenAgentManager,
  disabled
}) => {
  const [open, setOpen] = useState(false);
  const currentMode = EXECUTION_MODES.find((m) => m.id === executionMode) || EXECUTION_MODES[0];
  const label = activeAgent ? activeAgent.name : (currentMode?.label || 'Agent');
  const icon = activeAgent ? '👤' : (currentMode?.icon || '🔧');

  const selectMode = (modeId) => {
    if (typeof onExecutionModeChange === 'function') onExecutionModeChange(modeId);
    if (typeof onActiveAgentChange === 'function') onActiveAgentChange(null);
    setOpen(false);
  };

  const selectAgent = (agent) => {
    if (typeof onActiveAgentChange === 'function') onActiveAgentChange(agent);
    if (typeof onExecutionModeChange === 'function') onExecutionModeChange('agent');
    setOpen(false);
  };

  const openAgentManager = () => {
    if (typeof onOpenAgentManager === 'function') onOpenAgentManager();
    setOpen(false);
  };

  return (
    <div className="ai-pill-wrap">
      <button
        type="button"
        className="ai-pill"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        title="Mode d'exécution / Agent"
      >
        <span aria-hidden="true">{icon}</span>
        {label}
      </button>
      {open && (
        <div className="ai-pill-menu" role="menu">
          {EXECUTION_MODES.map((mode) => (
            <button
              type="button"
              role="menuitemradio"
              aria-checked={mode.id === executionMode && !activeAgent}
              key={mode.id}
              className={`ai-pill-menu-item ${mode.id === executionMode && !activeAgent ? 'is-active' : ''}`}
              onClick={() => selectMode(mode.id)}
              title={mode.description}
            >
              <span aria-hidden="true">{mode.icon}</span> {mode.label}
            </button>
          ))}
          {(agents || []).length > 0 && (
            <>
              <div className="ai-pill-menu-separator" />
              {agents.map((agent) => (
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={activeAgent?.name === agent.name}
                  key={`${agent.scope || ''}:${agent.name}`}
                  className={`ai-pill-menu-item ${activeAgent?.name === agent.name ? 'is-active' : ''}`}
                  onClick={() => selectAgent(agent)}
                  title={agent.description}
                >
                  <span aria-hidden="true">👤</span> {agent.name}
                </button>
              ))}
            </>
          )}
          {typeof onOpenAgentManager === 'function' && (
            <>
              <div className="ai-pill-menu-separator" />
              <button
                type="button"
                role="menuitem"
                className="ai-pill-menu-item ai-pill-menu-item--muted"
                onClick={openAgentManager}
                title="Créer, modifier ou supprimer des agents personnalisés"
              >
                Configurer les agents...
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
};

// ─── AutonomyPill ───────────────────────────────────────────────────────────
// Compact pill showing the current autonomy level (dot + label); click opens
// a popover to switch between Lecture seule / Supervisé / Autonome.
const AutonomyPill = ({ autonomyLevel, onAutonomyLevelChange, disabled }) => {
  const [open, setOpen] = useState(false);
  const current = AUTONOMY_LEVELS.find((l) => l.id === autonomyLevel) || AUTONOMY_LEVELS[0];

  return (
    <div className="ai-pill-wrap">
      <button
        type="button"
        className="ai-pill"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        title={current.helper}
      >
        <span className={`ai-pill-dot ai-pill-dot--${current.tone}`} aria-hidden="true" />
        {current.label}
      </button>
      {open && (
        <div className="ai-pill-menu" role="menu">
          {AUTONOMY_LEVELS.map((level) => (
            <button
              type="button"
              role="menuitemradio"
              aria-checked={level.id === autonomyLevel}
              key={level.id}
              className={`ai-pill-menu-item ${level.id === autonomyLevel ? 'is-active' : ''}`}
              onClick={() => { onAutonomyLevelChange(level.id); setOpen(false); }}
              title={level.helper}
            >
              <span className={`ai-pill-dot ai-pill-dot--${level.tone}`} aria-hidden="true" />
              {level.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── ProviderPill / ModelPill ───────────────────────────────────────────────
// Two independent pills instead of one combined "{Provider} · {modèle}"
// control — a single button used to hide which provider was active behind
// a raw model string (e.g. "gemini-3-1-pro" alone doesn't say "Gemini").
// Each pill owns its own popover: ProviderPill only lists providers,
// ModelPill only lists models for the currently active provider (already
// scoped via availableActiveModels, computed per-provider in
// useAIModelSettings/App.js).
const PROVIDER_PILL_LABELS = { gemini: 'Gemini', claude: 'Claude', kimi: 'Kimi', ollama: 'Ollama' };
const PROVIDER_PILL_OPTIONS = ['gemini', 'claude', 'kimi', 'ollama'];

const ProviderPill = ({ aiProvider, onProviderChange, disabled }) => {
  const [open, setOpen] = useState(false);
  const providerLabel = PROVIDER_PILL_LABELS[aiProvider] || aiProvider || 'Gemini';

  return (
    <div className="ai-pill-wrap">
      <button
        type="button"
        className="ai-pill"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        title="Fournisseur IA"
      >
        {providerLabel}
      </button>
      {open && (
        <div className="ai-pill-menu" role="menu">
          {PROVIDER_PILL_OPTIONS.map((provider) => (
            <button
              type="button"
              role="menuitemradio"
              aria-checked={provider === aiProvider}
              key={provider}
              className={`ai-pill-menu-item ${provider === aiProvider ? 'is-active' : ''}`}
              onClick={() => { if (typeof onProviderChange === 'function') onProviderChange(provider); setOpen(false); }}
            >
              {PROVIDER_PILL_LABELS[provider]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const ModelPill = ({
  aiProvider,
  activeModelValue,
  availableActiveModels,
  onActiveModelChange,
  disabled
}) => {
  const [open, setOpen] = useState(false);
  const models = Array.isArray(availableActiveModels) ? availableActiveModels : [];

  return (
    <div className="ai-pill-wrap">
      <button
        type="button"
        className="ai-pill"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        title={`Modèle ${PROVIDER_PILL_LABELS[aiProvider] || aiProvider || ''}`}
      >
        {activeModelValue || 'Modèle'}
      </button>
      {open && models.length > 0 && (
        <div className="ai-pill-menu" role="menu">
          {models.map((model) => (
            <button
              type="button"
              role="menuitemradio"
              aria-checked={model === activeModelValue}
              key={model}
              className={`ai-pill-menu-item ${model === activeModelValue ? 'is-active' : ''}`}
              onClick={() => { if (typeof onActiveModelChange === 'function') onActiveModelChange(model); setOpen(false); }}
              title={model}
            >
              {model}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const AIChat = ({
  prompt,
  conversationHistory,
  isLoading,
  currentProjectPath,
  isElectronApiAvailable,
  onPromptChange,
  onSend,
  onSaveConversation,
  onPasteImage,
  multiAIState,
  conversations = [],
  activeConversationFile,
  isConversationLoading = false,
  onNewConversation,
  onSelectConversation,
  onStopGeneration,
  workflows = [],
  // eslint-disable-next-line no-unused-vars
  findWorkflow,
  getWorkflow,
  parseSlashCommand,
  activeFile,
  onProviderChange,
  globalSkillsCount = 0,
  aiProvider = 'gemini',
  executionMode = 'agent',
  onExecutionModeChange,
  autoRoute = false,
  // eslint-disable-next-line no-unused-vars
  onAutoRouteChange,
  routerDecision = null,
  // Reserved for the upcoming "Routeur Intelligent" Settings tab (L2 classifier
  // provider/model override + L1/L2 complexity threshold). Not rendered here yet;
  // threaded through so callers can already pass them once that tab exists.
  // eslint-disable-next-line no-unused-vars
  routerClassifierProvider = null,
  // eslint-disable-next-line no-unused-vars
  routerClassifierModel = null,
  // eslint-disable-next-line no-unused-vars
  routerComplexityThreshold = 0.5,
  agents = [],
  activeAgent = null,
  onActiveAgentChange,
  onOpenAgentManager,
  // ModelPill: activeModelValue/availableActiveModels/onActiveModelChange are
  // already the unified per-provider accessors computed in useAIModelSettings
  // (App.js) — they resolve to the Ollama model/list/setter automatically
  // when aiProvider === 'ollama', so no separate Ollama-specific props are
  // needed here.
  activeModelValue = '',
  availableActiveModels = [],
  onActiveModelChange,
  pendingImages = [],
  onRemovePendingImage,
  pendingMessage = null,
  projectFileList = [],
  pendingFileChanges = [],
  activePendingChangeId = null,
  onSelectPendingChange,
  onApplyPendingChange,
  onRejectPendingChange,
  onApplyAllPendingChanges,
  onRejectAllPendingChanges,
  pendingSnapshotId = null,
  contextEstimate = null,
  permissionMode = 'edit_terminal',
  onPermissionModeChange,
  onStreamingDraftChange
}) => {
  const conversationHistoryRef = useRef(null);
  const promptInputRef = useRef(null);
  const [showConversations, setShowConversations] = useState(false);
  const [showPlusMenu, setShowPlusMenu] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showWorkflowSuggestions, setShowWorkflowSuggestions] = useState(false);
  const [workflowFilter, setWorkflowFilter] = useState('');

  // Mentions Context
  const [showContextSuggestions, setShowContextSuggestions] = useState(false);
  const [contextFilter, setContextFilter] = useState('');
  const [explicitContext, setExplicitContext] = useState([]); // List of explicitly mentioned files
  const [isApplyingPending, setIsApplyingPending] = useState(false);
  const [isBulkApplyingPending, setIsBulkApplyingPending] = useState(false);

  const [terminalActions, setTerminalActions] = useState([]); // AI terminal ReAct cards
  const [streamingText, setStreamingText] = useState('');       // live streaming output
  const [streamingMode, setStreamingMode] = useState('text');   // text | workflow | code | diff
  const [workflowAnimStep, setWorkflowAnimStep] = useState(0);
  const streamingRef = useRef(null);
  const streamingBufferRef = useRef('');
  const streamingFlushRafRef = useRef(null);
  const streamingScrollRafRef = useRef(null);

  const flushStreamingBuffer = useCallback(() => {
    streamingFlushRafRef.current = null;
    const chunk = streamingBufferRef.current;
    if (!chunk) return;
    streamingBufferRef.current = '';
    setStreamingText((prev) => prev + chunk);
  }, []);

  // Register AI terminal IPC events
  useEffect(() => {
    if (!isElectronApiAvailable || !window.electronAPI?.onAITerminalAction) return;
    const offAction = window.electronAPI.onAITerminalAction((data) => {
      setTerminalActions(prev => [...prev, { type: 'running', command: data.command, iteration: data.iteration, output: null }]);
    });
    const offResult = window.electronAPI.onAITerminalResult((data) => {
      setTerminalActions(prev => prev.map((a, i) =>
        i === prev.length - 1 && a.command === data.command
          ? { ...a, type: 'done', output: data.output }
          : a
      ));
    });
    return () => {
      if (typeof offAction === 'function') offAction();
      if (typeof offResult === 'function') offResult();
    };
  }, [isElectronApiAvailable]);

  useEffect(() => {
    if (!isElectronApiAvailable || !window.electronAPI?.onAIGenerationToken) return;
    const offToken = window.electronAPI.onAIGenerationToken((data) => {
      if (!data) return;

      if (data.done) {
        if (streamingFlushRafRef.current !== null) {
          window.cancelAnimationFrame(streamingFlushRafRef.current);
          flushStreamingBuffer();
        }
        return;
      }

      if (typeof data.token === 'string' && data.token.length > 0) {
        streamingBufferRef.current += data.token;
        if (streamingFlushRafRef.current === null) {
          streamingFlushRafRef.current = window.requestAnimationFrame(flushStreamingBuffer);
        }
      }
    });

    return () => {
      if (typeof offToken === 'function') offToken();
    };
  }, [flushStreamingBuffer, isElectronApiAvailable]);

  // Clear terminal actions and streaming when loading starts
  useEffect(() => {
    if (isLoading) {
      setTerminalActions([]);
      setStreamingText('');
      setStreamingMode('text');
      setWorkflowAnimStep(0);
      streamingBufferRef.current = '';
      if (streamingFlushRafRef.current !== null) {
        window.cancelAnimationFrame(streamingFlushRafRef.current);
        streamingFlushRafRef.current = null;
      }
    }
  }, [isLoading]);

  useEffect(() => {
    if (!streamingText) {
      setStreamingMode('text');
      return;
    }
    if (streamingMode === 'workflow' || streamingMode === 'diff') {
      return;
    }
    const sample = streamingText.slice(-8000);
    if (WORKFLOW_STREAM_REGEX.test(sample)) {
      setStreamingMode('workflow');
      return;
    }
    if (DIFF_STREAM_REGEX.test(sample)) {
      setStreamingMode('diff');
      return;
    }
    if (FILE_STREAM_REGEX.test(sample) || extractStreamingFileDraft(sample)) {
      setStreamingMode('code');
      return;
    }
    setStreamingMode('text');
  }, [streamingText, streamingMode]);

  useEffect(() => {
    if (!streamingText || !streamingRef.current) return;
    if (streamingScrollRafRef.current !== null) {
      window.cancelAnimationFrame(streamingScrollRafRef.current);
    }
    streamingScrollRafRef.current = window.requestAnimationFrame(() => {
      if (streamingRef.current) {
        streamingRef.current.scrollTop = streamingRef.current.scrollHeight;
      }
      streamingScrollRafRef.current = null;
    });
  }, [streamingText, streamingMode]);

  useEffect(() => {
    if (streamingMode !== 'workflow' || !isLoading) {
      setWorkflowAnimStep(0);
      return;
    }
    setWorkflowAnimStep(0);
    const stepInterval = window.setInterval(() => {
      setWorkflowAnimStep((prev) => Math.min(prev + 1, WORKFLOW_STREAM_STEPS.length - 1));
    }, 950);
    return () => window.clearInterval(stepInterval);
  }, [streamingMode, isLoading]);

  useEffect(() => {
    return () => {
      if (streamingFlushRafRef.current !== null) {
        window.cancelAnimationFrame(streamingFlushRafRef.current);
      }
      if (streamingScrollRafRef.current !== null) {
        window.cancelAnimationFrame(streamingScrollRafRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (conversationHistoryRef.current) {
      conversationHistoryRef.current.scrollTop = conversationHistoryRef.current.scrollHeight;
    }
  }, [conversationHistory, isLoading]);

  const handlePromptChange = (value) => {
    onPromptChange(value);

    // Slash command detection
    if (value.startsWith('/') && parseSlashCommand) {
      const parsed = parseSlashCommand(value);
      if (parsed) {
        setWorkflowFilter(parsed.command);
        setShowWorkflowSuggestions(true);
        setShowConversations(false);
        setShowContextSuggestions(false);
        return;
      }
    } else {
      setShowWorkflowSuggestions(false);
      setWorkflowFilter('');
    }

    // Mention detection (@file)
    const lastAtMatch = value.match(/@([^\s]*)$/);
    if (lastAtMatch) {
      setContextFilter(lastAtMatch[1]);
      setShowContextSuggestions(true);
      setShowWorkflowSuggestions(false);
      setShowConversations(false);
    } else {
      setShowContextSuggestions(false);
      setContextFilter('');
    }
  };

  const filteredWorkflows = workflows.filter(w =>
    w.name.toLowerCase().includes(workflowFilter.toLowerCase())
  );

  const handleSelectWorkflow = async (workflow) => {
    if (getWorkflow) {
      const fullWorkflow = await getWorkflow(workflow.name, workflow.scope);
      if (fullWorkflow && fullWorkflow.body) {
        onPromptChange(fullWorkflow.body);
      }
    }
    setShowWorkflowSuggestions(false);
    setWorkflowFilter('');
  };

  const filteredContextFiles = (projectFileList || []).filter(path =>
    path.toLowerCase().includes(contextFilter.toLowerCase())
  ).slice(0, 50); // limit to 50 for performance

  const handleSelectContextFile = (filePath) => {
    if (!explicitContext.includes(filePath)) {
      setExplicitContext(prev => [...prev, filePath]);
    }
    // Remove the @search part from the prompt
    const newPrompt = prompt.replace(/@[^\s]*$/, '');
    onPromptChange(newPrompt);
    setShowContextSuggestions(false);
    setContextFilter('');
    setTimeout(() => {
      promptInputRef.current?.focus();
    }, 10);
  };

  const removeExplicitContext = (filePath) => {
    setExplicitContext(prev => prev.filter(p => p !== filePath));
  };

  const handleSend = () => {
    if ((prompt.trim() || explicitContext.length > 0 || pendingImages.length > 0) && !isLoading) {
      setShowWorkflowSuggestions(false);
      setShowContextSuggestions(false);
      // We'll pass explicitContext via onSend if needed, or modify the prompt
      // Let's modify the prompt to prepend the explicit context requested
      if (explicitContext.length > 0 && typeof onSend === 'function') {
        const contextString = `[Contexte forcé: ${explicitContext.join(', ')}]\n\n`;
        // Hack: trigger onSend with context. We need to update useAI to handle this or just modify state.
        // Easiest is to modify prompt immediately before send, or let useAI handle it.
        // Actually since onSend reads state, let's just append it to the prompt.
        const augmentedPrompt = contextString + prompt;
        onPromptChange(augmentedPrompt);
        setExplicitContext([]);
        setTimeout(() => onSend(augmentedPrompt), 50);
      } else {
        onSend();
      }
    }
  };

  const handlePaste = (e) => {
    if (!onPasteImage) return;

    const items = e.clipboardData?.items;
    if (!items) return;

    const imageItems = Array.from(items).filter(item => item.type && item.type.startsWith('image/'));
    if (imageItems.length === 0) return;

    e.preventDefault();

    imageItems.forEach((item) => {
      const file = item.getAsFile();
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        const result = event.target?.result;
        if (typeof result === 'string') {
          onPasteImage(result);
        }
      };
      reader.readAsDataURL(file);
    });
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleStop = () => {
    if (typeof onStopGeneration === 'function') {
      onStopGeneration();
    }
  };

  const canApplyPending = permissionMode !== 'read_only';
  const currentWorkflowAnimStep = WORKFLOW_STREAM_STEPS[workflowAnimStep] || WORKFLOW_STREAM_STEPS[0];
  const streamingFileDraft = useMemo(() => extractStreamingFileDraft(streamingText), [streamingText]);
  const streamingWorkflowDraft = useMemo(() => extractStreamingWorkflowDraft(streamingText), [streamingText]);
  const liveFiles = useMemo(() => extractStreamingFiles(streamingText), [streamingText]);
  const streamingCodeLineCount = useMemo(() => {
    const code = streamingFileDraft?.code || '';
    if (!code) return 0;
    return code.split('\n').length;
  }, [streamingFileDraft]);

  useEffect(() => {
    if (typeof onStreamingDraftChange !== 'function') return;
    if (!isLoading || streamingMode !== 'code' || !streamingFileDraft?.filePath) {
      onStreamingDraftChange(null);
      return;
    }

    onStreamingDraftChange({
      filePath: streamingFileDraft.filePath,
      language: streamingFileDraft.language || '',
      code: streamingFileDraft.code || streamingText
    });
  }, [isLoading, onStreamingDraftChange, streamingFileDraft, streamingMode, streamingText]);

  const renderStreamingBox = () => {
    if (!streamingText) return null;

    return (
      <div
        ref={streamingRef}
        className={`ai-stream-box ai-stream-${streamingMode}`}
        role="status"
        aria-live="polite"
        aria-atomic="false"
      >
        {streamingMode === 'workflow' && (
          <div className="ai-stream-anim ai-stream-workflow">
            <div className="ai-stream-anim-title">Construction du workflow visuel...</div>
            <div className="ai-workflow-builder">
              <div className="wf-builder-canvas" aria-hidden="true">
                <div className={`wf-builder-node wf-builder-node-trigger ${workflowAnimStep >= 1 ? 'is-visible' : ''} ${workflowAnimStep === 1 ? 'is-active' : ''}`}>Trigger</div>
                <div className={`wf-builder-node wf-builder-node-ai ${workflowAnimStep >= 1 ? 'is-visible' : ''} ${workflowAnimStep === 2 ? 'is-active' : ''}`}>AI</div>
                <div className={`wf-builder-node wf-builder-node-output ${workflowAnimStep >= 1 ? 'is-visible' : ''} ${workflowAnimStep >= 3 ? 'is-active' : ''}`}>Output</div>
                <span className={`wf-builder-link wf-builder-link-ab ${workflowAnimStep >= 2 ? 'is-visible' : ''}`} />
                <span className={`wf-builder-link wf-builder-link-bc ${workflowAnimStep >= 3 ? 'is-visible' : ''}`} />
                <span className={`wf-builder-cursor step-${workflowAnimStep}`} />
              </div>
              <div className="wf-step-timeline">
                {WORKFLOW_STREAM_STEPS.map((step, index) => (
                  <div
                    key={step.key}
                    className={`wf-step-item ${index < workflowAnimStep ? 'is-done' : ''} ${index === workflowAnimStep ? 'is-current' : ''}`}
                  >
                    <span className="wf-step-bullet" />
                    <div className="wf-step-copy">
                      <span className="wf-step-label">{step.label}</span>
                      <span className="wf-step-detail">{step.detail}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {streamingWorkflowDraft?.json && (
              <SyntaxHighlightedCode code={streamingWorkflowDraft.json} language="json" maxHeight="300px" />
            )}
            <div className="ai-stream-anim-subtitle">
              Etape active: {currentWorkflowAnimStep.label} - {currentWorkflowAnimStep.detail}
            </div>
          </div>
        )}
        {streamingMode === 'diff' && (
          <div className="ai-stream-anim ai-stream-diff">
            <div className="ai-stream-anim-title">Edition structuree en cours...</div>
            <pre className="ai-stream-raw-preview">{filterUserVisibleText(streamingText)}</pre>
            <div className="ai-stream-anim-subtitle">Syntaxe detectee: {'<<<< SEARCH ... >>>> REPLACE'}</div>
          </div>
        )}
        {streamingMode === 'code' && (
          <div className="ai-stream-anim ai-stream-code">
            <div className="ai-stream-anim-title">Redaction du code en cours...</div>
            <div className="ai-stream-code-meta">
              <span className="ai-stream-code-file">{streamingFileDraft?.filePath || 'Fichier en cours de redaction'}</span>
              <span className="ai-stream-code-lang">{(streamingFileDraft?.language || 'text').toLowerCase()}</span>
            </div>
            <SyntaxHighlightedCode code={streamingFileDraft?.code || streamingText} language={streamingFileDraft?.language || 'javascript'} maxHeight="400px" />
            <div className="ai-stream-anim-subtitle">
              {streamingCodeLineCount > 0
                ? `${streamingCodeLineCount} ligne(s) recues en direct`
                : 'Le contenu du fichier apparait ici au fur et a mesure.'}
            </div>
          </div>
        )}
        {streamingMode === 'text' && (
          <pre className="ai-stream-text">
            {filterUserVisibleText(streamingText ? streamingText.replace(/<think>[\s\S]*?<\/think>\n*/g, '').trimStart() : '')}
          </pre>
        )}
      </div>
    );
  };

  const handleApplyPending = async (index) => {
    if (typeof onApplyPendingChange !== 'function') return;
    setIsApplyingPending(true);
    try {
      await onApplyPendingChange(index);
    } finally {
      setIsApplyingPending(false);
    }
  };

  const handleRejectPending = async (index) => {
    if (typeof onRejectPendingChange !== 'function') return;
    await onRejectPendingChange(index);
  };

  const handleApplyAllPending = async () => {
    if (typeof onApplyAllPendingChanges !== 'function') return;
    setIsBulkApplyingPending(true);
    try {
      await onApplyAllPendingChanges();
    } finally {
      setIsBulkApplyingPending(false);
    }
  };

  const handleRejectAllPending = async () => {
    if (typeof onRejectAllPendingChanges !== 'function') return;
    await onRejectAllPendingChanges();
  };

  const isPendingChangeActive = (change) => {
    if (!change) return false;
    if (activePendingChangeId && change.id) {
      return change.id === activePendingChangeId;
    }
    return change.filePath === activeFile;
  };

  const buildAgentBadgeLabel = (msg, baseLabel) => {
    const provider = String(msg?.agentProvider || '').trim();
    return provider ? `${baseLabel} (${provider})` : baseLabel;
  };

  const getRoleMeta = (msg) => {
    if (msg.role === 'system') {
      return {
        label: 'Systeme',
        badgeClass: 'chat-badge-system',
        bubbleClass: 'chat-bubble-system',
        alignClass: 'chat-row-system'
      };
    }

    if (msg.role === 'user') {
      return {
        label: 'Vous',
        badgeClass: 'chat-badge-user',
        bubbleClass: 'chat-bubble-user',
        alignClass: 'chat-row-user'
      };
    }

    if (msg.dynamicAgentTitle) {
      return {
        label: buildAgentBadgeLabel(msg, msg.dynamicAgentTitle),
        badgeClass: 'chat-badge-model',
        bubbleClass: 'chat-bubble-model',
        alignClass: 'chat-row-ai'
      };
    }

    return {
      label: 'IA',
      badgeClass: 'chat-badge-model',
      bubbleClass: 'chat-bubble-model',
      alignClass: 'chat-row-ai'
    };
  };

  const activeConversation = conversations.find(c => c.fileName === activeConversationFile) || null;
  const headerTitle = activeConversation ? activeConversation.title : 'Nouvelle conversation';
  const filteredConversations = conversations.filter((conv) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      (conv.title && conv.title.toLowerCase().includes(q)) ||
      (conv.fileName && conv.fileName.toLowerCase().includes(q))
    );
  });

  const handleSelectConversation = (fileName) => {
    if (!onSelectConversation || !fileName) return;
    onSelectConversation(fileName);
    setShowConversations(false);
  };

  // AgentModePill needs a plain setter (onExecutionModeChange may be undefined upstream).
  const setExecutionMode = (modeId) => {
    if (typeof onExecutionModeChange === 'function') {
      onExecutionModeChange(modeId);
    }
  };

  // AutonomyControls speaks restricted/normal/permissive; permissionMode
  // (the actual gate used by useFileOperations/useAIPendingChanges) speaks
  // read_only/edit_only/edit_terminal. Adapt both ways so there is a single
  // source of truth (permissionMode) instead of two states drifting apart.
  const autonomyLevel = fromLegacyPermission(permissionMode);
  const handleAutonomyLevelChange = (level) => {
    if (typeof onPermissionModeChange === 'function') {
      onPermissionModeChange(toLegacyPermission(level));
    }
  };

  return (
    <div className="ai-chat-root">
      {/* ===== HEADER ===== */}
      <div className="ai-chat-header">
        <div className="ai-reading-col ai-chat-header-inner">
        <div className="ai-chat-header-top">
          <div className="ai-chat-agent-info">
            <div className="ai-chat-avatar">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 8V4H8" /><rect x="4" y="8" width="16" height="12" rx="2" /><path d="M2 14h2" /><path d="M20 14h2" /><path d="M9 13v2" /><path d="M15 13v2" />
              </svg>
              <span className="ai-chat-avatar-dot" />
            </div>
            <div>
              <div className="ai-chat-agent-name">Agent IA</div>
              <div className="ai-chat-agent-session">{headerTitle}</div>
            </div>
          </div>

          <div className="ai-chat-header-actions">
            <button
              type="button"
              onClick={() => { if (onNewConversation) onNewConversation(); setShowConversations(false); }}
              className="ai-header-btn"
              disabled={!currentProjectPath || !isElectronApiAvailable}
              title="Nouvelle conversation"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            </button>
            <button
              type="button"
              onClick={() => setShowConversations(prev => !prev)}
              className="ai-header-btn"
              disabled={!currentProjectPath || !isElectronApiAvailable}
              title="Historique"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
            </button>
            <button
              onClick={onSaveConversation}
              className="ai-header-btn"
              disabled={!currentProjectPath || conversationHistory.length === 0 || !isElectronApiAvailable}
              title="Sauvegarder"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>
            </button>
          </div>
        </div>

        {/* Context Bar */}
        <div className="ai-chat-context-bar">
          {globalSkillsCount > 0 && (
            <span className="ai-chat-skills-badge" title={`${globalSkillsCount} skills globaux actifs`}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>
              {globalSkillsCount} skills actifs
            </span>
          )}
          {contextEstimate && (
            <div className="ai-chat-metrics">
              <div className="ai-chat-metric">
                <span className="ai-chat-metric-val">{Number(contextEstimate.contextChars || 0).toLocaleString('fr-FR')}</span>
                <span className="ai-chat-metric-label">Contexte</span>
              </div>
              <div className="ai-chat-metric">
                <span className="ai-chat-metric-val">{Number(contextEstimate.promptChars || 0).toLocaleString('fr-FR')}</span>
                <span className="ai-chat-metric-label">Prompt</span>
              </div>
              <div className="ai-chat-metric">
                <span className="ai-chat-metric-val">{Number(contextEstimate.estimatedTokens || 0).toLocaleString('fr-FR')}</span>
                <span className="ai-chat-metric-label">Tokens est.</span>
              </div>
              <div className="ai-chat-metric">
                <span className="ai-chat-metric-val">${Number(contextEstimate.estimatedCostUsd || 0).toFixed(4)}</span>
                <span className="ai-chat-metric-label">Coût est.</span>
              </div>
            </div>
          )}
        </div>
        </div>
      </div>

      {/* ===== CONVERSATIONS DROPDOWN ===== */}
      {showConversations && (
        <div className="ai-suggest-overlay">
          <div className="ai-chat-dropdown" style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface-2)', maxHeight: 200, overflowY: 'auto', boxShadow: '0 8px 20px rgba(0, 0, 0, 0.28)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 14px', borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Conversations</span>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{conversations.length}</span>
            </div>
            <div style={{ padding: '4px 14px' }}>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Rechercher..."
                style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, padding: '4px 8px', color: 'var(--text-main)', fontSize: 11, outline: 'none' }}
              />
            </div>
            <div>
              {isConversationLoading && <div style={{ padding: '8px 14px', fontSize: 10, color: 'var(--text-muted)' }}>Chargement...</div>}
              {!isConversationLoading && filteredConversations.length === 0 && <div style={{ padding: '8px 14px', fontSize: 10, color: 'var(--text-muted)' }}>Aucune</div>}
              {!isConversationLoading && filteredConversations.map((conv) => (
                <div
                  key={conv.fileName}
                  onClick={() => handleSelectConversation(conv.fileName)}
                  className={`ai-history-item ${conv.fileName === activeConversationFile ? 'is-active' : ''}`}
                >
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{conv.title}</span>
                  <span style={{ fontSize: 9, color: 'var(--text-muted)', flexShrink: 0 }}>
                    {new Date(conv.createdAt).toLocaleDateString('fr-FR', { month: 'numeric', day: 'numeric' })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ===== PENDING CHANGES PANEL ===== */}
      {Array.isArray(pendingFileChanges) && pendingFileChanges.length > 0 && (
        <div className="ai-pending-section">
          <div className="ai-pending-header">
            <span className="ai-pending-label">{pendingFileChanges.length} CHANGEMENTS EN ATTENTE</span>
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                type="button"
                className="ai-pending-btn ai-pending-btn-apply"
                onClick={handleApplyAllPending}
                disabled={!canApplyPending || isApplyingPending || isBulkApplyingPending}
                title={!canApplyPending ? 'Mode lecture seule' : 'Appliquer tous'}
              >
                ✓ Appliquer tout
              </button>
              <button
                type="button"
                className="ai-pending-btn ai-pending-btn-reject"
                onClick={handleRejectAllPending}
                disabled={isApplyingPending || isBulkApplyingPending}
                title="Rejeter tous"
              >
                Rejeter tout
              </button>
            </div>
          </div>

          {pendingSnapshotId && (
            <div style={{ padding: '3px 14px', fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>Snapshot: {pendingSnapshotId}</div>
          )}

          <div className="ai-pending-list custom-scrollbar" style={{ padding: '4px 10px' }}>
            {pendingFileChanges.map((change, index) => (
              <div
                key={change.id || `${change.filePath}-${index}`}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
                  padding: '3px 6px', borderRadius: 3, fontSize: 11, fontFamily: 'var(--font-mono)',
                  background: isPendingChangeActive(change) ? 'var(--accent-soft)' : 'transparent',
                  color: isPendingChangeActive(change) ? 'var(--accent)' : 'var(--text-dim)',
                  cursor: 'pointer', transition: 'background 0.1s',
                }}
                onClick={() => onSelectPendingChange && onSelectPendingChange(index)}
                title={change.filePath}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{change.filePath}</span>
                <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleApplyPending(index); }}
                    disabled={!canApplyPending || isApplyingPending || isBulkApplyingPending}
                    style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 2, padding: '1px 6px', fontSize: 9, fontWeight: 600, cursor: 'pointer' }}
                  >✓</button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleRejectPending(index); }}
                    disabled={isApplyingPending || isBulkApplyingPending}
                    style={{ background: 'transparent', color: 'var(--text-dim)', border: '1px solid var(--border)', borderRadius: 2, padding: '1px 6px', fontSize: 9, cursor: 'pointer' }}
                  >✕</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ===== STREAMING ===== */}
      {isLoading && streamingText && (
        <div style={{ borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div className="ai-reading-col">
            {liveFiles.length > 0 && (
              <div style={{ padding: '8px 0 0' }}>
                <LiveFilesPanel files={liveFiles} />
              </div>
            )}
            {renderStreamingBox()}
          </div>
        </div>
      )}

      {/* ===== MESSAGES ===== */}
      <div
        ref={conversationHistoryRef}
        className="ai-messages custom-scrollbar"
      >
        <div className="ai-reading-col">
          {conversationHistory.length === 0 && !isLoading && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: 'var(--text-muted)', padding: 30, textAlign: 'center' }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{ width: 40, height: 40, opacity: 0.15 }}>
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              <p style={{ fontSize: 12, lineHeight: 1.6, margin: 0 }}>Commencez à discuter avec l&apos;IA</p>
              <p style={{ fontSize: 10, margin: 0 }}>Contexte complet du projet pris en compte.</p>
            </div>
          )}

          {conversationHistory.map((msg, index) => {
            const meta = getRoleMeta(msg);
            const isUser = msg.role === 'user';
            return (
              <div key={msg.id || `msg-${index}`} className="ai-message">
                <div className="ai-message-meta">
                  <div className={`ai-message-avatar ${isUser ? 'user' : 'bot'}`}>
                    {isUser ? (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                    ) : (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 8V4H8" /><rect x="4" y="8" width="16" height="12" rx="2" /><path d="M9 13v2" /><path d="M15 13v2" /></svg>
                    )}
                  </div>
                  <span className="ai-message-role">{meta.label}</span>
                </div>
                <div className="ai-message-body">
                  <p style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {msg.text ? msg.text.replace(/<think>[\s\S]*?<\/think>\n*/g, '').trim() : ''}
                  </p>
                </div>

                {Array.isArray(msg.images) && msg.images.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', paddingLeft: 26 }}>
                    {msg.images.map((img, i) => (
                      <img key={i} src={img.dataUrl} alt="Collé" style={{ width: 48, height: 48, borderRadius: 4, objectFit: 'cover', border: '1px solid var(--border)' }} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* AI Terminal Action Cards (ReAct Loop) */}
          {isLoading && terminalActions.length > 0 && (
            <div style={{ padding: '8px 14px' }}>
              {terminalActions.map((action, i) => (
                <div key={i} style={{
                  background: 'var(--surface-2)', border: '1px solid var(--border)',
                  borderRadius: 4, margin: '4px 0', overflow: 'hidden', fontSize: 11,
                }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px',
                    background: action.type === 'done' ? 'rgba(16,185,129,0.08)' : 'rgba(245,158,11,0.08)',
                    borderBottom: action.output ? '1px solid var(--border)' : 'none',
                  }}>
                    <span>{action.type === 'done' ? '✓' : '⟳'}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-main)', flex: 1, fontSize: 10 }}>{action.command}</span>
                    <span style={{ color: 'var(--text-muted)', fontSize: 9 }}>#{action.iteration}</span>
                  </div>
                  {action.output && (
                    <pre style={{
                      margin: 0, padding: '5px 10px', fontSize: 9, color: 'var(--text-dim)',
                      fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', maxHeight: 100, overflowY: 'auto',
                    }}>{action.output.substring(0, 800)}{action.output.length > 800 ? '...' : ''}</pre>
                  )}
                </div>
              ))}
            </div>
          )}

          {isLoading && !multiAIState?.isActive && terminalActions.length > 0 && (
            <div className="ai-message-loading">
              <div className="ai-loading-dots"><span className="ai-loading-dot" /><span className="ai-loading-dot" /><span className="ai-loading-dot" /></div>
              <span>Exécution... ({terminalActions.filter(a => a.type === 'done').length}/{terminalActions.length} commandes)</span>
            </div>
          )}
        </div>
      </div>

      {/* Intelligent Router decision (auto mode only) — above the input bar */}
      {autoRoute && <AIDecisionBadge decision={routerDecision} />}

      {/* ===== INPUT BAR (unified, Antigravity-style) ===== */}
      <div className="ai-input-bar">
        <div className="ai-reading-col ai-input-bar-inner">
          {/* Pending message indicator */}
          {pendingMessage && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px',
              background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)',
              borderRadius: 4, fontSize: 10, color: 'var(--warning)',
            }}>
              <span>⏳</span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                En attente&#x202F;: <em>{pendingMessage.text}</em>
              </span>
              <span style={{ opacity: 0.6, fontSize: 9 }}>sera envoyé automatiquement</span>
            </div>
          )}

          {/* Pending images */}
          {pendingImages && pendingImages.length > 0 && (
            <div className="ai-input-images">
              {pendingImages.map((img, idx) => (
                <div key={idx} style={{ position: 'relative' }}>
                  <img src={img.dataUrl} alt="Pending" className="ai-input-image" />
                  <button
                    onClick={() => onRemovePendingImage && onRemovePendingImage(idx)}
                    style={{
                      position: 'absolute', top: 1, right: 1, background: 'rgba(0,0,0,0.7)', border: 'none', color: '#fff',
                      borderRadius: '50%', width: 14, height: 14, fontSize: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                    }}
                  >×</button>
                </div>
              ))}
            </div>
          )}

          {/* Explicit Context Tags */}
          {explicitContext.length > 0 && (
            <div className="ai-message-file-refs">
              {explicitContext.map(filePath => {
                const fileName = filePath.split(/[\\/]/).pop();
                return (
                  <span key={filePath} className="ai-message-file-ref" title={filePath}>
                    @{fileName}
                    <span className="ai-message-file-ref-close" onClick={() => removeExplicitContext(filePath)}>×</span>
                  </span>
                );
              })}
            </div>
          )}

          {/* Composer: un seul bloc arrondi = textarea + rangée [+] [mode] [modèle] [autonomie] [Envoyer] */}
          <div className="ai-composer">
          {/* Textarea */}
          <textarea
            ref={promptInputRef}
            id="ai-prompt"
            className="ai-input-bar-textarea"
            value={prompt}
            onChange={(e) => handlePromptChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder="Votre requête... (@ pour un fichier, / pour un workflow)"
            rows={2}
          />

          {/* Workflow suggestions */}
          {showWorkflowSuggestions && filteredWorkflows.length > 0 && (
            <div className="ai-suggest-overlay">
              <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 4, maxHeight: 150, overflowY: 'auto', boxShadow: '0 8px 20px rgba(0, 0, 0, 0.28)' }}>
                <div style={{ padding: '5px 10px', fontSize: 9, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', borderBottom: '1px solid var(--border)' }}>Workflows disponibles</div>
                {filteredWorkflows.map((workflow) => (
                  <button
                    key={`${workflow.scope}-${workflow.name}`}
                    onClick={() => handleSelectWorkflow(workflow)}
                    style={{ display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center', padding: '5px 10px', background: 'none', border: 'none', color: 'var(--text-main)', fontSize: 11, cursor: 'pointer', textAlign: 'left' }}
                  >
                    <div>
                      <span style={{ color: 'var(--accent)', fontWeight: 600 }}>/{workflow.name}</span>
                      {workflow.description && <span style={{ color: 'var(--text-dim)', marginLeft: 6 }}>{workflow.description}</span>}
                    </div>
                    <span style={{ fontSize: 9, color: 'var(--text-muted)', padding: '1px 5px', background: 'var(--surface)', borderRadius: 3 }}>{workflow.scope}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Context file suggestions */}
          {showContextSuggestions && (
            <div className="ai-suggest-overlay">
              <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 4, maxHeight: 150, overflowY: 'auto', boxShadow: '0 8px 20px rgba(0, 0, 0, 0.28)' }}>
                <div style={{ padding: '5px 10px', fontSize: 9, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', borderBottom: '1px solid var(--border)' }}>Fichiers du projet</div>
                {filteredContextFiles.length === 0 && (
                  <div style={{ padding: '8px 10px', fontSize: 10, color: 'var(--text-muted)' }}>Aucun fichier pour {contextFilter}</div>
                )}
                {filteredContextFiles.map((filePath) => {
                  const fileName = filePath.split(/[\\/]/).pop() || filePath;
                  return (
                    <button
                      key={filePath}
                      onClick={() => handleSelectContextFile(filePath)}
                      style={{ display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center', padding: '4px 10px', background: 'none', border: 'none', color: 'var(--text-main)', fontSize: 11, cursor: 'pointer', textAlign: 'left' }}
                    >
                      <span style={{ color: 'var(--accent)' }}>@{fileName}</span>
                      <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{filePath}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Bottom toolbar: [+] menu, mode/model/autonomy pills, send/stop */}
          <div className="ai-input-bar-toolbar">
            <button
              type="button"
              className="ai-plus-btn"
              onClick={() => setShowPlusMenu((v) => !v)}
              title="Mentionner un fichier ou lancer un workflow"
              aria-expanded={showPlusMenu}
            >
              +
            </button>

            <AgentModePill
              executionMode={executionMode}
              onExecutionModeChange={setExecutionMode}
              activeAgent={activeAgent}
              onActiveAgentChange={onActiveAgentChange}
              agents={agents}
              onOpenAgentManager={onOpenAgentManager}
              disabled={isLoading}
            />

            <ProviderPill
              aiProvider={aiProvider}
              onProviderChange={onProviderChange}
              disabled={isLoading}
            />

            <ModelPill
              aiProvider={aiProvider}
              activeModelValue={activeModelValue}
              availableActiveModels={availableActiveModels}
              onActiveModelChange={onActiveModelChange}
              disabled={isLoading}
            />

            {/* Permission Level n'a de sens qu'en mode Agent (Ask/Plan sont
                lecture seule par construction — aucune confirmation d'écriture
                à configurer). activeAgent force toujours executionMode à
                'agent' (voir selectAgent), donc ce seul test couvre aussi
                le cas persona custom sélectionnée. */}
            {executionMode === 'agent' && (
              <AutonomyPill
                autonomyLevel={autonomyLevel}
                onAutonomyLevelChange={handleAutonomyLevelChange}
                disabled={isLoading}
              />
            )}

            <div className="ai-input-bar-spacer" />

            <button
              type="button"
              onClick={isLoading ? handleStop : handleSend}
              className={`ai-send-btn-compact ${isLoading ? 'is-stop' : ''}`}
              disabled={!currentProjectPath || !isElectronApiAvailable}
              aria-label={isLoading ? "Arrêter la génération" : "Envoyer à l'IA"}
            >
              {isLoading ? 'Arrêter' : 'Envoyer'}
            </button>
          </div>
          </div>

          {/* [+] popover: contexte, agent, presets, actions rapides */}
          {showPlusMenu && (
            <div className="ai-plus-menu" role="menu">
              <div className="ai-plus-menu-section">
                <span className="ai-plus-menu-label">Contexte</span>
                <button
                  type="button"
                  className="ai-pill-menu-item"
                  onClick={() => { handlePromptChange(`${prompt}@`); setShowPlusMenu(false); promptInputRef.current?.focus(); }}
                >
                  @ Mentionner un fichier
                </button>
                <button
                  type="button"
                  className="ai-pill-menu-item"
                  onClick={() => { handlePromptChange('/'); setShowPlusMenu(false); promptInputRef.current?.focus(); }}
                >
                  / Workflow
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AIChat;
