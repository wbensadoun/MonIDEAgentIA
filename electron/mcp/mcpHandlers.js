/**
 * MCP IPC Handlers — Enregistre les handlers IPC pour gérer les serveurs MCP
 * depuis le processus renderer (Settings UI, Chat IA).
 */

const { McpClientManager } = require('./mcpClientManager');
const { getMcpCatalog, getMcpCatalogEntry } = require('./mcpRegistry');

/**
 * Crée et enregistre les handlers MCP dans le processus main Electron.
 *
 * @param {Object} deps
 * @param {import('electron').IpcMain} deps.ipcMain
 * @param {import('electron').App} deps.app
 * @param {typeof import('fs').promises} deps.fs
 * @param {typeof import('path')} deps.path
 * @param {import('electron').BrowserWindow} [deps.getMainWindow] - Fonction pour obtenir la fenêtre principale
 */
function registerMcpHandlers({ ipcMain, app, fs, path, getMainWindow }) {
  const manager = new McpClientManager();

  const getSettingsPath = () => path.join(app.getPath('userData'), 'mcp-servers.json');

  // Notifier le renderer quand l'état change
  manager.onChange((statuses) => {
    try {
      const win = typeof getMainWindow === 'function' ? getMainWindow() : null;
      if (win && !win.isDestroyed()) {
        win.webContents.send('mcp-status-changed', statuses);
      }
    } catch { /* silent */ }
  });

  // ─── Persistence ───────────────────────────────────────────────────────

  async function loadPersistedConfigs() {
    try {
      const configPath = getSettingsPath();
      const raw = await fs.readFile(configPath, 'utf8');
      const configs = JSON.parse(raw);
      manager.loadConfigs(configs);
      console.log(`[MCP] ${configs.length} serveurs chargés depuis la config`);
    } catch {
      // Pas de config sauvegardée, c'est normal au premier lancement
    }
  }

  async function persistConfigs() {
    try {
      const configPath = getSettingsPath();
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(configPath, JSON.stringify(manager.exportConfigs(), null, 2), 'utf8');
    } catch (err) {
      console.error('[MCP] Erreur persistance config:', err.message);
    }
  }

  // ─── IPC Handlers ──────────────────────────────────────────────────────

  const handle = (channel, listener) => {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, listener);
  };

  // Catalogue prédéfini
  handle('mcp-get-catalog', async () => {
    return { success: true, catalog: getMcpCatalog() };
  });

  // Lister tous les serveurs et leurs statuts
  handle('mcp-list-servers', async () => {
    return { success: true, servers: manager.getAllStatuses() };
  });

  // Ajouter/modifier un serveur MCP
  handle('mcp-upsert-server', async (event, config) => {
    try {
      const saved = manager.upsertConfig(config);
      await persistConfigs();
      return { success: true, server: manager.getStatus(saved.id) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Supprimer un serveur MCP
  handle('mcp-remove-server', async (event, serverId) => {
    try {
      await manager.removeConfig(serverId);
      await persistConfigs();
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Connecter un serveur MCP
  handle('mcp-connect', async (event, serverId) => {
    try {
      const result = await manager.connect(serverId);
      return result;
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Déconnecter un serveur MCP
  handle('mcp-disconnect', async (event, serverId) => {
    try {
      await manager.disconnect(serverId);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Obtenir tous les outils MCP disponibles
  handle('mcp-list-tools', async () => {
    return { success: true, tools: manager.getAllTools() };
  });

  // Appeler un outil MCP
  handle('mcp-call-tool', async (event, serverId, toolName, args) => {
    try {
      const result = await manager.callTool(serverId, toolName, args || {});
      return { success: true, result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Obtenir le contexte MCP pour injection dans le prompt IA
  handle('mcp-get-tools-context', async () => {
    return { success: true, context: manager.buildToolsContextForPrompt() };
  });

  // Quick-add depuis le catalogue
  handle('mcp-quick-add', async (event, catalogId, envOverrides) => {
    try {
      const entry = getMcpCatalogEntry(catalogId);
      if (!entry) return { success: false, error: `Serveur "${catalogId}" non trouvé dans le catalogue` };

      const config = {
        id: entry.id,
        name: entry.name,
        command: entry.command,
        args: [...entry.args],
        env: { ...(entry.env || {}), ...(envOverrides || {}) },
        autoStart: false
      };

      manager.upsertConfig(config);
      await persistConfigs();

      // Auto-connect
      const result = await manager.connect(config.id);
      return { success: true, server: manager.getStatus(config.id), connectResult: result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ─── Registre MCP Officiel ─────────────────────────────────────────────

  // Rechercher des serveurs dans le registre officiel
  handle('mcp-registry-search', async (event, query) => {
    try {
      const searchQuery = String(query || '').trim();
      const url = new URL('https://registry.modelcontextprotocol.io/v0.1/servers');
      url.searchParams.set('version', 'latest');
      url.searchParams.set('limit', '30');
      if (searchQuery) url.searchParams.set('search', searchQuery);

      const response = await fetch(url.toString(), {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(10000)
      });

      if (!response.ok) {
        return { success: false, error: `Registre HTTP ${response.status}` };
      }

      const data = await response.json();
      const servers = (data.servers || [])
        .filter(entry => entry?.server && entry._meta?.['io.modelcontextprotocol.registry/official']?.status === 'active')
        .map(entry => {
          const s = entry.server;
          const pkg = Array.isArray(s.packages) ? s.packages[0] : null;
          const remote = Array.isArray(s.remotes) ? s.remotes[0] : null;
          return {
            name: s.name,
            title: s.title || s.name.split('/').pop(),
            description: s.description || '',
            version: s.version,
            websiteUrl: s.websiteUrl || null,
            repoUrl: s.repository?.url || null,
            hasPackage: !!pkg,
            packageIdentifier: pkg?.identifier || null,
            registryType: pkg?.registryType || null,
            runtimeHint: pkg?.runtimeHint || null,
            hasRemote: !!remote,
            remoteType: remote?.type || null,
            remoteUrl: remote?.url || null,
            envVars: (pkg?.environmentVariables || []).map(v => ({
              name: v.name,
              description: v.description || '',
              isRequired: !!v.isRequired,
              isSecret: !!v.isSecret
            }))
          };
        });

      return { success: true, servers, total: servers.length };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Importer un serveur depuis le registre officiel
  handle('mcp-registry-import', async (event, registryServer, envValues) => {
    try {
      if (!registryServer || !registryServer.name) {
        return { success: false, error: 'Serveur invalide' };
      }

      const serverId = registryServer.name.replace(/[^a-zA-Z0-9._-]/g, '-').toLowerCase();
      let config;

      if (registryServer.hasPackage && registryServer.packageIdentifier) {
        // Serveur installable via npm/pypi
        const runtime = registryServer.runtimeHint || 'npx';
        const isNpx = runtime === 'npx' || registryServer.registryType === 'npm';
        const isPip = runtime === 'uvx' || runtime === 'pip' || registryServer.registryType === 'pypi';

        if (isNpx) {
          config = {
            id: serverId,
            name: registryServer.title || serverId,
            command: 'npx',
            args: ['-y', registryServer.packageIdentifier],
            env: { ...(envValues || {}) },
            autoStart: false
          };
        } else if (isPip) {
          config = {
            id: serverId,
            name: registryServer.title || serverId,
            command: 'uvx',
            args: [registryServer.packageIdentifier],
            env: { ...(envValues || {}) },
            autoStart: false
          };
        } else {
          config = {
            id: serverId,
            name: registryServer.title || serverId,
            command: runtime,
            args: [registryServer.packageIdentifier],
            env: { ...(envValues || {}) },
            autoStart: false
          };
        }
      } else {
        return {
          success: false,
          error: 'Ce serveur n\'a pas de package installable. Consultez sa documentation pour l\'installation manuelle.',
          websiteUrl: registryServer.websiteUrl || registryServer.repoUrl
        };
      }

      manager.upsertConfig(config);
      await persistConfigs();

      // Auto-connect
      const result = await manager.connect(config.id);
      return { success: true, server: manager.getStatus(config.id), connectResult: result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ─── Init ──────────────────────────────────────────────────────────────

  // Charger les configs au démarrage et auto-start
  loadPersistedConfigs().then(() => {
    manager.autoStartAll().catch(err => {
      console.error('[MCP] Erreur auto-start:', err.message);
    });
  });

  // Cleanup à la fermeture
  app.on('before-quit', () => {
    manager.disconnectAll().catch(() => {});
  });

  // Exposer le manager pour que d'autres modules puissent l'utiliser
  return manager;
}

module.exports = { registerMcpHandlers };
