import React, { useEffect, useState } from 'react';
import UpdateChecker from '../UpdateChecker';
import ThemeSwitcher from './ThemeSwitcher';
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

// Texte affiché en permanence au survol — pas un simple title HTML qui
// n'apparaît qu'après un délai. Le pairing "Auto-Route / Manuel" seul
// n'a d'analogue ni dans VS Code ni dans les outils courants ; ce texte
// explique ce que fait le bouton avant même de cliquer dessus.
const AUTO_ROUTE_TOOLTIP = 'Le routeur intelligent analyse votre demande et choisit le mode optimal (simple ou équipe multi-agent)';

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
}) => {
  // Popover pour le fournisseur IA uniquement — le modèle est maintenant un
  // champ toujours visible (voir plus bas), pas un second popover à
  // découvrir en cliquant sur un pill.
  const [providerPopoverOpen, setProviderPopoverOpen] = useState(false);
  const [modelDraft, setModelDraft] = useState(activeModelValue || '');
  const canEditRemoteModel = isRemoteProvider(aiProvider);

  useEffect(() => {
    if (!isExpertMode && providerPopoverOpen && aiProvider === 'ollama') {
      setProviderPopoverOpen(false);
    }
  }, [aiProvider, isExpertMode, providerPopoverOpen]);

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
      {/* Barre principale 40px — identité + breadcrumb projet/fichier
          uniquement. Le sélecteur de vue (IDE/Chat/Agents) vit désormais
          dans l'ActivityBar persistante (voir App.js), plus dans cette
          barre : elle ne mélange plus navigation de vue et actions. */}
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

        <div className="topbar-spacer" />

        {/* Fournisseur IA — pill dédié, indépendant du modèle. */}
        <div className="topbar-pill-anchor">
          <Pill
            variant="default"
            isActive={providerPopoverOpen}
            label={getProviderLabel(aiProvider)}
            clickable={isElectronApiAvailable}
            onClick={() => setProviderPopoverOpen((prev) => !prev)}
            title="Choisir le fournisseur IA (Gemini, Claude, Kimi, Ollama)"
          />
          {providerPopoverOpen && (
            <div className="topbar-model-popover">
              <div className="topbar-popover-section">
                <span className="topbar-popover-label">Fournisseur</span>
                <div className="topbar-popover-options">
                  {['gemini', 'claude', 'kimi', 'ollama'].map((provider) => (
                    <button
                      key={provider}
                      type="button"
                      className={`topbar-popover-option ${provider === aiProvider ? 'is-active' : ''}`}
                      onClick={() => { onAiProviderChange(provider); setProviderPopoverOpen(false); }}
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

        {/* Modèle — sélecteur direct, toujours visible (au lieu d'un
            second popover derrière un pill). Pour les fournisseurs distants
            (Gemini/Claude/Kimi) c'est un champ texte libre ; pour Ollama,
            une liste des modèles locaux détectés. */}
        {activeModelValue && (
          canEditRemoteModel ? (
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
                className="topbar-select"
                disabled={!isElectronApiAvailable}
                placeholder={activeModelValue}
                title={`Modele ${getProviderLabel(aiProvider)}`}
              />
              <datalist id="topbar-model-suggestions">
                {(Array.isArray(availableActiveModels) ? availableActiveModels : []).map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </>
          ) : (
            Array.isArray(availableActiveModels) && availableActiveModels.length > 0 && (
              <select
                className="topbar-select"
                value={activeModelValue}
                onChange={(e) => onActiveModelChange(e.target.value)}
                disabled={!isElectronApiAvailable}
                title={`Modele ${getProviderLabel(aiProvider)}`}
              >
                {availableActiveModels.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            )
          )
        )}

        {/* Auto-Route badge — tooltip permanent (voir AUTO_ROUTE_TOOLTIP)
            expliquant ce que fait le bouton, pas juste son état. */}
        <button
          type="button"
          className={`topbar-autoroute-badge ${autoRoute ? 'is-active' : 'is-muted'}`}
          onClick={typeof onAutoRouteChange === 'function' ? () => onAutoRouteChange(!autoRoute) : undefined}
          disabled={!isElectronApiAvailable}
          title={AUTO_ROUTE_TOOLTIP}
        >
          {autoRoute ? <IconLightning size={13} /> : <IconCompass size={13} />}
          <span>{autoRoute ? 'Auto-Route' : 'Manuel'}</span>
        </button>

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

          {/* Project group: Folder, Preview, Expert mode (visible in IDE only) */}
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

          {/* Panels group — isolated at the far right edge, always in the
              same place, so their position spatially maps to what they
              control (left toggle near the left panel side of the shell,
              right toggle near the right panel), instead of being buried
              among 9 other icons in a single crowded group. */}
          {viewMode === 'ide' && (
            <>
              <ToolbarSeparator />
              <ToolbarGroup label="Panneaux">
                <IconButton
                  icon={<IconSidebar size={16} />}
                  isActive={isLeftCollapsed}
                  title={isLeftCollapsed ? "Afficher l'explorateur" : "Masquer l'explorateur"}
                  onClick={onToggleLeftPanel}
                />
                <IconButton
                  icon={<IconChat size={16} />}
                  isActive={isRightCollapsed}
                  title={isRightCollapsed ? 'Afficher le chat IA' : 'Masquer le chat IA'}
                  onClick={onToggleRightPanel}
                />
              </ToolbarGroup>
            </>
          )}
        </Toolbar>
      </div>
    </header>
  );
};

export default AppTopbar;
