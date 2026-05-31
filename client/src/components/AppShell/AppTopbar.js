import React, { useEffect, useMemo, useState } from 'react';
import UpdateChecker from '../UpdateChecker';
import ThemeSwitcher from './ThemeSwitcher';
import { normalizeRemoteModelName } from '../../utils/remoteModels';

/* ---- Icônes SVG inline ---- */
const IconBot = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2a2 2 0 0 1 2 2v2H10V4a2 2 0 0 1 2-2z" />
    <rect x="4" y="6" width="16" height="12" rx="2" />
    <circle cx="9" cy="12" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="15" cy="12" r="1.5" fill="currentColor" stroke="none" />
    <path d="M9 16h6" />
    <path d="M2 10v4M22 10v4" />
  </svg>
);

const IconFolder = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
);

const IconPlay = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="5 3 19 12 5 21 5 3" fill="currentColor" stroke="none" />
  </svg>
);

const IconStop = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="4" width="16" height="16" rx="2" fill="currentColor" stroke="none" />
  </svg>
);

const IconSidebar = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <line x1="9" y1="3" x2="9" y2="21" />
  </svg>
);

const IconChat = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

const IconWorkflow = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </svg>
);

const IconSettings = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

const IconChevronDown = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const IconTerminal = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="4 17 10 11 4 5" />
    <line x1="12" y1="19" x2="20" y2="19" />
  </svg>
);

const getProviderLabel = (provider) => {
  if (provider === 'claude') return 'Claude';
  if (provider === 'kimi') return 'Kimi / Together';
  if (provider === 'multi') return 'Multi-IA';
  if (provider === 'ollama') return 'Ollama';
  if (provider === 'ollama-multi') return 'Multi-Ollama';
  return 'Gemini';
};

const isRemoteProvider = (provider) => (
  provider === 'gemini' || provider === 'claude' || provider === 'kimi'
);

const AppTopbar = ({
  projectName,
  currentProjectPath,
  displayedActiveFile,
  isStreamingCodePreview,
  gitDiffPreview,
  isExpertMode,
  onToggleExpertMode,
  aiProvider,
  onAiProviderChange,
  activeModelValue,
  availableActiveModels,
  onActiveModelChange,
  thinkingMode,
  onThinkingModeChange,
  deepContextEnabled,
  onDeepContextEnabledChange,
  isElectronApiAvailable,
  isLoading,
  multiAIState,
  resolvedOllamaModel,
  resolvedOllamaArchitect,
  resolvedOllamaCoder,
  resolvedOllamaTester,
  availableOllamaModels,
  recommendedOllamaModel,
  onOllamaSettingChange,
  ollamaTopbarLabel,
  showMessage,
  onOpenFolder,
  previewStatus,
  onTogglePreview,
  onToggleLeftPanel,
  isLeftCollapsed,
  onToggleRightPanel,
  isRightCollapsed,
  onOpenWorkflowManager,
  onOpenSettings,
  theme,
  onThemeChange,
  isTerminalOpen,
  onToggleTerminal,
}) => {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [modelDraft, setModelDraft] = useState(activeModelValue || '');
  const canEditRemoteModel = isRemoteProvider(aiProvider);

  useEffect(() => {
    if (!isExpertMode && showAdvanced && aiProvider === 'ollama-multi') {
      setShowAdvanced(false);
    }
  }, [aiProvider, isExpertMode, showAdvanced]);

  useEffect(() => {
    setModelDraft(activeModelValue || '');
  }, [activeModelValue, aiProvider]);

  const commitRemoteModelDraft = () => {
    const normalized = normalizeRemoteModelName(modelDraft);
    if (!normalized) {
      setModelDraft(activeModelValue || '');
      return;
    }
    setModelDraft(normalized);
    if (normalized !== activeModelValue && typeof onActiveModelChange === 'function') {
      onActiveModelChange(normalized);
    }
  };

  const multiAISummary = useMemo(() => {
    if (!multiAIState?.mode) return '';
    const steps = Array.isArray(multiAIState.steps) ? multiAIState.steps : [];
    if (!multiAIState.isActive && steps.length === 0 && !multiAIState.error) return '';
    const done = steps.filter((s) => s?.status === 'done' || s?.status === 'completed').length;
    const label = multiAIState.mode === 'ollama-multi' ? 'Swarm' : 'Équipe';
    if (multiAIState.error) return `${label} erreur`;
    if (multiAIState.isActive) return `${label}: ${multiAIState.currentPhase || 'en cours'} · ${done}/${steps.length || 0}`;
    return `${label}: ${done}/${steps.length || 0} terminé`;
  }, [multiAIState]);

  return (
    <header style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Barre principale 40px */}
      <div className="topbar-shell">
        {/* Marque FuturIA */}
        <div className="topbar-brand">
          <div className="topbar-brand-icon">
            <IconBot />
          </div>
          <span className="topbar-brand-name">FuturIA</span>
        </div>

        <span className="topbar-separator">|</span>

        {/* Projet actif */}
        <div className="topbar-project-chip" title={currentProjectPath || 'Aucun projet'}>
          <span className={`topbar-project-dot ${currentProjectPath ? 'is-open' : ''}`} />
          <span className="topbar-project-name">{projectName}</span>
        </div>

        {/* Fichier actif */}
        {displayedActiveFile && (
          <>
            <span style={{ color: 'var(--border)', fontSize: 14, margin: '0 2px' }}>›</span>
            <div className="topbar-file-chip" title={displayedActiveFile}>
              <span>{displayedActiveFile}</span>
              {isStreamingCodePreview && (
                <span style={{ fontSize: 9, color: 'var(--accent)' }}>● IA</span>
              )}
            </div>
          </>
        )}

        {/* Git diff info */}
        {gitDiffPreview && !isStreamingCodePreview && (
          <span style={{ fontSize: 10, color: 'var(--text-dim)', padding: '0 4px' }}>
            diff {gitDiffPreview.baseLabel} → {gitDiffPreview.targetLabel}
          </span>
        )}

        {/* Menu bar */}
        <span className="topbar-separator">|</span>
        <nav className="topbar-menubar">
          <button className="topbar-menu-item">Fichier</button>
          <button className="topbar-menu-item">Édition</button>
          <button className="topbar-menu-item">Vue</button>
          <button className="topbar-menu-item">Run</button>
          <button className="topbar-menu-item">Aide</button>
        </nav>

        <div className="topbar-spacer" />

        {/* Section IA */}
        <div className="topbar-ai-section">
          <select
            value={aiProvider}
            onChange={(e) => onAiProviderChange(e.target.value)}
            className="topbar-select"
            disabled={!isElectronApiAvailable}
            title="Fournisseur IA (modifiable meme pendant un run — applique a la requete suivante)"
          >
            <option value="gemini">Gemini</option>
            <option value="claude">Claude</option>
            <option value="kimi">Kimi / Together</option>
            <option value="multi">Multi-IA</option>
            <option value="ollama">Ollama</option>
            <option value="ollama-multi">Multi-Ollama</option>
          </select>

          {canEditRemoteModel && activeModelValue && (
            <>
              <input
                type="text"
                list="topbar-active-models"
                value={modelDraft}
                onChange={(e) => setModelDraft(e.target.value)}
                onBlur={commitRemoteModelDraft}
                onKeyDown={(e) => {
                  const key = String(e?.key || '').toLowerCase();
                  if (key === 'enter') {
                    e.preventDefault();
                    commitRemoteModelDraft();
                  } else if (key === 'escape') {
                    e.preventDefault();
                    setModelDraft(activeModelValue || '');
                  }
                }}
                className="topbar-select"
                disabled={!isElectronApiAvailable}
                title={`Modele ${getProviderLabel(aiProvider)}`}
              />
              <datalist id="topbar-active-models">
                {(Array.isArray(availableActiveModels) ? availableActiveModels : []).map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </>
          )}

          {!canEditRemoteModel && activeModelValue && Array.isArray(availableActiveModels) && availableActiveModels.length > 0 && (
            <select
              value={activeModelValue}
              onChange={(e) => onActiveModelChange(e.target.value)}
              className="topbar-select"
              disabled={!isElectronApiAvailable}
              title="Modèle IA"
            >
              {availableActiveModels.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          )}

          <button
            className={`topbar-icon-btn ${showAdvanced ? 'is-active' : ''}`}
            onClick={() => setShowAdvanced((p) => !p)}
            title="Options IA avancées"
            style={{ width: 'auto', padding: '0 6px', fontSize: 11 }}
          >
            Options
            <IconChevronDown />
          </button>

          {multiAISummary && (
            <span style={{ fontSize: 10, color: multiAIState?.error ? 'var(--danger)' : 'var(--success)', padding: '0 4px', whiteSpace: 'nowrap' }}>
              ● {multiAISummary}
            </span>
          )}
        </div>

        {/* Actions droite */}
        <div className="topbar-actions">
          {/* Terminal */}
          <button
            className={`topbar-icon-btn ${isTerminalOpen ? 'is-active' : ''}`}
            title={isTerminalOpen ? 'Masquer le terminal' : 'Afficher le terminal'}
            onClick={onToggleTerminal}
            style={{ padding: '0 8px', gap: 4, width: 'auto', fontSize: 11 }}
          >
            <IconTerminal />
            <span>Terminal</span>
          </button>

          {/* Thème switcher */}
          <ThemeSwitcher theme={theme} onThemeChange={onThemeChange} />

          {/* Séparateur */}
          <span className="topbar-separator" style={{ margin: '0 2px' }}>|</span>

          {/* Ouvrir dossier */}
          <button
            className="topbar-icon-btn"
            onClick={onOpenFolder}
            disabled={!isElectronApiAvailable}
            title="Ouvrir un dossier"
          >
            <IconFolder />
          </button>

          {/* Preview */}
          <button
            className={`topbar-icon-btn ${previewStatus === 'running' ? 'is-active' : ''}`}
            onClick={onTogglePreview}
            title={previewStatus === 'running' ? 'Arrêter le preview' : 'Lancer le preview'}
          >
            {previewStatus === 'running' ? <IconStop /> : <IconPlay />}
          </button>

          {/* Toggle sidebar gauche */}
          <button
            className={`topbar-icon-btn ${isLeftCollapsed ? 'is-active' : ''}`}
            onClick={onToggleLeftPanel}
            title={isLeftCollapsed ? 'Afficher l\'explorateur' : 'Masquer l\'explorateur'}
          >
            <IconSidebar />
          </button>

          {/* Toggle sidebar droite */}
          <button
            className={`topbar-icon-btn ${isRightCollapsed ? 'is-active' : ''}`}
            onClick={onToggleRightPanel}
            title={isRightCollapsed ? 'Afficher le chat IA' : 'Masquer le chat IA'}
          >
            <IconChat />
          </button>

          {/* Mode Expert */}
          <button
            className={`topbar-icon-btn ${isExpertMode ? 'is-active' : ''}`}
            onClick={onToggleExpertMode}
            title={isExpertMode ? 'Mode IA avancé actif' : 'Activer le mode IA avancé'}
            style={{ padding: '0 8px', width: 'auto', fontSize: 11, gap: 4 }}
          >
            <span style={{ fontSize: 10 }}>●</span>
            {isExpertMode ? 'Avancé' : 'Simple'}
          </button>

          {/* Workflows */}
          <button
            className="topbar-icon-btn"
            onClick={onOpenWorkflowManager}
            title="Gestionnaire de workflows"
          >
            <IconWorkflow />
          </button>

          {/* UpdateChecker */}
          <UpdateChecker isElectronApiAvailable={isElectronApiAvailable} showMessage={showMessage} />

          {/* Settings */}
          <button
            className="topbar-icon-btn"
            onClick={onOpenSettings}
            title="Paramètres"
            style={{ padding: '0 8px', gap: 4, width: 'auto', fontSize: 11 }}
          >
            <IconSettings />
            <span>Settings</span>
          </button>
        </div>
      </div>

      {/* Options IA avancées (dépliables) */}
      {showAdvanced && (
        <div className="topbar-advanced">
          <span className="topbar-advanced-label">Assistant</span>

          <label className={`topbar-toggle ${thinkingMode ? 'is-active' : ''}`} title="Mode réflexion approfondie">
            <input
              type="checkbox"
              checked={thinkingMode}
              onChange={(e) => onThinkingModeChange(e.target.checked)}
              disabled={!isElectronApiAvailable || isLoading}
            />
            Réflexion
          </label>

          <label className={`topbar-toggle ${deepContextEnabled ? 'is-active' : ''}`} title="Deep Context (scan complet du projet)">
            <input
              type="checkbox"
              checked={deepContextEnabled}
              onChange={(e) => onDeepContextEnabledChange(e.target.checked)}
              disabled={!isElectronApiAvailable || isLoading}
            />
            Contexte profond
          </label>

          {(aiProvider === 'ollama' || aiProvider === 'ollama-multi') && (
            <>
              <span className="topbar-advanced-label" style={{ marginLeft: 8 }}>Ollama</span>

              {aiProvider === 'ollama' && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-dim)' }}>
                  <span style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>Modèle</span>
                  <select
                    value={resolvedOllamaModel}
                    onChange={(e) => onOllamaSettingChange('ollamaModel', e.target.value)}
                    className="topbar-select"
                    disabled={!isElectronApiAvailable}
                  >
                    {availableOllamaModels.map((m) => (
                      <option key={m} value={m}>{m === recommendedOllamaModel ? `${m} (recommandée)` : m}</option>
                    ))}
                  </select>
                </label>
              )}

              {aiProvider === 'ollama-multi' && (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {[
                    { key: 'ollamaModelArchitect', val: resolvedOllamaArchitect, label: 'Arch' },
                    { key: 'ollamaModelCoder', val: resolvedOllamaCoder, label: 'Code' },
                    { key: 'ollamaModelTester', val: resolvedOllamaTester, label: 'Test' },
                  ].map(({ key, val, label }) => (
                    <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-dim)' }}>
                      <span style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>{label}</span>
                      <select
                        value={val}
                        onChange={(e) => onOllamaSettingChange(key, e.target.value)}
                        className="topbar-select"
                        disabled={!isElectronApiAvailable}
                      >
                        {availableOllamaModels.map((m) => (
                          <option key={m} value={m}>{m === recommendedOllamaModel ? `${m} (recommandée)` : m}</option>
                        ))}
                      </select>
                    </label>
                  ))}
                  <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{ollamaTopbarLabel}</span>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </header>
  );
};

export default AppTopbar;
