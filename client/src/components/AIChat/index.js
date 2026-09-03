import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import './AIChat.css';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { LiveFilesPanel } from '../LoadingAnimations';
import SyntaxHighlightedCode from './SyntaxHighlightedCode';
import { EXECUTION_MODES } from '../../utils/agentModes';
import AIDecisionBadge from './AIDecisionBadge';
import ChatWelcome from './ChatWelcome';
import MarkdownRenderer from './MarkdownRenderer';
import { AUTONOMY_LEVELS, toLegacyPermission } from './AutonomyControls';
import MessageViewer from './MessageViewer';
import { conversationToChatMessages } from '../../utils/chatMessages';
import { isChatInterfaceSwapEnabled } from '../../utils/featureFlags';
import {
  IconAgents, IconUser, IconWrench, IconCheck, IconX, IconHourglass,
  IconExpand, IconMoreVertical, IconEdit, IconCopy, IconTrash
} from '../ComponentLibrary/icons';
import {
  THINKING_MESSAGES,
  TERMINAL_MESSAGES,
  WORKFLOW_STREAM_REGEX,
  DIFF_STREAM_REGEX,
  FILE_STREAM_REGEX,
  WORKFLOW_STREAM_STEPS,
  extractStreamingFileDraft,
  extractStreamingFiles,
  normalizeMarkerPath,
  stripReasoningBlocks,
  splitReasoningSegments,
  extractStreamingWorkflowDraft,
  fromLegacyPermission
} from '../../utils/streamParsing';

// ─── ReasoningBlock ─────────────────────────────────────────────────────────
// Le raisonnement du modèle, replié par défaut. Visible seulement quand le
// mode Raisonnement est actif — sinon le backend l'a déjà retiré et aucun
// segment de ce type n'arrive jusqu'ici.
const ReasoningBlock = ({ content }) => (
  <details className="ai-reasoning">
    <summary className="ai-reasoning-summary">Raisonnement du modèle</summary>
    <pre className="ai-reasoning-body">{content.trim()}</pre>
  </details>
);

// ─── usePillMenu ────────────────────────────────────────────────────────────
// Popover plumbing partagée par toutes les pills de la barre d'outils : fermer
// au clic extérieur et à Escape. Sans ça, un menu ouvert juste avant le début
// d'une génération devenait impossible à fermer — le bouton déclencheur passe
// disabled={isLoading}, donc le re-clic qui le referme ne part jamais.
const usePillMenu = () => {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return { open, setOpen, wrapRef };
};

const readChatTerminalTheme = () => {
  const styles = getComputedStyle(document.documentElement);
  const read = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
  return {
    background: read('--surface-2', '#17181b'),
    foreground: read('--text-dim', '#b6bac1'),
    cursor: 'transparent',
    selectionBackground: read('--accent-soft', 'rgba(59,158,255,0.25)'),
    black: '#1d1f23',
    brightBlack: '#5c6370',
  };
};

const URL_IN_TERMINAL_REGEX = /(https?:\/\/[^\s"'<>`]+)/g;

const TERMINAL_ROW_PX = 15;
const TERMINAL_MAX_ROWS = 20;

const TerminalOutputView = ({ output }) => {
  const hostRef = useRef(null);
  const lineCount = useMemo(
    () => Math.max(1, String(output || '').split('\n').length),
    [output]
  );
  const rows = Math.min(TERMINAL_MAX_ROWS, Math.max(3, lineCount));

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    const term = new Terminal({
      convertEol: true,
      disableStdin: true,
      cursorBlink: false,
      cursorStyle: 'bar',
      fontSize: 11,
      lineHeight: 1.3,
      fontFamily: 'var(--font-mono, Consolas, monospace)',
      theme: readChatTerminalTheme(),
      scrollback: 5000,
      rows,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    const linkDisposable = term.registerLinkProvider({
      provideLinks(bufferLineNumber, callback) {
        const line = term.buffer.active.getLine(bufferLineNumber - 1);
        if (!line) { callback(undefined); return; }
        const text = line.translateToString(true);
        const links = [];
        const re = new RegExp(URL_IN_TERMINAL_REGEX.source, 'g');
        let m;
        while ((m = re.exec(text)) !== null) {
          const url = m[1].replace(/[.,;:)\]}]+$/, '');
          links.push({
            range: {
              start: { x: m.index + 1, y: bufferLineNumber },
              end: { x: m.index + url.length, y: bufferLineNumber },
            },
            text: url,
            activate: () => { window.open(url, '_blank', 'noopener,noreferrer'); },
          });
        }
        callback(links.length > 0 ? links : undefined);
      },
    });

    term.open(host);
    try { fitAddon.fit(); } catch { /* conteneur pas encore mesure */ }
    term.write(String(output || ''));
    term.scrollToTop();

    const ro = new ResizeObserver(() => { try { fitAddon.fit(); } catch { /* ignore */ } });
    ro.observe(host);

    return () => {
      ro.disconnect();
      linkDisposable.dispose();
      term.dispose();
    };
  }, [output, rows]);

  return (
    <div
      ref={hostRef}
      className="ai-terminal-card-xterm"
      style={{ height: rows * TERMINAL_ROW_PX + 10 }}
    />
  );
};

// ─── TerminalActionCard ─────────────────────────────────────────────────────
// Une commande exécutée par l'IA. Dépliée tant qu'elle tourne pour suivre en
// direct, repliée automatiquement à la fin (l'utilisateur peut la redéplier).
// Sortie scrollable, jamais tronquée — l'ancienne version coupait à 800
// caractères et perdait la fin du log. Pastille succès/échec : le code de
// sortie est transporté via le canal IPC et affiché comme indicateur visuel.
// Un code de sortie null signifie que la commande a été bloquée (permissions,
// timeout, refus utilisateur) ou qu'une erreur a survenu avant fork — pas de code shell.
const TerminalActionCard = ({ action }) => {
  const isDone = action.type === 'done';
  const isOk = isDone && action.ok === true;
  const hasExitCode = typeof action.exitCode === 'number';
  const [expanded, setExpanded] = useState(!isDone);

  useEffect(() => {
    if (isDone) setExpanded(false);
  }, [isDone]);

  return (
    <div className="ai-terminal-card">
      <button
        type="button"
        className="ai-terminal-card-header"
        onClick={() => setExpanded((v) => !v)}
        title={isDone ? (isOk ? `Commande reussie${hasExitCode ? ` (code ${action.exitCode})` : ''}` : `Commande en echec${hasExitCode ? ` (code ${action.exitCode})` : ' (bloquee ou interrompue)'}`) : 'Commande en cours'}
      >
        <span className={`ai-terminal-card-status${!isDone ? ' is-running' : isOk ? ' is-success' : ' is-error'}`} />
        <span className="ai-terminal-card-command">{action.command}</span>
        {isDone && (
          <span className={`ai-terminal-card-exit${isOk ? ' is-success' : ' is-error'}`}>
            {hasExitCode ? `exit ${action.exitCode}` : (isOk ? 'OK' : 'echec')}
          </span>
        )}
        <span className="ai-terminal-card-iteration">#{action.iteration}</span>
        <svg
          width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          className={`ai-terminal-card-chevron${expanded ? ' is-open' : ''}`}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>
      {expanded && (
        action.output
          ? <TerminalOutputView output={action.output} />
          : <div className="ai-terminal-card-empty">{isDone ? 'Aucune sortie.' : 'En cours…'}</div>
      )}
    </div>
  );
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
  const { open, setOpen, wrapRef } = usePillMenu();
  const currentMode = EXECUTION_MODES.find((m) => m.id === executionMode) || EXECUTION_MODES[0];
  const label = activeAgent ? activeAgent.name : (currentMode?.label || 'Agent');
  const icon = activeAgent ? <IconUser size={13} /> : (currentMode?.icon || <IconWrench size={13} />);

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
    <div className="ai-pill-wrap" ref={wrapRef}>
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
                  <span aria-hidden="true"><IconUser size={13} /></span> {agent.name}
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

// ─── ReasoningEffortPill ────────────────────────────────────────────────────
// Sélecteur d'effort de raisonnement (façon Codex/Claude). Aiguille le routeur
// vers un profil interne PLANCHER (low→luna, medium→sol, high/ultra→opus) sans
// jamais exposer ces profils à l'utilisateur : il ne voit que "Neven IA" ou son
// BYOK + modèle. 'auto' = le routeur décide seul (comportement historique).
// Miroir de ROUTER_REASONING_EFFORTS (electron/services/router.service.js).
const REASONING_EFFORT_LEVELS = [
  { id: 'auto', label: 'Auto', helper: 'Le routeur choisit la puissance selon la demande.', tone: 'success' },
  { id: 'low', label: 'Faible', helper: 'Réponses rapides, tâches simples.', tone: 'success' },
  { id: 'medium', label: 'Moyen', helper: 'Équilibre vitesse / profondeur.', tone: 'warning' },
  { id: 'high', label: 'Élevé', helper: 'Raisonnement approfondi.', tone: 'danger' },
  { id: 'ultra', label: 'Ultra', helper: 'Puissance maximale, multi-agents.', tone: 'danger' }
];

const ReasoningEffortPill = ({ reasoningEffort, onReasoningEffortChange, disabled }) => {
  const { open, setOpen, wrapRef } = usePillMenu();
  const current = REASONING_EFFORT_LEVELS.find((l) => l.id === reasoningEffort) || REASONING_EFFORT_LEVELS[0];

  return (
    <div className="ai-pill-wrap" ref={wrapRef}>
      <button
        type="button"
        className="ai-pill"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        title={`Effort de raisonnement : ${current.label}. ${current.helper}`}
      >
        <span className={`ai-pill-dot ai-pill-dot--${current.tone}`} aria-hidden="true" />
        {current.label}
      </button>
      {open && (
        <div className="ai-pill-menu" role="menu">
          {REASONING_EFFORT_LEVELS.map((level) => (
            <button
              type="button"
              role="menuitemradio"
              aria-checked={level.id === reasoningEffort}
              key={level.id}
              className={`ai-pill-menu-item ${level.id === reasoningEffort ? 'is-active' : ''}`}
              onClick={() => { onReasoningEffortChange(level.id); setOpen(false); }}
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

// ─── AutonomyPill ───────────────────────────────────────────────────────────
// Compact pill showing the current autonomy level (dot + label); click opens
// a popover to switch between Lecture seule / Supervisé / Autonome.
const AutonomyPill = ({ autonomyLevel, onAutonomyLevelChange, disabled }) => {  const { open, setOpen, wrapRef } = usePillMenu();
  const current = AUTONOMY_LEVELS.find((l) => l.id === autonomyLevel) || AUTONOMY_LEVELS[0];

  return (
    <div className="ai-pill-wrap" ref={wrapRef}>
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
  const { open, setOpen, wrapRef } = usePillMenu();
  const providerLabel = PROVIDER_PILL_LABELS[aiProvider] || aiProvider || 'Gemini';

  return (
    <div className="ai-pill-wrap" ref={wrapRef}>
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
  const { open, setOpen, wrapRef } = usePillMenu();
  const models = Array.isArray(availableActiveModels) ? availableActiveModels : [];

  return (
    <div className="ai-pill-wrap" ref={wrapRef}>
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
  isSwarmPanelOpen,
  onToggleSwarmPanel,
  conversations = [],
  activeConversationFile,
  isConversationLoading = false,
  onNewConversation,
  onSelectConversation,
  onStopGeneration,
  // Sessions de chat (plan-ia-onglets.md §⑤ 5.5.1/5.5.2) : sessions[] +
  // activeSessionId remplacent la conversation plate. `conversationHistory`
  // ci-dessus reste la vue de la session active — inchangee pour le pipeline
  // de generation, qui ignore tout du modele multi-session.
  sessions = [],
  activeSessionId = null,
  onSwitchSession,
  onOpenSessionTab,
  onRenameSession,
  onDuplicateSession,
  onDeleteSession,
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
  // Effort de raisonnement (façon Codex/Claude) : aiguille le routeur vers un
  // profil interne plancher sans jamais l'exposer à l'utilisateur.
  reasoningEffort = 'auto',
  onReasoningEffortChange,
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
  // Session dont le menu contextuel (Ouvrir dans un onglet / Renommer /
  // Dupliquer / Supprimer) est ouvert — plan-ia-onglets.md §⑤ 5.5.3.
  const [sessionMenuId, setSessionMenuId] = useState(null);
  const sessionMenuRef = useRef(null);
  useEffect(() => {
    if (!sessionMenuId) return undefined;
    const onPointerDown = (event) => {
      if (sessionMenuRef.current && !sessionMenuRef.current.contains(event.target)) setSessionMenuId(null);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setSessionMenuId(null);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [sessionMenuId]);
  const [showPlusMenu, setShowPlusMenu] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showWorkflowSuggestions, setShowWorkflowSuggestions] = useState(false);
  const [workflowFilter, setWorkflowFilter] = useState('');

  // Mentions Context
  const [showContextSuggestions, setShowContextSuggestions] = useState(false);
  const [contextFilter, setContextFilter] = useState('');
  const [explicitContext, setExplicitContext] = useState([]); // List of explicitly mentioned files

  // COD-70 — navigation clavier des suggestions (@fichier / /workflow) :
  // index de l'option surlignee, reinitialise a chaque changement de filtre.
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  // COD-70 — historique de prompts (↑/↓ dans un composer vide, standard VS Code).
  const [historyIndex, setHistoryIndex] = useState(-1); // -1 = saisie libre
  const liveDraftRef = useRef('');
  // COD-70 — glisser-deposer de fichiers/images sur le composer.
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const dragDepthRef = useRef(0);
  // COD-70 — brouillon persistant par session (sessionStorage, cf. A.5).
  const skipDraftSaveRef = useRef(true);

  const [isApplyingPending, setIsApplyingPending] = useState(false);
  const [isBulkApplyingPending, setIsBulkApplyingPending] = useState(false);

  const [terminalActions, setTerminalActions] = useState([]); // AI terminal ReAct cards (tour en cours)
  // Actions terminal des tours PRECEDENTS, indexees par position dans
  // conversationHistory — sinon elles disparaissaient integralement des que
  // isLoading repassait a false (l'ancien garde de rendu exigeait isLoading).
  const [historicalTerminalActions, setHistoricalTerminalActions] = useState({});
  const prevIsLoadingRef = useRef(false);
  const [streamingText, setStreamingText] = useState('');       // live streaming output
  const [throttledStreamingText, setThrottledStreamingText] = useState(''); // version rendue en Markdown (throttled)
  const lastStreamingParseAtRef = useRef(0);
  // Compteur de secondes écoulées. Sur CPU-only une réponse peut demander
  // plusieurs minutes : un indicateur qui bouge est la seule façon de distinguer
  // "ça travaille" de "c'est planté".
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [streamingMode, setStreamingMode] = useState('text');   // text | workflow | code | diff
  const [workflowAnimStep, setWorkflowAnimStep] = useState(0);
  const streamingRef = useRef(null);
  const streamingBufferRef = useRef('');
  const streamingFlushRafRef = useRef(null);
  const streamingScrollRafRef = useRef(null);
  const isPinnedToBottomRef = useRef(true);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const [thinkingLabel, setThinkingLabel] = useState('Réflexion');

  // ── COD-70 A.1 — autosize du textarea ────────────────────────────────────
  // rows={2} + max-height CSS fixes rendaient tout prompt long inexploitable
  // (micro-scroll interne). Le champ grandit avec son contenu jusqu'a un cap,
  // puis le scroll reapparait au-dela — comportement standard (VS Code chat).
  useEffect(() => {
    const el = promptInputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [prompt]);

  // ── COD-70 A.5 — brouillon persistant par session ────────────────────────
  // Un prompt en cours etait perdu au changement d'onglet/projet. Stocke dans
  // sessionStorage (jamais dans le workspace user), restaure au remontage.
  const draftKey = `cc.draft.${activeSessionId || currentProjectPath || 'default'}`;
  useEffect(() => {
    let restored = null;
    try {
      restored = window.sessionStorage.getItem(draftKey);
    } catch {
      restored = null; // sessionStorage indisponible (mode prive) : on ignore
    }
    skipDraftSaveRef.current = true;
    if (restored) onPromptChange(restored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);
  useEffect(() => {
    if (skipDraftSaveRef.current) {
      skipDraftSaveRef.current = false;
      return;
    }
    try {
      if (prompt) window.sessionStorage.setItem(draftKey, prompt);
      else window.sessionStorage.removeItem(draftKey);
    } catch { /* idem */ }
  }, [draftKey, prompt]);


  const [copiedMessageIndex, setCopiedMessageIndex] = useState(null);
  const copyResetTimerRef = useRef(null);
  // COD-70 B.13 — retour 👍/👎 par reponse de l'agent. Stocke en memoire pour
  // l'instant (index -> 'up' | 'down') ; l'ingest vers l'analyse de qualite du
  // routeur depend de COD-54 (contrat d'evenements) — a brancher ici ensuite.
  const [messageFeedback, setMessageFeedback] = useState({});
  // COD-70 B.12 — index du message user en cours de reedition inline.
  const [editingIndex, setEditingIndex] = useState(null);
  const [editingText, setEditingText] = useState('');
  const editTextareaRef = useRef(null);

  const flushStreamingBuffer = useCallback(() => {
    streamingFlushRafRef.current = null;
    const chunk = streamingBufferRef.current;
    if (!chunk) return;
    streamingBufferRef.current = '';
    setStreamingText((prev) => prev + chunk);
  }, []);

  useEffect(() => {
    if (!isLoading) {
      setElapsedSeconds(0);
      return undefined;
    }
    const startedAt = Date.now();
    const timer = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [isLoading]);

  useEffect(() => {
    if (!isLoading) return undefined;
    const thinkingTimer = setInterval(() => {
      const messages = terminalActions.length > 0 ? TERMINAL_MESSAGES : THINKING_MESSAGES;
      setThinkingLabel(messages[Math.floor(Math.random() * messages.length)]);
    }, 1200);
    return () => clearInterval(thinkingTimer);
  }, [isLoading, terminalActions.length]);

  const handleConversationScroll = () => {
    if (!conversationHistoryRef.current) return;
    const el = conversationHistoryRef.current;
    const isPinned = (el.scrollHeight - el.scrollTop - el.clientHeight) < 24;
    isPinnedToBottomRef.current = isPinned;
    setShowScrollDown(!isPinned);
  };

  const handleScrollToBottom = () => {
    isPinnedToBottomRef.current = true;
    setShowScrollDown(false);
    if (conversationHistoryRef.current) {
      conversationHistoryRef.current.scrollTop = conversationHistoryRef.current.scrollHeight;
    }
  };

  // Register AI terminal IPC events
  useEffect(() => {
    if (!isElectronApiAvailable || !window.electronAPI?.onAITerminalAction) return;
    const offAction = window.electronAPI.onAITerminalAction((data) => {
      setTerminalActions(prev => [...prev, { type: 'running', command: data.command, iteration: data.iteration, output: null }]);
    });
    const offResult = window.electronAPI.onAITerminalResult((data) => {
      setTerminalActions(prev => prev.map((a, i) =>
        i === prev.length - 1 && a.command === data.command
          ? { ...a, type: 'done', output: data.output, exitCode: (typeof data.exitCode === 'number' ? data.exitCode : null), ok: data.success === true }
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
      setThrottledStreamingText('');
      lastStreamingParseAtRef.current = 0;
      setStreamingMode('text');
      setWorkflowAnimStep(0);
      streamingBufferRef.current = '';
      if (streamingFlushRafRef.current !== null) {
        window.cancelAnimationFrame(streamingFlushRafRef.current);
        streamingFlushRafRef.current = null;
      }
    }
  }, [isLoading]);

  // À la fin d'une génération (transition true -> false), archive les actions
  // terminal de CE tour sous l'index du message assistant qui vient d'être
  // ajouté à conversationHistory. Le message est déjà présent à ce point : le
  // hook parent (useAI.js) pousse le message AVANT de couper isLoading (deux
  // setState séparés par des await, donc deux rendus distincts), ce composant
  // reçoit donc conversationHistory à jour avant que isLoading ne passe à false.
  useEffect(() => {
    const wasLoading = prevIsLoadingRef.current;
    prevIsLoadingRef.current = isLoading;
    if (wasLoading && !isLoading && terminalActions.length > 0) {
      const idx = conversationHistory.length - 1;
      // Si la génération a échoué APRES avoir execute des commandes (le
      // provider a planté au dernier appel), useAI.js n'ajoute aucun message
      // — le dernier index pointerait alors sur un message deja existant
      // (ex: le prompt utilisateur) et lui collerait a tort ces actions.
      if (idx >= 0 && conversationHistory[idx]?.role === 'model') {
        setHistoricalTerminalActions((prev) => ({ ...prev, [idx]: terminalActions }));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  // Changer de conversation (nouvelle ou chargée) invalide les index
  // précédents : sans ce reset, les cartes d'un autre fil s'afficheraient
  // sous les mauvais messages. Deux signaux distincts, car aucun des deux ne
  // couvre l'autre cas : charger une conversation sauvegardée remplace
  // l'historique par un tableau NON VIDE et change activeConversationFile ;
  // "Nouvelle conversation" vide l'historique mais ne touche PAS
  // activeConversationFile s'il valait déjà null (cas par défaut tant que
  // l'utilisateur n'a jamais cliqué "Sauvegarder" — autoSaveConversation
  // écrit sur disque en arrière-plan sans jamais l'assigner).
  useEffect(() => {
    setHistoricalTerminalActions({});
  }, [activeConversationFile]);

  useEffect(() => {
    if (conversationHistory.length === 0) {
      setHistoricalTerminalActions({});
    }
  }, [conversationHistory.length]);

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

  // Le mode 'text' rend le stream en Markdown (même moteur que le message
  // final, cf. plus bas) au lieu d'un <pre> brut — donc chaque mise à jour
  // reparse tout le texte accumulé depuis le début de la réponse. RAF borne
  // déjà la fréquence à l'écran, mais un provider cloud rapide (Gemini/Claude/
  // Kimi, contrairement à Ollama CPU) peut streamer bien plus vite que 100ms —
  // ce throttle plafonne le coût de reparsing indépendamment du débit du token.
  useEffect(() => {
    if (streamingMode !== 'text') return undefined;
    const MIN_INTERVAL_MS = 100;
    const elapsed = Date.now() - lastStreamingParseAtRef.current;
    if (elapsed >= MIN_INTERVAL_MS) {
      lastStreamingParseAtRef.current = Date.now();
      setThrottledStreamingText(streamingText);
      return undefined;
    }
    const timer = setTimeout(() => {
      lastStreamingParseAtRef.current = Date.now();
      setThrottledStreamingText(streamingText);
    }, MIN_INTERVAL_MS - elapsed);
    return () => clearTimeout(timer);
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
      if (copyResetTimerRef.current) {
        clearTimeout(copyResetTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (conversationHistoryRef.current && isPinnedToBottomRef.current) {
      conversationHistoryRef.current.scrollTop = conversationHistoryRef.current.scrollHeight;
    }
  }, [conversationHistory, isLoading]);

  const handlePromptChange = (value) => {
    onPromptChange(value);

    // COD-70 — toute nouvelle frappe quitte la navigation dans l'historique.
    if (historyIndex !== -1) {
      liveDraftRef.current = value;
      setHistoryIndex(-1);
    }
    // COD-70 — la suggestion surlignee repart au debut a chaque changement.
    setActiveSuggestion(0);

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

  // COD-70 A.4 — historique de prompts : ↑ dans un composer vide (ou en
  // navigation) rappelle le message precedent, ↓ revient a la saisie en cours.
  const userPromptHistory = useMemo(
    () => conversationHistory
      .filter((m) => m.role === 'user' && String(m.text || '').trim())
      .map((m) => m.text),
    [conversationHistory]
  );

  const recallHistory = useCallback((direction) => {
    if (direction === 'up') {
      if (!userPromptHistory.length) return;
      const nextIndex = historyIndex === -1
        ? userPromptHistory.length - 1
        : Math.max(0, historyIndex - 1);
      if (historyIndex === -1) liveDraftRef.current = prompt;
      setHistoryIndex(nextIndex);
      setShowWorkflowSuggestions(false);
      setShowContextSuggestions(false);
      onPromptChange(userPromptHistory[nextIndex]);
    } else if (historyIndex !== -1) {
      const nextIndex = historyIndex + 1;
      if (nextIndex >= userPromptHistory.length) {
        setHistoryIndex(-1);
        onPromptChange(liveDraftRef.current);
      } else {
        setHistoryIndex(nextIndex);
        onPromptChange(userPromptHistory[nextIndex]);
      }
    }
  }, [historyIndex, userPromptHistory, prompt, onPromptChange]);

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
      // COD-70 — onSend (useAI.generateAIResponse) accepte deja un prompt
      // effectif en argument : le contexte force est passe directement, plus
      // de course state/setTimeout(onSend, 50) (l'ancien "Hack:" dans ce bloc).
      if (explicitContext.length > 0 && typeof onSend === 'function') {
        const contextString = `[Contexte forcé: ${explicitContext.join(', ')}]\n\n`;
        setExplicitContext([]);
        // generateAIResponse(overridePrompt) ne vide pas le champ lui-meme
        // (chemin normal : setPrompt('') seulement si overridePrompt indefini).
        onPromptChange('');
        onSend(contextString + prompt);
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
    // COD-70 A.2 — pendant une composition IME (CJK, accents), Enter valide
    // la composition, pas l'envoi du message.
    if (e.nativeEvent && e.nativeEvent.isComposing) return;

    // COD-70 A.3 — navigation clavier dans les suggestions @fichier / /workflow.
    const suggestionsOpen = showWorkflowSuggestions || showContextSuggestions;
    if (suggestionsOpen) {
      const items = showWorkflowSuggestions ? filteredWorkflows : filteredContextFiles;
      const activeItem = items[Math.min(activeSuggestion, Math.max(0, items.length - 1))];
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveSuggestion((i) => (items.length ? (i + 1) % items.length : 0));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveSuggestion((i) => (items.length ? (i - 1 + items.length) % items.length : 0));
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (activeItem) {
          if (showWorkflowSuggestions) handleSelectWorkflow(activeItem);
          else handleSelectContextFile(activeItem);
          return;
        }
        handleSend();
        return;
      }
      if (e.key === 'Tab') {
        if (activeItem) {
          e.preventDefault();
          if (showWorkflowSuggestions) handleSelectWorkflow(activeItem);
          else handleSelectContextFile(activeItem);
          return;
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowWorkflowSuggestions(false);
        setShowContextSuggestions(false);
        return;
      }
    }

    // COD-70 A.4 — historique de prompts (↑/↓), hors suggestions.
    if (e.key === 'ArrowUp' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
      const el = e.currentTarget;
      const caretOnFirstLine = !el.value.slice(0, el.selectionStart).includes('\n');
      if (caretOnFirstLine && (historyIndex !== -1 || !el.value.trim())) {
        e.preventDefault();
        recallHistory('up');
        return;
      }
    }
    if (e.key === 'ArrowDown' && historyIndex !== -1 && !e.shiftKey) {
      const el = e.currentTarget;
      const caretOnLastLine = !el.value.slice(el.selectionEnd).includes('\n');
      if (caretOnLastLine) {
        e.preventDefault();
        recallHistory('down');
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // COD-70 A.6 — glisser-deposer d'images sur le composer (parite avec le
  // collage : memes callbacks onPasteImage, meme pipeline de lecture).
  const hasFilePayload = (dataTransfer) =>
    Array.from(dataTransfer?.types || []).includes('Files');

  const handleComposerDrop = (e) => {
    e.preventDefault();
    dragDepthRef.current = 0;
    setIsDraggingFiles(false);
    if (!onPasteImage) return;
    const files = Array.from(e.dataTransfer?.files || []);
    files.forEach((file) => {
      if (!file.type || !file.type.startsWith('image/')) return;
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

  const handleComposerDragOver = (e) => {
    if (!onPasteImage || !hasFilePayload(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleComposerDragEnter = (e) => {
    if (!onPasteImage || !hasFilePayload(e.dataTransfer)) return;
    e.preventDefault();
    dragDepthRef.current += 1;
    setIsDraggingFiles(true);
  };

  const handleComposerDragLeave = () => {
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDraggingFiles(false);
  };

  const handleStop = () => {
    if (typeof onStopGeneration === 'function') {
      onStopGeneration();
    }
  };

  const lastAssistantIndex = useMemo(() => {
    for (let i = conversationHistory.length - 1; i >= 0; i -= 1) {
      if (conversationHistory[i]?.role === 'model') return i;
    }
    return -1;
  }, [conversationHistory]);

  const handleCopyMessage = useCallback((index, text) => {
    const plain = stripReasoningBlocks(text);
    if (!plain || !navigator.clipboard?.writeText) return;
    navigator.clipboard.writeText(plain).then(() => {
      setCopiedMessageIndex(index);
      if (copyResetTimerRef.current) clearTimeout(copyResetTimerRef.current);
      copyResetTimerRef.current = setTimeout(() => setCopiedMessageIndex(null), 1800);
    }).catch(() => { /* presse-papiers refuse : pas de faux succes affiche */ });
  }, []);

  const findPrecedingUserText = useCallback((index) => {
    for (let i = index - 1; i >= 0; i -= 1) {
      if (conversationHistory[i]?.role === 'user') return String(conversationHistory[i].text || '');
    }
    return '';
  }, [conversationHistory]);

  const handleRerunMessage = useCallback((index) => {
    const text = findPrecedingUserText(index);
    if (!text.trim() || isLoading || typeof onSend !== 'function') return;
    onSend(text);
  }, [findPrecedingUserText, isLoading, onSend]);

  // COD-70 B.13 — bascule du pouce (re-clic sur le meme pouce = retire).
  const handleToggleFeedback = useCallback((index, kind) => {
    setMessageFeedback((prev) => {
      const next = { ...prev };
      if (next[index] === kind) delete next[index];
      else next[index] = kind;
      return next;
    });
  }, []);

  // COD-70 B.12 — "Modifier" un message user : edition inline non-destructive
  // (le fil n'est pas tronque, cf. pipeline generateAIResponse). Valider
  // remplace le message en memoire puis relance une reponse a partir de la
  // version editees ; Echap annule.
  const beginEditUserMessage = useCallback((index, text) => {
    if (isLoading) return;
    setEditingIndex(index);
    setEditingText(String(text || ''));
    requestAnimationFrame(() => {
      const el = editTextareaRef.current;
      if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
    });
  }, [isLoading]);

  const cancelEditUserMessage = useCallback(() => {
    setEditingIndex(null);
    setEditingText('');
  }, []);

  const commitEditUserMessage = useCallback((index) => {
    const nextText = editingText.trim();
    const original = conversationHistory[index];
    setEditingIndex(null);
    setEditingText('');
    if (!nextText || !original || nextText === String(original.text || '')) return;
    // Re-envoi non-destructif : le texte edite part comme nouveau tour.
    if (typeof onSend === 'function' && !isLoading) onSend(nextText);
  }, [editingText, conversationHistory, onSend, isLoading]);


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
            {/* Un diff se lit verbatim : l'ancien filterUserVisibleText()
                supprimait ici toute ligne commençant par {, [ ou ", donc une
                bonne partie du contenu édité. */}
            <pre className="ai-stream-raw-preview">{stripReasoningBlocks(streamingText)}</pre>
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
          <div className="ai-stream-markdown">
            {/* Même moteur (MarkdownRenderer) que le message final une fois la
                génération terminée : avant, le stream passait par un <pre>
                brut puis basculait sur du Markdown rendu à la fin, avec un
                saut visuel et des blocs de code non coloriés pendant tout le
                stream. Le bruit "construction de workflow" est déjà géré en
                amont par streamingMode ('workflow' a son propre rendu). */}
            <MarkdownRenderer text={stripReasoningBlocks(throttledStreamingText)} />
          </div>
        )}
      </div>
    );
  };

  const handleApplyPending = useCallback(async (index, overrideContent = null) => {
    if (typeof onApplyPendingChange !== 'function') return;
    setIsApplyingPending(true);
    try {
      await onApplyPendingChange(index, overrideContent);
    } finally {
      setIsApplyingPending(false);
    }
  }, [onApplyPendingChange]);

  const findPendingIndexForPath = useCallback((filePath) => {
    const target = normalizeMarkerPath(filePath);
    if (!target || !Array.isArray(pendingFileChanges)) return -1;
    return pendingFileChanges.findIndex(
      (change) => normalizeMarkerPath(change?.filePath) === target
    );
  }, [pendingFileChanges]);

  const handleApplyMarkdownBlock = useCallback((code, language, filePath) => {
    const index = findPendingIndexForPath(filePath);
    if (index < 0) return;
    handleApplyPending(index, code);
  }, [findPendingIndexForPath, handleApplyPending]);

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
    if (autoRoute) return baseLabel;
    const provider = String(msg?.agentProvider || '').trim();
    return provider ? `${baseLabel} (${provider})` : baseLabel;
  };

  // ─── 1.4c : swap gardé de la liste de messages ────────────────────────────
  // Éteint par défaut (cf. utils/featureFlags.js). Lu une seule fois au
  // montage : basculer en cours de session remonterait tout l'historique dans
  // un autre arbre DOM, ce qui casserait la position de scroll.
  const [chatInterfaceSwap] = useState(() => isChatInterfaceSwapEnabled());
  const swapMessages = useMemo(
    () => conversationToChatMessages(conversationHistory),
    [conversationHistory]
  );

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
  const activeSessionForTitle = sessions.find((s) => s.id === activeSessionId) || null;
  const headerTitle = activeConversation
    ? activeConversation.title
    : (activeSessionForTitle?.title || 'Nouvelle conversation');
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
            {typeof onOpenSessionTab === 'function' && (
              <button
                type="button"
                onClick={() => { onOpenSessionTab(activeSessionId); setShowConversations(false); }}
                className="ai-header-btn"
                disabled={!activeSessionId}
                title="Ouvrir cette conversation dans un onglet"
              >
                <IconExpand size={16} />
              </button>
            )}
            <button
              onClick={onSaveConversation}
              className="ai-header-btn"
              disabled={!currentProjectPath || conversationHistory.length === 0 || !isElectronApiAvailable}
              title="Sauvegarder"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>
            </button>
            {onToggleSwarmPanel && (
              <button
                type="button"
                onClick={onToggleSwarmPanel}
                className="ai-header-btn"
                title={isSwarmPanelOpen ? 'Masquer le panneau des agents' : 'Afficher le panneau des agents'}
                aria-label={isSwarmPanelOpen ? 'Masquer le panneau des agents' : 'Afficher le panneau des agents'}
                aria-pressed={Boolean(isSwarmPanelOpen)}
              >
                <IconAgents />
              </button>
            )}
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

      {/* ===== SESSIONS + CONVERSATIONS DROPDOWN (plan-ia-onglets.md §⑤ 5.5.2) ===== */}
      {showConversations && (
        <div className="ai-suggest-overlay">
          {/* Historique des SESSIONS (en memoire, 5.5.1) — distinct des
              "Conversations" ci-dessous qui restent les sauvegardes explicites
              sur disque (bouton Sauvegarder), une fonctionnalite existante et
              non touchee par ce chantier. */}
          <div ref={sessionMenuRef} className="ai-chat-dropdown" style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface-2)', maxHeight: 220, overflowY: 'auto', boxShadow: '0 8px 20px rgba(0, 0, 0, 0.28)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 14px', borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Sessions</span>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{sessions.length}</span>
            </div>
            <div>
              {sessions.length === 0 && (
                <div style={{ padding: '8px 14px', fontSize: 10, color: 'var(--text-muted)' }}>Aucune</div>
              )}
              {sessions.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).map((session) => (
                <div
                  key={session.id}
                  className={`ai-history-item ${session.id === activeSessionId ? 'is-active' : ''}`}
                  style={{ position: 'relative', gap: 4 }}
                  role="button"
                  tabIndex={0}
                  onClick={() => { if (onSwitchSession) onSwitchSession(session.id); setShowConversations(false); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { if (onSwitchSession) onSwitchSession(session.id); setShowConversations(false); } }}
                  onContextMenu={(e) => { e.preventDefault(); setSessionMenuId(session.id); }}
                >
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{session.title}</span>
                  {typeof onOpenSessionTab === 'function' && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onOpenSessionTab(session.id); }}
                      title="Ouvrir dans un onglet"
                      aria-label={`Ouvrir "${session.title}" dans un onglet`}
                      style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: 2, display: 'flex', flexShrink: 0 }}
                    >
                      <IconExpand size={12} />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setSessionMenuId((prev) => (prev === session.id ? null : session.id)); }}
                    title="Plus d'actions"
                    aria-label={`Actions pour "${session.title}"`}
                    aria-haspopup="menu"
                    aria-expanded={sessionMenuId === session.id}
                    style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: 2, display: 'flex', flexShrink: 0 }}
                  >
                    <IconMoreVertical size={12} />
                  </button>
                  {sessionMenuId === session.id && (
                    <div className="ai-pill-menu" role="menu" style={{ position: 'absolute', top: '100%', right: 4, zIndex: 20 }}>
                      <button type="button" role="menuitem" className="ai-pill-menu-item" onClick={(e) => { e.stopPropagation(); onOpenSessionTab && onOpenSessionTab(session.id); setSessionMenuId(null); }}>
                        <IconExpand size={13} /> Ouvrir dans un onglet
                      </button>
                      <button type="button" role="menuitem" className="ai-pill-menu-item" onClick={(e) => { e.stopPropagation(); onRenameSession && onRenameSession(session.id); setSessionMenuId(null); }}>
                        <IconEdit size={13} /> Renommer
                      </button>
                      <button type="button" role="menuitem" className="ai-pill-menu-item" onClick={(e) => { e.stopPropagation(); onDuplicateSession && onDuplicateSession(session.id); setSessionMenuId(null); }}>
                        <IconCopy size={13} /> Dupliquer
                      </button>
                      <div className="ai-pill-menu-separator" />
                      <button type="button" role="menuitem" className="ai-pill-menu-item" onClick={(e) => { e.stopPropagation(); onDeleteSession && onDeleteSession(session.id); setSessionMenuId(null); }}>
                        <IconTrash size={13} /> Supprimer
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

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
<IconCheck size={11} /> Appliquer tout
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
                  ><IconCheck size={10} /></button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleRejectPending(index); }}
                    disabled={isApplyingPending || isBulkApplyingPending}
                    style={{ background: 'transparent', color: 'var(--text-dim)', border: '1px solid var(--border)', borderRadius: 2, padding: '1px 6px', fontSize: 9, cursor: 'pointer' }}
                  ><IconX size={10} /></button>
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
        onScroll={handleConversationScroll}
      >
        <div className="ai-reading-col">
          {conversationHistory.length === 0 && !isLoading && (
            <ChatWelcome
              onPickSuggestion={(suggestionPrompt) => {
                handlePromptChange(suggestionPrompt);
                setTimeout(() => promptInputRef.current?.focus(), 10);
              }}
            />
          )}

          {chatInterfaceSwap ? (
            <MessageViewer
              messages={swapMessages}
              // Volontairement sans streamingText : l'aperçu de streaming
              // existant (renderStreaming*, index.js:1048) gère trois modes
              // (fichier / workflow / texte) que MessageViewer ne modélise
              // pas. Lui passer le flux ici l'afficherait deux fois.
              actionsDisabled={isLoading}
              onCopyMessage={(message) =>
                handleCopyMessage(message.sourceIndex, conversationHistory[message.sourceIndex]?.text)
              }
              onRerunMessage={(message) => handleRerunMessage(message.sourceIndex)}
              onApplyCode={
                canApplyPending && !isApplyingPending && !isBulkApplyingPending
                  && Array.isArray(pendingFileChanges) && pendingFileChanges.length > 0
                  ? handleApplyMarkdownBlock
                  : undefined
              }
              renderMessageExtras={(message) => {
                const source = conversationHistory[message.sourceIndex];
                const images = Array.isArray(source?.images) ? source.images : [];
                const actions = historicalTerminalActions[message.sourceIndex];
                if (!images.length && !(Array.isArray(actions) && actions.length)) return null;
                return (
                  <>
                    {images.length > 0 && (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', paddingLeft: 26 }}>
                        {images.map((img, i) => (
                          <img key={i} src={img.dataUrl} alt="Collé" style={{ width: 48, height: 48, borderRadius: 4, objectFit: 'cover', border: '1px solid var(--border)' }} />
                        ))}
                      </div>
                    )}
                    {Array.isArray(actions) && actions.length > 0 && (
                      <div style={{ paddingLeft: 26, marginTop: 4 }}>
                        {actions.map((action, i) => (
                          <TerminalActionCard key={i} action={action} />
                        ))}
                      </div>
                    )}
                  </>
                );
              }}
            />
          ) : conversationHistory.map((msg, index) => {
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
                  {isUser && editingIndex === index ? (
                    <div className="ai-message-edit">
                      <textarea
                        ref={editTextareaRef}
                        className="ai-message-edit-textarea"
                        value={editingText}
                        onChange={(e) => setEditingText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey && !(e.nativeEvent && e.nativeEvent.isComposing)) {
                            e.preventDefault();
                            commitEditUserMessage(index);
                          }
                          if (e.key === 'Escape') { e.preventDefault(); cancelEditUserMessage(); }
                        }}
                        rows={Math.min(10, Math.max(2, editingText.split('\n').length))}
                        aria-label="Modifier le message"
                      />
                      <div className="ai-message-edit-actions">
                        <button type="button" className="ai-msg-action" onClick={cancelEditUserMessage}>Annuler</button>
                        <button type="button" className="ai-msg-action is-primary" onClick={() => commitEditUserMessage(index)} disabled={!editingText.trim()}>Envoyer</button>
                      </div>
                    </div>
                  ) : (
                  (() => {
                    const segments = splitReasoningSegments(msg.text);
                    // Garde-fou : un provider peut renvoyer success avec un
                    // texte vide (cf. ollama.provider, 8 tours d'outils sans
                    // réponse). Sans ça, la bulle s'affichait totalement vide.
                    if (segments.length === 0) {
                      return !isUser ? (
                        <p className="ai-message-empty">
                          (réponse vide — le modèle n&apos;a rien renvoyé)
                        </p>
                      ) : null;
                    }
                    return segments.map((segment, segmentIndex) => {
                      if (segment.type === 'reasoning') {
                        return <ReasoningBlock key={`seg-${segmentIndex}`} content={segment.content} />;
                      }
                      // Le message utilisateur reste en texte brut : ce qu'il a
                      // tapé doit s'afficher tel quel, sans réinterpréter ses
                      // astérisques ou ses backticks.
                      if (isUser) {
                        return (
                          <p
                            key={`seg-${segmentIndex}`}
                            style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                          >
                            {segment.content.trim()}
                          </p>
                        );
                      }
                      // Réponse IA : Markdown rendu (blocs de code avec
                      // coloration + bouton Copier, titres, listes). Le
                      // renderer existait depuis toujours mais n'était importé
                      // nulle part — tout s'affichait en brut.
                      return (
                        <MarkdownRenderer
                          key={`seg-${segmentIndex}`}
                          text={segment.content.trim()}
                          onApply={canApplyPending && !isApplyingPending && !isBulkApplyingPending && Array.isArray(pendingFileChanges) && pendingFileChanges.length > 0
                            ? handleApplyMarkdownBlock
                            : undefined}
                        />
                      );
                    });
                  })())}
                </div>

                {!isUser && msg.role !== 'system' && (
                  <div className={`ai-message-actions${index === lastAssistantIndex ? ' is-pinned' : ''}`}>
                    <button
                      type="button"
                      className="ai-msg-action"
                      onClick={() => handleCopyMessage(index, msg.text)}
                      title={copiedMessageIndex === index ? 'Copié' : 'Copier la réponse'}
                      aria-label="Copier la réponse"
                    >
                      {copiedMessageIndex === index ? (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                      ) : (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                      )}
                    </button>
                    <button
                      type="button"
                      className="ai-msg-action"
                      onClick={() => handleRerunMessage(index)}
                      disabled={isLoading || !findPrecedingUserText(index).trim()}
                      title={isLoading ? 'Génération en cours' : 'Relancer cette requête'}
                      aria-label="Relancer cette requête"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
                    </button>
                    <span className="ai-msg-action-sep" aria-hidden="true" />
                    <button
                      type="button"
                      className={`ai-msg-action ai-msg-feedback${messageFeedback[index] === 'up' ? ' is-active is-up' : ''}`}
                      onClick={() => handleToggleFeedback(index, 'up')}
                      aria-pressed={messageFeedback[index] === 'up'}
                      title="Réponse utile"
                      aria-label="Réponse utile"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" /></svg>
                    </button>
                    <button
                      type="button"
                      className={`ai-msg-action ai-msg-feedback${messageFeedback[index] === 'down' ? ' is-active is-down' : ''}`}
                      onClick={() => handleToggleFeedback(index, 'down')}
                      aria-pressed={messageFeedback[index] === 'down'}
                      title="Réponse peu utile"
                      aria-label="Réponse peu utile"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zM17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17" /></svg>
                    </button>
                  </div>
                )}

                {isUser && editingIndex !== index && (
                  <div className="ai-message-actions">
                    <button
                      type="button"
                      className="ai-msg-action"
                      onClick={() => handleCopyMessage(index, msg.text)}
                      title={copiedMessageIndex === index ? 'Copié' : 'Copier le message'}
                      aria-label="Copier le message"
                    >
                      {copiedMessageIndex === index ? (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                      ) : (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                      )}
                    </button>
                    <button
                      type="button"
                      className="ai-msg-action"
                      onClick={() => beginEditUserMessage(index, msg.text)}
                      disabled={isLoading}
                      title="Modifier et renvoyer"
                      aria-label="Modifier et renvoyer"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                    </button>
                  </div>
                )}

                {Array.isArray(msg.images) && msg.images.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', paddingLeft: 26 }}>
                    {msg.images.map((img, i) => (
                      <img key={i} src={img.dataUrl} alt="Collé" style={{ width: 48, height: 48, borderRadius: 4, objectFit: 'cover', border: '1px solid var(--border)' }} />
                    ))}
                  </div>
                )}

                {/* Cartes terminal du tour AUQUEL ce message appartient (archivées
                    par l'effet historicalTerminalActions à la fin de ce tour-là —
                    pas le tour en cours, qui se rend plus bas via `terminalActions`). */}
                {Array.isArray(historicalTerminalActions[index]) && historicalTerminalActions[index].length > 0 && (
                  <div style={{ paddingLeft: 26, marginTop: 4 }}>
                    {historicalTerminalActions[index].map((action, i) => (
                      <TerminalActionCard key={i} action={action} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* AI Terminal Action Cards (ReAct Loop) — tour EN COURS */}
          {isLoading && terminalActions.length > 0 && (
            <div style={{ padding: '8px 14px' }}>
              {terminalActions.map((action, i) => (
                <TerminalActionCard key={i} action={action} />
              ))}
            </div>
          )}

          {isLoading && !multiAIState?.isActive && terminalActions.length > 0 && (
            <div className="ai-message-loading">
              <div className="ai-loading-dots"><span className="ai-loading-dot" /><span className="ai-loading-dot" /><span className="ai-loading-dot" /></div>
              <span>Exécution... ({terminalActions.filter(a => a.type === 'done').length}/{terminalActions.length} commandes)</span>
            </div>
          )}

          {/* Indicateur INCONDITIONNEL d'attente. Les trois autres blocs
              `isLoading &&` exigent tous soit streamingText, soit une commande
              terminal en cours : dans le cas nominal (aucune commande, provider
              non streamant) l'interface restait donc rigoureusement identique à
              l'état de repos pendant toute la génération — seul le libellé du
              bouton changeait. C'est ce qui poussait à renvoyer le message en
              croyant qu'il n'était pas parti. */}
          {isLoading && !multiAIState?.isActive && terminalActions.length === 0 && !streamingText && (
            <div className="ai-message-loading">
              <div className="ai-loading-dots"><span className="ai-loading-dot" /><span className="ai-loading-dot" /><span className="ai-loading-dot" /></div>
              <span className="ai-loading-label">
                {elapsedSeconds > 0
                  ? `${thinkingLabel}… ${elapsedSeconds}s`
                  : `${thinkingLabel}…`}
              </span>
            </div>
          )}
        </div>

        {/* Doit rester ENFANT de .ai-messages : c'est ce conteneur qui porte
            position:relative (AIChat.css), pas ses freres. Place en sibling,
            le bouton s'ancre au premier ancetre positionne trouve plus haut
            dans l'arbre — potentiellement tout autre chose que le panneau de
            chat. */}
        {showScrollDown && (
          <button
            type="button"
            onClick={handleScrollToBottom}
            className="ai-scroll-to-bottom"
            title="Revenir en bas"
            aria-label="Revenir en bas"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        )}
      </div>

      {/* Intelligent Router decision (auto mode only) — above the input bar */}
      {autoRoute && <AIDecisionBadge decision={routerDecision} />}

      {/* ===== INPUT BAR (unified, Antigravity-style) ===== */}
      <div className="ai-input-bar">
        <div className="ai-reading-col ai-input-bar-inner">
          {/* Pending message indicator */}
          {pendingMessage && (
            <div className="ai-input-pending-banner" role="status">
              <span><IconHourglass size={11} /></span>
              <span className="ai-input-pending-text">
                En attente&#x202F;: <em>{pendingMessage.text}</em>
              </span>
              <span className="ai-input-pending-hint">sera envoyé automatiquement</span>
            </div>
          )}

          {/* Pending images */}
          {pendingImages && pendingImages.length > 0 && (
            <div className="ai-input-images">
              {pendingImages.map((img, idx) => (
                <div key={idx} className="ai-input-image-wrap">
                  <img src={img.dataUrl} alt={`Image jointe ${idx + 1}`} className="ai-input-image" />
                  <button
                    type="button"
                    className="ai-input-image-remove"
                    aria-label={`Retirer l'image ${idx + 1}`}
                    onClick={() => onRemovePendingImage && onRemovePendingImage(idx)}
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
                    <button
                      type="button"
                      className="ai-message-file-ref-close"
                      aria-label={`Retirer ${fileName} du contexte`}
                      onClick={() => removeExplicitContext(filePath)}
                    >×</button>
                  </span>
                );
              })}
            </div>
          )}

          {/* Composer: un seul bloc arrondi = textarea + rangée [+] [mode] [modèle] [autonomie] [Envoyer] */}
          <div
            className={`ai-composer${isLoading ? ' is-working' : ''}${isDraggingFiles ? ' is-drop-target' : ''}`}
            onDrop={handleComposerDrop}
            onDragOver={handleComposerDragOver}
            onDragEnter={handleComposerDragEnter}
            onDragLeave={handleComposerDragLeave}
          >
          {isDraggingFiles && (
            <div className="ai-composer-drop-hint" aria-hidden="true">
              Déposez vos images ici
            </div>
          )}
          {/* Textarea */}
          <textarea
            ref={promptInputRef}
            id="ai-prompt"
            className="ai-input-bar-textarea"
            value={prompt}
            onChange={(e) => handlePromptChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder="Votre requête... (@ fichier, / workflow — Entrée pour envoyer, Maj+Entrée pour une nouvelle ligne)"
            rows={2}
            role="combobox"
            aria-expanded={showWorkflowSuggestions || showContextSuggestions}
            aria-controls="ai-suggest-listbox"
            aria-autocomplete="list"
            aria-activedescendant={
              ((showWorkflowSuggestions && filteredWorkflows.length > 0) ||
                (showContextSuggestions && filteredContextFiles.length > 0))
                ? `ai-suggest-opt-${activeSuggestion}`
                : undefined
            }
          />

          {/* Workflow suggestions */}
          {showWorkflowSuggestions && filteredWorkflows.length > 0 && (
            <div className="ai-suggest-overlay">
              <div className="ai-suggest-panel">
                <div className="ai-suggest-header">Workflows disponibles</div>
                <ul className="ai-suggest-list" id="ai-suggest-listbox" role="listbox" aria-label="Workflows disponibles">
                  {filteredWorkflows.map((workflow, i) => (
                    <li
                      key={`${workflow.scope}-${workflow.name}`}
                      id={`ai-suggest-opt-${i}`}
                      role="option"
                      aria-selected={i === activeSuggestion}
                      className={`ai-suggest-item${i === activeSuggestion ? ' is-active' : ''}`}
                      onMouseEnter={() => setActiveSuggestion(i)}
                      onClick={() => handleSelectWorkflow(workflow)}
                    >
                      <span className="ai-suggest-item-name">/{workflow.name}</span>
                      {workflow.description && <span className="ai-suggest-item-desc">{workflow.description}</span>}
                      <span className="ai-suggest-item-scope">{workflow.scope}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* Context file suggestions */}
          {showContextSuggestions && (
            <div className="ai-suggest-overlay">
              <div className="ai-suggest-panel">
                <div className="ai-suggest-header">Fichiers du projet</div>
                {filteredContextFiles.length === 0 ? (
                  <div className="ai-suggest-empty">Aucun fichier pour {contextFilter}</div>
                ) : (
                  <ul className="ai-suggest-list" id="ai-suggest-listbox" role="listbox" aria-label="Fichiers du projet">
                    {filteredContextFiles.map((filePath, i) => {
                      const fileName = filePath.split(/[\\/]/).pop() || filePath;
                      return (
                        <li
                          key={filePath}
                          id={`ai-suggest-opt-${i}`}
                          role="option"
                          aria-selected={i === activeSuggestion}
                          className={`ai-suggest-item${i === activeSuggestion ? ' is-active' : ''}`}
                          onMouseEnter={() => setActiveSuggestion(i)}
                          onClick={() => handleSelectContextFile(filePath)}
                        >
                          <span className="ai-suggest-item-name">@{fileName}</span>
                          <span className="ai-suggest-item-path">{filePath}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
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

            {autoRoute ? (
              <span className="ai-auto-router-pill" role="status">Neven · Auto</span>
            ) : (
              <>
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
              </>
            )}

            {/* Effort de raisonnement : aiguille le routeur / control plane vers
                un profil plus ou moins puissant, sans exposer les profils internes. */}
            {onReasoningEffortChange && (
              <ReasoningEffortPill
                reasoningEffort={reasoningEffort}
                onReasoningEffortChange={onReasoningEffortChange}
                disabled={isLoading}
              />
            )}

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
              disabled={!isElectronApiAvailable}
              title={!currentProjectPath ? "Ouvrez un dossier de projet pour discuter avec l'IA" : undefined}
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

          {/* COD-70 A.10 — raison explicite quand l'envoi est indisponible
              (le bouton disabled seul ne disait rien a l'utilisateur). */}
          {!isElectronApiAvailable && (
            <div className="ai-input-warning" role="alert">
              IA indisponible&nbsp;: l&apos;application Electron n&apos;est pas connectée.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AIChat;
