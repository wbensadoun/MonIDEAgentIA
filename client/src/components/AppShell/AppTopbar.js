import React, { useEffect, useRef, useState } from 'react';
import {
  IconBot,
  IconFolder,
  IconPlay,
  IconStop,
  IconLayoutSidebarLeft,
  IconLayoutSidebarLeftOff,
  IconLayoutPanel,
  IconLayoutPanelOff,
  IconLayoutSidebarRight,
  IconLayoutSidebarRightOff,
  IconLayoutCustomize,
  IconCheck,
  IconMaximize2,
  IconMinimize2,
} from '../ComponentLibrary/icons';
import { Toolbar, ToolbarGroup, ToolbarSeparator, IconButton } from '../ComponentLibrary/Toolbar';

// Popover plumbing pour le menu "Personnaliser la disposition" — meme
// pattern que usePillMenu dans AIChat/index.js (fermeture au clic exterieur
// et a Escape), duplique ici plutot qu'importe car non exporte par AIChat.
const useLayoutMenu = () => {
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
  isChatMaximized,
  onToggleChatMaximize,
  onToggleChatSidebar,
  isChatSidebarCollapsed,
  onToggleSwarmPanel,
  isSwarmPanelOpen,
  isTerminalOpen,
  onToggleTerminal,
  viewMode = 'ide',
}) => {
  const layoutMenu = useLayoutMenu();
  const isChat = viewMode === 'chat';

  // Les trois zones de la barre de titre VS Code (Primary Side Bar / Panel /
  // Secondary Side Bar) mappent sur des cibles differentes selon la vue :
  // en IDE ce sont explorateur/terminal/chat, en Chat ce sont projets/—/agents.
  // Le glyphe reste identique — c'est la region de l'ecran qu'il designe, pas
  // la fonctionnalite — pour que la position spatiale garde son sens.
  const layoutControls = isChat
    ? [
      {
        id: 'primary',
        Icon: isChatSidebarCollapsed ? IconLayoutSidebarLeftOff : IconLayoutSidebarLeft,
        isActive: !isChatSidebarCollapsed,
        label: isChatSidebarCollapsed ? 'Afficher les projets' : 'Masquer les projets',
        menuLabel: 'Panneau des projets',
        onClick: onToggleChatSidebar,
      },
      {
        id: 'secondary',
        Icon: isSwarmPanelOpen ? IconLayoutSidebarRight : IconLayoutSidebarRightOff,
        isActive: Boolean(isSwarmPanelOpen),
        label: isSwarmPanelOpen ? 'Masquer les agents' : 'Afficher les agents',
        menuLabel: 'Panneau des agents',
        onClick: onToggleSwarmPanel,
      },
    ]
    : [
      {
        id: 'primary',
        Icon: isLeftCollapsed ? IconLayoutSidebarLeftOff : IconLayoutSidebarLeft,
        isActive: !isLeftCollapsed,
        label: isLeftCollapsed ? "Afficher l'explorateur" : "Masquer l'explorateur",
        menuLabel: "Panneau de l'explorateur",
        onClick: onToggleLeftPanel,
      },
      {
        id: 'panel',
        Icon: isTerminalOpen ? IconLayoutPanel : IconLayoutPanelOff,
        isActive: Boolean(isTerminalOpen),
        label: isTerminalOpen ? 'Masquer le terminal' : 'Afficher le terminal',
        menuLabel: 'Panneau du terminal',
        onClick: onToggleTerminal,
      },
      {
        id: 'secondary',
        Icon: isRightCollapsed ? IconLayoutSidebarRightOff : IconLayoutSidebarRight,
        isActive: !isRightCollapsed,
        label: isRightCollapsed ? 'Afficher le chat IA' : 'Masquer le chat IA',
        menuLabel: 'Panneau du chat IA',
        onClick: onToggleRightPanel,
      },
    ];

  return (
    <header style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Barre principale 40px — identité + breadcrumb projet/fichier
          uniquement. Le sélecteur de vue (IDE/Chat/Agents) vit désormais
          dans l'ActivityBar persistante (voir App.js), plus dans cette
          barre : elle ne mélange plus navigation de vue et actions. */}
      <div className="topbar-shell">
        {/* Marque Code Companion */}
        <div className="topbar-brand">
          <div className="topbar-brand-icon">
            <IconBot />
          </div>
          <span className="topbar-brand-name">Code Companion</span>
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

          {/* Layout controls — isolated at the far right edge, always in the
              same place, so their position spatially maps to what they
              control (left toggle near the left panel side of the shell,
              right toggle near the right panel), instead of being buried
              among 9 other icons in a single crowded group. Same glyph
              vocabulary as VS Code's title bar: a panel frame with the
              active region filled in. */}
          {(viewMode === 'ide' || isChat) && (
            <>
              <ToolbarSeparator />
              <ToolbarGroup label="Disposition">
                <div className="topbar-layout-menu-wrap" ref={layoutMenu.wrapRef}>
                  <IconButton
                    icon={<IconLayoutCustomize size={16} />}
                    isActive={layoutMenu.open}
                    title="Personnaliser la disposition"
                    aria-label="Personnaliser la disposition"
                    aria-haspopup="menu"
                    aria-expanded={layoutMenu.open}
                    onClick={() => layoutMenu.setOpen((v) => !v)}
                  />
                  {layoutMenu.open && (
                    <div className="topbar-layout-menu" role="menu">
                      <div className="topbar-layout-menu-title">Disposition</div>
                      {layoutControls.map(({ id, Icon, isActive, menuLabel, onClick }) => (
                        <button
                          key={id}
                          type="button"
                          role="menuitemcheckbox"
                          aria-checked={isActive}
                          className={`topbar-layout-menu-item${isActive ? ' is-active' : ''}`}
                          onClick={() => { onClick?.(); layoutMenu.setOpen(false); }}
                        >
                          <span className="topbar-layout-menu-check">
                            {isActive && <IconCheck size={12} />}
                          </span>
                          <Icon size={14} />
                          <span className="topbar-layout-menu-label">{menuLabel}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {layoutControls.map(({ id, Icon, isActive, label, onClick }) => (
                  <IconButton
                    key={id}
                    icon={<Icon size={16} />}
                    isActive={isActive}
                    title={label}
                    aria-label={label}
                    onClick={onClick}
                  />
                ))}
                {!isChat && !isRightCollapsed && (
                  <IconButton
                    icon={isChatMaximized ? <IconMinimize2 size={16} /> : <IconMaximize2 size={16} />}
                    isActive={Boolean(isChatMaximized)}
                    title={isChatMaximized ? 'Restaurer le chat' : 'Maximiser le chat'}
                    aria-label={isChatMaximized ? 'Restaurer le chat' : 'Maximiser le chat'}
                    onClick={onToggleChatMaximize}
                  />
                )}
              </ToolbarGroup>
            </>
          )}
        </Toolbar>
      </div>
    </header>
  );
};

export default AppTopbar;
