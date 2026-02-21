import React, { useRef, useEffect, useState, useMemo } from 'react';
import './AIChat.css';
import { LoadingSteps, LoadingPulse } from '../LoadingAnimations';

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
  globalSkillsCount = 0
}) => {
  const conversationHistoryRef = useRef(null);
  const promptInputRef = useRef(null);
  const [showConversations, setShowConversations] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showWorkflowSuggestions, setShowWorkflowSuggestions] = useState(false);
  const [workflowFilter, setWorkflowFilter] = useState('');
  const [terminalActions, setTerminalActions] = useState([]); // AI terminal ReAct cards

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

  // Clear terminal actions when loading starts
  useEffect(() => {
    if (isLoading) setTerminalActions([]);
  }, [isLoading]);

  useEffect(() => {
    if (conversationHistoryRef.current) {
      conversationHistoryRef.current.scrollTop = conversationHistoryRef.current.scrollHeight;
    }
  }, [conversationHistory, isLoading]);

  const handlePromptChange = (value) => {
    onPromptChange(value);

    if (value.startsWith('/') && parseSlashCommand) {
      const parsed = parseSlashCommand(value);
      if (parsed) {
        setWorkflowFilter(parsed.command);
        setShowWorkflowSuggestions(true);
        setShowConversations(false);
      }
    } else {
      setShowWorkflowSuggestions(false);
      setWorkflowFilter('');
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

  const handleSend = () => {
    if (prompt.trim() && !isLoading) {
      setShowWorkflowSuggestions(false);
      onSend();
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

      {multiAIState?.isActive && (
        <div className="ai-loading">
          <LoadingSteps
            steps={multiAIState.steps}
            currentStep={multiAIState.steps.findIndex(s => s.status === 'active')}
          />
          {multiAIState.currentPhase && (
            <div className="multi-ai-phase-hint">
              <span className="phase-label">Phase :</span>
              <span className="phase-value">{multiAIState.currentPhase}</span>
              {multiAIState.error && (
                <span className="phase-error">Erreur : {multiAIState.error}</span>
              )}
            </div>
          )}
        </div>
      )}

      {isLoading && !multiAIState?.isActive && (
        <div className="ai-loading">
          <LoadingPulse text="L'IA reflechit..." variant="default" />
        </div>
      )}

      <div className="ai-input-wrap">
        <textarea
          ref={promptInputRef}
          id="ai-prompt"
          className="ai-input"
          value={prompt}
          onChange={(e) => handlePromptChange(e.target.value)}
          onKeyPress={handleKeyPress}
          onPaste={handlePaste}
          placeholder="Votre requete... (tapez / pour les workflows)"
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

        {isLoading && !multiAIState?.isActive && (
          <div className="ai-loading-inline">
            <p>{terminalActions.length > 0 ? `🖥️ Exécution... (${terminalActions.filter(a => a.type === 'done').length}/${terminalActions.length})` : "L'IA réfléchit..."}</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default AIChat;
