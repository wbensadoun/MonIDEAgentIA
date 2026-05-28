/**
 * MCP Registry — Catalogue de serveurs MCP prédéfinis (quick-add dans l'UI).
 *
 * L'utilisateur clique sur un bouton → la config est pré-remplie.
 * Il n'a qu'à ajouter ses credentials si nécessaire.
 */

const MCP_CATALOG = [
  {
    id: 'filesystem',
    name: 'Filesystem',
    icon: '📁',
    description: 'Accès sécurisé aux fichiers locaux',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/home'],
    env: {},
    category: 'core'
  },
  {
    id: 'github',
    name: 'GitHub',
    icon: '🔗',
    description: 'Issues, PRs, repos, code review',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: '' },
    category: 'dev',
    requiredEnv: ['GITHUB_PERSONAL_ACCESS_TOKEN']
  },
  {
    id: 'brave-search',
    name: 'Brave Search',
    icon: '🔍',
    description: 'Recherche web via Brave',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-brave-search'],
    env: { BRAVE_API_KEY: '' },
    category: 'web',
    requiredEnv: ['BRAVE_API_KEY']
  },
  {
    id: 'memory',
    name: 'Memory',
    icon: '🧠',
    description: 'Mémoire persistante pour l\'IA (knowledge graph)',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    env: {},
    category: 'ai'
  },
  {
    id: 'puppeteer',
    name: 'Puppeteer',
    icon: '🌐',
    description: 'Navigation web, screenshots, scraping',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-puppeteer'],
    env: {},
    category: 'web'
  },
  {
    id: 'postgres',
    name: 'PostgreSQL',
    icon: '🗄️',
    description: 'Requêtes SQL, schéma, tables',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres'],
    env: { POSTGRES_CONNECTION_STRING: '' },
    category: 'data',
    requiredEnv: ['POSTGRES_CONNECTION_STRING']
  },
  {
    id: 'sqlite',
    name: 'SQLite',
    icon: '💾',
    description: 'Base de données SQLite locale',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sqlite'],
    env: {},
    category: 'data'
  },
  {
    id: 'slack',
    name: 'Slack',
    icon: '💬',
    description: 'Messages, channels, recherche Slack',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-slack'],
    env: { SLACK_BOT_TOKEN: '' },
    category: 'communication',
    requiredEnv: ['SLACK_BOT_TOKEN']
  },
  {
    id: 'fetch',
    name: 'Fetch',
    icon: '📡',
    description: 'Requêtes HTTP (GET, POST, etc.)',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-fetch'],
    env: {},
    category: 'web'
  },
  {
    id: 'sequential-thinking',
    name: 'Sequential Thinking',
    icon: '💡',
    description: 'Raisonnement structuré étape par étape',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
    env: {},
    category: 'ai'
  }
];

/**
 * Catégories du catalogue
 */
const MCP_CATEGORIES = {
  core: { label: 'Essentiels', icon: '⚡' },
  dev: { label: 'Développement', icon: '🛠️' },
  web: { label: 'Web', icon: '🌐' },
  data: { label: 'Données', icon: '🗄️' },
  ai: { label: 'Intelligence Artificielle', icon: '🧠' },
  communication: { label: 'Communication', icon: '💬' }
};

/**
 * Obtenir le catalogue complet
 */
function getMcpCatalog() {
  return MCP_CATALOG.map(entry => ({
    ...entry,
    categoryLabel: MCP_CATEGORIES[entry.category]?.label || entry.category,
    categoryIcon: MCP_CATEGORIES[entry.category]?.icon || '📦'
  }));
}

/**
 * Obtenir une entrée du catalogue par ID
 */
function getMcpCatalogEntry(id) {
  return MCP_CATALOG.find(e => e.id === id) || null;
}

/**
 * Obtenir les catégories
 */
function getMcpCategories() {
  return MCP_CATEGORIES;
}

module.exports = { getMcpCatalog, getMcpCatalogEntry, getMcpCategories, MCP_CATALOG };
