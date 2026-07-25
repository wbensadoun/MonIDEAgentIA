import React, { useEffect, useState } from 'react';
import UpdateChecker from '../UpdateChecker';
import ThemeSwitcher from './ThemeSwitcher';
import AppViewSwitcher from './AppViewSwitcher';
import { normalizeRemoteModelName } from '../../utils/remoteModels';
import { IconBot, IconFolder, IconPlay, IconStop, IconSidebar, IconChat, IconWorkflow, IconSettings, IconTerminal, IconLightning, IconCompass } from '../ComponentLibrary/icons';
import { Toolbar, ToolbarGroup, ToolbarSeparator, IconButton, Pill } from '../ComponentLibrary/Toolbar';

const getProviderLabel = (provider) => {
  if (provider === 'claude') return 'Claude';
  if (provider === 'kimi') return 'Kimi / Together';
  if (provider === 'multi') return 'Multi-IA';
  if (provider === 'ollama') return 'Ollama';
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
  _thinkingMode,
  _onThinkingModeChange,
  _deepContextEnabled,
  _onDeepContextEnabledChange,
  isElectronApiAvailable,
  _isLoading,
  multiAIState: _multiAIState,
  _resolvedOllamaModel,
  _availableOllamaModels,
  _recommendedOllamaModel,
  _onOllamaSettingChange,
  _ollamaTopbarLabel,
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
  autoRoute,
  onAutoRouteChange,
  viewMode = 'ide',
  onViewModeChange = () => {},
}) => {
  // Deux popovers indépendants (Provider / Modèle) au lieu d'un seul bloc
  // combiné : openPopover vaut null | 'provider' | 'model'. aiProvider et
  // activeModelValue sont déjà deux states distincts côté App.js
  // (useAIModelSettings) — ce composant se contente d'exposer chacun via son
  // propre pill cliquable, plutôt qu'un unique contrôle qui les mélangeait
  // visuellement (ex: "gemini-3-1-pro" sans indiquer "Gemini").
  const [openPopover, setOpenPopover] = useState(null);
  const [modelDraft, setModelDraft] = useState(activeModelValue || '');
  const canEditRemoteModel = isRemoteProvider(aiProvider);

  useEffect(() => {
    if (!isExpertMode && openPopover && aiProvider === 'ollama') {
      setOpenPopover(null);
    }
  }, [aiProvider, isExpertMode, openPopover]);

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

        {/* Sélecteur de mode d'affichage (IDE / Chat / Agents) */}
        <AppViewSwitcher viewMode={viewMode} onViewModeChange={onViewModeChange} />

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

        <div className="topbar-spacer" />

        {/* Fournisseur IA — pill dédié, indépendant du modèle. Avant, un seul
            contrôle combinait les deux (ex: "gemini-3-1-pro" ne montrait pas
            "Gemini"); ici le fournisseur est toujours visible tel quel. */}
        <div className="topbar-pill-anchor">
          <Pill
            variant="default"
            isActive={openPopover === 'provider'}
            label={getProviderLabel(aiProvider)}
            clickable={isElectronApiAvailable}
            onClick={() => setOpenPopover((prev) => (prev === 'provider' ? null : 'provider'))}
            title="Choisir le fournisseur IA (Gemini, Claude, Kimi, Ollama)"
          />
          {openPopover === 'provider' && (
            <div className="topbar-model-popover">
              <div className="topbar-popover-section">
                <span className="topbar-popover-label">Fournisseur</span>
                <div className="topbar-popover-options">
                  {['gemini', 'claude', 'kimi', 'ollama'].map((provider) => (
                    <button
                      key={provider}
                      type="button"
                      className={`topbar-popover-option ${provider === aiProvider ? 'is-active' : ''}`}
                      onClick={() => { onAiProviderChange(provider); setOpenPopover(null); }}
                      disabled={!isElectronApiAvailable}
                    >
                      {getProviderLabel(provider)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modèle — pill séparé, dont le contenu (input libre ou liste)
            dépend du fournisseur actif ci-dessus. Changer de fournisseur
            réinitialise activeModelValue à la valeur par défaut de ce
            fournisseur côté useAIModelSettings (App.js), avant même
            l'ouverture de ce popover. */}
        {activeModelValue && (
          <div className="topbar-pill-anchor">
            <Pill
              variant="default"
              isActive={openPopover === 'model'}
              label={activeModelValue}
              clickable={isElectronApiAvailable}
              onClick={() => setOpenPopover((prev) => (prev === 'model' ? null : 'model'))}
              title={`Choisir le modèle ${getProviderLabel(aiProvider)}`}
            />
            {openPopover === 'model' && (
              <div className="topbar-model-popover">
                <div className="topbar-popover-section">
                  <span className="topbar-popover-label">Modèle ({getProviderLabel(aiProvider)})</span>
                  {canEditRemoteModel && (
                    <>
                      <input
                        type="text"
                        list="topbar-model-suggestions"
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
                        className="topbar-popover-input"
                        disabled={!isElectronApiAvailable}
                        placeholder={activeModelValue}
                        autoFocus
                      />
                      <datalist id="topbar-model-suggestions">
                        {(Array.isArray(availableActiveModels) ? availableActiveModels : []).map((m) => (
                          <option key={m} value={m} />
                        ))}
                      </datalist>
                    </>
                  )}
                  {!canEditRemoteModel && Array.isArray(availableActiveModels) && availableActiveModels.length > 0 && (
                    <div className="topbar-popover-options">
                      {availableActiveModels.map((m) => (
                        <button
                          key={m}
                          type="button"
                          className={`topbar-popover-option ${m === activeModelValue ? 'is-active' : ''}`}
                          onClick={() => { onActiveModelChange(m); setOpenPopover(null); }}
                          disabled={!isElectronApiAvailable}
                          title={m}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Auto-Route badge */}
        <Pill
          variant={autoRoute ? 'accent' : 'default'}
          isActive={autoRoute}
          icon={autoRoute ? <IconLightning size={13} /> : <IconCompass size={13} />}
          label={autoRoute ? 'Auto-Route' : 'Manuel'}
          clickable={isElectronApiAvailable}
          onClick={typeof onAutoRouteChange === 'function' ? () => onAutoRouteChange(!autoRoute) : undefined}
          title="Clic pour activer/désactiver le routeur intelligent (analyse automatique du mode optimal)"
        />

        {/* Actions droite — structured with Toolbar */}
        <Toolbar className="topbar-actions">
          {/* Layout group: Terminal (visible in IDE only) */}
          {viewMode === 'ide' && (
            <ToolbarGroup label="Disposition">
              <IconButton
                icon={<IconTerminal size={16} />}
                label="Terminal"
                isActive={isTerminalOpen}
                title={isTerminalOpen ? 'Masquer le terminal' : 'Afficher le terminal'}
                onClick={onToggleTerminal}
              />
            </ToolbarGroup>
          )}

          {/* Theme Switcher */}
          <ThemeSwitcher theme={theme} onThemeChange={onThemeChange} />

          {/* Separator */}
          <ToolbarSeparator />

          {/* Project group: Folder, Preview, Sidebars, Expert mode (visible in IDE only) */}
          {viewMode === 'ide' && (
            <ToolbarGroup label="Projet">
              <IconButton
                icon={<IconFolder size={16} />}
                disabled={!isElectronApiAvailable}
                title="Ouvrir un dossier"
                onClick={onOpenFolder}
              />
              <IconButton
                icon={previewStatus === 'running' ? <IconStop size={16} /> : <IconPlay size={16} />}
                isActive={previewStatus === 'running'}
                title={previewStatus === 'running' ? 'Arrêter le preview' : 'Lancer le preview'}
                onClick={onTogglePreview}
              />
              <IconButton
                icon={<IconSidebar size={16} />}
                isActive={isLeftCollapsed}
                title={isLeftCollapsed ? 'Afficher l\'explorateur' : 'Masquer l\'explorateur'}
                onClick={onToggleLeftPanel}
              />
              <IconButton
                icon={<IconChat size={16} />}
                isActive={isRightCollapsed}
                title={isRightCollapsed ? 'Afficher le chat IA' : 'Masquer le chat IA'}
                onClick={onToggleRightPanel}
              />
              <IconButton
                label={isExpertMode ? 'Avancé' : 'Simple'}
                isActive={isExpertMode}
                title={isExpertMode ? 'Mode IA avancé actif' : 'Activer le mode IA avancé'}
                onClick={onToggleExpertMode}
              />
            </ToolbarGroup>
          )}

          {/* Meta group: Workflows, Updates, Settings */}
          <ToolbarGroup label="Métadonnées">
            <IconButton
              icon={<IconWorkflow size={16} />}
              title="Gestionnaire de workflows"
              onClick={onOpenWorkflowManager}
            />
            <UpdateChecker isElectronApiAvailable={isElectronApiAvailable} showMessage={showMessage} />
            <IconButton
              icon={<IconSettings size={16} />}
              label="Settings"
              title="Paramètres"
              onClick={onOpenSettings}
            />
          </ToolbarGroup>
        </Toolbar>
      </div>
    </header>
  );
};

export default AppTopbar;
