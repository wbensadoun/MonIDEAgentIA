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
  aiProvider = 'gemini',
  onProviderChange,
  thinkingMode = false,
  onThinkingModeChange,
  deepContextEnabled = false,
  onDeepContextEnabledChange,
  onPasteImage,
  multiAIState,
  conversations = [],
  activeConversationFile,
  isConversationLoading = false,
  onNewConversation,
  onSelectConversation,
  onStopGeneration,
  workflows = [],
  getWorkflow,
  parseSlashCommand,
  activeFile,
  agents = [],
  skills = [],
  activeAgent,
  activeSkill,
  onActiveAgentChange,
  onActiveSkillChange
}) => {
  const conversationHistoryRef = useRef(null);
  const promptInputRef = useRef(null);
  const [showConversations, setShowConversations] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showWorkflowSuggestions, setShowWorkflowSuggestions] = useState(false);
  const [workflowFilter, setWorkflowFilter] = useState('');

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

  const activeAgentValue = activeAgent ? `${activeAgent.scope}:${activeAgent.name}` : '';
  const activeSkillValue = activeSkill ? `${activeSkill.scope}:${activeSkill.name}` : '';

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
            New
          </button>

          <button
            type="button"
            onClick={() => setShowConversations(prev => !prev)}
            className="ai-control-btn"
            disabled={!currentProjectPath || !isElectronApiAvailable}
          >
            History
          </button>

          <label className="ai-toggle">
            <input
              type="checkbox"
              checked={thinkingMode}
              onChange={(e) => onThinkingModeChange && onThinkingModeChange(e.target.checked)}
              disabled={!isElectronApiAvailable || isLoading}
            />
            <span>Think</span>
          </label>

          <label className="ai-toggle" title="Inclure le contexte du projet (scan)">
            <input
              type="checkbox"
              checked={deepContextEnabled}
              onChange={(e) => onDeepContextEnabledChange && onDeepContextEnabledChange(e.target.checked)}
              disabled={!isElectronApiAvailable || isLoading}
            />
            <span>Ctx</span>
          </label>

          <select
            value={activeAgentValue}
            onChange={(e) => {
              const next = e.target.value || '';
              if (!next) {
                onActiveAgentChange && onActiveAgentChange(null);
                return;
              }
              const [scope, ...rest] = next.split(':');
              const name = rest.join(':');
              onActiveAgentChange && onActiveAgentChange({ scope, name });
            }}
            className="ai-select"
            disabled={!isElectronApiAvailable || isLoading}
            title="Agent (persona)"
          >
            <option value="">Agent: Default</option>
            {Array.isArray(agents) && agents.map((agent) => (
              <option
                key={`${agent.scope}:${agent.name}`}
                value={`${agent.scope}:${agent.name}`}
              >
                {agent.scope === 'workspace' ? 'WS' : 'G'}:{agent.name}
              </option>
            ))}
          </select>

          <select
            value={activeSkillValue}
            onChange={(e) => {
              const next = e.target.value || '';
              if (!next) {
                onActiveSkillChange && onActiveSkillChange(null);
                return;
              }
              const [scope, ...rest] = next.split(':');
              const name = rest.join(':');
              onActiveSkillChange && onActiveSkillChange({ scope, name });
            }}
            className="ai-select"
            disabled={!isElectronApiAvailable || isLoading}
            title="Skill (instructions)"
          >
            <option value="">Skill: None</option>
            {Array.isArray(skills) && skills.map((skill) => (
              <option
                key={`${skill.scope}:${skill.name}`}
                value={`${skill.scope}:${skill.name}`}
              >
                {skill.scope === 'workspace' ? 'WS' : 'G'}:{skill.name}
              </option>
            ))}
          </select>

          <select
            value={aiProvider}
            onChange={(e) => onProviderChange && onProviderChange(e.target.value)}
            className="ai-select"
            disabled={!isElectronApiAvailable || isLoading}
            title="IA"
          >
            <option value="gemini">Gemini</option>
            <option value="kimi">Kimi K2.5</option>
            <option value="multi">Multi-IA (5 Agents)</option>
          </select>

          <button
            onClick={onSaveConversation}
            className="ai-control-btn"
            disabled={!currentProjectPath || conversationHistory.length === 0 || !isElectronApiAvailable}
          >
            Save
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
        onClick={isLoading ? (onStopGeneration || (() => { })) : handleSend}
        className={`ai-send-btn ${isLoading ? 'is-stop' : ''}`}
        disabled={!currentProjectPath || !isElectronApiAvailable}
      >
        {isLoading ? 'Arreter' : 'Envoyer a l IA'}
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

        {isLoading && !multiAIState?.isActive && (
          <div className="ai-loading-inline">
            <p>L&apos;IA reflechit...</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default AIChat;
