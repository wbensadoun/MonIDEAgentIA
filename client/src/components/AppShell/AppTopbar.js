import React, { useEffect, useMemo, useState } from 'react';
import UpdateChecker from '../UpdateChecker';

const getProviderLabel = (provider) => {
  if (provider === 'claude') return 'Claude';
  if (provider === 'kimi') return 'Kimi K2.5';
  if (provider === 'multi') return 'Multi-IA';
  if (provider === 'ollama') return 'Ollama';
  if (provider === 'ollama-multi') return 'Multi-Ollama';
  return 'Gemini';
};

const AppTopbar = ({
  projectName,
  currentProjectPath,
  displayedActiveFile,
  isStreamingCodePreview,
  gitDiffPreview,
  onOpenCommandPalette,
  isExpertMode,
  onToggleExpertMode,
  aiProvider,
  onAiProviderChange,
  thinkingMode,
  onThinkingModeChange,
  deepContextEnabled,
  onDeepContextEnabledChange,
  isElectronApiAvailable,
  isLoading,
  resolvedOllamaModel,
  resolvedOllamaArchitect,
  resolvedOllamaCoder,
  resolvedOllamaTester,
  availableOllamaModels,
  onOllamaSettingChange,
  ollamaTopbarLabel,
  ollamaStatusLabel,
  showMessage,
  onOpenFolder,
  previewStatus,
  onTogglePreview,
  onToggleLeftPanel,
  isLeftCollapsed,
  onToggleRightPanel,
  isRightCollapsed,
  onOpenWorkflowManager,
  onOpenSettings
}) => {
  const [showAdvancedAIControls, setShowAdvancedAIControls] = useState(false);

  useEffect(() => {
    if (!isExpertMode && showAdvancedAIControls && aiProvider === 'ollama-multi') {
      setShowAdvancedAIControls(false);
    }
  }, [aiProvider, isExpertMode, showAdvancedAIControls]);

  const assistantSummary = useMemo(() => {
    const parts = [getProviderLabel(aiProvider)];
    if (thinkingMode) parts.push('reflexion');
    if (deepContextEnabled) parts.push('contexte');

    if (aiProvider === 'ollama' || aiProvider === 'ollama-multi') {
      parts.push(ollamaTopbarLabel.replace(/^🦙\s*/, '').trim());
    } else if (aiProvider === 'multi') {
      parts.push('5 agents');
    }

    return parts.filter(Boolean).join(' · ');
  }, [aiProvider, deepContextEnabled, ollamaTopbarLabel, thinkingMode]);

  return (
    <header className="topbar-shell">
      <div className="topbar">
        <div className="topbar-left">
          <div className="brand">
            <div className="brand-mark">V</div>
            <div className="brand-text">
              <div className="brand-title">Vibe IDE</div>
              <div className="brand-subtitle">Studio IA</div>
            </div>
          </div>
          <div className="status-chip">
            <span className={`status-dot ${currentProjectPath ? 'is-on' : 'is-off'}`} />
            <span className="status-chip-text">{projectName}</span>
          </div>
          {displayedActiveFile && (
            <div className="status-chip subtle">
              <span className="status-chip-text">{displayedActiveFile}</span>
            </div>
          )}
          {isStreamingCodePreview && (
            <div className="status-chip subtle">
              <span className="status-chip-text">Apercu IA en direct</span>
            </div>
          )}
          {gitDiffPreview && !isStreamingCodePreview && (
            <div className="status-chip subtle">
              <span className="status-chip-text">{`Git diff ${gitDiffPreview.baseLabel} -> ${gitDiffPreview.targetLabel}`}</span>
            </div>
          )}
        </div>

        <div className="topbar-center">
          <button className="command-trigger" onClick={onOpenCommandPalette}>
            <span className="command-trigger-label">Palette de commandes</span>
            <span className="command-trigger-shortcut">Ctrl+K</span>
          </button>
        </div>

        <div className="topbar-right">
          <div className="topbar-group topbar-ai-group">
            <button
              type="button"
              className={`btn btn-ghost topbar-ai-trigger ${showAdvancedAIControls ? 'is-active' : ''}`}
              onClick={() => setShowAdvancedAIControls((prev) => !prev)}
              title="Afficher les options IA"
            >
              🤖 Assistant
            </button>
            <div className="status-chip subtle topbar-ai-summary" title={assistantSummary}>
              <span className="status-chip-text">{assistantSummary}</span>
            </div>
          </div>

          <button
            onClick={onToggleExpertMode}
            className={`btn btn-pill mode-toggle ${isExpertMode ? 'btn-live' : 'btn-idle'}`}
            title={isExpertMode ? 'Revenir au mode IA simple' : 'Activer les options IA avancees'}
          >
            {isExpertMode ? 'IA avancee' : 'IA simple'}
          </button>

          <UpdateChecker
            isElectronApiAvailable={isElectronApiAvailable}
            showMessage={showMessage}
          />

          <div className="topbar-group">
            <button
              onClick={onOpenFolder}
              className="btn btn-ghost"
              disabled={!isElectronApiAvailable}
            >
              📂 Ouvrir
            </button>
            <button
              onClick={onTogglePreview}
              className={`btn btn-pill ${previewStatus === 'running' ? 'btn-live' : 'btn-idle'}`}
            >
              {previewStatus === 'running' ? 'Aperçu actif' : 'Lancer aperçu'}
            </button>
          </div>

          <div className="topbar-group">
            <button
              onClick={onToggleLeftPanel}
              className={`btn btn-ghost ${isLeftCollapsed ? 'is-active' : ''}`}
            >
              🧭 Nav
            </button>
            <button
              onClick={onToggleRightPanel}
              className={`btn btn-ghost ${isRightCollapsed ? 'is-active' : ''}`}
            >
              💬 IA
            </button>
            <button
              onClick={onOpenWorkflowManager}
              className="btn btn-ghost"
            >
              ⚡ Workflows
            </button>
            <button
              onClick={onOpenSettings}
              className="btn btn-ghost"
            >
              ⚙ Paramètres
            </button>
          </div>
        </div>
      </div>

      {showAdvancedAIControls && (
        <div className="topbar-advanced">
          <div className="topbar-advanced-group">
            <span className="topbar-advanced-label">Assistant</span>
            <select
              value={aiProvider}
              onChange={(event) => onAiProviderChange(event.target.value)}
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
            <label className="ai-toggle-mini" title="Mode réflexion">
              <input
                type="checkbox"
                checked={thinkingMode}
                onChange={(event) => onThinkingModeChange(event.target.checked)}
                disabled={!isElectronApiAvailable || isLoading}
              />
              Réflexion
            </label>
            <label className="ai-toggle-mini" title="Deep Context (scan projet)">
              <input
                type="checkbox"
                checked={deepContextEnabled}
                onChange={(event) => onDeepContextEnabledChange(event.target.checked)}
                disabled={!isElectronApiAvailable || isLoading}
              />
              Contexte
            </label>
          </div>

          {(aiProvider === 'ollama' || aiProvider === 'ollama-multi') && (
            <div className="topbar-advanced-group">
              <span className="topbar-advanced-label">Ollama</span>
              {aiProvider === 'ollama' && (
                <label className="ai-model-picker" title="Modele Ollama actif">
                  <span className="ai-model-label">Modele</span>
                  <select
                    value={resolvedOllamaModel}
                    onChange={(event) => onOllamaSettingChange('ollamaModel', event.target.value)}
                    className="ai-select-mini ai-model-select"
                    disabled={!isElectronApiAvailable || isLoading}
                  >
                    {availableOllamaModels.map((modelName) => (
                      <option key={`topbar-ollama-${modelName}`} value={modelName}>{modelName}</option>
                    ))}
                  </select>
                </label>
              )}

              {aiProvider === 'ollama-multi' && (
                <div className="ai-model-stack" title={ollamaStatusLabel}>
                  <label className="ai-model-picker">
                    <span className="ai-model-label">Arch</span>
                    <select
                      value={resolvedOllamaArchitect}
                      onChange={(event) => onOllamaSettingChange('ollamaModelArchitect', event.target.value)}
                      className="ai-select-mini ai-model-select"
                      disabled={!isElectronApiAvailable || isLoading}
                    >
                      {availableOllamaModels.map((modelName) => (
                        <option key={`topbar-arch-${modelName}`} value={modelName}>{modelName}</option>
                      ))}
                    </select>
                  </label>
                  <label className="ai-model-picker">
                    <span className="ai-model-label">Code</span>
                    <select
                      value={resolvedOllamaCoder}
                      onChange={(event) => onOllamaSettingChange('ollamaModelCoder', event.target.value)}
                      className="ai-select-mini ai-model-select"
                      disabled={!isElectronApiAvailable || isLoading}
                    >
                      {availableOllamaModels.map((modelName) => (
                        <option key={`topbar-coder-${modelName}`} value={modelName}>{modelName}</option>
                      ))}
                    </select>
                  </label>
                  <label className="ai-model-picker">
                    <span className="ai-model-label">Test</span>
                    <select
                      value={resolvedOllamaTester}
                      onChange={(event) => onOllamaSettingChange('ollamaModelTester', event.target.value)}
                      className="ai-select-mini ai-model-select"
                      disabled={!isElectronApiAvailable || isLoading}
                    >
                      {availableOllamaModels.map((modelName) => (
                        <option key={`topbar-tester-${modelName}`} value={modelName}>{modelName}</option>
                      ))}
                    </select>
                  </label>
                </div>
              )}

              <div className="status-chip subtle ai-model-chip" title={ollamaStatusLabel}>
                <span className="status-chip-text">{ollamaTopbarLabel}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </header>
  );
};

export default AppTopbar;
