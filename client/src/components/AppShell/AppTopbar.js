import React from 'react';
import { IconBot, IconFolder, IconPlay, IconStop, IconSidebar, IconChat, IconTerminal } from '../ComponentLibrary/icons';
import { Toolbar, ToolbarGroup, ToolbarSeparator, IconButton } from '../ComponentLibrary/Toolbar';

const AppTopbar = ({
  projectName,
  currentProjectPath,
  displayedActiveFile,
  isStreamingCodePreview,
  gitDiffPreview,
  isExpertMode,
  onToggleExpertMode,
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
  onOpenFolder,
  previewStatus,
  onTogglePreview,
  onToggleLeftPanel,
  isLeftCollapsed,
  onToggleRightPanel,
  isRightCollapsed,
  isTerminalOpen,
  onToggleTerminal,
  viewMode = 'ide',
}) => {
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

        {/* Fournisseur + modèle : affichés uniquement dans le panneau de
            chat (AIChat/index.js — ProviderPill/ModelPill), pas ici. Avant,
            ce même choix apparaissait deux fois (topbar ET chat) — l'un des
            deux devait disparaître ; celui du chat est plus proche de
            l'usage réel (on choisit le modèle juste avant d'envoyer). */}

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
