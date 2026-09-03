import React from 'react';
import './ExtensionsPanel.css';
import McpSettings from '../Settings/McpSettings';
import { IconPackage, IconPlug } from '../ComponentLibrary/icons';

/**
 * The discovery surface for integrations. MCP keeps its existing lifecycle,
 * credential prompts and registry IPC; this panel only gives those controls a
 * first-class home in the Activity Bar and links the existing pack manager.
 */
const ExtensionsPanel = ({
  isElectronApiAvailable = false,
  showMessage = () => {},
  onOpenPackManager = () => {}
}) => (
  <div className="extensions-panel">
    <div className="extensions-panel-intro">
      <div className="extensions-panel-title">
        <span className="extensions-panel-icon"><IconPlug size={18} /></span>
        <div>
          <h2>Extensions &amp; Connecteurs</h2>
          <p>Connectez vos outils et enrichissez votre espace de travail.</p>
        </div>
      </div>
      <button type="button" className="extensions-packs-button" onClick={onOpenPackManager}>
        <IconPackage size={14} />
        <span>Gérer les Vibe Packs</span>
      </button>
    </div>

    <section className="extensions-panel-section" aria-labelledby="extensions-mcp-heading">
      <div className="extensions-panel-section-heading">
        <div>
          <h3 id="extensions-mcp-heading">Connecteurs MCP</h3>
          <p>Installez, connectez et surveillez vos serveurs depuis cette vue.</p>
        </div>
        <span className="extensions-panel-badge">Live</span>
      </div>
      <McpSettings
        isElectronApiAvailable={isElectronApiAvailable}
        showMessage={showMessage}
      />
    </section>
  </div>
);

export default ExtensionsPanel;
