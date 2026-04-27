import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import './AIChat.css';
import './MarkdownRenderer.css';
import { AIWorkingIndicator } from '../LoadingAnimations';
import MarkdownRenderer from './MarkdownRenderer';
import StreamingCodeBlock from './StreamingCodeBlock';

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

const extractStreamingWorkflowDraft = (text) => {
  const match = extractLastStreamingMatch(WORKFLOW_BLOCK_STREAM_REGEX, text);
  if (!match) return null;
  return {
    name: String(match[1] || '').trim(),
    json: String(match[2] || '').replace(/^\s*\n/, '')
  };
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
  globalSkillsCount = 0,
  aiProvider = 'gemini',
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
  onStreamingDraftChange,
  onProviderChange,
  thinkingMode,
  onThinkingModeChange,
  deepContextEnabled,
  onDeepContextEnabledChange,
  resolvedOllamaModel,
  resolvedOllamaArchitect,
  resolvedOllamaCoder,
  resolvedOllamaTester,
  availableOllamaModels = [],
  onOllamaSettingChange,
  isExpertMode
}) => {
  const conversationHistoryRef = useRef(null);
  const promptInputRef = useRef(null);
  const [showConversations, setShowConversations] = useState(false);
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
  const [streamingAgent, setStreamingAgent] = useState('');     // which agent is streaming
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

  // Register Ollama multi-agent streaming tokens
  useEffect(() => {
    if (!isElectronApiAvailable || !window.electronAPI?.onOllamaMultiToken) return;
    const offToken = window.electronAPI.onOllamaMultiToken((data) => {
      if (!data) return;
      if (data.agent) setStreamingAgent(data.agent);

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
      if (streamingFlushRafRef.current !== null) {
        window.cancelAnimationFrame(streamingFlushRafRef.current);
        streamingFlushRafRef.current = null;
      }
      streamingBufferRef.current = '';
    };
  }, [isElectronApiAvailable, flushStreamingBuffer]);

  useEffect(() => {
    if (!isElectronApiAvailable || !window.electronAPI?.onAIGenerationToken) return;
    const offToken = window.electronAPI.onAIGenerationToken((data) => {
      if (!data) return;
      if (data.provider === 'kimi') {
        setStreamingAgent('Kimi');
      }

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
      setStreamingAgent('');
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

  const handleKeyPress = (e) => {
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
  const safeMultiSteps = Array.isArray(multiAIState?.steps) ? multiAIState.steps : [];
  const safeCurrentStepIndex = safeMultiSteps.findIndex((s) => s?.status === 'active');
  const currentWorkflowAnimStep = WORKFLOW_STREAM_STEPS[workflowAnimStep] || WORKFLOW_STREAM_STEPS[0];
  const streamingFileDraft = useMemo(() => extractStreamingFileDraft(streamingText), [streamingText]);
  const streamingWorkflowDraft = useMemo(() => extractStreamingWorkflowDraft(streamingText), [streamingText]);
  // streamingCodeLineCount now handled inside StreamingCodeBlock

  useEffect(() => {
    if (typeof onStreamingDraftChange !== 'function') return;
    if (!isLoading || streamingMode !== 'code' || !streamingFileDraft?.filePath) {
      onStreamingDraftChange(null);
      return;
    }

    onStreamingDraftChange({
      filePath: streamingFileDraft.filePath,
      language: streamingFileDraft.language || '',
      code: streamingFileDraft.code || streamingText,
      agent: streamingAgent || ''
    });
  }, [isLoading, onStreamingDraftChange, streamingAgent, streamingFileDraft, streamingMode, streamingText]);

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
              <pre className="ai-stream-json-preview">{streamingWorkflowDraft.json}</pre>
            )}
            <div className="ai-stream-anim-subtitle">
              Etape active: {currentWorkflowAnimStep.label} - {currentWorkflowAnimStep.detail}
            </div>
          </div>
        )}
        {streamingMode === 'diff' && (
          <div className="ai-stream-anim ai-stream-diff">
            <div className="ai-stream-anim-title">Edition structuree en cours...</div>
            <div className="ai-diff-file">
              <span className="diff-line diff-line-1" />
              <span className="diff-line diff-line-2" />
              <span className="diff-line diff-line-3" />
            </div>
            <pre className="ai-stream-raw-preview">{streamingText}</pre>
            <div className="ai-stream-anim-subtitle">Syntaxe detectee: {'<<<< SEARCH ... >>>> REPLACE'}</div>
          </div>
        )}
        {streamingMode === 'code' && (
          <StreamingCodeBlock
            code={streamingFileDraft?.code || streamingText}
            filePath={streamingFileDraft?.filePath || ''}
            language={streamingFileDraft?.language || ''}
            isStreaming={isLoading}
            agent={streamingAgent || ''}
          />
        )}
        {streamingMode === 'text' && (
          <div className="ai-stream-text-wrap">
            <MarkdownRenderer text={streamingText} />
          </div>
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

  const getRoleMeta = (msg) => {
    if (msg.role === 'system') {
      return {
        label: 'Système',
        avatar: '⚙️',
        avatarClass: 'chat-avatar-system',
        badgeClass: 'chat-badge-system',
        bubbleClass: 'chat-bubble-system',
        alignClass: 'chat-row-system'
      };
    }

    if (msg.role === 'user') {
      return {
        label: 'Vous',
        avatar: '👤',
        avatarClass: 'chat-avatar-user',
        badgeClass: 'chat-badge-user',
        bubbleClass: 'chat-bubble-user',
        alignClass: 'chat-row-user'
      };
    }

    // 5 Agents Multi-IA
    if (msg.isChefDeProjet) {
      return {
        label: '🎯 Chef (Gemini 2.5)',
        avatar: '🎯',
        avatarClass: 'chat-avatar-chef',
        badgeClass: 'chat-badge-chef-projet',
        bubbleClass: 'chat-bubble-chef-projet',
        alignClass: 'chat-row-ai'
      };
    }

    if (msg.isFrontendDev) {
      return {
        label: '🎨 Front (Kimi)',
        avatar: '🎨',
        avatarClass: 'chat-avatar-frontend',
        badgeClass: 'chat-badge-frontend-dev',
        bubbleClass: 'chat-bubble-frontend-dev',
        alignClass: 'chat-row-ai'
      };
    }

    if (msg.isBackendDev) {
      return {
        label: '⚙️ Back (Kimi)',
        avatar: '⚙️',
        avatarClass: 'chat-avatar-backend',
        badgeClass: 'chat-badge-backend-dev',
        bubbleClass: 'chat-bubble-backend-dev',
        alignClass: 'chat-row-ai'
      };
    }

    if (msg.isArchitectEngineer || msg.isArchitect) {
      return {
        label: '🏗️ Archi (Kimi)',
        avatar: '🏗️',
        avatarClass: 'chat-avatar-architect',
        badgeClass: 'chat-badge-architect',
        bubbleClass: 'chat-bubble-architect',
        alignClass: 'chat-row-ai'
      };
    }

    if (msg.isScrumMaster) {
      return {
        label: '📋 Scrum (Gemini 2.5)',
        avatar: '📋',
        avatarClass: 'chat-avatar-scrum',
        badgeClass: 'chat-badge-scrum-master',
        bubbleClass: 'chat-bubble-scrum-master',
        alignClass: 'chat-row-ai'
      };
    }

    if (msg.isReviewer) {
      return {
        label: 'Relecteur',
        avatar: '🔍',
        avatarClass: 'chat-avatar-reviewer',
        badgeClass: 'chat-badge-reviewer',
        bubbleClass: 'chat-bubble-reviewer',
        alignClass: 'chat-row-ai'
      };
    }

    if (msg.isCoder) {
      return {
        label: 'Codeur',
        avatar: '💻',
        avatarClass: 'chat-avatar-coder',
        badgeClass: 'chat-badge-coder',
        bubbleClass: 'chat-bubble-coder',
        alignClass: 'chat-row-ai'
      };
    }

    return {
      label: 'IA',
      avatar: '🤖',
      avatarClass: 'chat-avatar-ai',
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

  const quickActions = useMemo(() => ([
    {
      id: 'explain',
      label: 'Expliquer',
      prompt: activeFile ? `Explique le fichier ${activeFile} et ses responsabilites.` : 'Explique le projet et sa structure.'
    },
    {
      id: 'refactor',
      label: 'Refactor',
      prompt: activeFile ? `Refactorise ${activeFile} en gardant le comportement.` : 'Propose un refactor global.'
    },
    {
      id: 'tests',
      label: 'Tests',
      prompt: activeFile ? `Ecris des tests pour ${activeFile}.` : 'Ecris des tests prioritaires.'
    },
    {
      id: 'docs',
      label: 'Docs',
      prompt: activeFile ? `Documente ${activeFile} (README court).` : 'Redige un README rapide.'
    },
    {
      id: 'plan',
      label: 'Plan',
      prompt: 'Donne un plan clair avant d agir.'
    }
  ]), [activeFile]);

  const applyQuickPrompt = (text) => {
    const next = prompt && prompt.trim() ? `${prompt}\n${text}` : text;
    onPromptChange(next);
    setShowWorkflowSuggestions(false);
    promptInputRef.current?.focus();
  };

  // Auto-resize textarea
  const handleTextareaInput = useCallback((e) => {
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, []);

  // Format timestamp
  const formatTime = useCallback((timestamp) => {
    if (!timestamp) return '';
    try {
      const d = new Date(timestamp);
      return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  }, []);

  return (
    <div className="ai-chat-container">
      <div className="ai-header">
        <div className="ai-header-left">
          <div className="ai-header-brand">
            <span className="ai-header-icon">🧠</span>
            <div className="ai-header-text">
              <div className="ai-title">Agent IA</div>
              <div className="ai-subtitle">{headerTitle}</div>
            </div>
          </div>
          {globalSkillsCount > 0 && (
            <div className="ai-skills-badge" title={`${globalSkillsCount} skills globaux injectés automatiquement dans chaque requête IA`}>
              ⚡ {globalSkillsCount} skills
            </div>
          )}
        </div>

        <div className="ai-controls">
          <button
            type="button"
            onClick={() => {
              if (onNewConversation) {
                onNewConversation();
              }
              setShowConversations(false);
            }}
            className="ai-control-btn"
            disabled={!currentProjectPath || !isElectronApiAvailable}
            title="Nouvelle conversation"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>

          <button
            type="button"
            onClick={() => setShowConversations(prev => !prev)}
            className={`ai-control-btn ${showConversations ? 'is-active' : ''}`}
            disabled={!currentProjectPath || !isElectronApiAvailable}
            title="Historique des conversations"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="12 8 12 12 14 14"/><circle cx="12" cy="12" r="10"/></svg>
          </button>

          <button
            type="button"
            onClick={onSaveConversation}
            className="ai-control-btn"
            disabled={!currentProjectPath || conversationHistory.length === 0 || !isElectronApiAvailable}
            title="Sauvegarder la conversation"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
          </button>
        </div>
      </div>

      {showConversations && (
        <div className="ai-dropdown">
          <div className="ai-dropdown-header">
            <span>Conversations</span>
            <span>{conversations.length}</span>
          </div>
          <div className="ai-dropdown-search">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Rechercher..."
            />
          </div>
          <div className="ai-dropdown-list">
            {isConversationLoading && (
              <div className="ai-dropdown-empty">Chargement...</div>
            )}
            {!isConversationLoading && filteredConversations.length === 0 && (
              <div className="ai-dropdown-empty">Aucune</div>
            )}
            {!isConversationLoading && filteredConversations.length > 0 && (
              <ul>
                {filteredConversations.map((conv) => (
                  <li
                    key={conv.fileName}
                    className={`ai-dropdown-item ${conv.fileName === activeConversationFile ? 'is-active' : ''}`}
                    onClick={() => handleSelectConversation(conv.fileName)}
                  >
                    <span className="ai-dropdown-title">{conv.title}</span>
                    <span className="ai-dropdown-date">
                      {new Date(conv.createdAt).toLocaleDateString('fr-FR', { month: 'numeric', day: 'numeric' })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {contextEstimate && (
        <div className="ai-context-estimate">
          <span>Contexte: {Number(contextEstimate.contextChars || 0).toLocaleString('fr-FR')} chars</span>
          <span>Prompt: {Number(contextEstimate.promptChars || 0).toLocaleString('fr-FR')} chars</span>
          <span>Tokens est.: {Number(contextEstimate.estimatedTokens || 0).toLocaleString('fr-FR')}</span>
          <span>Coût est.: ${Number(contextEstimate.estimatedCostUsd || 0).toFixed(4)}</span>
        </div>
      )}

      {Array.isArray(pendingFileChanges) && pendingFileChanges.length > 0 && (
        <div className="ai-pending-changes">
          <div className="ai-pending-head">
            <span>{pendingFileChanges.length} changement(s) IA en attente</span>
            <div className="ai-pending-head-actions">
              <button
                type="button"
                className="ai-control-btn"
                onClick={handleApplyAllPending}
                disabled={!canApplyPending || isApplyingPending || isBulkApplyingPending}
                title={!canApplyPending ? 'Mode lecture seule' : 'Appliquer tous les changements IA'}
              >
                Appliquer tout
              </button>
              <button
                type="button"
                className="ai-control-btn"
                onClick={handleRejectAllPending}
                disabled={isApplyingPending || isBulkApplyingPending}
                title="Rejeter tous les changements IA"
              >
                Rejeter tout
              </button>
            </div>
          </div>

          {pendingSnapshotId && (
            <div className="ai-pending-meta">Snapshot: {pendingSnapshotId}</div>
          )}

          <div className="ai-pending-list">
            {pendingFileChanges.slice(0, 8).map((change, index) => (
              <div
                key={change.id || `${change.filePath}-${index}`}
                className={`ai-pending-item ${isPendingChangeActive(change) ? 'is-active' : ''}`}
              >
                <button
                  type="button"
                  className="ai-pending-file"
                  onClick={() => onSelectPendingChange && onSelectPendingChange(index)}
                  title={change.filePath}
                >
                  {change.filePath}
                </button>
                <div className="ai-pending-item-actions">
                  <button
                    type="button"
                    className="ai-mini-btn is-apply"
                    onClick={() => handleApplyPending(index)}
                    disabled={!canApplyPending || isApplyingPending || isBulkApplyingPending}
                  >
                    Apply
                  </button>
                  <button
                    type="button"
                    className="ai-mini-btn is-reject"
                    onClick={() => handleRejectPending(index)}
                    disabled={isApplyingPending || isBulkApplyingPending}
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
            {pendingFileChanges.length > 8 && (
              <div className="ai-pending-more">+ {pendingFileChanges.length - 8} autre(s)</div>
            )}
          </div>
        </div>
      )}

      {multiAIState?.isActive && (
        <div className="ai-loading" role="status" aria-live="polite" aria-busy={isLoading}>
          <AIWorkingIndicator
            provider={aiProvider}
            statusText={multiAIState.currentPhase ? `${streamingAgent || multiAIState.currentPhase} en cours...` : 'Multi-IA en cours...'}
            steps={safeMultiSteps}
            currentStepIndex={safeCurrentStepIndex}
            streamingAgent={streamingAgent}
          />
          {renderStreamingBox()}
          {multiAIState.error && (
            <div className="multi-ai-phase-hint">
              <span className="phase-error">Erreur : {multiAIState.error}</span>
            </div>
          )}
        </div>
      )}

      {isLoading && !multiAIState?.isActive && (
        <div className="ai-loading" role="status" aria-live="polite" aria-busy="true">
          <AIWorkingIndicator
            provider={aiProvider}
            statusText={
              streamingMode === 'code'
                ? `Rédaction ${streamingAgent ? `par ${streamingAgent}` : 'du code'} en cours...`
                : (streamingText ? `${streamingAgent || 'IA'} en train de répondre...` : 'Traitement en cours...')
            }
            streamingAgent={streamingAgent}
          />
          {renderStreamingBox()}
        </div>
      )}

      <div
        ref={conversationHistoryRef}
        className="ai-history custom-scrollbar"
      >
        {conversationHistory.length === 0 && !isLoading && (
          <div className="ai-empty">
            <div className="ai-empty-icon">💬</div>
            <h3 className="ai-empty-title">Démarrer une conversation</h3>
            <p className="ai-empty-desc">Posez une question, demandez du code, ou décrivez ce que vous voulez construire.</p>
            <div className="ai-empty-features">
              <div className="ai-empty-feature">
                <span className="ai-empty-feature-icon">📁</span>
                <span>Contexte projet complet</span>
              </div>
              <div className="ai-empty-feature">
                <span className="ai-empty-feature-icon">✏️</span>
                <span>Modification de fichiers</span>
              </div>
              <div className="ai-empty-feature">
                <span className="ai-empty-feature-icon">🔍</span>
                <span>Tapez <code>@</code> pour mentionner un fichier</span>
              </div>
              <div className="ai-empty-feature">
                <span className="ai-empty-feature-icon">⚡</span>
                <span>Tapez <code>/</code> pour les workflows</span>
              </div>
            </div>
          </div>
        )}

        {conversationHistory.map((msg, index) => {
          const meta = getRoleMeta(msg);
          const timeStr = formatTime(msg.timestamp || msg.createdAt);
          return (
            <div key={index} className={`chat-message ${meta.alignClass}`}>
              {/* Avatar */}
              <div className={`chat-avatar ${meta.avatarClass || ''}`}>
                <span className="chat-avatar-emoji">{meta.avatar}</span>
              </div>
              <div className={`chat-bubble ${meta.bubbleClass}`}>
                <div className="chat-message-header">
                  <span className={`chat-badge ${meta.badgeClass}`}>{meta.label}</span>
                  {timeStr && <span className="chat-timestamp">{timeStr}</span>}
                </div>
                <div className="chat-message-body">
                  {msg.role === 'user' ? (
                    <p className="chat-message-text">{msg.text}</p>
                  ) : (
                    <MarkdownRenderer text={msg.text} />
                  )}
                </div>

                {Array.isArray(msg.images) && msg.images.length > 0 && (
                  <div className="chat-images">
                    {msg.images.map((img, i) => (
                      <div key={i} className="chat-image-wrapper">
                        <img
                          src={img.dataUrl}
                          alt="Image collée"
                          className="chat-image-thumb"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* AI Terminal Action Cards (ReAct Loop) */}
        {isLoading && terminalActions.length > 0 && (
          <div style={{ padding: '8px 0' }}>
            {terminalActions.map((action, i) => (
              <div key={i} style={{
                background: '#0d1a0d',
                border: `1px solid ${action.type === 'done' ? '#00c49a44' : '#f5a62344'}`,
                borderRadius: '8px',
                margin: '4px 12px',
                overflow: 'hidden',
                fontSize: '12px'
              }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '6px 10px',
                  background: action.type === 'done' ? '#00c49a18' : '#f5a62318',
                  borderBottom: action.output ? '1px solid #1a1a1a' : 'none'
                }}>
                  <span style={{ fontSize: '14px' }}>{action.type === 'done' ? '✅' : '⏳'}</span>
                  <span style={{ fontFamily: 'monospace', color: '#e0e0e0', flex: 1 }}>{action.command}</span>
                  <span style={{ color: '#666', fontSize: '10px' }}>#{action.iteration}</span>
                </div>
                {action.output && (
                  <pre style={{
                    margin: 0, padding: '6px 10px',
                    fontSize: '10px', color: '#aaa',
                    fontFamily: 'Fira Code, monospace',
                    whiteSpace: 'pre-wrap', maxHeight: '120px', overflowY: 'auto'
                  }}>{action.output.substring(0, 800)}{action.output.length > 800 ? '...' : ''}</pre>
                )}
              </div>
            ))}
          </div>
        )}

        {isLoading && !multiAIState?.isActive && terminalActions.length > 0 && (
          <div className="ai-loading-inline">
            <p>🖥️ Exécution... ({terminalActions.filter(a => a.type === 'done').length}/{terminalActions.length} commandes)</p>
          </div>
        )}
      </div>

      <div className="ai-input-wrap">
        <div className="ai-model-selectors" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', padding: '8px 10px', borderBottom: '1px solid var(--border-0)', background: 'rgba(255, 255, 255, 0.02)' }}>
          <select
            value={aiProvider}
            onChange={(event) => onProviderChange && onProviderChange(event.target.value)}
            className="ai-select-mini"
            disabled={!isElectronApiAvailable || isLoading}
            title="Provider IA"
          >
            <option value="gemini">Gemini</option>
            <option value="claude">Claude</option>
            <option value="kimi">Kimi K2.5</option>
            <option value="multi">Multi-IA (5 Agents)</option>
            <option value="ollama">🦙 Ollama</option>
            <option value="ollama-multi">🦙🦙 Multi-Ollama</option>
          </select>

          {isExpertMode && (
            <>
              <label className="ai-toggle-mini" title="Mode réflexion">
                <input
                  type="checkbox"
                  checked={thinkingMode}
                  onChange={(event) => onThinkingModeChange && onThinkingModeChange(event.target.checked)}
                  disabled={!isElectronApiAvailable || isLoading}
                />
                Réflexion
              </label>
              <label className="ai-toggle-mini" title="Deep Context (scan projet)">
                <input
                  type="checkbox"
                  checked={deepContextEnabled}
                  onChange={(event) => onDeepContextEnabledChange && onDeepContextEnabledChange(event.target.checked)}
                  disabled={!isElectronApiAvailable || isLoading}
                />
                Contexte
              </label>
            </>
          )}

          {(aiProvider === 'ollama' || aiProvider === 'ollama-multi') && (
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              {aiProvider === 'ollama' && (
                <label className="ai-model-picker" title="Modele Ollama actif">
                  <span className="ai-model-label" style={{ fontSize: '0.62rem', fontWeight: 700, color: 'var(--text-2)' }}>Modèle</span>
                  <select
                    value={resolvedOllamaModel}
                    onChange={(event) => onOllamaSettingChange && onOllamaSettingChange('ollamaModel', event.target.value)}
                    className="ai-select-mini"
                    disabled={!isElectronApiAvailable || isLoading}
                  >
                    {availableOllamaModels.map((modelName) => (
                      <option key={`chat-ollama-${modelName}`} value={modelName}>{modelName}</option>
                    ))}
                  </select>
                </label>
              )}

              {aiProvider === 'ollama-multi' && (
                <div style={{ display: 'flex', gap: '6px' }}>
                  <label className="ai-model-picker">
                    <span className="ai-model-label" style={{ fontSize: '0.62rem', fontWeight: 700, color: 'var(--text-2)' }}>Arch</span>
                    <select
                      value={resolvedOllamaArchitect}
                      onChange={(event) => onOllamaSettingChange && onOllamaSettingChange('ollamaModelArchitect', event.target.value)}
                      className="ai-select-mini"
                      disabled={!isElectronApiAvailable || isLoading}
                    >
                      {availableOllamaModels.map((modelName) => (
                        <option key={`chat-arch-${modelName}`} value={modelName}>{modelName}</option>
                      ))}
                    </select>
                  </label>
                  <label className="ai-model-picker">
                    <span className="ai-model-label" style={{ fontSize: '0.62rem', fontWeight: 700, color: 'var(--text-2)' }}>Code</span>
                    <select
                      value={resolvedOllamaCoder}
                      onChange={(event) => onOllamaSettingChange && onOllamaSettingChange('ollamaModelCoder', event.target.value)}
                      className="ai-select-mini"
                      disabled={!isElectronApiAvailable || isLoading}
                    >
                      {availableOllamaModels.map((modelName) => (
                        <option key={`chat-coder-${modelName}`} value={modelName}>{modelName}</option>
                      ))}
                    </select>
                  </label>
                  <label className="ai-model-picker">
                    <span className="ai-model-label" style={{ fontSize: '0.62rem', fontWeight: 700, color: 'var(--text-2)' }}>Test</span>
                    <select
                      value={resolvedOllamaTester}
                      onChange={(event) => onOllamaSettingChange && onOllamaSettingChange('ollamaModelTester', event.target.value)}
                      className="ai-select-mini"
                      disabled={!isElectronApiAvailable || isLoading}
                    >
                      {availableOllamaModels.map((modelName) => (
                        <option key={`chat-tester-${modelName}`} value={modelName}>{modelName}</option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Pending message indicator */}
        {pendingMessage && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '5px 10px',
            background: 'rgba(251,191,36,0.12)',
            border: '1px solid rgba(251,191,36,0.3)',
            borderRadius: '8px',
            marginBottom: '6px',
            fontSize: '11px',
            color: 'rgba(251,191,36,0.9)'
          }}>
            <span>⏳</span>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              En attente&#x202F;: <em>{pendingMessage.text}</em>
            </span>
            <span style={{ opacity: 0.6 }}>sera envoyé automatiquement</span>
          </div>
        )}
        {pendingImages && pendingImages.length > 0 && (
          <div className="ai-pending-images" style={{ display: 'flex', gap: '8px', padding: '8px', flexWrap: 'wrap', borderBottom: '1px solid #333' }}>
            {pendingImages.map((img, idx) => (
              <div key={idx} style={{ position: 'relative', width: '60px', height: '60px', borderRadius: '4px', overflow: 'hidden', border: '1px solid #444' }}>
                <img src={img.dataUrl} alt="Pending" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                <button
                  onClick={() => onRemovePendingImage && onRemovePendingImage(idx)}
                  style={{
                    position: 'absolute', top: 2, right: 2, background: 'rgba(0,0,0,0.6)', border: 'none', color: '#fff',
                    borderRadius: '50%', width: '16px', height: '16px', fontSize: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer'
                  }}
                >×</button>
              </div>
            ))}
          </div>
        )}

        {/* Explicit Context Tags */}
        {explicitContext.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', padding: '8px 10px 0 10px' }}>
            {explicitContext.map(filePath => {
              const fileName = filePath.split(/[\\/]/).pop();
              return (
                <div key={filePath} style={{
                  display: 'flex', alignItems: 'center', gap: '4px',
                  background: 'rgba(168, 255, 181, 0.15)',
                  border: '1px solid rgba(168, 255, 181, 0.3)',
                  color: '#a8ffb5', padding: '2px 8px', borderRadius: '12px', fontSize: '11px', cursor: 'default'
                }}>
                  <span title={filePath}>@{fileName}</span>
                  <button onClick={() => removeExplicitContext(filePath)} style={{
                    background: 'none', border: 'none', color: '#a8ffb5', cursor: 'pointer', padding: 0, marginLeft: '4px', fontSize: '14px', lineHeight: 1
                  }}>×</button>
                </div>
              );
            })}
          </div>
        )}

        <div className="ai-input-container">
          <textarea
            ref={promptInputRef}
            id="ai-prompt"
            className="ai-input"
            value={prompt}
            onChange={(e) => handlePromptChange(e.target.value)}
            onKeyPress={handleKeyPress}
            onPaste={handlePaste}
            onInput={handleTextareaInput}
            placeholder="Décrivez ce que vous voulez... (@ fichier, / workflow)"
            rows={2}
          />
          <div className="ai-input-hint">
            <span><kbd>Enter</kbd> envoyer</span>
            <span><kbd>Shift+Enter</kbd> retour ligne</span>
          </div>
        </div>

        {showWorkflowSuggestions && filteredWorkflows.length > 0 && (
          <div className="ai-workflow-suggest">
            <div className="ai-workflow-title">Workflows disponibles</div>
            {filteredWorkflows.map((workflow) => (
              <button
                key={`${workflow.scope}-${workflow.name}`}
                onClick={() => handleSelectWorkflow(workflow)}
                className="ai-workflow-item"
              >
                <div>
                  <span className="ai-workflow-name">/{workflow.name}</span>
                  {workflow.description && (
                    <span className="ai-workflow-desc">{workflow.description}</span>
                  )}
                </div>
                <span className={`ai-workflow-scope ${workflow.scope}`}>
                  {workflow.scope}
                </span>
              </button>
            ))}
          </div>
        )}

        {showContextSuggestions && (
          <div className="ai-workflow-suggest">
            <div className="ai-workflow-title">Fichiers du projet</div>
            {filteredContextFiles.length === 0 && (
              <div className="ai-dropdown-empty">Aucun fichier pour {contextFilter}</div>
            )}
            {filteredContextFiles.map((filePath) => {
              const fileName = filePath.split(/[\\/]/).pop() || filePath;
              return (
                <button
                  key={filePath}
                  onClick={() => handleSelectContextFile(filePath)}
                  className="ai-workflow-item"
                >
                  <div>
                    <span className="ai-workflow-name">@{fileName}</span>
                    <span className="ai-workflow-desc">{filePath}</span>
                  </div>
                  <span className="ai-workflow-scope workspace">ctx</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="ai-actions">
        {quickActions.map((action) => (
          <button
            key={action.id}
            className="ai-chip"
            onClick={() => applyQuickPrompt(action.prompt)}
            disabled={!isElectronApiAvailable}
          >
            {action.label}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={isLoading ? handleStop : handleSend}
        className={`ai-send-btn ${isLoading ? 'is-stop' : ''}`}
        disabled={!currentProjectPath || !isElectronApiAvailable}
        aria-label={isLoading ? 'Arrêter la génération' : 'Envoyer le message'}
      >
        {isLoading ? (
          <span className="ai-send-btn-content">
            <span className="ai-stop-icon" aria-hidden="true" />
            <span>Arrêter</span>
          </span>
        ) : (
          <span className="ai-send-btn-content">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
            <span>Envoyer</span>
          </span>
        )}
      </button>
    </div>
  );
};

export default AIChat;
// force recompile
