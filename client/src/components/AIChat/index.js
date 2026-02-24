import React, { useRef, useEffect, useState, useMemo } from 'react';
import './AIChat.css';
import { LoadingSteps, AIWorkingIndicator } from '../LoadingAnimations';

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
  permissionMode = 'edit_terminal'
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
  const [streamingMode, setStreamingMode] = useState('text');   // text | workflow | diff
  const streamingRef = useRef(null);

  // Register AI terminal IPC events
  useEffect(() => {
    if (!isElectronApiAvailable || !window.electronAPI?.onAITerminalAction) return;
    window.electronAPI.onAITerminalAction((data) => {
      setTerminalActions(prev => [...prev, { type: 'running', command: data.command, iteration: data.iteration, output: null }]);
    });
    window.electronAPI.onAITerminalResult((data) => {
      setTerminalActions(prev => prev.map((a, i) =>
        i === prev.length - 1 && a.command === data.command
          ? { ...a, type: 'done', output: data.output }
          : a
      ));
    });
  }, [isElectronApiAvailable]);

  // Register Ollama multi-agent streaming tokens
  useEffect(() => {
    if (!isElectronApiAvailable || !window.electronAPI?.onOllamaMultiToken) return;
    window.electronAPI.onOllamaMultiToken((data) => {
      if (data.done) {
        // agent finished, keep text visible briefly
        return;
      }
      setStreamingAgent(data.agent || '');
      setStreamingText(prev => prev + data.token);
      // auto-scroll streaming box
      if (streamingRef.current) {
        streamingRef.current.scrollTop = streamingRef.current.scrollHeight;
      }
    });
    return () => {
      if (window.electronAPI?.removeOllamaMultiListeners) {
        window.electronAPI.removeOllamaMultiListeners();
      }
    };
  }, [isElectronApiAvailable]);

  // Clear terminal actions and streaming when loading starts
  useEffect(() => {
    if (isLoading) {
      setTerminalActions([]);
      setStreamingText('');
      setStreamingAgent('');
      setStreamingMode('text');
    }
  }, [isLoading]);

  useEffect(() => {
    if (!streamingText) {
      setStreamingMode('text');
      return;
    }
    if (/\*\*WORKFLOW:/i.test(streamingText)) {
      setStreamingMode('workflow');
      return;
    }
    if (/<<<<\s*SEARCH/i.test(streamingText) || /(?:^|\n)FILE:\s*.+/i.test(streamingText)) {
      setStreamingMode('diff');
      return;
    }
    setStreamingMode('text');
  }, [streamingText]);

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

    // 5 Agents Multi-IA
    if (msg.isChefDeProjet) {
      return {
        label: '🎯 Chef (Gemini 2.5)',
        badgeClass: 'chat-badge-chef-projet',
        bubbleClass: 'chat-bubble-chef-projet',
        alignClass: 'chat-row-ai'
      };
    }

    if (msg.isFrontendDev) {
      return {
        label: '🎨 Front (Kimi)',
        badgeClass: 'chat-badge-frontend-dev',
        bubbleClass: 'chat-bubble-frontend-dev',
        alignClass: 'chat-row-ai'
      };
    }

    if (msg.isBackendDev) {
      return {
        label: '⚙️ Back (Kimi)',
        badgeClass: 'chat-badge-backend-dev',
        bubbleClass: 'chat-bubble-backend-dev',
        alignClass: 'chat-row-ai'
      };
    }

    if (msg.isArchitectEngineer || msg.isArchitect) {
      return {
        label: '🏗️ Archi (Kimi)',
        badgeClass: 'chat-badge-architect',
        bubbleClass: 'chat-bubble-architect',
        alignClass: 'chat-row-ai'
      };
    }

    if (msg.isScrumMaster) {
      return {
        label: '📋 Scrum (Gemini 2.5)',
        badgeClass: 'chat-badge-scrum-master',
        bubbleClass: 'chat-bubble-scrum-master',
        alignClass: 'chat-row-ai'
      };
    }

    if (msg.isReviewer) {
      return {
        label: 'Relecteur',
        badgeClass: 'chat-badge-reviewer',
        bubbleClass: 'chat-bubble-reviewer',
        alignClass: 'chat-row-ai'
      };
    }

    if (msg.isCoder) {
      return {
        label: 'Codeur',
        badgeClass: 'chat-badge-coder',
        bubbleClass: 'chat-bubble-coder',
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

  return (
    <div className="ai-chat-container">
      <div className="ai-header">
        <div className="ai-header-left">
          <div className="ai-title">Agent IA</div>
          <div className="ai-subtitle">{headerTitle}</div>
          {globalSkillsCount > 0 && (
            <div title={`${globalSkillsCount} skills globaux injectés automatiquement dans chaque requête IA`} style={{
              display: 'inline-flex', alignItems: 'center', gap: '4px',
              background: '#00c49a18', border: '1px solid #00c49a44',
              borderRadius: '20px', padding: '2px 8px',
              color: '#00c49a', fontSize: '11px', fontWeight: 600,
              cursor: 'help', marginTop: '2px'
            }}>
              ⚡ {globalSkillsCount} skills actifs
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
          >
            Nouveau
          </button>

          <button
            type="button"
            onClick={() => setShowConversations(prev => !prev)}
            className="ai-control-btn"
            disabled={!currentProjectPath || !isElectronApiAvailable}
          >
            Historique
          </button>

          <button
            onClick={onSaveConversation}
            className="ai-control-btn"
            disabled={!currentProjectPath || conversationHistory.length === 0 || !isElectronApiAvailable}
          >
            Sauvegarder
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
        <div className="ai-loading">
          <AIWorkingIndicator
            provider={aiProvider}
            statusText={multiAIState.currentPhase ? `${streamingAgent || multiAIState.currentPhase} en cours...` : "Multi-IA en cours..."}
          />
          <LoadingSteps
            steps={safeMultiSteps}
            currentStep={safeCurrentStepIndex}
          />
          {streamingText && (
            <div
              ref={streamingRef}
              className={`ai-stream-box ai-stream-${streamingMode}`}
            >
              {streamingMode === 'workflow' && (
                <div className="ai-stream-anim ai-stream-workflow">
                  <div className="ai-stream-anim-title">Creation du workflow visuel...</div>
                  <div className="ai-workflow-pulse">
                    <span className="wf-node wf-node-a" />
                    <span className="wf-link wf-link-ab" />
                    <span className="wf-node wf-node-b" />
                    <span className="wf-link wf-link-bc" />
                    <span className="wf-node wf-node-c" />
                  </div>
                  <div className="ai-stream-anim-subtitle">Tag detecte: **WORKFLOW:**</div>
                </div>
              )}
              {streamingMode === 'diff' && (
                <div className="ai-stream-anim ai-stream-diff">
                  <div className="ai-stream-anim-title">Edition de fichier en cours...</div>
                  <div className="ai-diff-file">
                    <span className="diff-line diff-line-1" />
                    <span className="diff-line diff-line-2" />
                    <span className="diff-line diff-line-3" />
                  </div>
                  <div className="ai-stream-anim-subtitle">Syntaxe detectee: {'<<<< SEARCH ... >>>> REPLACE'}</div>
                </div>
              )}
              {streamingMode === 'text' && (
                <pre className="ai-stream-text">{streamingText}</pre>
              )}
            </div>
          )}
          {multiAIState.error && (
            <div className="multi-ai-phase-hint">
              <span className="phase-error">Erreur : {multiAIState.error}</span>
            </div>
          )}
        </div>
      )}

      {isLoading && !multiAIState?.isActive && (
        <div className="ai-loading">
          <AIWorkingIndicator provider={aiProvider} statusText="Traitement en cours..." />
        </div>
      )}

      <div
        ref={conversationHistoryRef}
        className="ai-history custom-scrollbar"
      >
        {conversationHistory.length === 0 && !isLoading && (
          <div className="ai-empty">
            <p>Commencez a discuter avec l&apos;IA</p>
            <p>Contexte complet du projet pris en compte.</p>
          </div>
        )}

        {conversationHistory.map((msg, index) => {
          const meta = getRoleMeta(msg);
          return (
            <div key={index} className={`chat-message ${meta.alignClass}`}>
              <div className={meta.bubbleClass}>
                <div className="chat-message-header">
                  <span className={`chat-badge ${meta.badgeClass}`}>{meta.label}</span>
                </div>
                <p className="chat-message-text whitespace-pre-wrap text-xs mt-1">{msg.text}</p>

                {Array.isArray(msg.images) && msg.images.length > 0 && (
                  <div className="chat-images">
                    {msg.images.map((img, i) => (
                      <div key={i} className="chat-image-wrapper">
                        <img
                          src={img.dataUrl}
                          alt="Image collee"
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

        <textarea
          ref={promptInputRef}
          id="ai-prompt"
          className="ai-input"
          value={prompt}
          onChange={(e) => handlePromptChange(e.target.value)}
          onKeyPress={handleKeyPress}
          onPaste={handlePaste}
          placeholder="Votre requête... (Tapez @ pour mentionner un fichier, / pour workflows)"
          rows={3}
        />

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
        aria-label={isLoading ? 'Arreter la generation de l IA' : "Envoyer a l IA"}
      >
        {isLoading ? (
          <span className="ai-send-btn-content">
            <span className="ai-stop-icon" aria-hidden="true" />
            <span>Arreter</span>
          </span>
        ) : (
          'Envoyer a l IA'
        )}
      </button>
    </div>
  );
};

export default AIChat;
