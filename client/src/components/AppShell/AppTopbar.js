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
  isElectronApiAvailable,
  isLoading,
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
  const [activeMenu, setActiveMenu] = useState(null);

  const toggleMenu = (menu) => {
    setActiveMenu(activeMenu === menu ? null : menu);
  };

  return (
    <header className="topbar-shell">
      <div className="topbar">
        <div className="topbar-left">
          <div className="brand" style={{ marginRight: '16px' }}>
            <div className="brand-mark">V</div>
          </div>
          
          <div className="menubar">
            <div className="menu-dropdown" onMouseLeave={() => setActiveMenu(null)}>
              <button 
                className={`menu-btn ${activeMenu === 'file' ? 'is-active' : ''}`} 
                onMouseEnter={() => setActiveMenu('file')} 
                onClick={() => toggleMenu('file')}
              >
                Fichier
              </button>
              {activeMenu === 'file' && (
                <div className="menu-content">
                  <button onClick={() => { onOpenFolder(); setActiveMenu(null); }} disabled={!isElectronApiAvailable}>
                    <span>Ouvrir un dossier</span>
                    <span>Ctrl+O</span>
                  </button>
                  <button onClick={() => { onOpenCommandPalette(); setActiveMenu(null); }}>
                    <span>Ouvrir un fichier...</span>
                    <span>Ctrl+P</span>
                  </button>
                </div>
              )}
            </div>

            <div className="menu-dropdown" onMouseLeave={() => setActiveMenu(null)}>
              <button 
                className={`menu-btn ${activeMenu === 'view' ? 'is-active' : ''}`} 
                onMouseEnter={() => setActiveMenu('view')} 
                onClick={() => toggleMenu('view')}
              >
                Affichage
              </button>
              {activeMenu === 'view' && (
                <div className="menu-content">
                  <button onClick={() => { onToggleLeftPanel(); setActiveMenu(null); }}>
                    <span>{isLeftCollapsed ? 'Afficher' : 'Masquer'} le Navigateur</span>
                  </button>
                  <button onClick={() => { onToggleRightPanel(); setActiveMenu(null); }}>
                    <span>{isRightCollapsed ? 'Afficher' : 'Masquer'} le panneau IA</span>
                  </button>
                  <button onClick={() => { onTogglePreview(); setActiveMenu(null); }}>
                    <span>{previewStatus === 'running' ? 'Arreter' : 'Demarrer'} l&apos;aperçu</span>
                  </button>
                  <button onClick={() => { onOpenCommandPalette(); setActiveMenu(null); }}>
                    <span>Palette de commandes</span>
                    <span>Ctrl+K</span>
                  </button>
                </div>
              )}
            </div>

            <div className="menu-dropdown" onMouseLeave={() => setActiveMenu(null)}>
              <button 
                className={`menu-btn ${activeMenu === 'tools' ? 'is-active' : ''}`} 
                onMouseEnter={() => setActiveMenu('tools')} 
                onClick={() => toggleMenu('tools')}
              >
                Outils
              </button>
              {activeMenu === 'tools' && (
                <div className="menu-content">
                  <button onClick={() => { onOpenWorkflowManager(); setActiveMenu(null); }}>Workflows</button>
                  <button onClick={() => { onOpenSettings(); setActiveMenu(null); }}>Paramètres</button>
                  <button onClick={() => { onToggleExpertMode(); setActiveMenu(null); }}>
                    <span>Mode {isExpertMode ? 'Simple' : 'Expert'}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="topbar-center">
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

        <div className="topbar-right">
          <UpdateChecker
            isElectronApiAvailable={isElectronApiAvailable}
            showMessage={showMessage}
          />
        </div>
      </div>
    </header>
  );
};

export default AppTopbar;
