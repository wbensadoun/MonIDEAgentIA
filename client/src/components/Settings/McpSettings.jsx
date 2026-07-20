import React, { useState, useEffect, useCallback } from 'react';
import './McpSettings.css';

const McpSettings = ({ isElectronApiAvailable, showMessage }) => {
  const [servers, setServers] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showRegistry, setShowRegistry] = useState(false);
  const [registryResults, setRegistryResults] = useState([]);
  const [registrySearch, setRegistrySearch] = useState('');
  const [registryLoading, setRegistryLoading] = useState(false);
  const [editForm, setEditForm] = useState({
    id: '', name: '', command: '', args: '', env: ''
  });
  const [isLoading, setIsLoading] = useState({});

  const refreshServers = useCallback(async () => {
    if (!isElectronApiAvailable || !window.electronAPI?.mcpListServers) return;
    try {
      const res = await window.electronAPI.mcpListServers();
      if (res?.success) setServers(res.servers || []);
    } catch { /* silent */ }
  }, [isElectronApiAvailable]);

  const loadCatalog = useCallback(async () => {
    if (!isElectronApiAvailable || !window.electronAPI?.mcpGetCatalog) return;
    try {
      const res = await window.electronAPI.mcpGetCatalog();
      if (res?.success) setCatalog(res.catalog || []);
    } catch { /* silent */ }
  }, [isElectronApiAvailable]);

  useEffect(() => {
    refreshServers();
    loadCatalog();
  }, [refreshServers, loadCatalog]);

  // Écouter les changements de statut en temps réel
  useEffect(() => {
    if (!isElectronApiAvailable || !window.electronAPI?.onMcpStatusChanged) return;
    const off = window.electronAPI.onMcpStatusChanged((statuses) => {
      if (Array.isArray(statuses)) setServers(statuses);
    });
    return () => { if (typeof off === 'function') off(); };
  }, [isElectronApiAvailable]);

  const handleConnect = async (serverId) => {
    setIsLoading(prev => ({ ...prev, [serverId]: true }));
    try {
      const res = await window.electronAPI.mcpConnect(serverId);
      if (res?.success) {
        showMessage(`✅ ${serverId} connecté`, 2000);
      } else {
        showMessage(`❌ Erreur: ${res?.error}`, 4000);
      }
      await refreshServers();
    } catch (err) {
      showMessage(`❌ ${err.message}`, 4000);
    } finally {
      setIsLoading(prev => ({ ...prev, [serverId]: false }));
    }
  };

  const handleDisconnect = async (serverId) => {
    try {
      await window.electronAPI.mcpDisconnect(serverId);
      showMessage(`Déconnecté: ${serverId}`, 2000);
      await refreshServers();
    } catch (err) {
      showMessage(`Erreur: ${err.message}`, 3000);
    }
  };

  const handleRemove = async (serverId) => {
    try {
      await window.electronAPI.mcpRemoveServer(serverId);
      showMessage(`Supprimé: ${serverId}`, 2000);
      await refreshServers();
    } catch (err) {
      showMessage(`Erreur: ${err.message}`, 3000);
    }
  };

  const handleQuickAdd = async (catalogId) => {
    setIsLoading(prev => ({ ...prev, [`catalog-${catalogId}`]: true }));
    try {
      const entry = catalog.find(c => c.id === catalogId);
      const envOverrides = {};

      if (entry?.requiredEnv?.length > 0) {
        for (const key of entry.requiredEnv) {
          const value = window.prompt(`${entry.name} — Entrez la valeur pour ${key}:`);
          if (value === null) {
            showMessage('Annulé', 2000);
            setIsLoading(prev => ({ ...prev, [`catalog-${catalogId}`]: false }));
            return;
          }
          envOverrides[key] = value;
        }
      }

      const res = await window.electronAPI.mcpQuickAdd(catalogId, envOverrides);
      if (res?.success) {
        showMessage(`✅ ${entry?.name || catalogId} ajouté et connecté!`, 3000);
      } else {
        showMessage(`❌ ${res?.error}`, 4000);
      }
      await refreshServers();
    } catch (err) {
      showMessage(`❌ ${err.message}`, 4000);
    } finally {
      setIsLoading(prev => ({ ...prev, [`catalog-${catalogId}`]: false }));
    }
  };

  // ─── Registre MCP Officiel ────────────────────────────────────────────

  const searchRegistry = async (query) => {
    if (!window.electronAPI?.mcpRegistrySearch) return;
    setRegistryLoading(true);
    try {
      const res = await window.electronAPI.mcpRegistrySearch(query || '');
      if (res?.success) {
        setRegistryResults(res.servers || []);
      } else {
        showMessage(`❌ ${res?.error}`, 3000);
      }
    } catch (err) {
      showMessage(`❌ ${err.message}`, 3000);
    } finally {
      setRegistryLoading(false);
    }
  };

  const handleRegistryImport = async (registryServer) => {
    const loadKey = `reg-${registryServer.name}`;
    setIsLoading(prev => ({ ...prev, [loadKey]: true }));
    try {
      const envValues = {};
      // Demander les variables d'env requises
      if (registryServer.envVars?.length > 0) {
        for (const v of registryServer.envVars) {
          if (v.isRequired || v.isSecret) {
            const value = window.prompt(
              `${registryServer.title} — ${v.description || v.name}:`,
              ''
            );
            if (value === null) {
              showMessage('Annulé', 2000);
              setIsLoading(prev => ({ ...prev, [loadKey]: false }));
              return;
            }
            envValues[v.name] = value;
          }
        }
      }

      const res = await window.electronAPI.mcpRegistryImport(registryServer, envValues);
      if (res?.success) {
        showMessage(`✅ "${registryServer.title}" importé et sauvegardé!`, 3000);
        setShowRegistry(false);
        await refreshServers();
      } else {
        showMessage(`❌ ${res?.error}`, 4000);
      }
    } catch (err) {
      showMessage(`❌ ${err.message}`, 4000);
    } finally {
      setIsLoading(prev => ({ ...prev, [loadKey]: false }));
    }
  };

  const openRegistry = () => {
    setShowRegistry(true);
    setRegistrySearch('');
    setRegistryResults([]);
    // Charger les résultats par défaut
    searchRegistry('');
  };

  // ─── Custom add ───────────────────────────────────────────────────────

  const handleAddCustom = async () => {
    if (!editForm.id || !editForm.command) {
      showMessage('ID et commande requis', 3000);
      return;
    }

    try {
      let envObj = {};
      if (editForm.env.trim()) {
        try {
          envObj = JSON.parse(editForm.env);
        } catch {
          editForm.env.split('\n').forEach(line => {
            const [k, ...v] = line.split('=');
            if (k?.trim()) envObj[k.trim()] = v.join('=').trim();
          });
        }
      }

      const config = {
        id: editForm.id.trim().replace(/\s+/g, '-').toLowerCase(),
        name: editForm.name || editForm.id,
        command: editForm.command.trim(),
        args: editForm.args ? editForm.args.split(/\s+/).filter(Boolean) : [],
        env: envObj,
        autoStart: false
      };

      const res = await window.electronAPI.mcpUpsertServer(config);
      if (res?.success) {
        showMessage(`Serveur "${config.name}" ajouté et sauvegardé`, 2000);
        setShowAddForm(false);
        setEditForm({ id: '', name: '', command: '', args: '', env: '' });
        await window.electronAPI.mcpConnect(config.id);
        await refreshServers();
      } else {
        showMessage(`Erreur: ${res?.error}`, 4000);
      }
    } catch (err) {
      showMessage(`Erreur: ${err.message}`, 4000);
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'connected': return '🟢';
      case 'connecting': return '🟡';
      case 'error': return '🔴';
      default: return '⚪';
    }
  };

  const connectedIds = new Set(servers.filter(s => s.status === 'connected').map(s => s.id));
  const configuredIds = new Set(servers.map(s => s.id));
  const totalTools = servers.reduce((sum, s) => sum + (s.toolCount || 0), 0);

  return (
    <div className="mcp-settings">
      <div className="mcp-header">
        <div className="mcp-header-title">
          <span className="mcp-icon">🔌</span>
          <span>Intégrations MCP</span>
        </div>
        <div className="mcp-header-actions">
          <button className="mcp-btn mcp-btn-import" onClick={openRegistry}>
            📥 Importer depuis le registre
          </button>
          <div className="mcp-header-stats">
            <span className="mcp-stat">{servers.length} serveurs</span>
            <span className="mcp-stat">{totalTools} outils</span>
          </div>
        </div>
      </div>

      {/* Modal Import depuis le Registre Officiel */}
      {showRegistry && (
        <div className="mcp-registry-modal">
          <div className="mcp-registry-header">
            <div className="mcp-registry-title">
              <span>📥</span>
              <span>Registre MCP Officiel</span>
              <span className="mcp-registry-badge-official">registry.modelcontextprotocol.io</span>
            </div>
            <button className="mcp-btn mcp-btn-ghost" onClick={() => setShowRegistry(false)}>✕</button>
          </div>

          <div className="mcp-registry-search">
            <input
              type="text"
              className="mcp-input mcp-registry-input"
              placeholder="Rechercher un serveur MCP (github, filesystem, brave, slack...)"
              value={registrySearch}
              onChange={(e) => setRegistrySearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') searchRegistry(registrySearch);
              }}
            />
            <button
              className="mcp-btn mcp-btn-connect"
              onClick={() => searchRegistry(registrySearch)}
              disabled={registryLoading}
            >
              {registryLoading ? '...' : '🔍 Rechercher'}
            </button>
          </div>

          <div className="mcp-registry-results">
            {registryLoading && (
              <div className="mcp-registry-loading">Recherche en cours...</div>
            )}
            {!registryLoading && registryResults.length === 0 && (
              <div className="mcp-registry-empty">
                {registrySearch ? 'Aucun résultat' : 'Tapez un mot-clé pour chercher'}
              </div>
            )}
            {registryResults.map((srv, i) => {
              const loadKey = `reg-${srv.name}`;
              const alreadyAdded = configuredIds.has(srv.name.replace(/[^a-zA-Z0-9._-]/g, '-').toLowerCase());
              return (
                <div key={srv.name + i} className={`mcp-registry-item ${alreadyAdded ? 'is-added' : ''}`}>
                  <div className="mcp-registry-item-info">
                    <div className="mcp-registry-item-title">
                      <span className="mcp-registry-item-name">{srv.title}</span>
                      <span className="mcp-registry-item-version">v{srv.version}</span>
                      {srv.registryType && (
                        <span className={`mcp-registry-item-type type-${srv.registryType}`}>{srv.registryType}</span>
                      )}
                    </div>
                    <div className="mcp-registry-item-desc">{srv.description}</div>
                    {srv.envVars?.length > 0 && (
                      <div className="mcp-registry-item-env">
                        🔑 {srv.envVars.map(v => v.name).join(', ')}
                      </div>
                    )}
                  </div>
                  <div className="mcp-registry-item-actions">
                    {alreadyAdded ? (
                      <span className="mcp-registry-item-added">✓ Ajouté</span>
                    ) : srv.hasPackage ? (
                      <button
                        className="mcp-btn mcp-btn-import-sm"
                        onClick={() => handleRegistryImport(srv)}
                        disabled={isLoading[loadKey]}
                      >
                        {isLoading[loadKey] ? '...' : '📥 Importer'}
                      </button>
                    ) : (
                      <span className="mcp-registry-item-remote" title="Serveur distant (pas de package local)">
                        ☁️ Remote
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Serveurs configurés */}
      {servers.length > 0 && (
        <div className="mcp-servers-list">
          {servers.map(server => (
            <div key={server.id} className={`mcp-server-card mcp-status-${server.status}`}>
              <div className="mcp-server-info">
                <span className="mcp-server-status">{getStatusIcon(server.status)}</span>
                <div className="mcp-server-details">
                  <span className="mcp-server-name">{server.name}</span>
                  <span className="mcp-server-meta">
                    {server.status === 'connected'
                      ? `${server.toolCount} outils`
                      : server.error || server.status}
                  </span>
                </div>
              </div>
              <div className="mcp-server-actions">
                {server.status === 'connected' ? (
                  <button
                    className="mcp-btn mcp-btn-ghost"
                    onClick={() => handleDisconnect(server.id)}
                  >
                    Arrêter
                  </button>
                ) : (
                  <button
                    className="mcp-btn mcp-btn-connect"
                    onClick={() => handleConnect(server.id)}
                    disabled={isLoading[server.id]}
                  >
                    {isLoading[server.id] ? '...' : 'Connecter'}
                  </button>
                )}
                <button
                  className="mcp-btn mcp-btn-danger"
                  onClick={() => handleRemove(server.id)}
                  title="Supprimer"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {servers.length === 0 && !showRegistry && (
        <div className="mcp-empty">
          <span className="mcp-empty-icon">🔌</span>
          <span>Aucun serveur MCP configuré</span>
          <span className="mcp-empty-hint">Importez depuis le registre ou ajoutez depuis le catalogue</span>
        </div>
      )}

      {/* Outils connectés */}
      {totalTools > 0 && (
        <div className="mcp-tools-summary">
          <div className="mcp-tools-title">🔧 {totalTools} outils disponibles pour l&apos;IA</div>
          <div className="mcp-tools-list">
            {servers.filter(s => s.status === 'connected').map(s =>
              (s.tools || []).map(tool => (
                <span key={`${s.id}-${tool.name}`} className="mcp-tool-chip">
                  {tool.name}
                </span>
              ))
            )}
          </div>
        </div>
      )}

      {/* Catalogue quick-add */}
      <div className="mcp-catalog">
        <div className="mcp-catalog-title">Catalogue rapide</div>
        <div className="mcp-catalog-grid">
          {catalog.map(entry => {
            const isAdded = configuredIds.has(entry.id);
            const isConnected = connectedIds.has(entry.id);
            return (
              <button
                key={entry.id}
                className={`mcp-catalog-item ${isConnected ? 'is-connected' : ''} ${isAdded ? 'is-added' : ''}`}
                onClick={() => !isAdded && handleQuickAdd(entry.id)}
                disabled={isAdded || isLoading[`catalog-${entry.id}`]}
                title={entry.description}
              >
                <span className="mcp-catalog-icon">{entry.icon}</span>
                <span className="mcp-catalog-name">{entry.name}</span>
                {isConnected && <span className="mcp-catalog-badge">✓</span>}
                {isLoading[`catalog-${entry.id}`] && <span className="mcp-catalog-badge">...</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Ajout custom */}
      <div className="mcp-custom">
        <button
          className="mcp-btn mcp-btn-add"
          onClick={() => setShowAddForm(!showAddForm)}
        >
          {showAddForm ? '✕ Fermer' : '+ Ajouter un serveur custom'}
        </button>

        {showAddForm && (
          <div className="mcp-add-form">
            <div className="mcp-form-field">
              <label>ID unique</label>
              <input
                value={editForm.id}
                onChange={e => setEditForm(prev => ({ ...prev, id: e.target.value }))}
                placeholder="mon-serveur"
                className="mcp-input"
              />
            </div>
            <div className="mcp-form-field">
              <label>Nom</label>
              <input
                value={editForm.name}
                onChange={e => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                placeholder="Mon Serveur MCP"
                className="mcp-input"
              />
            </div>
            <div className="mcp-form-field">
              <label>Commande</label>
              <input
                value={editForm.command}
                onChange={e => setEditForm(prev => ({ ...prev, command: e.target.value }))}
                placeholder="npx -y @my/mcp-server"
                className="mcp-input"
              />
            </div>
            <div className="mcp-form-field">
              <label>Arguments (séparés par espaces)</label>
              <input
                value={editForm.args}
                onChange={e => setEditForm(prev => ({ ...prev, args: e.target.value }))}
                placeholder="--port 3001"
                className="mcp-input"
              />
            </div>
            <div className="mcp-form-field">
              <label>Variables d&apos;env (KEY=VALUE par ligne ou JSON)</label>
              <textarea
                value={editForm.env}
                onChange={e => setEditForm(prev => ({ ...prev, env: e.target.value }))}
                placeholder={'API_KEY=abc123\nDB_URL=postgresql://...'}
                className="mcp-textarea"
                rows={3}
              />
            </div>
            <button className="mcp-btn mcp-btn-connect" onClick={handleAddCustom}>
              Ajouter et connecter
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default McpSettings;
