/**
 * MCP Client Manager — Gère N serveurs MCP connectés depuis l'IDE.
 *
 * Responsabilités :
 * 1. Spawner des processus MCP server (stdio) et s'y connecter
 * 2. Découvrir les outils disponibles sur chaque serveur
 * 3. Appeler un outil MCP et retourner le résultat
 * 4. Gérer le cycle de vie (start / stop / reconnect / status)
 * 5. Persister la config des serveurs dans les settings de l'app
 */

const { spawn } = require('child_process');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

/**
 * @typedef {Object} McpServerConfig
 * @property {string} id - Identifiant unique
 * @property {string} name - Nom affiché dans l'UI
 * @property {string} command - Commande pour lancer le serveur (ex: "npx", "node")
 * @property {string[]} args - Arguments de la commande
 * @property {Object<string,string>} [env] - Variables d'environnement supplémentaires
 * @property {boolean} [autoStart] - Démarrer automatiquement au lancement de l'IDE
 */

/**
 * @typedef {Object} McpServerState
 * @property {'disconnected'|'connecting'|'connected'|'error'} status
 * @property {string|null} error
 * @property {Object[]} tools - Liste des outils découverts
 * @property {Object[]} resources - Liste des resources découvertes
 * @property {Object} serverInfo - Info serveur MCP
 */

class McpClientManager {
  constructor() {
    /** @type {Map<string, McpServerConfig>} */
    this._configs = new Map();
    /** @type {Map<string, { client: Client, transport: StdioClientTransport, state: McpServerState }>} */
    this._connections = new Map();
    /** @type {Function|null} */
    this._onChangeCallback = null;
  }

  /**
   * S'abonner aux changements d'état (pour notifier le renderer)
   */
  onChange(callback) {
    this._onChangeCallback = typeof callback === 'function' ? callback : null;
  }

  _notify() {
    if (this._onChangeCallback) {
      try { this._onChangeCallback(this.getAllStatuses()); } catch { /* silent */ }
    }
  }

  // ─── Configuration ──────────────────────────────────────────────────────

  /**
   * Charger les configs depuis un tableau persisté
   */
  loadConfigs(configs) {
    if (!Array.isArray(configs)) return;
    for (const cfg of configs) {
      if (cfg && cfg.id && cfg.command) {
        this._configs.set(cfg.id, { ...cfg });
      }
    }
  }

  /**
   * Exporter les configs pour persistance
   */
  exportConfigs() {
    return Array.from(this._configs.values());
  }

  /**
   * Ajouter ou mettre à jour une config serveur
   */
  upsertConfig(config) {
    if (!config || !config.id || !config.command) {
      throw new Error('Config MCP invalide: id et command requis');
    }
    const sanitized = {
      id: String(config.id).trim(),
      name: String(config.name || config.id).trim(),
      command: String(config.command).trim(),
      args: Array.isArray(config.args) ? config.args.map(a => String(a)) : [],
      env: config.env && typeof config.env === 'object' ? { ...config.env } : {},
      autoStart: !!config.autoStart
    };
    this._configs.set(sanitized.id, sanitized);
    return sanitized;
  }

  /**
   * Supprimer une config et déconnecter si actif
   */
  async removeConfig(serverId) {
    await this.disconnect(serverId);
    this._configs.delete(serverId);
  }

  getConfig(serverId) {
    return this._configs.get(serverId) || null;
  }

  // ─── Connexion ──────────────────────────────────────────────────────────

  /**
   * Connecter un serveur MCP par son ID
   */
  async connect(serverId) {
    const config = this._configs.get(serverId);
    if (!config) throw new Error(`Serveur MCP inconnu: ${serverId}`);

    // Déconnecter si déjà connecté
    if (this._connections.has(serverId)) {
      await this.disconnect(serverId);
    }

    const state = {
      status: 'connecting',
      error: null,
      tools: [],
      resources: [],
      serverInfo: {}
    };

    try {
      console.log(`[MCP] Connexion à "${config.name}" (${config.command} ${config.args.join(' ')})...`);

      const transport = new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: { ...process.env, ...(config.env || {}) }
      });

      const client = new Client({
        name: 'mon-ide-agent-ia',
        version: '1.6.0'
      });

      await client.connect(transport);

      // Découvrir les outils
      let tools = [];
      try {
        const toolsResult = await client.listTools();
        tools = Array.isArray(toolsResult?.tools) ? toolsResult.tools : [];
      } catch { /* server may not support tools */ }

      // Découvrir les resources
      let resources = [];
      try {
        const resourcesResult = await client.listResources();
        resources = Array.isArray(resourcesResult?.resources) ? resourcesResult.resources : [];
      } catch { /* server may not support resources */ }

      state.status = 'connected';
      state.tools = tools;
      state.resources = resources;
      state.serverInfo = client.getServerVersion?.() || {};

      this._connections.set(serverId, { client, transport, state });

      console.log(`[MCP] ✅ "${config.name}" connecté — ${tools.length} outils, ${resources.length} resources`);
      this._notify();

      return { success: true, tools: tools.length, resources: resources.length };

    } catch (err) {
      state.status = 'error';
      state.error = err.message || String(err);
      // Stocker l'état même en erreur pour afficher dans l'UI
      this._connections.set(serverId, { client: null, transport: null, state });
      console.error(`[MCP] ❌ Erreur connexion "${config.name}":`, err.message);
      this._notify();
      return { success: false, error: err.message };
    }
  }

  /**
   * Déconnecter un serveur MCP
   */
  async disconnect(serverId) {
    const conn = this._connections.get(serverId);
    if (!conn) return;

    try {
      if (conn.client) await conn.client.close();
    } catch { /* silent */ }

    try {
      if (conn.transport) await conn.transport.close();
    } catch { /* silent */ }

    this._connections.delete(serverId);
    console.log(`[MCP] Déconnecté: ${serverId}`);
    this._notify();
  }

  /**
   * Déconnecter tous les serveurs
   */
  async disconnectAll() {
    const ids = Array.from(this._connections.keys());
    await Promise.allSettled(ids.map(id => this.disconnect(id)));
  }

  /**
   * Connecter tous les serveurs marqués autoStart
   */
  async autoStartAll() {
    const promises = [];
    for (const [id, config] of this._configs) {
      if (config.autoStart) {
        promises.push(this.connect(id).catch(err => {
          console.error(`[MCP] Auto-start échoué pour "${config.name}":`, err.message);
        }));
      }
    }
    await Promise.allSettled(promises);
  }

  // ─── Appels d'outils ───────────────────────────────────────────────────

  /**
   * Appeler un outil sur un serveur MCP spécifique
   */
  async callTool(serverId, toolName, args = {}) {
    const conn = this._connections.get(serverId);
    if (!conn || !conn.client || conn.state.status !== 'connected') {
      throw new Error(`Serveur MCP "${serverId}" non connecté`);
    }

    console.log(`[MCP] Appel outil: ${serverId}/${toolName}`);
    const result = await conn.client.callTool({ name: toolName, arguments: args });
    return result;
  }

  /**
   * Obtenir TOUS les outils de TOUS les serveurs connectés
   * Retour: { serverId, serverName, toolName, description, inputSchema }[]
   */
  getAllTools() {
    const allTools = [];
    for (const [serverId, conn] of this._connections) {
      if (conn.state.status !== 'connected') continue;
      const config = this._configs.get(serverId);
      for (const tool of conn.state.tools) {
        allTools.push({
          serverId,
          serverName: config?.name || serverId,
          toolName: tool.name,
          description: tool.description || '',
          inputSchema: tool.inputSchema || {}
        });
      }
    }
    return allTools;
  }

  /**
   * Appeler un outil par son nom qualifié (serverId/toolName)
   * ou trouver automatiquement le bon serveur
   */
  async callToolByName(qualifiedName, args = {}) {
    // Format: "serverId/toolName" ou juste "toolName" (premier serveur qui a cet outil)
    const parts = qualifiedName.split('/');
    let serverId, toolName;

    if (parts.length >= 2) {
      serverId = parts[0];
      toolName = parts.slice(1).join('/');
    } else {
      toolName = qualifiedName;
      // Chercher le premier serveur qui expose cet outil
      for (const [sid, conn] of this._connections) {
        if (conn.state.status === 'connected' && conn.state.tools.some(t => t.name === toolName)) {
          serverId = sid;
          break;
        }
      }
    }

    if (!serverId) {
      throw new Error(`Aucun serveur MCP connecté ne fournit l'outil "${toolName}"`);
    }

    return this.callTool(serverId, toolName, args);
  }

  // ─── Statuts ────────────────────────────────────────────────────────────

  getStatus(serverId) {
    const config = this._configs.get(serverId);
    const conn = this._connections.get(serverId);
    return {
      id: serverId,
      name: config?.name || serverId,
      config: config || null,
      status: conn?.state?.status || 'disconnected',
      error: conn?.state?.error || null,
      toolCount: conn?.state?.tools?.length || 0,
      resourceCount: conn?.state?.resources?.length || 0,
      tools: (conn?.state?.tools || []).map(t => ({ name: t.name, description: t.description || '' }))
    };
  }

  getAllStatuses() {
    const statuses = [];
    for (const id of this._configs.keys()) {
      statuses.push(this.getStatus(id));
    }
    return statuses;
  }

  /**
   * Générer un résumé texte des outils MCP pour injection dans le prompt IA
   */
  buildToolsContextForPrompt() {
    const tools = this.getAllTools();
    if (tools.length === 0) return '';

    const lines = tools.map(t => {
      const params = t.inputSchema?.properties
        ? Object.keys(t.inputSchema.properties).join(', ')
        : '';
      return `- ${t.serverName}/${t.toolName}: ${t.description}${params ? ` (params: ${params})` : ''}`;
    });

    return [
      '\n--- OUTILS MCP DISPONIBLES ---',
      `${tools.length} outils connectés via MCP:`,
      ...lines,
      '',
      'Pour utiliser un outil MCP, répondez avec:',
      'MCP_CALL: serverId/toolName {"param": "value"}',
      '--- FIN OUTILS MCP ---\n'
    ].join('\n');
  }
}

module.exports = { McpClientManager };
