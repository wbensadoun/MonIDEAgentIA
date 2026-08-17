#!/usr/bin/env node
// MCP Server — Code companion
// Expose les capacités de l'IDE via le Model Context Protocol (stdio transport)

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// ─── Helpers ────────────────────────────────────────────────────────────────
const MAX_FILE_SIZE = 2 * 1024 * 1024;
const BLOCKED_EXT = new Set([
  '.png','.jpg','.jpeg','.gif','.webp','.svg','.ico','.bmp',
  '.mp3','.wav','.ogg','.mp4','.mov','.avi','.mkv','.webm',
  '.pdf','.zip','.rar','.7z','.tar','.gz','.exe','.dll','.so',
  '.woff','.woff2','.ttf','.otf','.eot','.bin','.iso','.jar'
]);

function assertSafePath(root, sub) {
  const rootRes = path.resolve(root) + path.sep;
  const subRes = path.resolve(sub);
  if (subRes !== path.resolve(root) && !subRes.startsWith(rootRes)) {
    throw new Error(`Accès refusé: chemin hors projet "${sub}"`);
  }
}

function resolveSafe(root, rel) {
  if (!rel || path.isAbsolute(rel)) throw new Error(`Chemin invalide: "${rel}"`);
  const resolved = path.resolve(root, rel);
  assertSafePath(root, resolved);
  return resolved;
}

function isBlocked(filePath) {
  return BLOCKED_EXT.has(path.extname(filePath).toLowerCase());
}

function runShell(cmd, cwd, timeoutMs = 30000) {
  return new Promise((resolve) => {
    let stdout = '', stderr = '';
    const child = spawn(cmd, { shell: true, cwd, timeout: timeoutMs });
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('close', code => resolve({ code, stdout, stderr }));
    child.on('error', err => resolve({ code: -1, stdout, stderr: err.message }));
  });
}

async function walkDir(dir, base, maxFiles = 500) {
  const results = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (results.length >= maxFiles) break;
    const rel = path.relative(base, path.join(dir, entry.name)).replace(/\\/g, '/');
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue;
    if (entry.isDirectory()) {
      results.push({ path: rel + '/', type: 'directory' });
      const sub = await walkDir(path.join(dir, entry.name), base, maxFiles - results.length);
      results.push(...sub);
    } else {
      const stats = await fs.stat(path.join(dir, entry.name)).catch(() => null);
      results.push({ path: rel, type: 'file', size: stats?.size || 0 });
    }
  }
  return results;
}

// ─── Server Setup ───────────────────────────────────────────────────────────
const server = new McpServer({
  name: 'mon-ide-agent-ia',
  version: '1.6.0',
  description: 'MCP Server pour Mon IDE Agent IA — expose fichiers, terminal, git, workflows et IA'
});

// ═══════════════════════════════════════════════════════════════════════════
// TOOLS
// ═══════════════════════════════════════════════════════════════════════════

// 1. read_file — Lire un fichier du projet
server.registerTool('read_file', {
  description: 'Lire le contenu d\'un fichier du projet. Chemin relatif au projet.',
  inputSchema: z.object({
    projectPath: z.string().describe('Chemin absolu du répertoire projet'),
    filePath: z.string().describe('Chemin relatif du fichier à lire'),
  }),
}, async ({ projectPath, filePath }) => {
  const resolved = resolveSafe(projectPath, filePath);
  if (isBlocked(resolved)) throw new Error(`Extension bloquée: ${filePath}`);
  const stats = await fs.stat(resolved);
  if (stats.size > MAX_FILE_SIZE) throw new Error(`Fichier trop gros: ${stats.size} bytes`);
  const content = await fs.readFile(resolved, 'utf8');
  return { content: [{ type: 'text', text: content }] };
});

// 2. write_file — Écrire/créer un fichier
server.registerTool('write_file', {
  description: 'Écrire ou créer un fichier dans le projet.',
  inputSchema: z.object({
    projectPath: z.string().describe('Chemin absolu du répertoire projet'),
    filePath: z.string().describe('Chemin relatif du fichier'),
    content: z.string().describe('Contenu à écrire'),
  }),
}, async ({ projectPath, filePath, content }) => {
  const resolved = resolveSafe(projectPath, filePath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, content, 'utf8');
  return { content: [{ type: 'text', text: `✅ Fichier écrit: ${filePath}` }] };
});

// 3. list_files — Lister les fichiers du projet
server.registerTool('list_files', {
  description: 'Lister les fichiers et dossiers d\'un projet (récursif, max 500).',
  inputSchema: z.object({
    projectPath: z.string().describe('Chemin absolu du répertoire projet'),
    subPath: z.string().optional().describe('Sous-répertoire relatif (optionnel)'),
  }),
}, async ({ projectPath, subPath }) => {
  const dir = subPath ? resolveSafe(projectPath, subPath) : path.resolve(projectPath);
  const files = await walkDir(dir, dir);
  const listing = files.map(f => `${f.type === 'directory' ? '📁' : '📄'} ${f.path}${f.size ? ` (${(f.size/1024).toFixed(1)}KB)` : ''}`).join('\n');
  return { content: [{ type: 'text', text: `${files.length} éléments:\n${listing}` }] };
});

// 4. edit_file — Chercher/remplacer dans un fichier
server.registerTool('edit_file', {
  description: 'Modifier un fichier par recherche/remplacement de texte.',
  inputSchema: z.object({
    projectPath: z.string().describe('Chemin absolu du répertoire projet'),
    filePath: z.string().describe('Chemin relatif du fichier'),
    searchText: z.string().describe('Texte exact à chercher'),
    replaceText: z.string().describe('Texte de remplacement'),
  }),
}, async ({ projectPath, filePath, searchText, replaceText }) => {
  const resolved = resolveSafe(projectPath, filePath);
  const content = await fs.readFile(resolved, 'utf8');
  if (!content.includes(searchText)) throw new Error('Texte à chercher non trouvé dans le fichier');
  const newContent = content.replace(searchText, replaceText);
  await fs.writeFile(resolved, newContent, 'utf8');
  return { content: [{ type: 'text', text: `✅ Fichier modifié: ${filePath}` }] };
});

// 5. run_command — Exécuter une commande shell
server.registerTool('run_command', {
  description: 'Exécuter une commande shell dans le répertoire du projet.',
  inputSchema: z.object({
    projectPath: z.string().describe('Répertoire de travail'),
    command: z.string().describe('Commande shell à exécuter'),
    timeoutMs: z.number().optional().describe('Timeout en ms (défaut: 30000)'),
  }),
}, async ({ projectPath, command, timeoutMs }) => {
  const result = await runShell(command, projectPath, timeoutMs || 30000);
  const output = [
    result.stdout ? `STDOUT:\n${result.stdout}` : '',
    result.stderr ? `STDERR:\n${result.stderr}` : '',
    `Exit code: ${result.code}`
  ].filter(Boolean).join('\n\n');
  return { content: [{ type: 'text', text: output }] };
});

// 6. git_status — État du dépôt Git
server.registerTool('git_status', {
  description: 'Obtenir le statut Git du projet (fichiers modifiés, branche, etc.).',
  inputSchema: z.object({
    projectPath: z.string().describe('Chemin du projet Git'),
  }),
}, async ({ projectPath }) => {
  const [status, branch, log] = await Promise.all([
    runShell('git status --short', projectPath),
    runShell('git branch --show-current', projectPath),
    runShell('git log --oneline -5', projectPath),
  ]);
  const text = [
    `🌿 Branche: ${branch.stdout.trim()}`,
    `\n📋 Statut:\n${status.stdout || '(aucune modification)'}`,
    `\n📜 Derniers commits:\n${log.stdout}`,
  ].join('\n');
  return { content: [{ type: 'text', text }] };
});

// 7. git_diff — Diff d'un fichier ou du projet
server.registerTool('git_diff', {
  description: 'Afficher le diff Git d\'un fichier ou de tout le projet.',
  inputSchema: z.object({
    projectPath: z.string().describe('Chemin du projet Git'),
    filePath: z.string().optional().describe('Fichier spécifique (optionnel, sinon diff global)'),
  }),
}, async ({ projectPath, filePath }) => {
  const cmd = filePath ? `git diff -- "${filePath}"` : 'git diff';
  const result = await runShell(cmd, projectPath);
  return { content: [{ type: 'text', text: result.stdout || '(aucun changement)' }] };
});

// 8. git_commit — Commiter les changements
server.registerTool('git_commit', {
  description: 'Ajouter et commiter tous les changements avec un message.',
  inputSchema: z.object({
    projectPath: z.string().describe('Chemin du projet Git'),
    message: z.string().describe('Message de commit'),
    addAll: z.boolean().optional().describe('git add -A avant le commit (défaut: true)'),
  }),
}, async ({ projectPath, message, addAll }) => {
  if (addAll !== false) await runShell('git add -A', projectPath);
  const result = await runShell(`git commit -m "${message.replace(/"/g, '\\"')}"`, projectPath);
  return { content: [{ type: 'text', text: result.stdout + (result.stderr || '') }] };
});

// 9. search_in_project — Rechercher dans les fichiers
server.registerTool('search_in_project', {
  description: 'Rechercher un texte dans les fichiers du projet (grep récursif).',
  inputSchema: z.object({
    projectPath: z.string().describe('Chemin du projet'),
    query: z.string().describe('Texte ou regex à chercher'),
    filePattern: z.string().optional().describe('Pattern de fichiers (ex: "*.js")'),
  }),
}, async ({ projectPath, query, filePattern }) => {
  const include = filePattern ? `--include="${filePattern}"` : '';
  const result = await runShell(`grep -rn ${include} --max-count=50 "${query.replace(/"/g, '\\"')}" . 2>/dev/null || true`, projectPath);
  return { content: [{ type: 'text', text: result.stdout || 'Aucun résultat trouvé.' }] };
});

// 10. list_workflows — Lister les workflows visuels
server.registerTool('list_workflows', {
  description: 'Lister les workflows visuels du projet (.vibe-workflows/).',
  inputSchema: z.object({
    projectPath: z.string().describe('Chemin du projet'),
  }),
}, async ({ projectPath }) => {
  const dir = path.join(projectPath, '.vibe-workflows');
  if (!fsSync.existsSync(dir)) return { content: [{ type: 'text', text: 'Aucun workflow trouvé.' }] };
  const files = await fs.readdir(dir);
  const workflows = [];
  for (const file of files.filter(f => f.endsWith('.json'))) {
    try {
      const raw = JSON.parse(await fs.readFile(path.join(dir, file), 'utf8'));
      workflows.push(`📊 ${raw.name || file} — ${(raw.nodes || []).length} nœuds, ${(raw.edges || []).length} liens`);
    } catch { workflows.push(`⚠️ ${file} (JSON invalide)`); }
  }
  return { content: [{ type: 'text', text: workflows.join('\n') || 'Aucun workflow.' }] };
});

// 11. get_project_info — Infos du projet
server.registerTool('get_project_info', {
  description: 'Obtenir les informations principales du projet (package.json, structure).',
  inputSchema: z.object({
    projectPath: z.string().describe('Chemin du projet'),
  }),
}, async ({ projectPath }) => {
  const parts = [];
  // package.json
  const pkgPath = path.join(projectPath, 'package.json');
  if (fsSync.existsSync(pkgPath)) {
    const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8'));
    parts.push(`📦 ${pkg.name}@${pkg.version}\n📝 ${pkg.description || '(pas de description)'}\n🔧 Scripts: ${Object.keys(pkg.scripts || {}).join(', ')}`);
  }
  // Structure de base
  const entries = await fs.readdir(projectPath, { withFileTypes: true });
  const dirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules').map(e => `📁 ${e.name}/`);
  const files = entries.filter(e => e.isFile()).map(e => `📄 ${e.name}`);
  parts.push(`\n📂 Structure racine:\n${[...dirs, ...files].join('\n')}`);
  return { content: [{ type: 'text', text: parts.join('\n') }] };
});

// ═══════════════════════════════════════════════════════════════════════════
// RESOURCES
// ═══════════════════════════════════════════════════════════════════════════

server.registerResource('ide://info', 'ide://info', {
  description: 'Informations sur Mon IDE Agent IA',
  mimeType: 'text/plain',
}, async () => ({
  contents: [{
    uri: 'ide://info',
    text: `Mon IDE Agent IA v1.6.0\n\nIDE desktop AI-native avec:\n- Multi-providers IA (Gemini, Kimi K2.5, Claude, Ollama)\n- Workflows visuels\n- Terminal intégré\n- Git natif\n- Preview web\n- RAG local vectoriel`,
    mimeType: 'text/plain'
  }]
}));

// ═══════════════════════════════════════════════════════════════════════════
// PROMPTS
// ═══════════════════════════════════════════════════════════════════════════

server.registerPrompt('analyze_project', {
  description: 'Générer un prompt d\'analyse complète du projet',
  argsSchema: z.object({
    projectPath: z.string().describe('Chemin du projet à analyser'),
    focus: z.string().optional().describe('Focus spécifique: architecture, performance, sécurité, etc.'),
  }),
}, async ({ projectPath, focus }) => {
  const focusText = focus ? `\nFocus spécifique: ${focus}` : '';
  return {
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: `Analyse le projet situé dans: ${projectPath}${focusText}\n\nUtilise les outils disponibles pour:\n1. Lister la structure du projet\n2. Lire le package.json et les fichiers de config\n3. Examiner les fichiers sources principaux\n4. Vérifier le statut Git\n5. Fournir une synthèse avec recommandations`
      }
    }]
  };
});

server.registerPrompt('code_review', {
  description: 'Prompt de revue de code pour un fichier spécifique',
  argsSchema: z.object({
    projectPath: z.string().describe('Chemin du projet'),
    filePath: z.string().describe('Fichier à reviewer'),
  }),
}, async ({ projectPath, filePath }) => ({
  messages: [{
    role: 'user',
    content: {
      type: 'text',
      text: `Fais une revue de code du fichier "${filePath}" dans le projet "${projectPath}".\n\nAnalyse:\n- Qualité du code et lisibilité\n- Bugs potentiels\n- Performance\n- Sécurité\n- Suggestions d'amélioration\n\nLis d'abord le fichier avec read_file, puis fournis ta revue structurée.`
    }
  }]
}));

// ─── Start ──────────────────────────────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[MCP] Mon IDE Agent IA — Serveur MCP démarré (stdio)');
}

main().catch(err => {
  console.error('[MCP] Erreur fatale:', err);
  process.exit(1);
});
