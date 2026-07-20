// main.js
require('dotenv').config();
const { app, BrowserWindow, ipcMain, dialog, Menu, shell, session } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs').promises;
const fsSync = require('fs');
const readline = require('readline');
const { spawn } = require('child_process');
const net = require('net');
const crypto = require('crypto');
const axios = require('axios');
const logger = require('./logger');
const { registerGitHandlers } = require('./electron/ipc/gitHandlers');
const { registerWorkflowHandlers } = require('./electron/ipc/workflowHandlers');
const { registerBrainGraphHandlers } = require('./electron/ipc/brainGraphHandlers');
const { sanitizeVisualWorkflowPayload } = require('./electron/workflows/visualWorkflowSchema');

const isDev =
  process.env.NODE_ENV === 'development' ||
  process.env.ELECTRON_IS_DEV === '1' ||
  process.defaultApp === true;

const installStdioBrokenPipeGuards = () => {
  const guard = (err) => {
    if (!err) return;
    if (err.code === 'EPIPE' || err.code === 'ERR_STREAM_DESTROYED') {
      return;
    }
    try {
      const message = `[Main] stdio stream error: ${err.message || String(err)}\n`;
      fsSync.writeSync(2, message);
    } catch {
      // Ignore: stderr might not be available.
    }
  };
  try {
    if (process.stdout && typeof process.stdout.on === 'function') {
      process.stdout.on('error', guard);
    }
  } catch {
    // ignore
  }
  try {
    if (process.stderr && typeof process.stderr.on === 'function') {
      process.stderr.on('error', guard);
    }
  } catch {
    // ignore
  }
};

const safeConsoleLog = (...args) => {
  try {
    console.log(...args);
  } catch (error) {
    if (error && (error.code === 'EPIPE' || error.code === 'ERR_STREAM_DESTROYED')) {
      return;
    }
    throw error;
  }
};

installStdioBrokenPipeGuards();

let mainWindow;
const processes = {};
const processMeta = {};
const DEFAULT_PORT_ENV_KEYS = ['PORT', 'VITE_PORT', 'NUXT_PORT', 'WEB_PORT'];

const toPortNumber = (value, fallback = 3004) => {
  const raw = Number.parseInt(String(value ?? ''), 10);
  if (Number.isInteger(raw) && raw >= 1 && raw <= 65535) return raw;
  return fallback;
};

const getReservedPorts = () => {
  const reserved = new Set();
  Object.values(processMeta).forEach((meta) => {
    if (Number.isInteger(meta?.allocatedPort)) {
      reserved.add(meta.allocatedPort);
    }
  });
  return reserved;
};

const isPortAvailable = (port) =>
  new Promise((resolve) => {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      resolve(false);
      return;
    }

    const server = net.createServer();
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    server.once('error', () => finish(false));
    server.once('listening', () => {
      server.close(() => finish(true));
    });

    try {
      server.listen(port, '127.0.0.1');
    } catch {
      finish(false);
    }
  });

const findAvailablePort = async (preferredPort, maxAttempts = 200, reservedPorts = new Set()) => {
  const startPort = toPortNumber(preferredPort, 3004);
  for (let offset = 0; offset < maxAttempts; offset += 1) {
    const candidate = startPort + offset;
    if (candidate > 65535) break;
    if (reservedPorts.has(candidate)) continue;
    // eslint-disable-next-line no-await-in-loop
    const available = await isPortAvailable(candidate);
    if (available) return candidate;
  }
  return null;
};

/**
 * Security guard: ensures `sub` (resolved) is within `root`.
 * Throws an error if path traversal is detected.
 */
function assertSafePath(root, sub) {
  const rootResolved = path.resolve(root) + path.sep;
  const subResolved = path.resolve(sub);
  if (subResolved !== path.resolve(root) && !subResolved.startsWith(rootResolved)) {
    throw new Error(`Accès refusé: chemin hors projet "${sub}"`);
  }
}

const trustedProjectPaths = new Set();

const normalizeProjectPathForTrust = (projectPath) => {
  const raw = String(projectPath || '').trim();
  if (!raw || raw.includes('\0')) return '';
  return path.resolve(raw);
};

const trustProjectPath = (projectPath) => {
  const normalized = normalizeProjectPathForTrust(projectPath);
  if (normalized) trustedProjectPaths.add(normalized);
  return normalized;
};

const isTrustedProjectPath = (projectPath) => {
  const normalized = normalizeProjectPathForTrust(projectPath);
  return !!normalized && trustedProjectPaths.has(normalized);
};

const ensureTrustedProjectPath = async (projectPath) => {
  const normalized = normalizeProjectPathForTrust(projectPath);
  if (!normalized) {
    throw new Error('Chemin projet manquant ou invalide');
  }
  if (!trustedProjectPaths.has(normalized)) {
    throw new Error('Projet non autorise. Ouvrez ce dossier depuis le dialogue natif.');
  }
  return normalized;
};

const resolveOptionalTrustedProjectPath = async (projectPath) => {
  const normalized = normalizeProjectPathForTrust(projectPath);
  if (!normalized) return null;
  return ensureTrustedProjectPath(normalized);
};

const requestProjectPathApproval = async (projectPath) => {
  const normalized = normalizeProjectPathForTrust(projectPath);
  if (!normalized) {
    return { success: false, error: 'Chemin projet invalide' };
  }
  if (trustedProjectPaths.has(normalized)) {
    return { success: true, path: normalized, alreadyTrusted: true };
  }
  try {
    const stats = await fs.stat(normalized);
    if (!stats.isDirectory()) {
      return { success: false, error: 'Le chemin restaure n est pas un dossier' };
    }
  } catch (error) {
    return { success: false, error: `Projet introuvable: ${error.message}` };
  }

  const targetWindow = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  const result = await dialog.showMessageBox(targetWindow, {
    type: 'question',
    title: 'Autoriser le projet',
    message: 'Autoriser Mon IDE Agent IA a rouvrir ce dossier ?',
    detail: normalized,
    buttons: ['Autoriser', 'Refuser'],
    defaultId: 0,
    cancelId: 1,
    noLink: true
  });
  if (result.response !== 0) {
    return { success: false, error: 'Autorisation projet refusee' };
  }
  trustProjectPath(normalized);
  return { success: true, path: normalized, alreadyTrusted: false };
};

const AGENT_BLOCKED_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp', '.tif', '.tiff',
  '.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac',
  '.mp4', '.mov', '.avi', '.mkv', '.webm',
  '.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx',
  '.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz',
  '.exe', '.dll', '.so', '.dylib', '.bin', '.iso', '.jar',
  '.woff', '.woff2', '.ttf', '.otf', '.eot'
]);
const AGENT_MAX_FILE_BYTES = 2 * 1024 * 1024;
const AGENT_MAX_LINES_PER_CALL = 1000;
const AGENT_MAX_TOOL_CALLS = 20;
const AGENT_TOOL_MAX_ROUNDS = 6;
const AGENT_TOOL_CONTENT_MAX_CHARS = 120000;

// Familles Ollama a "raisonnement" (thinking) : par defaut elles generent un long
// bloc de reflexion AVANT de repondre, ce qui est catastrophique sur CPU (plusieurs
// minutes => "ne repond pas"). On desactive le thinking par defaut et on ne le
// reactive que si l'utilisateur coche "Reflexion". On n'envoie le champ `think`
// que pour ces familles, sinon Ollama rejette les modeles non compatibles.
const OLLAMA_THINKING_FAMILIES = /(qwen3|deepseek-r1|qwq|magistral|cogito|granite3\.2)/i;
const computeOllamaThink = (model, thinkingMode) => {
  if (!OLLAMA_THINKING_FAMILIES.test(String(model || ''))) return undefined; // champ omis
  return thinkingMode === true; // false par defaut (rapide)
};
// Filet de securite : certains builds emettent quand meme un bloc de raisonnement
// <think>...</think> malgre think:false. On le retire de la reponse finale.
const stripThinkBlocks = (text) => {
  let out = String(text || '');
  out = out.replace(/<think>[\s\S]*?<\/think>/gi, '');
  // Bloc <think> ouvert sans fermeture (reponse coupee) : on retire jusqu'a la fin.
  out = out.replace(/<think>[\s\S]*$/i, '');
  return out.trim();
};

const toPositiveInt = (value, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

function safeResolvePath(workspaceRoot, relativePath) {
  const root = path.resolve(String(workspaceRoot || '').trim() || process.cwd());
  const candidateRaw = String(relativePath || '').trim();
  if (!candidateRaw) {
    throw new Error('Chemin vide');
  }
  if (candidateRaw.includes('\0')) {
    throw new Error('Chemin invalide');
  }
  if (path.isAbsolute(candidateRaw)) {
    throw new Error(`Chemin absolu interdit: "${candidateRaw}"`);
  }
  const normalizedRelative = path.normalize(candidateRaw);
  if (normalizedRelative === '..' || normalizedRelative.startsWith(`..${path.sep}`) || normalizedRelative.includes(`${path.sep}..${path.sep}`)) {
    throw new Error(`Path traversal interdit: "${candidateRaw}"`);
  }
  const resolved = path.resolve(root, normalizedRelative);
  assertSafePath(root, resolved);
  return {
    root,
    resolved,
    relative: normalizedRelative.replace(/\\/g, '/')
  };
}

const hasAllowedAgentExtension = (filePath) => {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  return !AGENT_BLOCKED_EXTENSIONS.has(ext);
};

const isLikelyBinary = (contentBuffer) => {
  if (!Buffer.isBuffer(contentBuffer)) return false;
  const sample = contentBuffer.subarray(0, Math.min(contentBuffer.length, 4096));
  for (let i = 0; i < sample.length; i += 1) {
    if (sample[i] === 0) return true;
  }
  return false;
};

const formatToolError = (name, message) => {
  return `<tool_result name="${name}" status="error">\n${message}\n</tool_result>`;
};

async function validateAgentFileAccess(workspaceRoot, relativePath) {
  const resolvedPathInfo = safeResolvePath(workspaceRoot, relativePath);
  const { resolved, relative } = resolvedPathInfo;

  if (!hasAllowedAgentExtension(relative)) {
    throw new Error(`Extension non autorisee: ${relative}`);
  }

  let stats;
  try {
    stats = await fs.lstat(resolved);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`Fichier introuvable: ${relative}`);
    }
    throw error;
  }

  if (stats.isSymbolicLink()) {
    throw new Error(`Liens symboliques interdits: ${relative}`);
  }
  if (!stats.isFile()) {
    throw new Error(`Cible non-fichier: ${relative}`);
  }
  if (stats.size > AGENT_MAX_FILE_BYTES) {
    throw new Error(`Fichier trop volumineux (${stats.size} bytes > ${AGENT_MAX_FILE_BYTES})`);
  }

  return { resolvedPath: resolved, relativePath: relative, stats };
}

async function readAgentFileWithLimits(workspaceRoot, relativePath) {
  const { resolvedPath, relativePath: relPath } = await validateAgentFileAccess(workspaceRoot, relativePath);
  const raw = await fs.readFile(resolvedPath);
  if (isLikelyBinary(raw)) {
    throw new Error(`Fichier binaire non supporte: ${relPath}`);
  }
  const content = raw.toString('utf8');
  if (content.length > AGENT_TOOL_CONTENT_MAX_CHARS) {
    return `${content.slice(0, AGENT_TOOL_CONTENT_MAX_CHARS)}\n[...TRUNCATED ${content.length - AGENT_TOOL_CONTENT_MAX_CHARS} chars...]`;
  }
  return content;
}

function readAgentLinesWithLimits(content, start, end, maxLines = AGENT_MAX_LINES_PER_CALL) {
  const lines = String(content || '').split(/\r?\n/);
  const total = lines.length;
  const s = toPositiveInt(start, 1, 1, Math.max(1, total));
  const eDefault = Math.min(total, s + maxLines - 1);
  const eRaw = toPositiveInt(end, eDefault, s, Math.max(s, total));
  const eCapped = Math.min(eRaw, s + maxLines - 1);
  const excerpt = lines.slice(s - 1, eCapped);
  return {
    start: s,
    end: eCapped,
    total,
    content: excerpt.join('\n')
  };
}

const parseTagAttributes = (rawAttrs) => {
  const attrs = {};
  const text = String(rawAttrs || '');
  const regex = /([a-zA-Z_][a-zA-Z0-9_-]*)\s*=\s*"([^"]*)"/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    attrs[match[1]] = match[2];
  }
  return attrs;
};

const parseAgentToolCalls = (text) => {
  const source = String(text || '');
  const calls = [];
  const pushCall = (call) => {
    if (calls.length >= AGENT_MAX_TOOL_CALLS) return;
    calls.push(call);
  };

  const readFileRegex = /<read_file\b([^>]*)\/?>/gi;
  const readLinesRegex = /<read_lines\b([^>]*)\/?>/gi;
  const listWorkflowsRegex = /<list_workflows\s*\/?>/gi;
  const readWorkflowRegex = /<read_workflow\b([^>]*)\/?>/gi;

  let match;
  while ((match = readFileRegex.exec(source)) !== null) {
    const attrs = parseTagAttributes(match[1]);
    pushCall({ name: 'read_file', attrs });
  }
  while ((match = readLinesRegex.exec(source)) !== null) {
    const attrs = parseTagAttributes(match[1]);
    pushCall({ name: 'read_lines', attrs });
  }
  while ((match = listWorkflowsRegex.exec(source)) !== null) {
    pushCall({ name: 'list_workflows', attrs: {} });
  }
  while ((match = readWorkflowRegex.exec(source)) !== null) {
    const attrs = parseTagAttributes(match[1]);
    pushCall({ name: 'read_workflow', attrs });
  }

  return calls;
};

// Contrat d'outils PARTAGE (balises XML, provider-agnostique). Annonce aux agents
// les outils de lecture A LA DEMANDE : le contexte n'est plus pre-injecte en entier.
const AGENT_FILE_TOOL_CONTRACT = `OUTILS DISPONIBLES (lecture du projet a la demande):
- <read_file file="chemin/relatif.ext" />
- <read_lines file="chemin/relatif.ext" start="10" end="80" />

REGLES OUTILS:
- Utilise uniquement des chemins relatifs au workspace, pris dans l'INDEX PROJET.
- Ne demande que les fichiers reellement utiles a la reponse.
- Taille max fichier: ${AGENT_MAX_FILE_BYTES} bytes ; read_lines renvoie au max ${AGENT_MAX_LINES_PER_CALL} lignes.
- Quand tu appelles un outil, reponds UNIQUEMENT avec les balises d'outil, sans texte autour.`;

// Runtime d'outils PARTAGE (provider-agnostique) : execute un appel d'outil de
// lecture de fichier sur le workspace. Reutilisable par tous les agents (Ollama
// simple/multi, et a terme Gemini/Claude/Kimi) pour le contexte a la demande.
const executeAgentFileToolCall = async (workspaceRoot, call) => {
  const toolName = String(call?.name || '').trim();
  const attrs = call?.attrs && typeof call.attrs === 'object' ? call.attrs : {};
  try {
    if (!workspaceRoot) throw new Error('Aucun projet autorise pour la lecture de fichier.');
    if (toolName === 'read_file') {
      const relFile = String(attrs.file || '').trim();
      if (!relFile) throw new Error('Attribut file requis');
      const resolvedInfo = safeResolvePath(workspaceRoot, relFile);
      const content = await readAgentFileWithLimits(workspaceRoot, relFile);
      return `<tool_result name="read_file" file="${resolvedInfo.relative}" status="ok">\n${content}\n</tool_result>`;
    }
    if (toolName === 'read_lines') {
      const relFile = String(attrs.file || '').trim();
      if (!relFile) throw new Error('Attribut file requis');
      const { resolvedPath, relativePath } = await validateAgentFileAccess(workspaceRoot, relFile);
      const raw = await fs.readFile(resolvedPath);
      if (isLikelyBinary(raw)) throw new Error(`Fichier binaire non supporte: ${relativePath}`);
      const excerpt = readAgentLinesWithLimits(raw.toString('utf8'), attrs.start, attrs.end, AGENT_MAX_LINES_PER_CALL);
      return `<tool_result name="read_lines" file="${relativePath}" start="${excerpt.start}" end="${excerpt.end}" total="${excerpt.total}" status="ok">\n${excerpt.content}\n</tool_result>`;
    }
    return formatToolError(toolName || 'unknown_tool', `Outil non supporte: ${toolName}`);
  } catch (error) {
    return formatToolError(toolName || 'unknown_tool', error?.message || String(error));
  }
};

// Construit un INDEX PROJET leger (chemins + tailles, SANS contenu brut) a injecter
// dans le prompt. L'agent lit ensuite les fichiers utiles via les outils ci-dessus.
const buildProjectIndexContext = (allProjectFiles, maxEntries = 200) => {
  const fileEntries = allProjectFiles?.files && typeof allProjectFiles.files === 'object'
    ? Object.entries(allProjectFiles.files)
    : [];
  if (fileEntries.length === 0) return '';
  const lines = fileEntries.slice(0, maxEntries).map(([filePath, fileData]) => {
    const size = Number(fileData?.size || (fileData?.content ? String(fileData.content).length : 0));
    return `- ${filePath} (${Number.isFinite(size) ? size : 0} bytes)`;
  });
  if (fileEntries.length > lines.length) {
    lines.push(`- ... ${fileEntries.length - lines.length} fichiers supplementaires`);
  }
  return `\nINDEX PROJET (sans contenu brut — lis les fichiers utiles via les outils):\n${lines.join('\n')}\n`;
};

const summarizeWorkflow = (rawWorkflow, fallbackName) => {
  const wf = rawWorkflow && typeof rawWorkflow === 'object' ? rawWorkflow : {};
  const name = String(wf.name || fallbackName || 'workflow').trim() || 'workflow';
  const descriptionRaw = String(wf.description || wf.summary || '').trim();
  const description = descriptionRaw ? descriptionRaw.slice(0, 180) : '';
  const nodes = Array.isArray(wf.nodes) ? wf.nodes.length : 0;
  const edges = Array.isArray(wf.edges) ? wf.edges.length : 0;
  return { name, description, nodes, edges };
};

const buildWorkflowIdFromFilename = (filename) => {
  const base = String(filename || '').trim();
  if (!base) return '';
  return base.replace(/\.json$/i, '');
};

const resolveWorkflowFileById = async (projectPath, workflowId) => {
  const baseDir = getWorkspaceVisualWorkflowsDir(projectPath);
  const allFiles = await fs.readdir(baseDir);
  const jsonFiles = allFiles.filter((name) => String(name).toLowerCase().endsWith('.json'));
  if (jsonFiles.length === 0) return null;

  const requested = String(workflowId || '').trim();
  if (!requested) return null;
  const requestedLower = requested.toLowerCase();

  let selected = jsonFiles.find((name) => String(name).toLowerCase() === requestedLower);
  if (!selected) {
    selected = jsonFiles.find((name) => buildWorkflowIdFromFilename(name).toLowerCase() === requestedLower);
  }

  if (!selected) return null;
  return path.join(baseDir, selected);
};

async function getVisualWorkflowIndex(projectPath, maxItems = 40) {
  if (!projectPath) return [];
  const baseDir = getWorkspaceVisualWorkflowsDir(projectPath);
  if (!fsSync.existsSync(baseDir)) return [];

  const entries = await fs.readdir(baseDir);
  const jsonFiles = entries
    .filter((name) => String(name).toLowerCase().endsWith('.json'))
    .slice(0, maxItems);

  const workflows = [];
  for (const filename of jsonFiles) {
    try {
      const filePath = path.join(baseDir, filename);
      const content = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(content);
      const { workflow } = sanitizeVisualWorkflowPayload(parsed, { strict: false });
      const summary = summarizeWorkflow(workflow, buildWorkflowIdFromFilename(filename));
      workflows.push({
        id: buildWorkflowIdFromFilename(filename),
        filename,
        ...summary
      });
    } catch {
      workflows.push({
        id: buildWorkflowIdFromFilename(filename),
        filename,
        name: buildWorkflowIdFromFilename(filename),
        description: '[invalid json]',
        nodes: 0,
        edges: 0
      });
    }
  }

  return workflows;
}

async function readVisualWorkflowById(projectPath, workflowId) {
  if (!projectPath) {
    throw new Error('Aucun projet actif');
  }
  const targetFile = await resolveWorkflowFileById(projectPath, workflowId);
  if (!targetFile) {
    throw new Error(`Workflow introuvable: ${workflowId}`);
  }
  const content = await fs.readFile(targetFile, 'utf8');
  if (content.length > AGENT_TOOL_CONTENT_MAX_CHARS) {
    return `${content.slice(0, AGENT_TOOL_CONTENT_MAX_CHARS)}\n[...TRUNCATED ${content.length - AGENT_TOOL_CONTENT_MAX_CHARS} chars...]`;
  }
  return content;
}

const VISUAL_WORKFLOW_INTENT_REGEX = /\b(workflow|workflows|flux|visuel|visuels|diagram|diagramme|n8n)\b/i;

async function buildVisualWorkflowContextForPrompt(projectPath, userText = '', options = {}) {
  if (!projectPath) return '';
  const safeOptions = options && typeof options === 'object' ? options : {};
  if (safeOptions.includeVisualWorkflows === false) return '';

  const maxIndexItems = toPositiveInt(safeOptions.maxVisualWorkflowIndexItems, 20, 1, 60);
  const maxDetailedItems = toPositiveInt(safeOptions.maxVisualWorkflowDetailedItems, 4, 0, 15);
  const maxContentChars = toPositiveInt(safeOptions.maxVisualWorkflowContentChars, 7000, 800, 50000);
  const workflowIntent = safeOptions.forceVisualWorkflowContext === true
    || VISUAL_WORKFLOW_INTENT_REGEX.test(String(userText || ''));

  // Ne charger les workflows que si l'intention est detectable — meme logique que n8n.
  if (!workflowIntent) return '';

  let workflows = [];
  try {
    workflows = await getVisualWorkflowIndex(projectPath, maxIndexItems);
  } catch {
    return '';
  }

  if (!Array.isArray(workflows) || workflows.length === 0) {
    return '';
  }

  let context = '\n--- WORKFLOWS VISUELS (.vibe-workflows) ---\n';
  context += workflows.map((wf, idx) =>
    `${idx + 1}. id=${wf.id} | name=${wf.name} | nodes=${wf.nodes} | edges=${wf.edges}${wf.description ? ` | desc=${wf.description}` : ''}`
  ).join('\n');

  if (!workflowIntent || maxDetailedItems <= 0) {
    context += '\n\nUtilisez ces identifiants pour modifier un workflow existant via **WORKFLOW: NomDuWorkflow** avec un JSON complet.';
    context += '\n--- FIN WORKFLOWS VISUELS ---\n';
    return context;
  }

  const detailedList = workflows.slice(0, maxDetailedItems);
  for (const wf of detailedList) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const rawContent = await readVisualWorkflowById(projectPath, wf.id);
      const content = String(rawContent || '');
      const rendered = content.length > maxContentChars
        ? `${content.slice(0, maxContentChars)}\n/* ... TRUNCATED ${content.length - maxContentChars} chars ... */`
        : content;
      context += `\n\n### WORKFLOW_JSON: ${wf.id}\n\`\`\`json\n${rendered}\n\`\`\``;
    } catch {
      context += `\n\n### WORKFLOW_JSON: ${wf.id}\n[lecture impossible]`;
    }
  }

  context += '\n--- FIN WORKFLOWS VISUELS ---\n';
  return context;
}

const N8N_CATALOG_INTENT_REGEX = /\b(n8n|catalog|catalogue|template|templates)\b/i;
const N8N_CATALOG_REPO_OWNER = 'Danitilahun';
const N8N_CATALOG_REPO_NAME = 'n8n-workflow-templates';
const N8N_CATALOG_WORKFLOWS_DIR = 'workflows/';
const N8N_CATALOG_BRANCH_CANDIDATES = ['main', 'master'];
const N8N_CATALOG_ALLOWED_RAW_HOST = 'raw.githubusercontent.com';
const N8N_CATALOG_IMMUTABLE_REF_REGEX = /^[a-f0-9]{40}$/i;
const N8N_CATALOG_MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024;
const N8N_IMPORT_MAX_NODES = 500;
let n8nCatalogPromptCache = {
  fetchedAt: 0,
  items: [],
  total: 0,
  source: 'none',
  truncated: false
};

const sanitizeN8nImportFilename = (rawName, fallbackName = 'imported_n8n_workflow') => {
  const candidate = String(rawName || '').trim() || fallbackName;
  const baseName = path.basename(candidate);
  const withoutExt = baseName.replace(/\.json$/i, '');
  const cleaned = withoutExt
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_\.-]+|[_\.-]+$/g, '')
    .slice(0, 120);
  const safe = cleaned || fallbackName;
  return `${safe}.json`;
};

const isTrustedN8nDownloadUrl = (rawUrl) => {
  try {
    const parsed = new URL(String(rawUrl || '').trim());
    if (parsed.protocol !== 'https:') return false;
    if (parsed.hostname.toLowerCase() !== N8N_CATALOG_ALLOWED_RAW_HOST) return false;
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length < 5) return false;
    if (parts[0].toLowerCase() !== N8N_CATALOG_REPO_OWNER.toLowerCase()) return false;
    if (parts[1].toLowerCase() !== N8N_CATALOG_REPO_NAME.toLowerCase()) return false;
    const immutableRef = parts[2];
    if (!N8N_CATALOG_IMMUTABLE_REF_REGEX.test(immutableRef)) return false;
    const relPath = parts.slice(3).join('/');
    if (!relPath.toLowerCase().startsWith(N8N_CATALOG_WORKFLOWS_DIR)) return false;
    if (!relPath.toLowerCase().endsWith('.json')) return false;
    return true;
  } catch {
    return false;
  }
};

const parseN8nWorkflowPayload = (rawData) => {
  if (typeof rawData === 'string') {
    try {
      return JSON.parse(rawData);
    } catch {
      throw new Error('Le fichier telecharge n est pas un JSON valide.');
    }
  }
  return rawData;
};

const isValidN8nWorkflowPayload = (payload) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  if (!Array.isArray(payload.nodes)) return false;
  if (payload.nodes.length === 0 || payload.nodes.length > N8N_IMPORT_MAX_NODES) return false;
  if (payload.connections !== undefined && (payload.connections === null || typeof payload.connections !== 'object' || Array.isArray(payload.connections))) {
    return false;
  }
  return payload.nodes.every((node) => node && typeof node === 'object' && typeof node.type === 'string');
};

const fetchTrustedN8nWorkflow = async (downloadUrl, timeoutMs = 15000) => {
  if (!isTrustedN8nDownloadUrl(downloadUrl)) {
    throw new Error('URL non autorisee. Utilisez une URL provenant du catalogue n8n configure.');
  }

  const response = await axios.get(downloadUrl, {
    timeout: timeoutMs,
    responseType: 'text',
    maxContentLength: N8N_CATALOG_MAX_DOWNLOAD_BYTES,
    maxBodyLength: N8N_CATALOG_MAX_DOWNLOAD_BYTES,
    transformResponse: [(data) => data]
  });
  const payload = parseN8nWorkflowPayload(response.data);
  if (!isValidN8nWorkflowPayload(payload)) {
    throw new Error('Le fichier telecharge ne semble pas etre un workflow n8n valide.');
  }
  return payload;
};

const toN8nCatalogItem = (entryPath, size = 0, ref = 'main') => {
  const normalizedPath = String(entryPath || '').replace(/\\/g, '/');
  const filename = path.posix.basename(normalizedPath);
  const rawName = filename.replace(/\.json$/i, '');
  const name = rawName.replace(/[_-]+/g, ' ').trim() || rawName || filename;
  return {
    name,
    filename,
    repoPath: normalizedPath,
    downloadUrl: `https://raw.githubusercontent.com/${N8N_CATALOG_REPO_OWNER}/${N8N_CATALOG_REPO_NAME}/${ref}/${normalizedPath}`,
    size: Number(size) || 0
  };
};

async function fetchN8nBranchCommitSha(branch, timeoutMs = 12000) {
  const url = `https://api.github.com/repos/${N8N_CATALOG_REPO_OWNER}/${N8N_CATALOG_REPO_NAME}/commits/${branch}`;
  const response = await axios.get(url, {
    headers: {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'MonIDEAgentIA'
    },
    timeout: timeoutMs
  });
  const sha = String(response.data?.sha || '').trim();
  if (!N8N_CATALOG_IMMUTABLE_REF_REGEX.test(sha)) {
    throw new Error(`SHA commit invalide pour la branche ${branch}`);
  }
  return sha;
}

const sortN8nCatalogItems = (items) => {
  return Array.isArray(items)
    ? items.slice().sort((a, b) =>
      String(a?.filename || '').localeCompare(String(b?.filename || ''), undefined, { numeric: true, sensitivity: 'base' }))
    : [];
};

async function fetchN8nCatalogFromGitTree(timeoutMs = 12000) {
  let lastError = null;
  for (const branch of N8N_CATALOG_BRANCH_CANDIDATES) {
    try {
      // Pin catalog entries to an immutable commit SHA to reduce supply-chain drift.
      const commitSha = await fetchN8nBranchCommitSha(branch, timeoutMs);
      const url = `https://api.github.com/repos/${N8N_CATALOG_REPO_OWNER}/${N8N_CATALOG_REPO_NAME}/git/trees/${commitSha}?recursive=1`;
      const response = await axios.get(url, {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'MonIDEAgentIA'
        },
        timeout: timeoutMs
      });

      const tree = Array.isArray(response.data?.tree) ? response.data.tree : [];
      const truncated = response.data?.truncated === true;
      const items = tree
        .filter((entry) =>
          entry &&
          entry.type === 'blob' &&
          typeof entry.path === 'string' &&
          entry.path.toLowerCase().startsWith(N8N_CATALOG_WORKFLOWS_DIR) &&
          entry.path.toLowerCase().endsWith('.json'))
        .map((entry) => toN8nCatalogItem(entry.path, entry.size, commitSha));

      if (items.length > 0) {
        return {
          items: sortN8nCatalogItems(items),
          source: `git-tree:${branch}@${commitSha.slice(0, 12)}`,
          truncated
        };
      }
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Impossible de lire le catalogue n8n (git tree)');
}

async function fetchN8nCatalogFromContents(timeoutMs = 12000) {
  let lastError = null;
  for (const branch of N8N_CATALOG_BRANCH_CANDIDATES) {
    try {
      const commitSha = await fetchN8nBranchCommitSha(branch, timeoutMs);
      const url = `https://api.github.com/repos/${N8N_CATALOG_REPO_OWNER}/${N8N_CATALOG_REPO_NAME}/contents/workflows?ref=${commitSha}`;
      const response = await axios.get(url, {
        headers: {
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'MonIDEAgentIA'
        },
        timeout: timeoutMs
      });

      const items = Array.isArray(response.data)
        ? response.data
          .filter((entry) =>
            entry &&
            typeof entry.name === 'string' &&
            String(entry.name).toLowerCase().endsWith('.json') &&
            typeof entry.path === 'string')
          .map((entry) => toN8nCatalogItem(entry.path, entry.size, commitSha))
        : [];

      if (items.length > 0) {
        return {
          items: sortN8nCatalogItems(items),
          source: `contents:${branch}@${commitSha.slice(0, 12)}`,
          truncated: false
        };
      }
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Impossible de lire le catalogue n8n (contents)');
}

async function getN8nCatalogEntries(timeoutMs = 12000) {
  const now = Date.now();
  const cacheAgeMs = now - Number(n8nCatalogPromptCache.fetchedAt || 0);
  const cacheFreshMs = 3 * 60 * 1000;
  if (Array.isArray(n8nCatalogPromptCache.items) && n8nCatalogPromptCache.items.length > 0 && cacheAgeMs < cacheFreshMs) {
    return {
      items: n8nCatalogPromptCache.items,
      total: Number(n8nCatalogPromptCache.total) || n8nCatalogPromptCache.items.length,
      source: n8nCatalogPromptCache.source || 'cache',
      truncated: !!n8nCatalogPromptCache.truncated,
      cached: true
    };
  }

  let fetched;
  try {
    fetched = await fetchN8nCatalogFromGitTree(timeoutMs);
  } catch {
    fetched = await fetchN8nCatalogFromContents(timeoutMs);
  }
  const items = Array.isArray(fetched?.items) ? fetched.items : [];

  n8nCatalogPromptCache = {
    fetchedAt: now,
    items,
    total: items.length,
    source: fetched?.source || 'unknown',
    truncated: !!fetched?.truncated
  };

  return {
    items,
    total: items.length,
    source: fetched?.source || 'unknown',
    truncated: !!fetched?.truncated,
    cached: false
  };
}

async function fetchN8nCatalogForPrompt(maxItems = 50, timeoutMs = 12000) {
  const catalog = await getN8nCatalogEntries(timeoutMs);
  return {
    items: catalog.items.slice(0, maxItems),
    total: catalog.total,
    source: catalog.source,
    truncated: catalog.truncated
  };
}

async function buildN8nCatalogContextForPrompt(userText = '', options = {}) {
  const safeOptions = options && typeof options === 'object' ? options : {};
  if (safeOptions.includeN8nCatalog === false) return '';

  const intent = safeOptions.forceN8nCatalogContext === true
    || N8N_CATALOG_INTENT_REGEX.test(String(userText || ''));
  if (!intent) return '';

  const maxItems = toPositiveInt(safeOptions.maxN8nCatalogItems, 50, 5, 500);
  const timeoutMs = toPositiveInt(safeOptions.n8nCatalogTimeoutMs, 12000, 2000, 30000);

  try {
    const catalog = await fetchN8nCatalogForPrompt(maxItems, timeoutMs);
    const entries = Array.isArray(catalog.items) ? catalog.items : [];
    if (entries.length === 0) {
      return '\n--- CATALOGUE N8N (COMMUNITY) ---\nAucun workflow trouve.\n--- FIN CATALOGUE N8N ---\n';
    }

    const totalCount = Number(catalog.total) || entries.length;
    const lines = entries.map((item, idx) => {
      const kb = (Number(item.size || 0) / 1024).toFixed(1);
      return `${idx + 1}. ${item.name} (${kb} KB) | ${item.downloadUrl}`;
    });
    const shownCount = lines.length;
    const sourceInfo = catalog.source ? `\nSource: ${catalog.source}` : '';
    const truncInfo = catalog.truncated ? '\nAttention: API GitHub signale un arbre tronque.' : '';
    const summary = `Total workflows detectes: ${totalCount}\nAffiches dans ce contexte: ${shownCount}`;
    return `\n--- CATALOGUE N8N (COMMUNITY) ---\n${summary}${sourceInfo}${truncInfo}\n${lines.join('\n')}\n--- FIN CATALOGUE N8N ---\n`;
  } catch (error) {
    return `\n--- CATALOGUE N8N (COMMUNITY) ---\nIndisponible: ${error?.message || 'erreur reseau'}\n--- FIN CATALOGUE N8N ---\n`;
  }
}

const getLogsDir = () => {
  return path.join(app.getPath('userData'), 'logs');
};

const getLatestLogPath = async () => {
  const logDir = getLogsDir();
  const files = await fs.readdir(logDir);
  const logFiles = files.filter(f => f.startsWith('app-') && f.endsWith('.log'));
  if (logFiles.length === 0) return null;

  // Trier par date/nom (app-YYYY-MM-DD.log)
  logFiles.sort();
  return path.join(logDir, logFiles[logFiles.length - 1]);
};

const normalizeContextPath = (filePath) => String(filePath || '').replace(/\\/g, '/');

const scoreFileForContext = (filePath, fileData) => {
  const normalized = normalizeContextPath(filePath).toLowerCase();
  const base = normalized.split('/').pop() || normalized;
  const depth = normalized.split('/').length;
  const size = typeof fileData?.size === 'number' ? fileData.size : 0;

  const basePriority = {
    'package.json': 0,
    'readme.md': 1,
    'readme': 2,
    'tsconfig.json': 3,
    '.gitignore': 4,
    '.gitattributes': 5,
    '.editorconfig': 6,
    '.prettierrc': 7,
    '.eslintrc': 8,
    '.npmrc': 9,
    '.env.example': 12,
    'next.config.js': 4,
    'vite.config.ts': 4,
    'vite.config.js': 4,
  };

  let score = basePriority[base] ?? 100;

  if (normalized.startsWith('src/')) score = Math.min(score, 10);
  if (normalized.startsWith('client/src/')) score = Math.min(score, 11);

  if (/\.(ts|tsx|js|jsx)$/.test(base)) score = Math.min(score, 30);
  if (/\.(md|json|yml|yaml|html|css|scss)$/.test(base)) score = Math.min(score, 50);

  score += Math.min(50, depth);
  score += Math.min(100, Math.floor(size / 2000));

  return score;
};

const pickFilesForContext = (files, maxFiles) => {
  const entries = Object.entries(files || {});
  const candidates = entries.filter(([, data]) =>
    data && typeof data.content === 'string' && !String(data.content).startsWith('[')
  );

  candidates.sort((a, b) => {
    const scoreA = scoreFileForContext(a[0], a[1]);
    const scoreB = scoreFileForContext(b[0], b[1]);
    if (scoreA !== scoreB) return scoreA - scoreB;
    return String(a[0]).localeCompare(String(b[0]));
  });

  return candidates.slice(0, maxFiles);
};

const createAppMenu = () => {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Folder',
          accelerator: 'CmdOrCtrl+O',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('menu-open-folder');
            }
          }
        },
        { type: 'separator' },
        { role: 'quit', label: 'Exit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'View Logs',
          click: async () => {
            try {
              const latest = await getLatestLogPath();
              if (!latest) {
                dialog.showMessageBox({ type: 'info', message: 'Aucun log trouvé.' });
                return;
              }
              const content = await fs.readFile(latest, 'utf8');
              const logsWindow = new BrowserWindow({
                width: 900,
                height: 650,
                title: 'Logs',
                webPreferences: {
                  nodeIntegration: false,
                  contextIsolation: true,
                  sandbox: true
                }
              });

              const escaped = content
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');

              const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Logs</title>
    <style>
      body { margin: 0; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; background: #0b1220; color: #e5e7eb; }
      header { display:flex; justify-content: space-between; align-items:center; padding: 12px 14px; border-bottom: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.03); }
      button { background: rgba(56, 189, 248, 0.15); color: #7dd3fc; border: 1px solid rgba(56, 189, 248, 0.35); border-radius: 10px; padding: 8px 10px; cursor: pointer; }
      button:hover { background: rgba(56, 189, 248, 0.25); }
      pre { margin: 0; padding: 14px; white-space: pre-wrap; word-break: break-word; }
      .path { opacity: 0.75; font-size: 12px; }
    </style>
  </head>
  <body>
    <header>
      <div>
        <div><strong>Logs</strong></div>
        <div class="path">${latest}</div>
      </div>
      <div style="display:flex; gap:8px;">
        <button onclick="navigator.clipboard.writeText(document.getElementById('log').innerText)">Copier</button>
      </div>
    </header>
    <pre id="log">${escaped}</pre>
  </body>
</html>`;
              const tempHtmlPath = path.join(app.getPath('temp'), 'vibe-logs-viewer.html');
              await fs.writeFile(tempHtmlPath, html, 'utf-8');
              logsWindow.loadFile(tempHtmlPath);
            } catch (e) {
              dialog.showErrorBox('Erreur logs', e.message || String(e));
            }
          }
        },
        {
          label: 'Open Logs Folder',
          click: async () => {
            try {
              await fs.mkdir(getLogsDir(), { recursive: true });
              await shell.openPath(getLogsDir());
            } catch (e) {
              dialog.showErrorBox('Erreur', e.message || String(e));
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Toggle DevTools',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.toggleDevTools();
            }
          }
        },
        {
          label: 'Settings',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('menu-open-settings');
            }
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
};

// Initialize logger when app is ready
app.whenReady().then(async () => {
  await logger.init();
  createWindow();
});

ipcMain.handle('get-latest-log', async () => {
  try {
    const latest = await getLatestLogPath();
    if (!latest) return { success: true, path: null, content: '' };
    const content = await fs.readFile(latest, 'utf8');
    return { success: true, path: latest, content };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// --- Validation des clés API par ping ---
ipcMain.handle('validate-api-key', async (event, provider, apiKey) => {
  try {
    if (!provider || !apiKey) {
      return { success: false, valid: false, error: 'Provider ou clé manquant' };
    }

    if (provider === 'gemini') {
      // Ping léger: lister les modèles Gemini
      const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
      try {
        const resp = await axios.get(url, { timeout: 15000 });
        const ok = resp && resp.status === 200;
        return { success: true, valid: !!ok };
      } catch (err) {
        const status = err.response?.status;
        // 401/403/400 => invalide
        return { success: true, valid: false, status, error: err.message };
      }
    }

    if (provider === 'kimi') {
      // Ping Together: lister les modèles
      try {
        const resp = await axios.get('https://api.together.xyz/v1/models', {
          headers: { Authorization: `Bearer ${apiKey}` },
          timeout: 15000
        });
        const ok = resp && resp.status === 200;
        return { success: true, valid: !!ok };
      } catch (err) {
        const status = err.response?.status;
        return { success: true, valid: false, status, error: err.message };
      }
    }

    if (provider === 'claude') {
      // Ping Anthropic: list models (lightweight)
      try {
        const resp = await axios.get('https://api.anthropic.com/v1/models', {
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
          },
          timeout: 15000
        });
        const ok = resp && resp.status === 200;
        return { success: true, valid: !!ok };
      } catch (err) {
        const status = err.response?.status;
        return { success: true, valid: false, status, error: err.message };
      }
    }

    if (provider === 'ollama') {
      // Ollama is local, no API key needed — just check connectivity
      try {
        const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
        const resp = await axios.get(`${ollamaUrl}/api/tags`, { timeout: 5000 });
        const models = resp.data?.models || [];
        return { success: true, valid: true, modelCount: models.length };
      } catch (err) {
        return { success: true, valid: false, error: `Ollama non disponible: ${err.message}` };
      }
    }

    return { success: false, valid: false, error: 'Provider inconnu' };
  } catch (error) {
    return { success: false, valid: false, error: error.message };
  }
});

ipcMain.handle('open-logs-folder', async () => {
  try {
    await fs.mkdir(getLogsDir(), { recursive: true });
    await shell.openPath(getLogsDir());
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Process Runner (Terminal intégré)
ipcMain.handle('start-process', async (event, payload) => {
  try {
    await ensureTerminalPermission();

    const {
      id,
      command,
      args = [],
      cwd,
      env: customEnv,
      autoSelectPort = false,
      preferredPort,
      portEnvVars,
      requireApproval = false
    } = payload || {};
    if (!id || !command) {
      return { success: false, error: 'Identifiant ou commande manquant' };
    }

    // Arrêter un éventuel processus existant avec le même id
    if (processes[id]) {
      try {
        processes[id].kill();
      } catch (e) {
        // ignore
      }
      delete processes[id];
      delete processMeta[id];
    }

    const safeCwd = await ensureTrustedProjectPath(cwd);
    const spawnRequest = buildSafeSpawnRequest(command, args);
    validateCommandArgsWithinWorkspace(spawnRequest, safeCwd);
    if (requireApproval) {
      const approved = await requestTerminalApproval(spawnRequest.normalizedCommandLine);
      if (!approved) {
        return { success: false, error: 'Commande refusee par l utilisateur' };
      }
    }

    const options = { cwd: safeCwd };
    options.shell = false;
    options.windowsHide = true;
    options.env = { ...process.env };

    if (customEnv && typeof customEnv === 'object' && !Array.isArray(customEnv)) {
      Object.entries(customEnv).forEach(([key, value]) => {
        if (typeof key !== 'string' || !key.trim()) return;
        if (value === undefined || value === null) return;
        options.env[key] = String(value);
      });
    }

    let allocatedPort = null;
    if (autoSelectPort) {
      const preferred = toPortNumber(preferredPort, 3004);
      const requestedKeys = Array.isArray(portEnvVars)
        ? portEnvVars.filter((key) => typeof key === 'string' && key.trim())
        : [];
      const keys = requestedKeys.length > 0 ? requestedKeys : DEFAULT_PORT_ENV_KEYS;
      const reservedPorts = getReservedPorts();
      allocatedPort = await findAvailablePort(preferred, 200, reservedPorts);
      if (!allocatedPort) {
        return { success: false, error: 'Aucun port libre disponible.' };
      }
      keys.forEach((key) => {
        options.env[key] = String(allocatedPort);
      });
    }

    const child = spawn(spawnRequest.executable, spawnRequest.args, options);
    processes[id] = child;
    if (allocatedPort) {
      processMeta[id] = { allocatedPort };
    } else {
      delete processMeta[id];
    }

    child.stdout.on('data', (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('process-output', {
          id,
          type: 'stdout',
          data: data.toString()
        });
      }
    });

    child.stderr.on('data', (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('process-output', {
          id,
          type: 'stderr',
          data: data.toString()
        });
      }
    });

    child.on('close', (code) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('process-exit', { id, code });
      }
      delete processes[id];
      delete processMeta[id];
    });

    child.on('error', (error) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('process-output', {
          id,
          type: 'stderr',
          data: `Erreur de processus: ${error.message || String(error)}`
        });
      }
    });

    return { success: true, allocatedPort };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('stop-process', async (event, id) => {
  try {
    if (!id || !processes[id]) {
      return { success: false, error: 'Processus introuvable' };
    }

    processes[id].kill();
    delete processes[id];
    delete processMeta[id];
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Settings
const getSettingsPath = () => path.join(app.getPath('userData'), 'settings.json');
const DEFAULT_GEMINI_MODEL = 'gemini-3-flash-preview';
const DEFAULT_KIMI_MODEL = 'moonshotai/Kimi-K2.5';
const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-6';
const DEFAULT_GEMINI_PRO_MODEL = 'gemini-3.1-pro-preview';
// Defaut concret (jamais ":latest" — alias ambigu supprime). La taille reelle
// est resolue dynamiquement cote UI selon la puissance machine.
const CANONICAL_QWEN_OLLAMA_MODEL = 'qwen3:8b';
const SUPPORTED_AI_PROVIDERS = new Set(['gemini', 'claude', 'kimi', 'ollama']);
const MULTI_AGENT_ROLE_DEFAULTS = Object.freeze({
  selector: { provider: 'gemini', model: DEFAULT_GEMINI_PRO_MODEL },
  captain: { provider: 'gemini', model: DEFAULT_GEMINI_PRO_MODEL },
  domain: { provider: 'gemini', model: DEFAULT_GEMINI_MODEL },
  ux: { provider: 'gemini', model: DEFAULT_GEMINI_MODEL },
  ui: { provider: 'kimi', model: DEFAULT_KIMI_MODEL },
  frontend: { provider: 'kimi', model: DEFAULT_KIMI_MODEL },
  apiData: { provider: 'kimi', model: DEFAULT_KIMI_MODEL },
  workflow: { provider: 'kimi', model: DEFAULT_KIMI_MODEL },
  security: { provider: 'claude', model: DEFAULT_CLAUDE_MODEL },
  qa: { provider: 'kimi', model: DEFAULT_KIMI_MODEL },
  gitRelease: { provider: 'kimi', model: DEFAULT_KIMI_MODEL }
});
const LEGACY_MULTI_AGENT_ROLE_KEY_MAP = {
  chef: 'captain',
  backend: 'apiData',
  architect: 'security',
  scrum: 'qa'
};

const normalizePreferredOllamaModelName = (value, fallback = CANONICAL_QWEN_OLLAMA_MODEL) => {
  const normalized = String(value || '').trim();
  const resolvedFallback = String(fallback || CANONICAL_QWEN_OLLAMA_MODEL).trim() || CANONICAL_QWEN_OLLAMA_MODEL;
  const candidate = normalized || resolvedFallback;

  // Migration: l'alias ":latest" est supprime. Toute ancienne valeur "<famille>:latest"
  // est convertie vers une taille concrete (8b) pour que le choix de l'utilisateur soit respecte.
  if (/:latest$/i.test(candidate)) {
    return candidate.replace(/:latest$/i, ':8b');
  }

  return candidate;
};

const normalizeAIProviderName = (value, fallback = 'gemini') => {
  const normalized = String(value || '').trim().toLowerCase();
  return SUPPORTED_AI_PROVIDERS.has(normalized) ? normalized : fallback;
};

const getDefaultModelForAIProvider = (provider) => {
  const normalizedProvider = normalizeAIProviderName(provider);
  if (normalizedProvider === 'claude') return DEFAULT_CLAUDE_MODEL;
  if (normalizedProvider === 'kimi') return DEFAULT_KIMI_MODEL;
  if (normalizedProvider === 'ollama') return CANONICAL_QWEN_OLLAMA_MODEL;
  return DEFAULT_GEMINI_MODEL;
};

const normalizeMultiAgentRoles = (raw = {}) => {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return Object.entries(MULTI_AGENT_ROLE_DEFAULTS).reduce((acc, [roleKey, defaults]) => {
    const legacyKey = Object.entries(LEGACY_MULTI_AGENT_ROLE_KEY_MAP)
      .find(([, nextKey]) => nextKey === roleKey)?.[0];
    const roleSource = source[roleKey] || source[legacyKey];
    const role = roleSource && typeof roleSource === 'object' ? roleSource : {};
    const provider = normalizeAIProviderName(role.provider, defaults.provider);
    const fallbackModel = defaults.model || getDefaultModelForAIProvider(provider);
    acc[roleKey] = {
      provider,
      model: String(role.model || fallbackModel || getDefaultModelForAIProvider(provider)).trim()
    };
    return acc;
  }, {});
};

const DEFAULT_APP_SETTINGS = Object.freeze({
  defaultProvider: 'gemini',
  thinkingMode: false,
  geminiModel: DEFAULT_GEMINI_MODEL,
  claudeModel: DEFAULT_CLAUDE_MODEL,
  kimiModel: DEFAULT_KIMI_MODEL,
  ollamaModel: CANONICAL_QWEN_OLLAMA_MODEL,
  ollamaModelArchitect: CANONICAL_QWEN_OLLAMA_MODEL,
  ollamaModelCoder: CANONICAL_QWEN_OLLAMA_MODEL,
  ollamaModelTester: CANONICAL_QWEN_OLLAMA_MODEL,
  multiAgentRoles: normalizeMultiAgentRoles(),
  devPort: '3004',
  allowDangerousActions: false,
  aiContextPreset: 'safe',
  aiContextIncludeSecrets: false,
  aiContextLargeFileStrategy: 'skip',
  aiTerminalApprovalMode: true,
  permissionMode: 'edit_terminal', // read_only | edit | edit_terminal
  qualityGateOnApply: false,
  qualityGateLint: true,
  qualityGateTest: false,
  qualityGateBuild: false,
  qualityGateBlockOnFail: true,
  onboardingCompleted: false,
  contextMode: 'auto', // auto | mentions | none
  contextMaxFiles: 120,
  localAIOptimizationMode: 'safe', // safe | auto | manual
  localAIHardwareConsent: false,
  localAIMaxConcurrentLocal: 1,
  localAIMaxConcurrentCloud: 3,
  localAIContextBudget: 'short', // short | medium | long
  localAIMaxTokens: 4096
});

const normalizePermissionMode = (value) => {
  const mode = String(value || '').trim();
  if (mode === 'read_only') return 'read_only';
  if (mode === 'edit') return 'edit';
  return 'edit_terminal';
};

const normalizeSettings = (raw) => {
  const base = raw && typeof raw === 'object' ? raw : {};
  const normalized = {
    ...DEFAULT_APP_SETTINGS,
    ...base
  };

  normalized.permissionMode = normalizePermissionMode(normalized.permissionMode);
  normalized.aiTerminalApprovalMode = normalized.aiTerminalApprovalMode !== false;
  normalized.qualityGateOnApply = !!normalized.qualityGateOnApply;
  normalized.qualityGateLint = normalized.qualityGateLint !== false;
  normalized.qualityGateTest = !!normalized.qualityGateTest;
  normalized.qualityGateBuild = !!normalized.qualityGateBuild;
  normalized.qualityGateBlockOnFail = normalized.qualityGateBlockOnFail !== false;

  const contextMode = String(normalized.contextMode || '').trim();
  normalized.contextMode = contextMode === 'mentions' || contextMode === 'none' ? contextMode : 'auto';

  const maxFiles = Number(normalized.contextMaxFiles);
  normalized.contextMaxFiles = Number.isFinite(maxFiles)
    ? Math.min(50000, Math.max(10, Math.floor(maxFiles)))
    : 120;

  const localMode = String(normalized.localAIOptimizationMode || 'safe').trim();
  normalized.localAIOptimizationMode = localMode === 'auto' || localMode === 'manual' ? localMode : 'safe';
  normalized.localAIHardwareConsent = !!normalized.localAIHardwareConsent;

  const localMax = Number(normalized.localAIMaxConcurrentLocal);
  normalized.localAIMaxConcurrentLocal = Number.isFinite(localMax)
    ? Math.min(4, Math.max(1, Math.floor(localMax)))
    : 1;

  const cloudMax = Number(normalized.localAIMaxConcurrentCloud);
  normalized.localAIMaxConcurrentCloud = Number.isFinite(cloudMax)
    ? Math.min(6, Math.max(1, Math.floor(cloudMax)))
    : 3;

  const localTokens = Number(normalized.localAIMaxTokens);
  normalized.localAIMaxTokens = Number.isFinite(localTokens)
    ? Math.min(8192, Math.max(512, Math.floor(localTokens)))
    : 4096;

  const localContextBudget = String(normalized.localAIContextBudget || 'short').trim();
  normalized.localAIContextBudget = ['short', 'medium', 'long'].includes(localContextBudget)
    ? localContextBudget
    : 'short';

  const devPort = String(normalized.devPort || '3004').trim();
  normalized.devPort = devPort || '3004';

  normalized.geminiModel = String(normalized.geminiModel || DEFAULT_GEMINI_MODEL).trim() || DEFAULT_GEMINI_MODEL;
  normalized.claudeModel = String(normalized.claudeModel || DEFAULT_CLAUDE_MODEL).trim() || DEFAULT_CLAUDE_MODEL;
  normalized.kimiModel = String(normalized.kimiModel || DEFAULT_KIMI_MODEL).trim() || DEFAULT_KIMI_MODEL;

  normalized.ollamaModel = normalizePreferredOllamaModelName(
    normalized.ollamaModel,
    DEFAULT_APP_SETTINGS.ollamaModel
  );
  normalized.ollamaModelArchitect = normalizePreferredOllamaModelName(
    normalized.ollamaModelArchitect,
    normalized.ollamaModel
  );
  normalized.ollamaModelCoder = normalizePreferredOllamaModelName(
    normalized.ollamaModelCoder,
    normalized.ollamaModel
  );
  normalized.ollamaModelTester = normalizePreferredOllamaModelName(
    normalized.ollamaModelTester,
    normalized.ollamaModel
  );
  normalized.multiAgentRoles = normalizeMultiAgentRoles(normalized.multiAgentRoles);

  const preset = String(normalized.aiContextPreset || 'safe');
  normalized.aiContextPreset = preset === 'full' || preset === 'god' ? preset : 'safe';

  const largeFileStrategy = String(normalized.aiContextLargeFileStrategy || 'skip');
  normalized.aiContextLargeFileStrategy = largeFileStrategy === 'truncate' ? 'truncate' : 'skip';

  return normalized;
};

const readSettingsSafe = async () => {
  try {
    const settingsPath = getSettingsPath();
    if (!fsSync.existsSync(settingsPath)) {
      return normalizeSettings({});
    }
    const content = await fs.readFile(settingsPath, 'utf8');
    const parsed = JSON.parse(content);
    return normalizeSettings(parsed);
  } catch {
    return normalizeSettings({});
  }
};

const canEditFiles = (permissionMode) =>
  permissionMode === 'edit' || permissionMode === 'edit_terminal';

const canUseTerminal = (permissionMode) =>
  permissionMode === 'edit_terminal';

const ensureEditPermission = async () => {
  const settings = await readSettingsSafe();
  if (!canEditFiles(settings.permissionMode)) {
    throw new Error('Le mode permissions actuel est en lecture seule.');
  }
  return settings;
};

const ensureTerminalPermission = async () => {
  const settings = await readSettingsSafe();
  if (!canUseTerminal(settings.permissionMode)) {
    throw new Error("Le mode permissions actuel n'autorise pas le terminal.");
  }
  return settings;
};

const TERMINAL_ALLOWED_COMMANDS = new Set([
  'npm', 'npx', 'node',
  'git',
  'python', 'py',
  'go', 'cargo', 'rustc', 'gradlew', 'mvn',
  'ollama',
  'curl',
  'ls', 'dir', 'cat', 'type', 'echo', 'mkdir',
  'n8n-search', 'n8n-import'
]);
const TERMINAL_DANGEROUS_COMMAND_PATTERNS = /(rm\s+-rf|del\s+\/[a-z]+|rmdir\s+\/[a-z]+|format\s+|shutdown|reboot|halt|mkfs|diskpart|git\s+reset\s+--hard|git\s+clean\s+-fd|:\(\)\{:\|:&\};:)/i;
const TERMINAL_CONTROL_OPERATOR_PATTERNS = /(&&|\|\||[|;&`<>]|\r|\n|\$\()/;
const MAX_CMD_OUTPUT = 4000;

const normalizeCommandName = (command) => {
  const base = path.basename(String(command || '').trim()).toLowerCase();
  return base.replace(/\.(cmd|exe|bat|ps1)$/i, '');
};

const tokenizeCommandLine = (commandLine) => {
  const text = String(commandLine || '').trim();
  const tokens = [];
  let current = '';
  let quote = null;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\' && quote) {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }
  if (quote) throw new Error('Guillemets non fermes');
  if (escaped) current += '\\';
  if (current) tokens.push(current);
  return tokens;
};

const buildCommandTokens = (command, args = []) => {
  const rawCommand = String(command || '').trim();
  const safeArgs = Array.isArray(args) ? args.map((arg) => String(arg ?? '')) : [];
  if (!rawCommand) throw new Error('Commande vide');
  if (safeArgs.length > 0) {
    if (/\s/.test(rawCommand) || TERMINAL_CONTROL_OPERATOR_PATTERNS.test(rawCommand)) {
      throw new Error('Commande invalide avec arguments separes');
    }
    return [rawCommand, ...safeArgs];
  }
  return tokenizeCommandLine(rawCommand);
};

const validateCommandTokens = (tokens) => {
  if (!Array.isArray(tokens) || tokens.length === 0) {
    throw new Error('Commande vide');
  }
  const normalizedCommandLine = tokens.join(' ').trim();
  if (TERMINAL_CONTROL_OPERATOR_PATTERNS.test(normalizedCommandLine)) {
    throw new Error('Operateurs shell interdits (&&, |, ;, redirections, etc.)');
  }
  if (TERMINAL_DANGEROUS_COMMAND_PATTERNS.test(normalizedCommandLine)) {
    throw new Error('Commande jugee dangereuse');
  }

  const commandName = normalizeCommandName(tokens[0]);
  if (!TERMINAL_ALLOWED_COMMANDS.has(commandName)) {
    throw new Error(`Commande non autorisee: ${tokens[0]}`);
  }
  return { commandName, normalizedCommandLine };
};

const resolveExecutableForPlatform = (commandName) => {
  if (process.platform === 'win32') {
    if (commandName === 'npm') return 'npm.cmd';
    if (commandName === 'npx') return 'npx.cmd';
    if (commandName === 'gradlew') return 'gradlew.bat';
  }
  return commandName;
};

const buildSafeSpawnRequest = (command, args = []) => {
  const tokens = buildCommandTokens(command, args);
  const { commandName, normalizedCommandLine } = validateCommandTokens(tokens);
  return {
    executable: resolveExecutableForPlatform(commandName),
    args: tokens.slice(1),
    commandName,
    normalizedCommandLine
  };
};

const isUrlLikeToken = (value) => /^[a-z][a-z0-9+.-]*:\/\//i.test(String(value || ''));

const validateCommandPathTokenForWorkspace = (value, workspaceRoot) => {
  const raw = String(value || '').trim();
  if (!raw || isUrlLikeToken(raw)) return;
  const candidates = raw.includes('=') ? [raw.slice(raw.indexOf('=') + 1)] : [raw];
  for (const candidate of candidates) {
    const token = String(candidate || '').trim();
    if (!token || isUrlLikeToken(token)) continue;
    const normalized = token.replace(/\\/g, '/');
    const looksPathLike = normalized.includes('/') || normalized.startsWith('.') || /^[a-zA-Z]:\//.test(normalized) || normalized.startsWith('~');
    if (!looksPathLike) continue;
    if (path.isAbsolute(token) || /^[a-zA-Z]:\//.test(normalized) || normalized.startsWith('~')) {
      throw new Error(`Chemin absolu interdit dans la commande: ${token}`);
    }
    if (normalized === '..' || normalized.startsWith('../') || normalized.includes('/../') || normalized.endsWith('/..')) {
      throw new Error(`Chemin hors workspace interdit dans la commande: ${token}`);
    }
    const resolved = path.resolve(workspaceRoot, token);
    assertSafePath(workspaceRoot, resolved);
  }
};

const validateCommandArgsWithinWorkspace = (spawnRequest, workspaceRoot) => {
  const args = Array.isArray(spawnRequest?.args) ? spawnRequest.args : [];
  for (const arg of args) {
    validateCommandPathTokenForWorkspace(arg, workspaceRoot);
  }
};

ipcMain.handle('save-settings', async (event, settings) => {
  try {
    const normalized = normalizeSettings(settings);
    await fs.mkdir(app.getPath('userData'), { recursive: true });
    await fs.writeFile(getSettingsPath(), JSON.stringify(normalized, null, 2), 'utf8');
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('load-settings', async () => {
  try {
    const settings = await readSettingsSafe();
    return { success: true, settings };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

const readWindowsGpuInfo = () => new Promise((resolve) => {
  if (process.platform !== 'win32') {
    resolve([]);
    return;
  }

  const child = spawn('wmic', ['path', 'win32_VideoController', 'get', 'Name,AdapterRAM', '/format:csv'], {
    windowsHide: true
  });
  let stdout = '';
  let stderr = '';
  let finished = false;

  const done = (items) => {
    if (finished) return;
    finished = true;
    try { child.kill(); } catch { /* ignore */ }
    resolve(items);
  };

  const timer = setTimeout(() => done([]), 2500);
  child.stdout?.on('data', (data) => { stdout += String(data); });
  child.stderr?.on('data', (data) => { stderr += String(data); });
  child.on('error', () => {
    clearTimeout(timer);
    done([]);
  });
  child.on('close', () => {
    clearTimeout(timer);
    if (stderr && !stdout) {
      done([]);
      return;
    }
    const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const items = lines
      .filter((line) => !/^Node,/i.test(line))
      .map((line) => {
        const parts = line.split(',');
        const adapterRam = Number(parts[1]);
        const name = parts.slice(2).join(',').trim();
        return {
          name,
          vramGb: Number.isFinite(adapterRam) && adapterRam > 0
            ? Number((adapterRam / 1024 / 1024 / 1024).toFixed(1))
            : null
        };
      })
      .filter((item) => item.name);
    done(items);
  });
});

ipcMain.handle('get-system-ai-profile', async (_event, options = {}) => {
  try {
    const settings = await readSettingsSafe();
    const explicitConsent = options?.consent === true;
    if (!explicitConsent && (settings.localAIOptimizationMode !== 'auto' || !settings.localAIHardwareConsent)) {
      return {
        success: false,
        denied: true,
        error: 'Lecture hardware non autorisee. Activez Auto-adaptatif avec consentement explicite.'
      };
    }

    const cpus = os.cpus() || [];
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const gpus = await readWindowsGpuInfo();
    let ollama = { available: false, models: [], error: null };
    try {
      const ollamaResponse = await fetchOllamaTags(OLLAMA_BASE_URL, 2500);
      const models = (ollamaResponse.data?.models || []).map((model) => ({
        name: model.name,
        size: model.size,
        sizeGb: Number.isFinite(Number(model.size))
          ? Number((Number(model.size) / 1024 / 1024 / 1024).toFixed(2))
          : null,
        modified: model.modified_at
      }));
      ollama = { available: true, models, error: null };
    } catch (error) {
      ollama = {
        available: false,
        models: [],
        error: error.message
      };
    }
    const ramGb = Number((totalMem / 1024 / 1024 / 1024).toFixed(1));
    const profile = ramGb >= 64 ? 'Workstation' : ramGb >= 32 ? 'High' : ramGb >= 16 ? 'Standard' : 'Low';

    return {
      success: true,
      profile,
      os: {
        platform: process.platform,
        arch: process.arch,
        release: os.release()
      },
      cpu: {
        cores: cpus.length,
        model: cpus[0]?.model || 'unknown'
      },
      memory: {
        totalGb: ramGb,
        freeGb: Number((freeMem / 1024 / 1024 / 1024).toFixed(1))
      },
      gpu: gpus,
      ollama
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Chemin de base pour les projets de l'IDE (utilisé par défaut si aucun dossier n'est ouvert)
const getDefaultProjectsDir = () => {
  return path.join(app.getPath('userData'), 'IDE_Projects');
};

let cspInstalled = false;

const buildElectronContentSecurityPolicy = () => {
  const scriptSrc = isDev
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net"
    : "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net";
  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net",
    "img-src 'self' data: blob: file: https://cdn.jsdelivr.net",
    "font-src 'self' data: https://fonts.gstatic.com https://cdn.jsdelivr.net",
    "connect-src 'self' https://generativelanguage.googleapis.com https://api.together.xyz https://api.anthropic.com http://localhost:* ws://localhost:* http://127.0.0.1:* ws://127.0.0.1:*",
    "frame-src 'self' data: blob: http://localhost:* http://127.0.0.1:*",
    "worker-src 'self' blob: https://cdn.jsdelivr.net",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'"
  ].join('; ');
};

const installContentSecurityPolicy = () => {
  if (cspInstalled) return;
  cspInstalled = true;
  const csp = buildElectronContentSecurityPolicy();
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp]
      }
    });
  });
};

const isAllowedAppNavigationUrl = (targetUrl) => {
  try {
    const parsed = new URL(String(targetUrl || ''));
    if (isDev) {
      return parsed.protocol === 'http:' && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') && parsed.port === '3004';
    }
    return parsed.protocol === 'file:';
  } catch {
    return false;
  }
};

async function createWindow() {
  await logger.info('Début de la création de la fenêtre principale');
  installContentSecurityPolicy();

  // Chemin correct pour preload.js
  const preloadPath = path.join(__dirname, 'preload.js');
  await logger.info('Chemin du script de préchargement:', { path: preloadPath });

  // Vérifier si le fichier de préchargement existe
  const preloadExists = fsSync.existsSync(preloadPath);
  await logger.info(`Le fichier de préchargement existe: ${preloadExists}`);

  if (!preloadExists) {
    await logger.error('Le fichier de préchargement est introuvable', { path: preloadPath });
    dialog.showErrorBox('Erreur de démarrage', 'Le fichier preload.js est introuvable. L\'application ne peut pas démarrer correctement.');
    app.quit();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    },
    icon: path.join(__dirname, 'assets', 'iconeDesktop.png')
  });

  createAppMenu();

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url).catch(() => { /* ignore */ });
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isAllowedAppNavigationUrl(url)) return;
    event.preventDefault();
    shell.openExternal(url).catch(() => { /* ignore */ });
  });

  // Crée le dossier des projets par défaut s'il n'existe pas
  try {
    await fs.mkdir(getDefaultProjectsDir(), { recursive: true });
    trustProjectPath(getDefaultProjectsDir());
    await logger.info(`Dossier des projets par défaut créé ou déjà existant: ${getDefaultProjectsDir()}`);
  } catch (error) {
    await logger.error('Erreur lors de la création du dossier des projets par défaut', { error: error.message });
    dialog.showErrorBox('Erreur de démarrage', `Impossible de créer le dossier des projets par défaut: ${error.message}`);
    app.quit();
    return;
  }

  // Charge l'application React
  if (isDev) {
    const appUrl = process.env.ELECTRON_DEV_SERVER_URL || 'http://127.0.0.1:3004';
    console.log(`[Main] 4. Chargement de l'application depuis: ${appUrl}`);
    await logger.info('Chargement de l\'application', { url: appUrl });
    mainWindow.loadURL(appUrl);
  } else {
    const indexPath = path.join(__dirname, 'client', 'build', 'index.html');
    const indexExists = fsSync.existsSync(indexPath);
    await logger.info('Chargement de l\'application (prod)', { indexPath, indexExists });
    if (!indexExists) {
      dialog.showErrorBox('Erreur de chargement', `index.html introuvable: ${indexPath}`);
    } else {
      mainWindow.loadFile(indexPath);
    }
  }

  // Ouvre les outils de développement (DevTools).
  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  // --- Menu Contextuel Natif (Clic Droit) ---
  mainWindow.webContents.on('context-menu', (event, params) => {
    const contextMenuTemplate = [
      { role: 'cut', label: 'Couper' },
      { role: 'copy', label: 'Copier' },
      { role: 'paste', label: 'Coller' },
      { type: 'separator' },
      { role: 'selectAll', label: 'Tout sélectionner' }
    ];

    if (isDev) {
      contextMenuTemplate.push({ type: 'separator' });
      contextMenuTemplate.push({
        label: 'Inspecter l\'élément',
        click: () => {
          mainWindow.webContents.inspectElement(params.x, params.y);
        }
      });
    }

    const contextMenu = Menu.buildFromTemplate(contextMenuTemplate);
    contextMenu.popup({ window: mainWindow });
  });

  // Événements de débogage
  mainWindow.webContents.on('did-finish-load', async () => {
    await logger.info('Contenu de la fenêtre chargé avec succès');

    // Vérification simplifiée de l'API
    // Suppression du "return" direct pour éviter "Illegal return statement"
    const checkAPI = `
      try {
        const apiExists = typeof window.electronAPI !== 'undefined';
        const methods = apiExists ? Object.keys(window.electronAPI) : [];
        console.log('[RENDERER] API disponible:', apiExists, 'Méthodes:', methods);
      } catch (e) {
        console.error('[RENDERER] Erreur vérification API:', e);
      }
    `;

    // Exécuter la vérification
    mainWindow.webContents.executeJavaScript(checkAPI)
      .catch(err => {
        console.error('[Main] Erreur lors de l\'exécution du script de vérification API dans le rendu:', err);
      });
  });

  mainWindow.webContents.on('console-message', (event, level, message) => {
    // Redirige les messages console du processus de rendu vers le processus principal
    console.log(`[RENDERER CONSOLE ${level}] ${message}`);
  });

  mainWindow.webContents.on('render-process-gone', async (event, details) => {
    await logger.error('Renderer process gone', details);
    dialog.showErrorBox('Erreur Renderer', `Le processus UI s'est arrêté: ${details.reason}`);
  });

  mainWindow.webContents.on('unresponsive', async () => {
    await logger.warn('Fenêtre non responsive');
  });

  mainWindow.webContents.on('crashed', async () => {
    await logger.error('Renderer crashed');
  });

  // N'affiche une boîte d'erreur que si l'échec concerne le frame principal
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    console.error(`[Main] Échec du chargement: ${errorCode} - ${errorDescription} pour ${validatedURL}`);
    if (!isMainFrame) {
      // Évite d'alerter l'utilisateur pour les iframes (ex: Live Preview)
      return;
    }
    dialog.showErrorBox('Erreur de chargement', `Impossible de charger la page: ${errorDescription}. Vérifiez que le serveur React est lancé (npm run start-react).`);
  });

  await logger.info('Fenêtre principale créée avec succès');
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// --- IPC Handlers pour les opérations sur les fichiers ---

// Ouvre un dialogue de sélection de dossier
ipcMain.handle('open-folder-dialog', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  if (canceled) {
    return { success: true, path: null }; // Annulé
  } else {
    const trustedPath = trustProjectPath(filePaths[0]);
    return { success: true, path: trustedPath }; // Retourne le chemin du dossier sélectionné
  }
});

ipcMain.handle('authorize-project-path', async (event, projectPath) => {
  try {
    return await requestProjectPathApproval(projectPath);
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Lister tous les fichiers et dossiers dans un répertoire donné avec structure hiérarchique
ipcMain.handle('get-all-files', async (event, folderPath) => {
  try {
    const trustedFolderPath = await ensureTrustedProjectPath(folderPath);
    async function buildFileTree(dirPath, relativePath = '') {
      const items = await fs.readdir(dirPath, { withFileTypes: true });
      const treeItems = [];

      for (const item of items) {
        const itemPath = path.join(dirPath, item.name);
        const relativeItemPath = relativePath ? path.join(relativePath, item.name) : item.name;

        if (item.isDirectory()) {
          // Pour les dossiers, on crée la structure sans charger les enfants immédiatement
          treeItems.push({
            name: item.name,
            type: 'directory',
            path: relativeItemPath,
            fullPath: itemPath,
            children: [], // Sera chargé à la demande
            hasChildren: true // Indicateur qu'il peut avoir des enfants
          });
        } else {
          treeItems.push({
            name: item.name,
            type: 'file',
            path: relativeItemPath,
            fullPath: itemPath
          });
        }
      }

      return treeItems;
    }

    const projectItems = await buildFileTree(trustedFolderPath);
    return { success: true, items: projectItems };
  } catch (error) {
    console.error('Erreur lors de la lecture du dossier:', error);
    return { success: false, error: error.message };
  }
});

// Nouvelle fonction pour charger les enfants d'un dossier spécifique
ipcMain.handle('get-folder-children', async (event, projectPath, folderPath) => {
  try {
    const trustedProjectPath = await ensureTrustedProjectPath(projectPath);
    if (!folderPath || typeof folderPath !== 'string') {
      return { success: false, error: 'Chemin du dossier manquant' };
    }

    const basePath = trustedProjectPath;
    const resolvedFolderPath = path.isAbsolute(folderPath)
      ? folderPath
      : path.join(trustedProjectPath, folderPath);
    assertSafePath(trustedProjectPath, resolvedFolderPath);

    async function getChildren(dirPath) {
      const items = await fs.readdir(dirPath, { withFileTypes: true });
      const children = [];

      for (const item of items) {
        const itemPath = path.join(dirPath, item.name);
        const relativeItemPath = basePath ? path.relative(basePath, itemPath) : item.name;

        if (item.isDirectory()) {
          children.push({
            name: item.name,
            type: 'directory',
            path: relativeItemPath,
            fullPath: itemPath,
            children: [],
            hasChildren: true
          });
        } else {
          children.push({
            name: item.name,
            type: 'file',
            path: relativeItemPath,
            fullPath: itemPath
          });
        }
      }

      return children;
    }

    const children = await getChildren(resolvedFolderPath);
    return { success: true, children };
  } catch (error) {
    console.error('Erreur lors de la lecture des enfants du dossier:', error);
    return { success: false, error: error.message };
  }
});

// Lister les fichiers d'un projet (liste plate) - utile pour Ctrl+P / index
ipcMain.handle('list-project-files', async (event, projectPath, options = {}) => {
  try {
    if (!projectPath) {
      return { success: false, error: 'Chemin du projet non fourni' };
    }
    const trustedProjectPath = await ensureTrustedProjectPath(projectPath);

    const safeOptions = options && typeof options === 'object' ? options : {};
    const includeHidden = !!safeOptions.includeHidden;
    const includeSecrets = !!safeOptions.includeSecrets;
    const includeGit = !!safeOptions.includeGit;
    const includeNodeModules = !!safeOptions.includeNodeModules;
    const includeBuild = !!safeOptions.includeBuild;

    const clampNumber = (value, min, max, fallback) => {
      const n = Number(value);
      if (!Number.isFinite(n)) return fallback;
      return Math.min(max, Math.max(min, n));
    };

    const maxFiles = clampNumber(safeOptions.maxFiles, 200, 500000, 30000);
    const maxDepth = clampNumber(safeOptions.maxDepth, 2, 60, 40);

    const files = [];
    let skippedCount = 0;
    let hitLimit = false;

    const textExtensions = new Set([
      '.js', '.jsx', '.ts', '.tsx',
      '.html', '.css', '.scss', '.sass', '.less',
      '.json', '.md', '.txt',
      '.py', '.java', '.cpp', '.c', '.h', '.hpp', '.php', '.rb', '.go', '.rs',
      '.xml', '.yml', '.yaml', '.sql',
      '.sh', '.bat', '.ps1',
      '.vue', '.svelte', '.astro',
      '.toml', '.ini', '.conf', '.config'
    ]);

    const textFileNames = new Set([
      'readme', 'readme.md', 'license', 'licence',
      'dockerfile', 'makefile',
      '.gitignore', '.gitattributes', '.editorconfig', '.npmrc', '.nvmrc',
      '.prettierrc', '.eslintrc', '.babelrc',
      '.env.example', '.env.sample', '.env.template', '.env.dist'
    ]);

    const isSensitiveFileName = (name) => {
      const lower = String(name || '').toLowerCase();
      if (lower === '.env') return true;
      if (lower.startsWith('.env.')) {
        if (lower === '.env.example') return false;
        if (lower === '.env.sample') return false;
        if (lower === '.env.template') return false;
        if (lower === '.env.dist') return false;
        return true;
      }
      if (lower.endsWith('.pem')) return true;
      if (lower.endsWith('.key')) return true;
      if (lower.endsWith('.pfx')) return true;
      if (lower.endsWith('.p12')) return true;
      if (lower.endsWith('.jks')) return true;
      if (lower.endsWith('.keystore')) return true;
      if (lower.includes('id_rsa')) return true;
      if (lower.includes('id_ed25519')) return true;
      return false;
    };

    const shouldSkipDirectory = (name) => {
      if (!name) return true;
      if (!includeGit && name === '.git') return true;
      if (!includeNodeModules && name === 'node_modules') return true;
      if (
        !includeBuild &&
        (name === 'dist' ||
          name === 'build' ||
          name === 'out' ||
          name === '.next' ||
          name === 'coverage' ||
          name === '.turbo' ||
          name === '.cache' ||
          name === '.parcel-cache')
      ) {
        return true;
      }
      return false;
    };

    const shouldReadAsText = (name) => {
      const lower = String(name || '').toLowerCase();
      if (textFileNames.has(lower)) return true;
      const ext = path.extname(lower);
      if (textExtensions.has(ext)) return true;
      return false;
    };

    async function walk(dirPath, relativePath = '', depth = 0) {
      if (hitLimit) return;
      if (depth > maxDepth) return;

      let items;
      try {
        items = await fs.readdir(dirPath, { withFileTypes: true });
      } catch {
        skippedCount += 1;
        return;
      }

      for (const item of items) {
        if (hitLimit) return;

        if (item.isSymbolicLink && item.isSymbolicLink()) {
          skippedCount += 1;
          continue;
        }

        const itemName = item.name;
        if (!itemName) continue;

        if (!includeHidden && itemName.startsWith('.')) {
          skippedCount += 1;
          continue;
        }

        if (!includeSecrets && isSensitiveFileName(itemName)) {
          skippedCount += 1;
          continue;
        }

        if (itemName.endsWith('.log') || itemName.endsWith('.tmp')) {
          skippedCount += 1;
          continue;
        }

        const fullPath = path.join(dirPath, itemName);
        const relativeFilePath = path.join(relativePath, itemName);

        if (item.isDirectory()) {
          if (shouldSkipDirectory(itemName)) {
            skippedCount += 1;
            continue;
          }
          await walk(fullPath, relativeFilePath, depth + 1);
          continue;
        }

        if (!item.isFile()) {
          skippedCount += 1;
          continue;
        }

        if (!shouldReadAsText(itemName)) {
          continue;
        }

        files.push(relativeFilePath);
        if (files.length >= maxFiles) {
          hitLimit = true;
          return;
        }
      }
    }

    await walk(trustedProjectPath);

    return {
      success: true,
      files,
      stats: {
        fileCount: files.length,
        skippedCount,
        hitLimit,
        options: {
          includeHidden,
          includeSecrets,
          includeGit,
          includeNodeModules,
          includeBuild,
          maxFiles,
          maxDepth
        }
      }
    };
  } catch (error) {
    console.error('Erreur list-project-files:', error);
    return { success: false, error: error.message };
  }
});

// Recherche globale dans le projet
ipcMain.handle('search-in-project', async (event, projectPath, query, options = {}) => {
  try {
    if (!projectPath) {
      return { success: false, error: 'Chemin du projet non fourni' };
    }
    const trustedProjectPath = await ensureTrustedProjectPath(projectPath);

    const q = String(query || '');
    if (!q.trim()) {
      return { success: true, results: [], stats: { matches: 0, scannedFiles: 0, hitLimit: false } };
    }

    const safeOptions = options && typeof options === 'object' ? options : {};
    const includeHidden = !!safeOptions.includeHidden;
    const includeSecrets = !!safeOptions.includeSecrets;
    const includeGit = !!safeOptions.includeGit;
    const includeNodeModules = !!safeOptions.includeNodeModules;
    const includeBuild = !!safeOptions.includeBuild;
    const caseSensitive = !!safeOptions.caseSensitive;

    const clampNumber = (value, min, max, fallback) => {
      const n = Number(value);
      if (!Number.isFinite(n)) return fallback;
      return Math.min(max, Math.max(min, n));
    };

    const maxMatches = clampNumber(safeOptions.maxMatches, 50, 50000, 800);
    const maxFileSize = clampNumber(safeOptions.maxFileSize, 5000, 5000000, 800000);
    const maxDepth = clampNumber(safeOptions.maxDepth, 2, 60, 40);

    const results = [];
    let scannedFiles = 0;
    let matches = 0;
    let hitLimit = false;

    const needle = caseSensitive ? q : q.toLowerCase();

    const textExtensions = new Set([
      '.js', '.jsx', '.ts', '.tsx',
      '.html', '.css', '.scss', '.sass', '.less',
      '.json', '.md', '.txt',
      '.py', '.java', '.cpp', '.c', '.h', '.hpp', '.php', '.rb', '.go', '.rs',
      '.xml', '.yml', '.yaml', '.sql',
      '.sh', '.bat', '.ps1',
      '.vue', '.svelte', '.astro',
      '.toml', '.ini', '.conf', '.config'
    ]);

    const textFileNames = new Set([
      'readme', 'readme.md', 'license', 'licence',
      'dockerfile', 'makefile',
      '.gitignore', '.gitattributes', '.editorconfig', '.npmrc', '.nvmrc',
      '.prettierrc', '.eslintrc', '.babelrc',
      '.env.example', '.env.sample', '.env.template', '.env.dist'
    ]);

    const isSensitiveFileName = (name) => {
      const lower = String(name || '').toLowerCase();
      if (lower === '.env') return true;
      if (lower.startsWith('.env.')) {
        if (lower === '.env.example') return false;
        if (lower === '.env.sample') return false;
        if (lower === '.env.template') return false;
        if (lower === '.env.dist') return false;
        return true;
      }
      if (lower.endsWith('.pem')) return true;
      if (lower.endsWith('.key')) return true;
      if (lower.endsWith('.pfx')) return true;
      if (lower.endsWith('.p12')) return true;
      if (lower.endsWith('.jks')) return true;
      if (lower.endsWith('.keystore')) return true;
      if (lower.includes('id_rsa')) return true;
      if (lower.includes('id_ed25519')) return true;
      return false;
    };

    const shouldSkipDirectory = (name) => {
      if (!name) return true;
      if (!includeGit && name === '.git') return true;
      if (!includeNodeModules && name === 'node_modules') return true;
      if (
        !includeBuild &&
        (name === 'dist' ||
          name === 'build' ||
          name === 'out' ||
          name === '.next' ||
          name === 'coverage' ||
          name === '.turbo' ||
          name === '.cache' ||
          name === '.parcel-cache')
      ) {
        return true;
      }
      return false;
    };

    const shouldReadAsText = (name) => {
      const lower = String(name || '').toLowerCase();
      if (textFileNames.has(lower)) return true;
      const ext = path.extname(lower);
      if (textExtensions.has(ext)) return true;
      return false;
    };

    const addResult = (relativeFilePath, lineNumber, column, lineText) => {
      results.push({
        file: relativeFilePath,
        line: lineNumber,
        column,
        text: String(lineText || '').slice(0, 400)
      });
      matches += 1;
      if (matches >= maxMatches) {
        hitLimit = true;
      }
    };

    async function searchFile(fullPath, relativeFilePath) {
      if (hitLimit) return;

      let stats;
      try {
        stats = await fs.stat(fullPath);
      } catch {
        return;
      }

      if (stats.size > maxFileSize) {
        return;
      }

      scannedFiles += 1;

      const stream = fsSync.createReadStream(fullPath, { encoding: 'utf8' });
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

      try {
        let lineNumber = 0;
        for await (const line of rl) {
          if (hitLimit) break;
          lineNumber += 1;
          const hay = caseSensitive ? String(line) : String(line).toLowerCase();
          const idx = hay.indexOf(needle);
          if (idx !== -1) {
            addResult(relativeFilePath, lineNumber, idx + 1, line);
          }
        }
      } catch {
        // ignore
      } finally {
        try {
          rl.close();
        } catch {
          // ignore
        }
        try {
          stream.destroy();
        } catch {
          // ignore
        }
      }
    }

    async function walk(dirPath, relativePath = '', depth = 0) {
      if (hitLimit) return;
      if (depth > maxDepth) return;

      let items;
      try {
        items = await fs.readdir(dirPath, { withFileTypes: true });
      } catch {
        return;
      }

      for (const item of items) {
        if (hitLimit) return;

        if (item.isSymbolicLink && item.isSymbolicLink()) {
          continue;
        }

        const itemName = item.name;
        if (!itemName) continue;

        if (!includeHidden && itemName.startsWith('.')) {
          continue;
        }

        if (!includeSecrets && isSensitiveFileName(itemName)) {
          continue;
        }

        if (itemName.endsWith('.log') || itemName.endsWith('.tmp')) {
          continue;
        }

        const fullPath = path.join(dirPath, itemName);
        const relativeFilePath = path.join(relativePath, itemName);

        if (item.isDirectory()) {
          if (shouldSkipDirectory(itemName)) {
            continue;
          }
          await walk(fullPath, relativeFilePath, depth + 1);
          continue;
        }

        if (!item.isFile()) {
          continue;
        }

        if (!shouldReadAsText(itemName)) {
          continue;
        }

        await searchFile(fullPath, relativeFilePath);
      }
    }

    await walk(trustedProjectPath);

    return {
      success: true,
      results,
      stats: {
        matches,
        scannedFiles,
        hitLimit,
        options: {
          includeHidden,
          includeSecrets,
          includeGit,
          includeNodeModules,
          includeBuild,
          caseSensitive,
          maxMatches,
          maxFileSize,
          maxDepth
        }
      }
    };
  } catch (error) {
    console.error('Erreur search-in-project:', error);
    return { success: false, error: error.message };
  }
});

// Recherche de symboles (fonctions/classes/exports) dans le projet
ipcMain.handle('search-symbols', async (event, projectPath, query, options = {}) => {
  try {
    if (!projectPath) {
      return { success: false, error: 'Chemin du projet non fourni' };
    }
    const trustedProjectPath = await ensureTrustedProjectPath(projectPath);

    const q = String(query || '').trim().toLowerCase();
    if (!q) {
      return { success: true, results: [] };
    }

    const safeOptions = options && typeof options === 'object' ? options : {};
    const maxResults = Math.min(5000, Math.max(20, Number(safeOptions.maxResults) || 300));
    const maxDepth = Math.min(50, Math.max(2, Number(safeOptions.maxDepth) || 25));

    const textExtensions = new Set([
      '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
      '.py', '.java', '.go', '.rs', '.php', '.rb',
      '.json', '.md', '.yml', '.yaml'
    ]);

    const shouldSkipDirectory = (name) => {
      const lower = String(name || '').toLowerCase();
      return (
        lower === '.git' ||
        lower === 'node_modules' ||
        lower === 'dist' ||
        lower === 'build' ||
        lower === 'out' ||
        lower === '.next' ||
        lower === 'coverage'
      );
    };

    const symbolMatchers = [
      { kind: 'function', regex: /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/ },
      { kind: 'class', regex: /^\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/ },
      { kind: 'const', regex: /^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*/ },
      { kind: 'let', regex: /^\s*(?:export\s+)?let\s+([A-Za-z_$][\w$]*)\s*=\s*/ },
      { kind: 'type', regex: /^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/ },
      { kind: 'interface', regex: /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/ },
      { kind: 'enum', regex: /^\s*(?:export\s+)?enum\s+([A-Za-z_$][\w$]*)/ },
      { kind: 'default', regex: /^\s*export\s+default\s+(?:function|class)?\s*([A-Za-z_$][\w$]*)?/ }
    ];

    const results = [];
    let hitLimit = false;

    const walk = async (dirPath, relativePath = '', depth = 0) => {
      if (hitLimit) return;
      if (depth > maxDepth) return;

      let entries;
      try {
        entries = await fs.readdir(dirPath, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (hitLimit) return;
        const fullPath = path.join(dirPath, entry.name);
        const relPath = relativePath ? path.join(relativePath, entry.name) : entry.name;

        if (entry.isDirectory()) {
          if (shouldSkipDirectory(entry.name)) continue;
          await walk(fullPath, relPath, depth + 1);
          continue;
        }

        if (!entry.isFile()) continue;
        const ext = path.extname(entry.name).toLowerCase();
        if (!textExtensions.has(ext)) continue;

        let content = '';
        try {
          const stat = await fs.stat(fullPath);
          if (stat.size > 1_200_000) continue;
          content = await fs.readFile(fullPath, 'utf-8');
        } catch {
          continue;
        }

        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i += 1) {
          const line = lines[i];
          for (const matcher of symbolMatchers) {
            const match = line.match(matcher.regex);
            if (!match) continue;
            const symbol = (match[1] || 'default').trim();
            if (!symbol.toLowerCase().includes(q)) continue;

            results.push({
              file: relPath.replace(/\\/g, '/'),
              line: i + 1,
              column: Math.max(1, line.indexOf(symbol) + 1),
              kind: matcher.kind,
              symbol,
              text: line.trim()
            });

            if (results.length >= maxResults) {
              hitLimit = true;
              return;
            }
          }
        }
      }
    };

    await walk(trustedProjectPath);

    return {
      success: true,
      results,
      stats: {
        count: results.length,
        hitLimit,
        maxResults,
        maxDepth
      }
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ExÃ©cute des quality gates (lint/test/build) avant application de modifications IA
ipcMain.handle('run-quality-gates', async (event, projectPath, options = {}) => {
  try {
    if (!projectPath) return { success: false, error: 'Chemin projet manquant' };
    const trustedProjectPath = await ensureTrustedProjectPath(projectPath);
    await ensureTerminalPermission();

    const settings = await readSettingsSafe();
    const safeOptions = options && typeof options === 'object' ? options : {};

    const enabled = {
      lint: safeOptions.lint ?? settings.qualityGateLint,
      test: safeOptions.test ?? settings.qualityGateTest,
      build: safeOptions.build ?? settings.qualityGateBuild
    };
    const blockOnFail = safeOptions.blockOnFail ?? settings.qualityGateBlockOnFail;
    const timeoutMs = Math.min(900000, Math.max(30000, Number(safeOptions.timeoutMs) || 180000));

    const gates = [];
    if (enabled.lint) gates.push({ id: 'lint', command: safeOptions.lintCommand || 'npm run lint --if-present' });
    if (enabled.test) gates.push({ id: 'test', command: safeOptions.testCommand || 'npm test -- --watchAll=false --runInBand' });
    if (enabled.build) gates.push({ id: 'build', command: safeOptions.buildCommand || 'npm run build --if-present' });

    if (gates.length === 0) {
      return { success: true, passed: true, skipped: true, results: [] };
    }

    const results = [];
    let passed = true;

    for (const gate of gates) {
      const runResult = await runCommandForTask(gate.command, trustedProjectPath, timeoutMs);
      const entry = {
        id: gate.id,
        command: gate.command,
        ok: runResult.ok,
        code: runResult.code,
        timedOut: runResult.timedOut,
        stdout: runResult.stdout,
        stderr: runResult.stderr
      };
      results.push(entry);

      if (!entry.ok) {
        passed = false;
        if (blockOnFail) break;
      }
    }

    return { success: true, passed, results, blockOnFail };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Lire le contenu d'un fichier
ipcMain.handle('read-file', async (event, projectPath, filename) => {
  try {
    const trustedProjectPath = await ensureTrustedProjectPath(projectPath);
    const filePath = path.join(trustedProjectPath, filename);
    assertSafePath(trustedProjectPath, filePath);

    // Vérifier si le fichier existe avant de le lire
    await fs.access(filePath);

    const stats = await fs.stat(filePath);
    const content = await fs.readFile(filePath, 'utf-8');
    return {
      success: true,
      content,
      size: Number(stats?.size || 0),
      mtimeMs: Math.round(Number(stats?.mtimeMs || 0))
    };
  } catch (error) {
    if (error && error.code !== 'ENOENT') {
      console.error(`Erreur de lecture du fichier ${filename} dans ${projectPath}:`, error);
    }
    return { success: false, error: error.message };
  }
});

// Écrire/créer un fichier
ipcMain.handle('write-file', async (event, projectPath, filename, content, writeOptions = {}) => {
  try {
    await ensureEditPermission();

    const trustedProjectPath = await ensureTrustedProjectPath(projectPath);
    const filePath = path.join(trustedProjectPath, filename);
    assertSafePath(trustedProjectPath, filePath);
    const expectedMtimeMsRaw = Number(writeOptions?.expectedMtimeMs);
    const hasExpectedMtime = Number.isFinite(expectedMtimeMsRaw);

    if (hasExpectedMtime) {
      try {
        const statsBefore = await fs.stat(filePath);
        const currentMtimeMs = Math.round(Number(statsBefore?.mtimeMs || 0));
        const expectedMtimeMs = Math.round(expectedMtimeMsRaw);
        if (currentMtimeMs !== expectedMtimeMs) {
          return {
            success: false,
            code: 'FILE_MODIFIED',
            error: `Conflit detecte: "${filename}" a ete modifie depuis la proposition IA.`,
            expectedMtimeMs,
            currentMtimeMs
          };
        }
      } catch (error) {
        if (error?.code === 'ENOENT') {
          return {
            success: false,
            code: 'FILE_MISSING',
            error: `Conflit detecte: "${filename}" n'existe plus.`
          };
        }
        throw error;
      }
    }

    // Créer les dossiers parents si nécessaire
    const dirPath = path.dirname(filePath);
    try {
      await fs.mkdir(dirPath, { recursive: true });
    } catch (dirError) {
      // Dossier existe déjà
    }

    await fs.writeFile(filePath, content, 'utf-8');
    const statsAfter = await fs.stat(filePath);
    console.log(`Fichier écrit: ${filePath}`);
    return {
      success: true,
      mtimeMs: Math.round(Number(statsAfter?.mtimeMs || 0)),
      size: Number(statsAfter?.size || 0)
    };
  } catch (error) {
    console.error(`Erreur d'écriture du fichier ${filename} dans ${projectPath}:`, error);
    return { success: false, error: error.message };
  }
});

// Supprimer un fichier
ipcMain.handle('delete-file', async (event, projectPath, filename, deleteOptions = {}) => {
  try {
    await ensureEditPermission();

    const trustedProjectPath = await ensureTrustedProjectPath(projectPath);
    const filePath = path.join(trustedProjectPath, filename);
    assertSafePath(trustedProjectPath, filePath);
    const expectedMtimeMsRaw = Number(deleteOptions?.expectedMtimeMs);
    if (Number.isFinite(expectedMtimeMsRaw)) {
      const statsBefore = await fs.stat(filePath);
      const currentMtimeMs = Math.round(Number(statsBefore?.mtimeMs || 0));
      const expectedMtimeMs = Math.round(expectedMtimeMsRaw);
      if (currentMtimeMs !== expectedMtimeMs) {
        return {
          success: false,
          code: 'FILE_MODIFIED',
          error: `Conflit detecte: "${filename}" a ete modifie depuis la proposition IA.`,
          expectedMtimeMs,
          currentMtimeMs
        };
      }
    }
    await fs.unlink(filePath);
    return { success: true };
  } catch (error) {
    console.error(`Erreur de suppression du fichier ${filename} dans ${projectPath}:`, error);
    return { success: false, error: error.message };
  }
});

// Créer un nouveau fichier (vide ou avec contenu initial)
ipcMain.handle('createNewFile', async (event, projectPath, filename, initialContent = '') => {
  try {
    await ensureEditPermission();

    const trustedProjectPath = await ensureTrustedProjectPath(projectPath);
    const filePath = path.join(trustedProjectPath, filename);
    assertSafePath(trustedProjectPath, filePath);

    console.log(`Tentative de création du fichier: ${filePath}`);

    // Créer les dossiers parents automatiquement
    const dirPath = path.dirname(filePath);
    try {
      await fs.mkdir(dirPath, { recursive: true });
      console.log(`Dossiers parents créés: ${dirPath}`);
    } catch (dirError) {
      console.log(`Dossiers déjà existants: ${dirPath}`);
    }

    // Vérifier si le fichier existe pour éviter de l'écraser
    try {
      await fs.access(filePath);
      console.log(`Le fichier existe déjà: ${filePath}`);
      return {
        success: false,
        error: `Le fichier "${filename}" existe déjà`
      };
    } catch (e) {
      // Si fs.access échoue, le fichier n'existe pas, on peut le créer
      await fs.writeFile(filePath, initialContent, 'utf-8');
      const stats = await fs.stat(filePath);
      console.log(`Fichier créé avec succès: ${filePath}`);
      return {
        success: true,
        message: `Fichier "${filename}" créé avec succès`,
        mtimeMs: Math.round(Number(stats?.mtimeMs || 0)),
        size: Number(stats?.size || 0)
      };
    }
  } catch (error) {
    console.error(`Erreur lors de la création du fichier ${filename} dans ${projectPath}:`, error);
    return {
      success: false,
      error: `Erreur de création: ${error.message}`
    };
  }
});

// Créer un nouveau dossier
ipcMain.handle('createDirectory', async (event, projectPath, dirname) => {
  try {
    await ensureEditPermission();

    const trustedProjectPath = await ensureTrustedProjectPath(projectPath);
    const dirPath = path.join(trustedProjectPath, dirname);
    assertSafePath(trustedProjectPath, dirPath);
    // Vérifier si le dossier existe
    try {
      await fs.access(dirPath);
      return { success: false, error: 'Le dossier existe déjà' };
    } catch (e) {
      await fs.mkdir(dirPath, { recursive: true });
      return { success: true };
    }
  } catch (error) {
    console.error(`Erreur lors de la création du dossier ${dirname} dans ${projectPath}:`, error);
    return { success: false, error: error.message };
  }
});

// Supprimer un dossier (vide ou non vide)
ipcMain.handle('deleteDirectory', async (event, projectPath, dirname) => {
  try {
    await ensureEditPermission();

    const trustedProjectPath = await ensureTrustedProjectPath(projectPath);
    const dirPath = path.join(trustedProjectPath, dirname);
    assertSafePath(trustedProjectPath, dirPath);
    await fs.rm(dirPath, { recursive: true, force: true }); // fs.rm est plus moderne que fs.rmdir
    return { success: true };
  } catch (error) {
    console.error(`Erreur lors de la suppression du dossier ${dirname} dans ${projectPath}:`, error);
    return { success: false, error: error.message };
  }
});

// Modifier partiellement un fichier (remplacer une section)
ipcMain.handle('editFile', async (event, projectPath, filename, searchText, replaceText) => {
  try {
    await ensureEditPermission();

    const trustedProjectPath = await ensureTrustedProjectPath(projectPath);
    const filePath = path.join(trustedProjectPath, filename);
    assertSafePath(trustedProjectPath, filePath);

    // Lire le contenu actuel
    const currentContent = await fs.readFile(filePath, 'utf-8');

    // Vérifier si le texte à remplacer existe
    if (!currentContent.includes(searchText)) {
      return {
        success: false,
        error: `Le texte à remplacer n'a pas été trouvé dans "${filename}"`
      };
    }

    // Remplacer le texte
    const newContent = currentContent.replace(searchText, replaceText);

    // Écrire le nouveau contenu
    await fs.writeFile(filePath, newContent, 'utf-8');

    console.log(`Fichier modifié: ${filePath}`);
    return {
      success: true,
      message: `Section modifiée dans "${filename}"`
    };
  } catch (error) {
    console.error('Erreur lors de la modification du fichier:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

// Renommer un fichier
ipcMain.handle('renameFile', async (event, projectPath, oldFilename, newFilename) => {
  try {
    await ensureEditPermission();

    const trustedProjectPath = await ensureTrustedProjectPath(projectPath);
    const oldPath = path.join(trustedProjectPath, oldFilename);
    const newPath = path.join(trustedProjectPath, newFilename);
    assertSafePath(trustedProjectPath, oldPath);
    assertSafePath(trustedProjectPath, newPath);

    // Vérifier si le fichier source existe
    try {
      await fs.access(oldPath);
    } catch {
      return {
        success: false,
        error: `Le fichier "${oldFilename}" n'existe pas`
      };
    }

    // Vérifier si le nouveau nom n'existe pas déjà
    try {
      await fs.access(newPath);
      return {
        success: false,
        error: `Un fichier nommé "${newFilename}" existe déjà`
      };
    } catch {
      // C'est bon, le nouveau nom n'existe pas
    }

    // Renommer le fichier
    await fs.rename(oldPath, newPath);

    console.log(`Fichier renommé: ${oldPath} -> ${newPath}`);
    return {
      success: true,
      message: `Fichier renommé de "${oldFilename}" vers "${newFilename}"`
    };
  } catch (error) {
    console.error('Erreur lors du renommage:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

// Copier un fichier
ipcMain.handle('copyFile', async (event, projectPath, sourceFilename, destFilename) => {
  try {
    await ensureEditPermission();

    const trustedProjectPath = await ensureTrustedProjectPath(projectPath);
    const sourcePath = path.join(trustedProjectPath, sourceFilename);
    const destPath = path.join(trustedProjectPath, destFilename);
    assertSafePath(trustedProjectPath, sourcePath);
    assertSafePath(trustedProjectPath, destPath);

    // Vérifier si le fichier source existe
    try {
      await fs.access(sourcePath);
    } catch {
      return {
        success: false,
        error: `Le fichier source "${sourceFilename}" n'existe pas`
      };
    }

    // Vérifier si la destination n'existe pas déjà
    try {
      await fs.access(destPath);
      return {
        success: false,
        error: `Le fichier de destination "${destFilename}" existe déjà`
      };
    } catch {
      // C'est bon, la destination n'existe pas
    }

    // Créer les dossiers parents si nécessaire
    const destDir = path.dirname(destPath);
    await fs.mkdir(destDir, { recursive: true });

    // Copier le fichier
    await fs.copyFile(sourcePath, destPath);

    console.log(`Fichier copié: ${sourcePath} -> ${destPath}`);
    return {
      success: true,
      message: `Fichier "${sourceFilename}" copié vers "${destFilename}"`
    };
  } catch (error) {
    console.error('Erreur lors de la copie:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

// Déplacer un fichier
ipcMain.handle('moveFile', async (event, projectPath, sourceFilename, destFilename) => {
  try {
    await ensureEditPermission();

    const trustedProjectPath = await ensureTrustedProjectPath(projectPath);
    const sourcePath = path.join(trustedProjectPath, sourceFilename);
    const destPath = path.join(trustedProjectPath, destFilename);
    assertSafePath(trustedProjectPath, sourcePath);
    assertSafePath(trustedProjectPath, destPath);

    // Vérifier si le fichier source existe
    try {
      await fs.access(sourcePath);
    } catch {
      return {
        success: false,
        error: `Le fichier source "${sourceFilename}" n'existe pas`
      };
    }

    // Vérifier si la destination n'existe pas déjà
    try {
      await fs.access(destPath);
      return {
        success: false,
        error: `Le fichier de destination "${destFilename}" existe déjà`
      };
    } catch {
      // C'est bon, la destination n'existe pas
    }

    // Créer les dossiers parents si nécessaire
    const destDir = path.dirname(destPath);
    await fs.mkdir(destDir, { recursive: true });

    // Déplacer le fichier
    await fs.rename(sourcePath, destPath);

    console.log(`Fichier déplacé: ${sourcePath} -> ${destPath}`);
    return {
      success: true,
      message: `Fichier "${sourceFilename}" déplacé vers "${destFilename}"`
    };
  } catch (error) {
    console.error('Erreur lors du déplacement:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

// Lire tous les fichiers du projet pour fournir le contexte complet à l'IA
ipcMain.handle('getAllProjectFiles', async (event, projectPath, options = {}) => {
  safeConsoleLog('[Main] getAllProjectFiles appelé avec projectPath:', projectPath);
  try {
    if (!projectPath) {
      const error = "Chemin du projet non fourni";
      console.error('[Main] Erreur:', error);
      return { success: false, error };
    }
    const trustedProjectPath = await ensureTrustedProjectPath(projectPath);

    const safeOptions = options && typeof options === 'object' ? options : {};
    // metadataOnly : liste les fichiers (chemin + taille) SANS lire le contenu.
    // Utilise pour les providers locaux (Ollama) : l'index est leger, le contenu
    // est lu a la demande via les outils read_file/read_lines.
    const metadataOnly = !!safeOptions.metadataOnly;
    const includeHidden = !!safeOptions.includeHidden;
    const includeSecrets = !!safeOptions.includeSecrets;
    const includeGit = !!safeOptions.includeGit;
    const includeNodeModules = !!safeOptions.includeNodeModules;
    const includeBuild = !!safeOptions.includeBuild;
    const includeVisualWorkflows = safeOptions.includeVisualWorkflows !== false;
    const largeFileStrategy = safeOptions.largeFileStrategy === 'truncate' ? 'truncate' : 'skip';

    const clampNumber = (value, min, max, fallback) => {
      const n = Number(value);
      if (!Number.isFinite(n)) return fallback;
      return Math.min(max, Math.max(min, n));
    };

    const maxFileSize = clampNumber(safeOptions.maxFileSize, 5000, 2000000, 50000); // 5KB..2MB, défaut 50KB
    const maxFiles = clampNumber(safeOptions.maxFiles, 200, 50000, 8000);
    const maxTotalBytes = clampNumber(safeOptions.maxTotalBytes, 200000, 200000000, 25000000); // 0.2MB..200MB
    const maxDepth = clampNumber(safeOptions.maxDepth, 2, 60, 30);

    const projectFiles = {};
    let totalBytes = 0;
    let hitLimit = false;
    let truncatedCount = 0;
    let skippedCount = 0;

    const textExtensions = new Set([
      '.js', '.jsx', '.ts', '.tsx',
      '.html', '.css', '.scss', '.sass', '.less',
      '.json', '.md', '.txt',
      '.py', '.java', '.cpp', '.c', '.h', '.hpp', '.php', '.rb', '.go', '.rs',
      '.xml', '.yml', '.yaml', '.sql',
      '.sh', '.bat', '.ps1',
      '.vue', '.svelte', '.astro',
      '.toml', '.ini', '.conf', '.config'
    ]);

    const textFileNames = new Set([
      'readme', 'readme.md', 'license', 'licence',
      'dockerfile', 'makefile',
      '.gitignore', '.gitattributes', '.editorconfig', '.npmrc', '.nvmrc',
      '.prettierrc', '.eslintrc', '.babelrc',
      '.env.example', '.env.sample', '.env.template', '.env.dist'
    ]);

    const isSensitiveFileName = (name) => {
      const lower = String(name || '').toLowerCase();
      if (lower === '.env') return true;
      if (lower.startsWith('.env.')) {
        if (lower === '.env.example') return false;
        if (lower === '.env.sample') return false;
        if (lower === '.env.template') return false;
        if (lower === '.env.dist') return false;
        return true;
      }
      if (lower.endsWith('.pem')) return true;
      if (lower.endsWith('.key')) return true;
      if (lower.endsWith('.pfx')) return true;
      if (lower.endsWith('.p12')) return true;
      if (lower.endsWith('.jks')) return true;
      if (lower.endsWith('.keystore')) return true;
      if (lower.includes('id_rsa')) return true;
      if (lower.includes('id_ed25519')) return true;
      return false;
    };

    const shouldSkipName = (name) => {
      if (!name) return true;
      if (name.endsWith('.log') || name.endsWith('.tmp')) return true;
      return false;
    };

    const shouldSkipDirectory = (name) => {
      if (!name) return true;
      if (!includeGit && name === '.git') return true;
      if (!includeNodeModules && name === 'node_modules') return true;
      if (
        !includeBuild &&
        (name === 'dist' ||
          name === 'build' ||
          name === 'out' ||
          name === '.next' ||
          name === 'coverage' ||
          name === '.turbo' ||
          name === '.cache' ||
          name === '.parcel-cache')
      ) {
        return true;
      }
      return false;
    };

    const shouldReadAsText = (name) => {
      const lower = String(name || '').toLowerCase();
      if (textFileNames.has(lower)) return true;
      const ext = path.extname(lower);
      if (textExtensions.has(ext)) return true;
      return false;
    };

    const recordFile = (relativeFilePath, payload, approxBytes = 0) => {
      const currentCount = Object.keys(projectFiles).length;
      if (currentCount >= maxFiles || totalBytes >= maxTotalBytes) {
        hitLimit = true;
        return false;
      }
      projectFiles[relativeFilePath] = payload;
      totalBytes += Math.max(0, Number(approxBytes) || 0);
      return true;
    };

    async function readFileTruncated(fullPath, bytesToRead) {
      const handle = await fs.open(fullPath, 'r');
      try {
        const buffer = Buffer.alloc(bytesToRead);
        const { bytesRead } = await handle.read(buffer, 0, bytesToRead, 0);
        return buffer.subarray(0, bytesRead).toString('utf-8');
      } finally {
        try {
          await handle.close();
        } catch {
          // ignore
        }
      }
    }

    async function readDirectory(dirPath, relativePath = '', depth = 0) {
      if (depth > maxDepth || hitLimit) return;

      let items;
      try {
        items = await fs.readdir(dirPath, { withFileTypes: true });
      } catch {
        skippedCount += 1;
        return;
      }

      for (const item of items) {
        if (hitLimit) return;

        if (item.isSymbolicLink && item.isSymbolicLink()) {
          skippedCount += 1;
          continue;
        }

        const itemName = item.name;
        if (!itemName) continue;

        const isVisualWorkflowDir = itemName === '.vibe-workflows';
        if (!includeHidden && itemName.startsWith('.') && !(includeVisualWorkflows && isVisualWorkflowDir)) {
          skippedCount += 1;
          continue;
        }

        if (!includeSecrets && isSensitiveFileName(itemName)) {
          skippedCount += 1;
          continue;
        }

        if (shouldSkipName(itemName)) {
          skippedCount += 1;
          continue;
        }

        const fullPath = path.join(dirPath, itemName);
        const relativeFilePath = path.join(relativePath, itemName);

        if (item.isDirectory()) {
          if (shouldSkipDirectory(itemName)) {
            skippedCount += 1;
            continue;
          }
          await readDirectory(fullPath, relativeFilePath, depth + 1);
          continue;
        }

        if (!item.isFile()) {
          skippedCount += 1;
          continue;
        }

        try {
          const stats = await fs.stat(fullPath);

          // Mode metadataOnly : on n'ouvre pas le fichier, on stocke juste chemin+taille.
          if (metadataOnly) {
            recordFile(relativeFilePath, { type: 'file', content: '', size: stats.size }, 0);
            continue;
          }

          const treatAsText = shouldReadAsText(itemName);
          if (!treatAsText) {
            recordFile(relativeFilePath, {
              type: 'file',
              content: '[FICHIER BINAIRE - Non lu]',
              size: stats.size
            }, 0);
            continue;
          }

          if (stats.size > maxFileSize) {
            if (largeFileStrategy === 'truncate') {
              const content = await readFileTruncated(fullPath, maxFileSize);
              truncatedCount += 1;
              recordFile(relativeFilePath, {
                type: 'file',
                content,
                size: stats.size,
                truncated: true
              }, Math.min(maxFileSize, stats.size));
            } else {
              recordFile(relativeFilePath, {
                type: 'file',
                content: '[FICHIER TROP VOLUMINEUX - Non lu]',
                size: stats.size
              }, 0);
            }
            continue;
          }

          const content = await fs.readFile(fullPath, 'utf-8');
          recordFile(relativeFilePath, {
            type: 'file',
            content,
            size: stats.size
          }, stats.size);
        } catch (readError) {
          recordFile(relativeFilePath, {
            type: 'file',
            content: '[ERREUR DE LECTURE]',
            error: readError.message
          }, 0);
        }
      }
    }

    await readDirectory(trustedProjectPath);

    const fileCount = Object.keys(projectFiles).length;
    console.log(`[Main] Succès: ${fileCount} fichiers lus pour le projet (octets=${totalBytes}, limite=${hitLimit})`);

    return {
      success: true,
      files: projectFiles,
      projectPath: trustedProjectPath,
      stats: {
        fileCount,
        totalBytes,
        hitLimit,
        truncatedCount,
        skippedCount,
        options: {
          includeHidden,
          includeSecrets,
          includeGit,
          includeNodeModules,
          includeBuild,
          includeVisualWorkflows,
          maxFileSize,
          maxFiles,
          maxTotalBytes,
          maxDepth,
          largeFileStrategy
        }
      }
    };
  } catch (error) {
    console.error('Erreur lors de la lecture du projet:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

// Fonction createNewFile déjà définie plus haut - duplication supprimée

// Sauvegarder une conversation dans un fichier TXT
ipcMain.handle('saveConversation', async (event, projectPath, conversationHistory) => {
  try {
    const trustedProjectPath = await ensureTrustedProjectPath(projectPath);
    // Générer un nom de fichier intelligent basé sur le contenu
    const conversationTitle = generateConversationTitle(conversationHistory);
    const timestamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-');
    const fileName = `${timestamp}_${conversationTitle}.txt`;
    const conversationsDir = path.join(trustedProjectPath, 'conversations');
    const filePath = path.join(conversationsDir, fileName);
    assertSafePath(conversationsDir, filePath);

    // Créer le dossier conversations s'il n'existe pas
    try {
      await fs.mkdir(conversationsDir, { recursive: true });
    } catch (err) {
      // Le dossier existe déjà
    }

    // Formater la conversation
    let conversationText = `CONVERSATION AVEC L'AGENT IA\n`;
    conversationText += `Date: ${new Date().toLocaleString('fr-FR')}\n`;
    conversationText += `Projet: ${path.basename(trustedProjectPath)}\n`;
    conversationText += `${'='.repeat(60)}\n\n`;

    conversationHistory.forEach((msg, index) => {
      const role = msg.role === 'user' ? 'UTILISATEUR' :
        msg.role === 'model' ? 'AGENT IA' : 'SYSTÈME';
      conversationText += `[${role}]\n${msg.text}\n\n`;
      conversationText += `${'-'.repeat(40)}\n\n`;
    });

    await fs.writeFile(filePath, conversationText, 'utf-8');

    return {
      success: true,
      fileName: fileName,
      filePath: filePath
    };
  } catch (error) {
    console.error('Erreur lors de la sauvegarde de la conversation:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

// Lister les conversations existantes pour un projet
ipcMain.handle('listConversations', async (event, projectPath) => {
  try {
    if (!projectPath) {
      return { success: false, error: 'Aucun chemin de projet fourni.' };
    }
    const trustedProjectPath = await ensureTrustedProjectPath(projectPath);

    const conversationsDir = path.join(trustedProjectPath, 'conversations');
    let entries;

    try {
      entries = await fs.readdir(conversationsDir, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') {
        // Pas encore de dossier de conversations : retourner une liste vide
        return { success: true, conversations: [] };
      }
      throw error;
    }

    const conversations = [];

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!entry.name.toLowerCase().endsWith('.txt')) continue;

      const filePath = path.join(conversationsDir, entry.name);
      const stats = await fs.stat(filePath);
      const createdAt = stats.mtime.toISOString();

      let title = entry.name.replace(/\.txt$/i, '');
      const underscoreIndex = title.indexOf('_');
      if (underscoreIndex !== -1) {
        title = title.slice(underscoreIndex + 1);
      }

      conversations.push({
        fileName: entry.name,
        filePath,
        createdAt,
        title,
      });
    }

    conversations.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

    return { success: true, conversations };
  } catch (error) {
    console.error('Erreur lors du listing des conversations :', error);
    return { success: false, error: error.message };
  }
});

// Charger une conversation existante et la retransformer en historique exploitable par l'IA
ipcMain.handle('loadConversation', async (event, projectPath, fileName) => {
  try {
    if (!projectPath || !fileName) {
      return { success: false, error: 'Chemin de projet ou fichier de conversation manquant.' };
    }
    const trustedProjectPath = await ensureTrustedProjectPath(projectPath);

    const conversationsDir = path.join(trustedProjectPath, 'conversations');
    const filePath = path.join(conversationsDir, fileName);
    assertSafePath(conversationsDir, filePath);
    const content = await fs.readFile(filePath, 'utf-8');

    const history = [];
    const blockRegex = /\[(UTILISATEUR|AGENT IA|SYSTÈME)\]\n([\s\S]*?)(?:\n-{40,}\n\n|$)/g;
    let match;

    while ((match = blockRegex.exec(content)) !== null) {
      const rawRole = match[1];
      const text = (match[2] || '').trim();
      if (!text) continue;

      let role = 'system';
      if (rawRole === 'UTILISATEUR') role = 'user';
      else if (rawRole === 'AGENT IA') role = 'model';

      history.push({ role, text });
    }

    return { success: true, history, fileName };
  } catch (error) {
    console.error('Erreur lors du chargement de la conversation :', error);
    return { success: false, error: error.message };
  }
});

// Fonction pour générer un titre intelligent pour la conversation
function generateConversationTitle(conversationHistory) {
  // Analyser les messages pour extraire des mots-clés
  const allText = conversationHistory
    .filter(msg => msg.role === 'user')
    .map(msg => msg.text)
    .join(' ')
    .toLowerCase();

  // Mots-clés techniques courants
  const keywords = {
    'react': 'React',
    'javascript': 'JavaScript',
    'css': 'CSS',
    'html': 'HTML',
    'api': 'API',
    'bug': 'Correction Bug',
    'erreur': 'Correction Erreur',
    'optimisation': 'Optimisation',
    'amélioration': 'Amélioration',
    'création': 'Création',
    'modification': 'Modification',
    'interface': 'Interface UI',
    'design': 'Design',
    'fonction': 'Fonctionnalité',
    'agent': 'Agent IA',
    'gemini': 'Gemini API',
    'electron': 'Electron',
    'fichier': 'Gestion Fichiers',
    'projet': 'Structure Projet'
  };

  const foundKeywords = [];
  for (const [key, value] of Object.entries(keywords)) {
    if (allText.includes(key)) {
      foundKeywords.push(value);
    }
  }

  // Générer un titre basé sur les mots-clés trouvés
  if (foundKeywords.length > 0) {
    return foundKeywords.slice(0, 3).join(' - ').replace(/[^a-zA-Z0-9\s-]/g, '');
  } else {
    // Titre par défaut
    return 'Conversation Agent IA';
  }
}

// ==================== AI TERMINAL AGENT LOOP ====================

const requestTerminalApproval = async (commandText) => {
  try {
    const targetWindow = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
    const result = await dialog.showMessageBox(targetWindow, {
      type: 'warning',
      title: 'Confirmation commande terminal IA',
      message: "L'agent IA veut executer une commande shell.",
      detail: commandText,
      buttons: ['Autoriser', 'Refuser'],
      defaultId: 1,
      cancelId: 1,
      noLink: true
    });
    return result.response === 0;
  } catch {
    return false;
  }
};

/**
 * Executes a validated command on behalf of the AI agent.
 * Commands run without a shell, inside a trusted project, with output caps.
 */
const executeCommandForAI = (cmd, projectPath) => {
  return new Promise(async (resolve) => {
    if (!cmd || typeof cmd !== 'string' || !cmd.trim()) {
      return resolve({ success: false, output: '[AI TERMINAL] Commande vide ignorée.' });
    }
    const trimmedCmd = cmd.trim();
    let settings;
    let spawnRequest;
    let trustedProjectPath = null;
    try {
      settings = await readSettingsSafe();
      spawnRequest = buildSafeSpawnRequest(trimmedCmd, []);
      trustedProjectPath = projectPath ? await ensureTrustedProjectPath(projectPath) : null;
    } catch (error) {
      return resolve({
        success: false,
        output: `[AI TERMINAL] Commande bloquee: ${error.message}`
      });
    }

    if (!canUseTerminal(settings.permissionMode)) {
      return resolve({
        success: false,
        output: "[AI TERMINAL] Le mode permissions actuel bloque l'execution de commandes terminal."
      });
    }

    if (settings.aiTerminalApprovalMode !== false) {
      const approved = await requestTerminalApproval(spawnRequest.normalizedCommandLine);
      if (!approved) {
        return resolve({
          success: false,
          output: `[AI TERMINAL] Commande refusee par l'utilisateur: ${spawnRequest.normalizedCommandLine}`
        });
      }
    }

    // --- Pseudo-commandes N8N Catalog ---
    if (spawnRequest.commandName === 'n8n-search') {
      const query = spawnRequest.args.join(' ').trim().toLowerCase();
      try {
        const catalog = await getN8nCatalogEntries(15000);
        const entries = Array.isArray(catalog.items) ? catalog.items : [];
        const matched = entries.filter((item) => {
          if (!query) return true;
          const haystack = `${item.name} ${item.filename} ${item.repoPath}`.toLowerCase();
          return haystack.includes(query);
        });
        const displayLimit = 120;
        const shown = matched.slice(0, displayLimit).map((item) =>
          `- ${item.name} (URL: ${item.downloadUrl})`
        );

        let out = `[N8N CATALOG SEARCH RESULTS - ${matched.length} trouvés | total catalogue: ${catalog.total}]\n`;
        out += shown.length > 0 ? shown.join('\n') : "Aucun workflow trouvé pour cette requête.";
        if (matched.length > shown.length) out += `\n...et ${matched.length - shown.length} autres.`;
        return resolve({ success: true, output: out });
      } catch (e) {
        return resolve({ success: false, output: `[N8N SEARCH ERROR] ${e.message}` });
      }
    }

    if (spawnRequest.commandName === 'n8n-import') {
      if (!trustedProjectPath) {
        return resolve({
          success: false,
          output: '[N8N IMPORT ERROR] Projet autorise requis pour importer un workflow.'
        });
      }
      const url = String(spawnRequest.args[0] || '').trim();
      const requestedName = spawnRequest.args.slice(1).join(' ').trim();
      const saveName = sanitizeN8nImportFilename(requestedName || 'imported_n8n_workflow');

      if (!url || !isTrustedN8nDownloadUrl(url)) {
        return resolve({
          success: false,
          output: `[N8N IMPORT ERROR] URL non autorisee. Utilise une URL du catalogue n8n configure. Usage: n8n-import <url_du_workflow> <nom_sauvegarde>`
        });
      }

      try {
        const n8nWf = await fetchTrustedN8nWorkflow(url, 15000);

        const guessNodeType = (n8nType) => {
          if (!n8nType) return 'action';
          const t = n8nType.toLowerCase();
          if (t.includes('trigger') || t.includes('cron') || t.includes('schedule') || t.includes('webhook') || t.includes('manual')) return 'trigger';
          if (t.includes('openai') || t.includes('ai') || t.includes('gpt') || t.includes('llm')) return 'ai';
          if (t.includes('if') || t.includes('switch') || t.includes('merge') || t.includes('loop') || t.includes('wait')) return 'logic';
          if (t.includes('slack') || t.includes('email') || t.includes('telegram') || t.includes('discord') || t.includes('notification')) return 'output';
          return 'action';
        };

        const guessNodeIcon = (n8nType) => {
          if (!n8nType) return '⚡';
          const t = n8nType.toLowerCase();
          if (t.includes('trigger') || t.includes('manual')) return '▶️';
          if (t.includes('cron') || t.includes('schedule')) return '⏰';
          if (t.includes('webhook')) return '🌐';
          if (t.includes('openai') || t.includes('ai') || t.includes('gpt')) return '🤖';
          if (t.includes('http')) return '🔗';
          if (t.includes('git')) return '📦';
          if (t.includes('if') || t.includes('switch')) return '🔀';
          if (t.includes('loop') || t.includes('merge')) return '🔁';
          if (t.includes('slack') || t.includes('email') || t.includes('telegram') || t.includes('discord')) return '📢';
          return '⚡';
        };

        const adapted = {
          name: n8nWf.name || saveName.replace('.json', ''),
          nodes: (n8nWf.nodes || []).map((n, i) => ({
            id: `node_${i + 1}`,
            type: guessNodeType(n.type),
            label: n.name || n.type,
            icon: guessNodeIcon(n.type),
            position: n.position ? { x: n.position[0] || 100, y: n.position[1] || 100 } : { x: 100 + i * 220, y: 150 },
            config: {
              command: n.parameters?.command || '',
              prompt: n.parameters?.text || n.parameters?.prompt || '',
              message: n.parameters?.message || '',
            },
          })),
          edges: [],
        };

        if (n8nWf.connections) {
          Object.entries(n8nWf.connections).forEach(([sourceName, conns]) => {
            const sourceNode = adapted.nodes.find(n => n.label === sourceName);
            if (!sourceNode) return;
            Object.values(conns).forEach(outputs => {
              outputs.forEach(outputArr => {
                outputArr.forEach(conn => {
                  const targetNode = adapted.nodes.find(n => n.label === conn.node);
                  if (targetNode) {
                    adapted.edges.push({ source: sourceNode.id, target: targetNode.id });
                  }
                });
              });
            });
          });
        }

        const workflowsDir = path.join(trustedProjectPath, '.vibe-workflows');
        await fs.mkdir(workflowsDir, { recursive: true });
        const filePath = path.join(workflowsDir, saveName);
        assertSafePath(workflowsDir, filePath);
        await fs.writeFile(filePath, JSON.stringify(adapted, null, 2), 'utf-8');

        return resolve({ success: true, output: `[N8N IMPORT SUCCESS] Workflow n8n adapté et sauvegardé sous : ${filePath}` });
      } catch (e) {
        return resolve({ success: false, output: `[N8N IMPORT ERROR] ${e.message}` });
      }
    }

    if (!trustedProjectPath) {
      return resolve({
        success: false,
        output: '[AI TERMINAL] Projet autorise requis pour executer une commande.'
      });
    }

    try {
      validateCommandArgsWithinWorkspace(spawnRequest, trustedProjectPath);
    } catch (error) {
      return resolve({
        success: false,
        output: `[AI TERMINAL] Commande bloquee: ${error.message}`
      });
    }

    console.log(`[AI Terminal] Exécution: ${spawnRequest.normalizedCommandLine}`);
    const child = spawn(spawnRequest.executable, spawnRequest.args, {
      shell: false,
      cwd: trustedProjectPath,
      windowsHide: true
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (d) => { stdout += d.toString(); });
    child.stderr?.on('data', (d) => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      try { child.kill(); } catch (e) { /* ignore */ }
      const output = `[AI TERMINAL - TIMEOUT après 30s]\nstdout: ${stdout.slice(0, 2000)}\nstderr: ${stderr.slice(0, 2000)}`;
      resolve({ success: false, output });
    }, 30000);

    child.on('close', (code) => {
      clearTimeout(timer);
      let output = '';
      if (stdout) output += stdout;
      if (stderr) output += `\n[stderr] ${stderr}`;
      if (!output.trim()) output = `[Process exited with code ${code}]`;
      // Cap output size
      if (output.length > MAX_CMD_OUTPUT) {
        output = output.substring(0, MAX_CMD_OUTPUT) + '\n[...sortie tronquée...]';
      }
      resolve({ success: code === 0, output });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ success: false, output: `[AI TERMINAL ERREUR] ${err.message}` });
    });
  });
};

const TERMINAL_CAPABILITY_PROMPT = `
CAPACITÉ TERMINAL — AGENT AUTONOME :
Tu peux exécuter des commandes shell directement dans le projet de l'utilisateur.
Pour exécuter une commande, utilise EXACTEMENT ce format XML (une seule commande par balise) :

<run_command>npm install lodash</run_command>

Tu recevras le résultat (stdout/stderr) dans ton prochain tour.
Règles :
- Utilise cette capacité pour : lire des fichiers, lancer des builds, installer des packages, vérifier des erreurs, lancer des tests.
- Spécial: utilise "n8n-search <mot_cle>" pour chercher un workflow n8n (ex: n8n-search slack)
- Spécial: utilise "n8n-import <url> <nom>" pour télécharger, adapter et importer un workflow n8n du catalogue directement dans le projet. Respecte toujours le mode permissions et le pipeline de validation.
- N'utilise PAS pour : supprimer des fichiers importants (rm -rf), commandes destructives.
- Tu peux enchaîner plusieurs commandes en plusieurs tours (max 8 itérations automatiques).
- Si une commande échoue, analyse l'erreur et essaie une solution alternative.
- Quand tu n'as plus besoin d'exécuter de commandes, réponds normalement sans balise <run_command>.

CRÉATION DE FICHIERS — AGENT AUTONOME :
Pour créer ou modifier un fichier, utilise EXACTEMENT ce format (appliqué automatiquement) :

**FICHIER: chemin/relatif/nom.ext**
\`\`\`langage
// contenu complet du fichier
\`\`\`

Règles fichiers :
- Utilise toujours ce format quand l'utilisateur demande du code, une appli, un composant, une config.
- Mets le chemin relatif complet (ex: src/components/Button.jsx, backend/routes/auth.js).
- Produis le contenu COMPLET du fichier, jamais un extrait.
- Tu peux créer plusieurs fichiers en un seul message.
- NE décris PAS les fichiers — CRÉE-les directement.

CRÉATION DE WORKFLOW VISUEL — AGENT AUTONOME :
Si l'utilisateur demande un workflow, un plan d'architecture, ou un diagramme de processus, génère aussi un workflow visuel avec ce format (importé automatiquement dans l'éditeur visuel) :

**WORKFLOW: NomDuWorkflow**
\`\`\`json
{
  "name": "NomDuWorkflow",
  "nodes": [
    {"id":"node_1","type":"trigger","label":"Démarrage","icon":"▶️","position":{"x":100,"y":150},"config":{"triggerType":"manual"}},
    {"id":"node_2","type":"ai","label":"Analyse IA","icon":"🤖","position":{"x":350,"y":150},"config":{"model":"gemini","prompt":"Analysez..."}},
    {"id":"node_3","type":"action","label":"Créer fichiers","icon":"💻","position":{"x":600,"y":150},"config":{"command":"npm install"}},
    {"id":"node_4","type":"output","label":"Résultat","icon":"🔔","position":{"x":850,"y":150},"config":{"message":"Terminé !"}}
  ],
  "edges": [
    {"source":"node_1","target":"node_2"},
    {"source":"node_2","target":"node_3"},
    {"source":"node_3","target":"node_4"}
  ]
}
\`\`\`

Types de nœuds disponibles : trigger (▶️) | ai (🤖) | action (💻) | logic (🔀) | output (🔔)
`;


/**
 * Parses a single <run_command> tag from an AI response text.
 * Returns the command string or null if not found.
 */
const parseRunCommand = (text) => {
  const match = String(text || '').match(/<run_command>([\s\S]*?)<\/run_command>/i);
  return match ? match[1].trim() : null;
};

// --- IPC Handler pour l'API Kimi K2.5 via Together ---
ipcMain.handle('get-kimi-completion', async (event, history, currentCode, allProjectFiles = null, options = {}) => {
  if (options.localOnly) {
    return { success: false, error: 'Local-only actif: Kimi/Together interdit.', provider: 'kimi' };
  }
  const apiKey = options.apiKey || process.env.KIMI_API_KEY || process.env.TOGETHER_API_KEY;
  const modelFromEnv = process.env.KIMI_MODEL;
  const model = options.model || modelFromEnv || DEFAULT_KIMI_MODEL;
  const thinkingMode = !!options.thinkingMode;
  const images = Array.isArray(options.images) ? options.images : [];
  const fastMode = options.fastMode !== false;
  const reactMode = options.reactMode === true;
  const streamResponse = options.streamResponse === true;
  const includeProjectContext = options.includeProjectContext !== false;
  const includeGlobalSkills = options.includeGlobalSkills === true || !fastMode;
  const parsePositiveInt = (value, fallback, min, max) => {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
  };
  const maxHistoryMessages = parsePositiveInt(options.maxHistoryMessages, fastMode ? 8 : 20, 2, 80);
  const contextFilesLimit = parsePositiveInt(options.contextFilesLimit, fastMode ? 8 : 20, 1, 40);
  const contextCharsPerFile = parsePositiveInt(options.contextCharsPerFile, fastMode ? 1200 : 2000, 300, 4000);
  const reactMaxIterations = reactMode
    ? parsePositiveInt(options.maxIterations, fastMode ? 3 : 8, 1, 8)
    : 1;
  const kimiRetryCount = parsePositiveInt(options.retryCount, fastMode ? 2 : 3, 0, 5);
  const kimiRetryDelayMs = parsePositiveInt(options.retryDelayMs, fastMode ? 900 : 1400, 250, 15000);
  const KIMI_RETRYABLE_STATUS = new Set([429, 502, 503, 504]);
  const KIMI_RETRYABLE_CODES = new Set([
    'ECONNABORTED',
    'ETIMEDOUT',
    'ECONNRESET',
    'EAI_AGAIN',
    'ENOTFOUND',
    'EPIPE',
    'ERR_STREAM_PREMATURE_CLOSE'
  ]);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const getKimiStatusCode = (error) => {
    const parsed = Number(error?.response?.status);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  };
  const isRetryableKimiError = (error) => {
    const statusCode = getKimiStatusCode(error);
    if (statusCode && KIMI_RETRYABLE_STATUS.has(statusCode)) return true;
    const errorCode = String(error?.code || '').toUpperCase();
    if (errorCode && KIMI_RETRYABLE_CODES.has(errorCode)) return true;
    return false;
  };
  const formatKimiErrorMessage = (error, statusCode) => {
    if (statusCode === 429) {
      return "Limite de requetes atteinte (quota API Together/Kimi ou trop de requetes). Reessayez dans quelques instants.";
    }
    if (statusCode === 502 || statusCode === 503 || statusCode === 504) {
      return `Service Kimi/Together temporairement indisponible (HTTP ${statusCode}). Reessayez dans quelques instants.`;
    }
    if (statusCode === 401 || statusCode === 403) {
      return 'Acces refuse a l API Kimi/Together. Verifiez votre cle API.';
    }
    if (String(error?.code || '').toUpperCase() === 'ECONNABORTED') {
      return 'Timeout de la requete Kimi/Together. Reessayez avec un timeout plus long.';
    }
    const remoteMessage =
      error?.response?.data?.error?.message ||
      error?.response?.data?.message;
    if (remoteMessage) return String(remoteMessage);
    return error?.message || 'Erreur inconnue lors de l appel Kimi/Together.';
  };
  const emitAIGenerationToken = (payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('ai-generation-token', {
        provider: 'kimi',
        ...payload
      });
    }
  };

  safeConsoleLog('[Main] Appel Kimi: verification de la cle API Kimi/Together...');

  if (!apiKey) {
    const errorMsg = "La clé API Together/Kimi n'est pas configurée. Définissez KIMI_API_KEY (ou TOGETHER_API_KEY) ou renseignez-la dans les Paramètres.";
    console.error('[Main][Kimi] Erreur:', errorMsg);
    return { success: false, error: errorMsg, retryable: false, statusCode: 401, provider: 'kimi' };
  }

  if (!history || !Array.isArray(history) || history.length === 0) {
    const errorMsg = "Aucun historique de conversation n'a été fourni pour Kimi.";
    console.error('[Main][Kimi] Erreur:', errorMsg);
    return { success: false, error: errorMsg };
  }

  try {
    const validHistory = history.filter(msg =>
      msg &&
      typeof msg === 'object' &&
      msg.text !== undefined
    );
    const effectiveHistory = validHistory.slice(-maxHistoryMessages);

    if (effectiveHistory.length === 0) {
      const errorMsg = "Aucun message valide trouvé dans l'historique pour Kimi.";
      console.error('[Main][Kimi] Erreur:', errorMsg);
      return { success: false, error: errorMsg };
    }

    const lastMessage = effectiveHistory[effectiveHistory.length - 1];
    const projectPath = await resolveOptionalTrustedProjectPath(options.projectPath);

    // Construire le contexte du projet si disponible (similaire à Gemini)
    let projectContext = '';
    if (includeProjectContext && allProjectFiles && allProjectFiles.files) {
      projectContext = '\n--- CONTEXTE COMPLET DU PROJET ---\n';
      const fileEntries = Object.entries(allProjectFiles.files);

      const maxFiles = contextFilesLimit;
      const filesToShow = pickFilesForContext(allProjectFiles.files, maxFiles);

      for (const [filePath, fileData] of filesToShow) {
        projectContext += `\n=== FICHIER: ${filePath} ===\n`;
        if (fileData.content && !String(fileData.content).startsWith('[')) {
          const maxContentLength = contextCharsPerFile;
          const content = fileData.content.length > maxContentLength
            ? fileData.content.substring(0, maxContentLength) + '\n[...CONTENU TRONQUÉ...]'
            : fileData.content;
          projectContext += content;
        } else {
          projectContext += fileData.content || '[Contenu non disponible]';
        }
        projectContext += '\n=== FIN FICHIER ===\n';
      }

      if (fileEntries.length > maxFiles) {
        projectContext += `\n[...ET ${fileEntries.length - maxFiles} AUTRES FICHIERS]\n`;
      }
      projectContext += '--- FIN CONTEXTE PROJET ---\n';
    }

    const agentPrompt = await loadAgentForCompletion(options.agent, projectPath);
    const globalSkillsContent = includeGlobalSkills ? await loadAllGlobalSkillsForCompletion() : '';
    const selectedSkill = await loadSkillForCompletion(options.skill, projectPath);
    const visualWorkflowContext = await buildVisualWorkflowContextForPrompt(projectPath, String(lastMessage.text), options);
    const n8nCatalogContext = await buildN8nCatalogContextForPrompt(String(lastMessage.text), options);

    const agentContext = agentPrompt
      ? `\n--- AGENT PERSONA (${agentPrompt.name}) ---\n${agentPrompt.body}\n--- FIN AGENT ---\n`
      : '';

    const skillContext = [
      globalSkillsContent
        ? `\n--- SKILLS GLOBAUX INSTALLÉS ---\n${globalSkillsContent}\n--- FIN SKILLS GLOBAUX ---\n`
        : '',
      selectedSkill
        ? `\n--- SKILL SELECTIONNÉ (${selectedSkill.name}) ---\n${selectedSkill.content}\n--- FIN SKILL SELECTIONNÉ ---\n`
        : '',
      formatAvailableSkillsListForPrompt(options.skillsContent)
    ].filter(Boolean).join('\n');

    const thinkingInstructionsKimi = thinkingMode
      ? `\nMODE THINKING ACTIVÉ : détaillez explicitement votre raisonnement étape par étape avant de proposer le code final.\n`
      : '';

    const terminalCapabilityPrompt = reactMode ? TERMINAL_CAPABILITY_PROMPT : '';
    const prompt = `
      Vous êtes un assistant de développement expert et autonome.
      ${agentContext}
      ${skillContext}
      ${projectContext}
      ${visualWorkflowContext}
      ${n8nCatalogContext}

      FICHIER ACTUELLEMENT OUVERT :
      --- CODE ACTUEL ---
      ${currentCode || 'Aucun code fourni'}
      ---

      DERNIÈRE DEMANDE DE L'UTILISATEUR :
      ${String(lastMessage.text)}

      ${thinkingInstructionsKimi}

      ${terminalCapabilityPrompt}

      INSTRUCTIONS :
      - Analysez le contexte du projet et la demande.
      - Proposez des modifications de code complètes.
      - Pour chaque fichier modifié, renvoyez le contenu complet au format :
        **FICHIER: nom_du_fichier.ext**
        \`\`\`langage
        // code complet
        \`\`\`
    `;

    const buildMessages = (baseHistory, userPrompt) => {
      const base = baseHistory.slice(0, -1).map(msg => {
        let role = 'user';
        if (msg.role === 'model') role = 'assistant';
        else if (msg.role === 'system') role = 'system';
        else if (msg.role === 'user') role = 'user';
        return { role, content: String(msg.text) };
      });
      let userContent;
      if (images.length > 0) {
        const imageContents = images.map(img => ({ type: 'image_url', image_url: { url: img.dataUrl || img.url || '' } }));
        userContent = [{ type: 'text', text: userPrompt }, ...imageContents];
      } else {
        userContent = userPrompt;
      }
      return [...base, { role: 'user', content: userContent }];
    };

    const kimiUrl = options.apiUrl || process.env.KIMI_API_URL || 'https://api.together.xyz/v1/chat/completions';
    const parsedMaxTokens = Number(options.maxTokens);
    const defaultMaxTokens = 4096;
    const kimiMaxTokens = Number.isFinite(parsedMaxTokens) && parsedMaxTokens > 0
      ? Math.min(16384, Math.floor(parsedMaxTokens))
      : defaultMaxTokens;
    const parsedTemperature = Number(options.temperature);
    const kimiTemperature = Number.isFinite(parsedTemperature) ? parsedTemperature : 0.7;
    const parsedTimeoutMs = Number(options.requestTimeoutMs ?? options.timeoutMs);
    const kimiTimeoutMs = Number.isFinite(parsedTimeoutMs) && parsedTimeoutMs > 0
      ? Math.floor(parsedTimeoutMs)
      : 0;
    const kimiCallWithMessages = async (msgs) => {
      const requestBody = {
        model,
        messages: msgs,
        max_tokens: kimiMaxTokens,
        temperature: kimiTemperature,
      };
      if (streamResponse) {
        requestBody.stream = true;
      }
      const requestMetadata = {
        model,
        maxTokens: requestBody.max_tokens,
        temperature: requestBody.temperature,
        stream: !!requestBody.stream,
        messageCount: Array.isArray(msgs) ? msgs.length : 0
      };
      logger.info(`[Kimi Agent API] Request metadata: ${JSON.stringify(requestMetadata)}`);
      logger.info(`[Kimi Agent API] Timeout HTTP: ${kimiTimeoutMs > 0 ? `${kimiTimeoutMs}ms` : 'disabled'}`);
      const requestConfig = {
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      };
      if (kimiTimeoutMs > 0) {
        requestConfig.timeout = kimiTimeoutMs;
      }
      if (streamResponse) {
        requestConfig.responseType = 'stream';
      }
      const resp = await axios.post(kimiUrl, requestBody, requestConfig);
      if (streamResponse) {
        const stream = resp.data;
        if (!stream || typeof stream.on !== 'function') {
          if (resp.data?.choices?.[0]?.message?.content === undefined) {
            throw new Error("Réponse de l'API Kimi mal formatée");
          }
          return resp.data.choices[0].message.content;
        }
        return await new Promise((resolve, reject) => {
          let fullText = '';
          let buffer = '';
          let rawStreamData = '';
          let settled = false;

          const appendToken = (token) => {
            if (typeof token !== 'string' || token.length === 0) return;
            fullText += token;
            emitAIGenerationToken({ token, done: false });
          };

          const safeResolve = (value) => {
            if (settled) return;
            settled = true;
            emitAIGenerationToken({ token: '', done: true });
            resolve(value);
          };

          const safeReject = (error) => {
            if (settled) return;
            settled = true;
            emitAIGenerationToken({ token: '', done: true, error: error?.message || String(error) });
            reject(error);
          };

          const processLine = (rawLine) => {
            const line = String(rawLine || '').trim();
            if (!line) return;

            // Si la ligne ne commence pas par data:, on l'ignore sauf si on veut debugger
            if (!line.startsWith('data:')) return;

            const payload = line.slice(5).trim();
            if (!payload || payload === '[DONE]') return;

            let parsed;
            try {
              parsed = JSON.parse(payload);
            } catch {
              return;
            }

            const deltaContent = parsed?.choices?.[0]?.delta?.content;
            if (typeof deltaContent === 'string') {
              appendToken(deltaContent);
              return;
            }
            if (Array.isArray(deltaContent)) {
              deltaContent.forEach((part) => {
                if (typeof part === 'string') appendToken(part);
                else if (typeof part?.text === 'string') appendToken(part.text);
              });
              return;
            }

            // Fallback for providers sending full message chunks while streaming
            const messageContent = parsed?.choices?.[0]?.message?.content;
            if (typeof messageContent === 'string' && !fullText) {
              appendToken(messageContent);
            }
          };

          stream.on('data', (chunk) => {
            const textChunk = chunk.toString('utf8');
            if (rawStreamData.length < 2000) rawStreamData += textChunk;
            buffer += textChunk;
            let newlineIndex = buffer.indexOf('\n');
            while (newlineIndex >= 0) {
              const line = buffer.slice(0, newlineIndex);
              buffer = buffer.slice(newlineIndex + 1);
              processLine(line);
              newlineIndex = buffer.indexOf('\n');
            }
          });

          stream.on('end', () => {
            if (buffer.trim()) processLine(buffer);
            if (!fullText) {
              const preview = rawStreamData.length > 500 ? rawStreamData.slice(0, 500) + '...' : rawStreamData;
              safeReject(new Error(`Réponse de l'API Kimi mal formatée (stream vide). Raw: ${preview}`));
              return;
            }
            safeResolve(fullText);
          });

          stream.on('error', (streamError) => {
            safeReject(streamError);
          });
        });
      }
      if (resp.data?.choices?.[0]?.message?.content === undefined) {
        throw new Error("Réponse de l'API Kimi mal formatée");
      }
      return resp.data.choices[0].message.content;
    };

    const kimiCallWithRetry = async (msgs) => {
      let lastError = null;
      for (let attempt = 0; attempt <= kimiRetryCount; attempt += 1) {
        try {
          // eslint-disable-next-line no-await-in-loop
          return await kimiCallWithMessages(msgs);
        } catch (error) {
          lastError = error;
          const statusCode = getKimiStatusCode(error);
          const retryable = isRetryableKimiError(error);
          if (!retryable || attempt >= kimiRetryCount) {
            break;
          }
          const jitterMs = Math.floor(Math.random() * 250);
          const backoffMs = Math.min(20000, kimiRetryDelayMs * (2 ** attempt) + jitterMs);
          logger.warn(`[Kimi Agent API] Tentative ${attempt + 1}/${kimiRetryCount + 1} echouee (status=${statusCode || 'n/a'}, code=${error?.code || 'n/a'}), retry dans ${backoffMs}ms`);
          // eslint-disable-next-line no-await-in-loop
          await sleep(backoffMs);
        }
      }
      throw lastError || new Error('Echec appel API Kimi');
    };

    logger.info(`[Kimi Agent API] Création du prompt et appel du modèle ${model}...`);

    try {
      // Kimi fast path: no terminal tool loop unless explicitly enabled
      let messages = buildMessages(effectiveHistory, prompt);
      let fullTranscript = '';
      if (!reactMode) {
        const aiText = await kimiCallWithRetry(messages);
        return { success: true, text: aiText, terminalActions: 0, mode: 'single' };
      }

      const MAX_ITERATIONS = reactMaxIterations;

      for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
        logger.info(`[Kimi Agent API] Itération ReAct ${iter + 1}/${MAX_ITERATIONS}...`);
        const aiText = await kimiCallWithRetry(messages);
        logger.info(`[Kimi Agent API] Réponse de l'IA (Itération ${iter + 1}):\n${aiText}`);

        fullTranscript += (iter > 0 ? '\n\n---\n\n' : '') + aiText;

        const cmd = parseRunCommand(aiText);
        if (!cmd) {
          // No command → done
          return { success: true, text: fullTranscript, terminalActions: iter };
        }

        // Emit terminal action event to renderer
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('ai-terminal-action', { command: cmd, iteration: iter + 1 });
        }

        const { output } = await executeCommandForAI(cmd, projectPath);

        // Feed result back as new user message
        messages = [
          ...messages,
          { role: 'assistant', content: aiText },
          { role: 'user', content: `[RÉSULTAT TERMINAL — itération ${iter + 1}]\n\`\`\`\n${output}\n\`\`\`\nContinue si nécessaire. Si tu as terminé, réponds sans balise <run_command>.` }
        ];

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('ai-terminal-result', { command: cmd, output, iteration: iter + 1 });
        }
      }

      // Reached max iterations — return what we have
      return { success: true, text: fullTranscript, terminalActions: MAX_ITERATIONS };

    } catch (error) {
      const statusCode = getKimiStatusCode(error);
      const retryable = isRetryableKimiError(error);
      const errorMsg = formatKimiErrorMessage(error, statusCode);
      const payload = {
        statusCode: statusCode || null,
        code: error?.code || null,
        retryable,
        message: error?.message || String(error)
      };
      logger.error(`[Kimi Agent API] Erreur Together: ${JSON.stringify(payload)}`);
      if (error?.response?.data) {
        logger.error(`[Kimi Agent API] Corps erreur Together: ${JSON.stringify(error.response.data).slice(0, 2000)}`);
      }
      return {
        success: false,
        error: errorMsg,
        retryable,
        statusCode: statusCode || undefined,
        errorCode: error?.code || undefined,
        provider: 'kimi'
      };
    }
  } catch (error) {
    const errorMsg = `Erreur inattendue Kimi: ${error.message || 'Erreur inconnue'}`;
    console.error('[Main][Kimi]', errorMsg, error);
    return { success: false, error: errorMsg, retryable: false, provider: 'kimi' };
  }
});

// --- IPC Handler pour lister les modèles Gemini disponibles ---
ipcMain.handle('list-gemini-models', async (event, apiKey) => {
  const key = apiKey || process.env.GEMINI_API_KEY;

  if (!key) {
    return { success: false, error: "Clé API Gemini non fournie" };
  }

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;
    const response = await axios.get(url);

    if (response.data && response.data.models) {
      // Filtrer les modèles qui supportent generateContent
      const generateModels = response.data.models.filter(model =>
        model.supportedGenerationMethods &&
        model.supportedGenerationMethods.includes('generateContent')
      );

      return {
        success: true,
        models: generateModels.map(model => ({
          name: model.name.split('/').pop(),
          fullName: model.name,
          displayName: model.displayName,
          description: model.description,
          methods: model.supportedGenerationMethods
        }))
      };
    } else {
      return { success: false, error: "Aucun modèle trouvé" };
    }
  } catch (error) {
    console.error('Erreur lors de la liste des modèles Gemini:', error);
    return {
      success: false,
      error: error.response?.data?.message || error.message
    };
  }
});

const normalizeCompletionProvider = (value) => {
  const provider = String(value || '').trim().toLowerCase();
  if (provider === 'claude' || provider === 'kimi' || provider === 'ollama') return provider;
  return 'gemini';
};

const stripCompletionMarkdown = (value, { trimEndOnly = false } = {}) => {
  const source = String(value || '')
    .replace(/^```[a-z]*\n/i, '')
    .replace(/\n```$/i, '');
  return trimEndOnly ? source.trimEnd() : source.trim();
};

async function runSingleCompletionProvider({ provider, systemInstruction, userPrompt, options = {}, maxTokens = 512, trimEndOnly = false }) {
  const rawProvider = String(provider || '').trim().toLowerCase();
  if (options.disallowProviderFallback && !['gemini', 'claude', 'kimi', 'ollama'].includes(rawProvider)) {
    return { success: false, error: `Provider completion non pris en charge: ${provider || 'aucun'}` };
  }
  const normalizedProvider = normalizeCompletionProvider(provider);
  const temperature = Number.isFinite(Number(options.temperature)) ? Number(options.temperature) : 0.1;

  if (options.localOnly && normalizedProvider !== 'ollama') {
    return {
      success: false,
      error: `Local-only actif: provider cloud interdit (${normalizedProvider}).`,
      provider: normalizedProvider
    };
  }

  if (normalizedProvider === 'kimi') {
    const apiKey = options.apiKey || process.env.KIMI_API_KEY || process.env.TOGETHER_API_KEY;
    const model = options.model || process.env.KIMI_MODEL || DEFAULT_KIMI_MODEL;
    if (!apiKey) return { success: false, error: "La cle API Together/Kimi est requise.", provider: 'kimi', model };

    const resp = await axios.post(options.apiUrl || process.env.KIMI_API_URL || 'https://api.together.xyz/v1/chat/completions', {
      model,
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: userPrompt }
      ],
      max_tokens: maxTokens,
      temperature
    }, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 60000
    });

    const text = resp.data?.choices?.[0]?.message?.content || '';
    return { success: true, text: stripCompletionMarkdown(text, { trimEndOnly }), provider: 'kimi', model };
  }

  if (normalizedProvider === 'claude') {
    const apiKey = options.apiKey || process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY;
    const model = options.model || process.env.CLAUDE_MODEL || DEFAULT_CLAUDE_MODEL;
    if (!apiKey) return { success: false, error: "La cle API Claude est requise.", provider: 'claude', model };

    const anthropic = new Anthropic({ apiKey });
    const resp = await anthropic.messages.create({
      model,
      max_tokens: maxTokens,
      temperature,
      system: systemInstruction,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const text = Array.isArray(resp.content)
      ? resp.content.map((part) => part?.text || '').join('')
      : '';
    return { success: true, text: stripCompletionMarkdown(text, { trimEndOnly }), provider: 'claude', model };
  }

  if (normalizedProvider === 'ollama') {
    const requestedModel = normalizeOllamaModelName(options.model || process.env.OLLAMA_MODEL);
    const startResult = await startOllamaServerIfPossible();
    if (!startResult.success) {
      return { success: false, error: startResult.error || 'Ollama indisponible.', provider: 'ollama', requestedModel };
    }

    const tagsResponse = await fetchOllamaTags(OLLAMA_BASE_URL, 5000);
    const installedModelNames = extractOllamaModelNames(tagsResponse?.data);
    const model = pickInstalledOllamaModel(requestedModel, installedModelNames, FALLBACK_OLLAMA_MODEL_CANDIDATES);
    if (!model) {
      return { success: false, error: 'Ollama: aucun modele installe compatible.', provider: 'ollama', requestedModel };
    }

    const resp = await axios.post(`${OLLAMA_BASE_URL}/api/chat`, {
      model,
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: userPrompt }
      ],
      stream: false,
      think: computeOllamaThink(model, options.thinkingMode),
      keep_alive: OLLAMA_KEEP_ALIVE,
      options: {
        temperature,
        num_predict: maxTokens
      }
    }, { timeout: 90000 });

    const text = stripThinkBlocks(resp.data?.message?.content || '');
    return { success: true, text: stripCompletionMarkdown(text, { trimEndOnly }), provider: 'ollama', requestedModel, model };
  }

  const apiKey = options.apiKey || process.env.GEMINI_API_KEY;
  const model = options.model || process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  if (!apiKey) return { success: false, error: "La cle API Gemini est requise.", provider: 'gemini', model };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const payload = {
    system_instruction: { parts: [{ text: systemInstruction }] },
    contents: [
      {
        role: 'user',
        parts: [{ text: userPrompt }]
      }
    ],
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens
    }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || `Erreur HTTP: ${response.status}`);
  }

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return { success: true, text: stripCompletionMarkdown(text, { trimEndOnly }), provider: 'gemini', model };
}

// --- IPC Handler for Inline Completion (Ghost Text / Ctrl+K) ---
ipcMain.handle('get-inline-completion', async (event, prompt, code, options = {}) => {
  const systemInstruction = `Tu es un assistant de complétion de code ultra-strict.
RÈGLES ABSOLUES:
1. Ne renvoie QUE le code complété ou modifié.
2. N'ajoute AUCUN bloc markdown (\`\`\`), ni préfixe, ni texte explicatif.
3. Le texte que tu renvoies remplacera EXACTEMENT la sélection de l'utilisateur.`;

  try {
    return await runSingleCompletionProvider({
      provider: options.provider,
      systemInstruction,
      userPrompt: `CONTEXTE DU FICHIER:\n${code}\n\nINSTRUCTION OU CODE SELECTIONNE:\n${prompt}`,
      options,
      maxTokens: 2048
    });
  } catch (error) {
    console.error('[Main] Erreur Inline Completion:', error);
    return { success: false, error: error.message };
  }
});

// --- IPC Handler for Ghost Text / Autocomplete (FIM) ---
ipcMain.handle('get-ghost-completion', async (event, prefix, suffix, options = {}) => {
  const systemInstruction = `Tu es une IA ultra-rapide d'autocomplétion de code (Fill-In-The-Middle).
Ton but est de prédire EXACTEMENT le code qui manque entre le <PREFIX> (avant le curseur) et le <SUFFIX> (après le curseur).
RÈGLES ABSOLUES:
1. NE RENVOIE QUE LE TEXTE MANQUANT. Rien d'autre.
2. N'ajoute AUCUN bloc markdown (\`\`\`), ni préfixe, ni explication.
3. Si aucune complétion n'est logique, renvoie une chaîne vide.`;

  try {
    return await runSingleCompletionProvider({
      provider: options.provider,
      systemInstruction,
      userPrompt: `<PREFIX>\n${prefix}\n</PREFIX>\n\n<SUFFIX>\n${suffix}\n</SUFFIX>`,
      options,
      maxTokens: 256,
      trimEndOnly: true
    });
  } catch (error) {
    console.error('[Main] Erreur Ghost Completion:', error);
    return { success: false, error: error.message };
  }
});

// --- IPC Handler pour l'API Gemini ---
ipcMain.handle('get-gemini-completion', async (event, history, currentCode, allProjectFiles = null, options = {}) => {
  if (options.localOnly) {
    return { success: false, error: 'Local-only actif: Gemini interdit.', provider: 'gemini' };
  }
  const apiKey = options.apiKey || process.env.GEMINI_API_KEY; // Clé prioritaire depuis les Settings côté renderer
  const modelFromEnv = process.env.GEMINI_MODEL;
  const modelFromOptions = options.model;
  const model = modelFromOptions || modelFromEnv || DEFAULT_GEMINI_MODEL;
  const thinkingMode = !!options.thinkingMode;
  const images = Array.isArray(options.images) ? options.images : [];

  console.log('[Main] Appel Gemini: Vérification de la clé API...');
  console.log('[Main] Options reçues:', {
    hasApiKeyOption: !!options.apiKey,
    hasEnvApiKey: !!process.env.GEMINI_API_KEY,
    model,
    thinkingMode,
    hasHistory: !!history,
    historyLength: history?.length
  });

  // Vérification de la clé API
  if (!apiKey) {
    const errorMsg = "La clé API Gemini n'est pas configurée. Veuillez définir GEMINI_API_KEY dans votre environnement.";
    console.error('[Main] Erreur:', errorMsg);
    dialog.showErrorBox('Erreur API Gemini', errorMsg);
    return { success: false, error: errorMsg };
  }

  console.log('[Main] Clé API Gemini détectée.');

  // Vérification de l'historique
  if (!history || !Array.isArray(history) || history.length === 0) {
    const errorMsg = "Aucun historique de conversation n'a été fourni. Impossible de traiter la requête.";
    console.error('[Main] Erreur:', errorMsg);
    return { success: false, error: errorMsg };
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const redactedUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=***`;
  console.log(`[Main] Appel à l'URL Gemini: ${redactedUrl}`);

  try {
    // Filtrer l'historique pour ne garder que les rôles valides pour l'API Gemini
    const validHistory = history.filter(msg =>
      msg &&
      typeof msg === 'object' &&
      (msg.role === 'user' || msg.role === 'model') &&
      msg.text !== undefined
    );

    if (validHistory.length === 0) {
      const errorMsg = "Aucun message valide avec les rôles 'user' ou 'model' trouvé dans l'historique.";
      console.error('[Main] Erreur:', errorMsg);
      return { success: false, error: errorMsg };
    }

    // Formatage de l'historique pour l'API Gemini
    // L'historique reçu de App.js est de la forme { role: 'user', text: '...', images?: [...] }
    // L'API Gemini attend { role: 'user', parts: [{ text: '...' }, { inline_data: { ... } }, ...] }
    const formattedHistory = validHistory.map(msg => {
      const parts = [{ text: String(msg.text) }];

      if (Array.isArray(msg.images)) {
        msg.images.forEach(img => {
          if (!img || !img.dataUrl) return;
          const match = String(img.dataUrl).match(/^data:(.+);base64,(.+)$/);
          if (!match) return;
          const mimeType = img.mimeType || match[1];
          const data = match[2];
          parts.push({
            inline_data: {
              mime_type: mimeType,
              data
            }
          });
        });
      }

      return {
        role: msg.role,
        parts
      };
    });

    // Vérifier que le dernier message est bien formaté
    const lastMessage = formattedHistory[formattedHistory.length - 1];
    if (!lastMessage || !lastMessage.parts || !lastMessage.parts[0] || !lastMessage.parts[0].text) {
      const errorMsg = "Le dernier message de l'historique est mal formaté.";
      console.error('[Main] Erreur:', errorMsg, 'Dernier message:', lastMessage);
      return { success: false, error: errorMsg };
    }

    const projectPath = await resolveOptionalTrustedProjectPath(options.projectPath);

    // Construire le contexte du projet si disponible
    let projectContext = '';
    if (allProjectFiles && allProjectFiles.files) {
      projectContext = '\n--- CONTEXTE COMPLET DU PROJET ---\n';
      const fileEntries = Object.entries(allProjectFiles.files);

      // Limiter le nombre de fichiers pour éviter de dépasser les limites de l'API
      const maxFiles = 20;
      const filesToShow = pickFilesForContext(allProjectFiles.files, maxFiles);

      for (const [filePath, fileData] of filesToShow) {
        projectContext += `\n=== FICHIER: ${filePath} ===\n`;
        if (fileData.content && !fileData.content.startsWith('[')) {
          // Limiter la taille du contenu pour chaque fichier
          const maxContentLength = 2000;
          const content = fileData.content.length > maxContentLength
            ? fileData.content.substring(0, maxContentLength) + '\n[...CONTENU TRONQUÉ...]'
            : fileData.content;
          projectContext += content;
        } else {
          projectContext += fileData.content || '[Contenu non disponible]';
        }
        projectContext += '\n=== FIN FICHIER ===\n';
      }

      if (fileEntries.length > maxFiles) {
        projectContext += `\n[...ET ${fileEntries.length - maxFiles} AUTRES FICHIERS]\n`;
      }
      projectContext += '--- FIN CONTEXTE PROJET ---\n';
    }

    const agentPrompt = await loadAgentForCompletion(options.agent, projectPath);
    // Replace single skill loading with all global skills
    const globalSkillsContent = await loadAllGlobalSkillsForCompletion();
    const selectedSkill = await loadSkillForCompletion(options.skill, projectPath);
    const visualWorkflowContext = await buildVisualWorkflowContextForPrompt(projectPath, lastMessage.parts?.[0]?.text || '', options);
    const n8nCatalogContext = await buildN8nCatalogContextForPrompt(lastMessage.parts?.[0]?.text || '', options);

    const agentContext = agentPrompt
      ? `\n--- AGENT PERSONA (${agentPrompt.name}) ---\n${agentPrompt.body}\n--- FIN AGENT ---\n`
      : '';

    const skillContext = [
      globalSkillsContent
        ? `\n--- SKILLS GLOBAUX INSTALLÉS ---\n${globalSkillsContent}\n--- FIN SKILLS GLOBAUX ---\n`
        : '',
      selectedSkill
        ? `\n--- SKILL SELECTIONNÉ (${selectedSkill.name}) ---\n${selectedSkill.content}\n--- FIN SKILL SELECTIONNÉ ---\n`
        : '',
      formatAvailableSkillsListForPrompt(options.skillsContent)
    ].filter(Boolean).join('\n');

    const thinkingInstructionsGemini = thinkingMode
      ? `
      MODE THINKING ACTIVÉ :
      - Détaillez explicitement votre raisonnement étape par étape.
      - Justifiez les choix techniques avant de montrer le code final.
      `
      : '';

    // Le prompt est construit ici dans le processus principal
    const prompt = `
      Vous êtes un assistant de développement expert et autonome, comme Cascade AI.
      ${agentContext}
      ${skillContext}
      ${projectContext}
      ${visualWorkflowContext}
      ${n8nCatalogContext}
      
      FICHIER ACTUELLEMENT OUVERT :
      --- CODE ACTUEL ---
      ${currentCode || 'Aucun code fourni'}
      ---
      
      DEMANDE DE L'UTILISATEUR :
      ${lastMessage.parts[0].text}

      ${thinkingInstructionsGemini}

      ${TERMINAL_CAPABILITY_PROMPT}

      INSTRUCTIONS POUR AGIR COMME UN AGENT AUTONOME :
      
      1. **ANALYSE COMPLÈTE** :
         - Analysez le contexte complet du projet
         - Identifiez les patterns, l'architecture, et les dépendances
         - Comprenez l'intention derrière la demande
      
      2. **MODIFICATIONS PRÉCISES** :
         - Pour chaque fichier à modifier, utilisez ce format :
         
         **FICHIER: nom_du_fichier.ext**
         \`\`\`langage
         // Code complet du fichier avec vos modifications
         // Incluez TOUT le contenu, pas seulement les changements
         \`\`\`
         
      3. **ACTIONS AUTONOMES** :
         - Corrigez automatiquement les erreurs détectées
         - Ajoutez les imports/dépendances nécessaires
         - Optimisez le code selon les meilleures pratiques
         - Créez de nouveaux fichiers si nécessaire
      
      4. **COMMUNICATION CLAIRE** :
         - Expliquez brièvement ce que vous faites
         - Mentionnez les améliorations apportées
         - Signalez les points d'attention
      
      5. **FORMATS SUPPORTÉS** :
         - JavaScript/TypeScript: \`\`\`javascript ou \`\`\`typescript
         - HTML: \`\`\`html
         - CSS: \`\`\`css
         - Python: \`\`\`python
         - JSON: \`\`\`json
         - Markdown: \`\`\`markdown
      
      AGISSEZ COMME UN DÉVELOPPEUR EXPERT QUI COMPREND LE CONTEXTE ET FAIT DES MODIFICATIONS INTELLIGENTES.
    `;

    // Les contenus à envoyer à l'API incluent l'historique formaté (sauf la dernière requête qui est dans le prompt)
    const inlineImageParts = (Array.isArray(images) ? images : [])
      .map(img => {
        if (!img || !img.dataUrl) return null;
        const match = String(img.dataUrl).match(/^data:(.+);base64,(.+)$/);
        if (!match) return null;
        const mimeType = img.mimeType || match[1];
        const data = match[2];
        return {
          inline_data: {
            mime_type: mimeType,
            data
          }
        };
      })
      .filter(Boolean);

    const finalUserParts = [
      { text: prompt },
      ...inlineImageParts
    ];

    const buildGeminiContents = (extraMessages = []) => [
      ...formattedHistory.slice(0, -1),
      { role: 'user', parts: finalUserParts },
      ...extraMessages
    ];

    logger.info('[Gemini Agent API] Création du prompt et appel du modèle...');

    try {
      const geminiCallWithContents = async (contents) => {
        const resp = await axios.post(url, { contents });
        if (resp.data?.candidates?.[0]?.content?.parts?.[0]?.text === undefined) {
          throw new Error("Réponse de l'API Gemini mal formatée");
        }
        return resp.data.candidates[0].content.parts[0].text;
      };

      // ReAct agent loop — max 8 iterations
      let contents = buildGeminiContents();
      let fullTranscript = '';
      const MAX_ITERATIONS = 8;

      for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
        logger.info(`[Gemini Agent API] Itération ReAct ${iter + 1}/${MAX_ITERATIONS}...`);
        const aiText = await geminiCallWithContents(contents);
        logger.info(`[Gemini Agent API] Réponse de l'IA (Itération ${iter + 1}):\n${aiText}`);

        fullTranscript += (iter > 0 ? '\n\n---\n\n' : '') + aiText;

        const cmd = parseRunCommand(aiText);
        if (!cmd) {
          return { success: true, text: fullTranscript, terminalActions: iter };
        }

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('ai-terminal-action', { command: cmd, iteration: iter + 1 });
        }

        const { output } = await executeCommandForAI(cmd, projectPath);

        // Append model response and new tool result
        contents = [
          ...contents,
          { role: 'model', parts: [{ text: aiText }] },
          { role: 'user', parts: [{ text: `[RÉSULTAT TERMINAL — itération ${iter + 1}]\n\`\`\`\n${output}\n\`\`\`\nContinue si nécessaire. Si tu as terminé, réponds sans balise <run_command>.` }] }
        ];

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('ai-terminal-result', { command: cmd, output, iteration: iter + 1 });
        }
      }

      return { success: true, text: fullTranscript, terminalActions: MAX_ITERATIONS };

    } catch (error) {
      if (error.response && error.response.status === 429) {
        const errorMsg = "Limite de requêtes atteinte (Quota API Gemini épuisé ou trop de requêtes rapides). Veuillez patienter quelques instants avant de réessayer.";
        logger.error('[Gemini Agent API] Erreur 429 Rate Limit:', error.response.data);
        dialog.showErrorBox('Erreur API Gemini (Trop de requêtes)', errorMsg);
        return { success: false, error: 'Rate limit (429)' };
      }

      logger.error("[Gemini Agent API] Erreur lors de l'appel à l'API Gemini:", error.response ? error.response.data : error.message);
      dialog.showErrorBox('Erreur API Gemini', `Erreur lors de l'appel à l'API Gemini: ${error.message}.`);
      return { success: false, error: error.message };
    }
  } catch (error) {
    // Gestion des erreurs globales de la fonction
    const errorMsg = `Erreur inattendue: ${error.message || 'Erreur inconnue'}`;
    console.error('[Main]', errorMsg, error);
    dialog.showErrorBox('Erreur', errorMsg);
    return { success: false, error: errorMsg };
  }
});

// ==================== WORKFLOW SYSTEM ====================

// Get the global workflows directory
const getGlobalWorkflowsDir = () => {
  return path.join(app.getPath('userData'), 'workflows');
};

// Get the workspace workflows directory
const getWorkspaceWorkflowsDir = (projectPath) => {
  return path.join(projectPath, '.agent', 'workflows');
};

// Parse workflow file content
const parseWorkflowFile = (content) => {
  const lines = content.split('\n');
  let description = '';
  let body = content;

  // Check for YAML frontmatter
  if (lines[0] && lines[0].trim() === '---') {
    let endIndex = -1;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === '---') {
        endIndex = i;
        break;
      }
      // Parse description from frontmatter
      const match = lines[i].match(/^description:\s*(.+)$/i);
      if (match) {
        description = match[1].trim();
      }
    }
    if (endIndex > 0) {
      body = lines.slice(endIndex + 1).join('\n').trim();
    }
  }

  return { description, body };
};

registerWorkflowHandlers({
  ipcMain,
  app,
  fs,
  path,
  ensureEditPermission,
  ensureTrustedProjectPath,
  assertSafePath,
  toPositiveInt,
  getN8nCatalogEntries,
  fetchTrustedN8nWorkflow
});

registerBrainGraphHandlers({
  ipcMain,
  ensureTrustedProjectPath,
  assertSafePath
});

// ==================== CLAUDE API INTEGRATION ====================
const Anthropic = require('@anthropic-ai/sdk');

ipcMain.handle('get-claude-completion', async (event, history, currentCode, allProjectFiles = null, options = {}) => {
  if (options.localOnly) {
    return { success: false, error: 'Local-only actif: Claude interdit.', provider: 'claude' };
  }
  const apiKey = options.apiKey || process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY;
  const modelFromEnv = process.env.CLAUDE_MODEL;
  const model = options.model || modelFromEnv || DEFAULT_CLAUDE_MODEL;
  const thinkingMode = !!options.thinkingMode;
  const images = Array.isArray(options.images) ? options.images : [];

  console.log(`[Main] Appel Claude (${model}): Vérification de la clé API...`);

  if (!apiKey) {
    const errorMsg = "La clé API Claude n'est pas configurée. Veuillez définir CLAUDE_API_KEY dans votre environnement ou les paramètres.";
    console.error('[Main][Claude] Erreur:', errorMsg);
    dialog.showErrorBox('Erreur API Claude', errorMsg);
    return { success: false, error: errorMsg };
  }

  if (!history || !Array.isArray(history) || history.length === 0) {
    const errorMsg = "Aucun historique de conversation n'a été fourni pour Claude.";
    console.error('[Main][Claude] Erreur:', errorMsg);
    return { success: false, error: errorMsg };
  }

  try {
    const validHistory = history.filter(msg =>
      msg && typeof msg === 'object' && msg.text !== undefined
    );

    if (validHistory.length === 0) {
      return { success: false, error: "Aucun message valide trouvé." };
    }

    const projectPath = await resolveOptionalTrustedProjectPath(options.projectPath);
    const lastUserText = String(validHistory[validHistory.length - 1]?.text || '');
    let projectContext = '';
    if (allProjectFiles && allProjectFiles.files) {
      projectContext = '\n--- CONTEXTE COMPLET DU PROJET ---\n';
      const fileEntries = Object.entries(allProjectFiles.files);
      const maxFiles = 20;
      const filesToShow = pickFilesForContext(allProjectFiles.files, maxFiles);

      for (const [filePath, fileData] of filesToShow) {
        projectContext += `\n=== FICHIER: ${filePath} ===\n`;
        if (fileData.content && !String(fileData.content).startsWith('[')) {
          const maxContentLength = 2000;
          const content = fileData.content.length > maxContentLength
            ? fileData.content.substring(0, maxContentLength) + '\n[...CONTENU TRONQUÉ...]'
            : fileData.content;
          projectContext += content;
        } else {
          projectContext += fileData.content || '[Contenu non disponible]';
        }
        projectContext += '\n=== FIN FICHIER ===\n';
      }
      if (fileEntries.length > maxFiles) {
        projectContext += `\n[...ET ${fileEntries.length - maxFiles} AUTRES FICHIERS]\n`;
      }
      projectContext += '--- FIN CONTEXTE PROJET ---\n';
    }

    const agentPrompt = await loadAgentForCompletion(options.agent, projectPath);
    const globalSkillsContent = await loadAllGlobalSkillsForCompletion();
    const selectedSkill = await loadSkillForCompletion(options.skill, projectPath);
    const visualWorkflowContext = await buildVisualWorkflowContextForPrompt(projectPath, lastUserText, options);
    const n8nCatalogContext = await buildN8nCatalogContextForPrompt(lastUserText, options);

    const agentContext = agentPrompt
      ? `\n--- AGENT PERSONA (${agentPrompt.name}) ---\n${agentPrompt.body}\n--- FIN AGENT ---\n`
      : '';

    const skillContext = [
      globalSkillsContent
        ? `\n--- SKILLS GLOBAUX INSTALLÉS ---\n${globalSkillsContent}\n--- FIN SKILLS GLOBAUX ---\n`
        : '',
      selectedSkill
        ? `\n--- SKILL SELECTIONNÉ (${selectedSkill.name}) ---\n${selectedSkill.content}\n--- FIN SKILL SELECTIONNÉ ---\n`
        : '',
      formatAvailableSkillsListForPrompt(options.skillsContent)
    ].filter(Boolean).join('\n');

    const thinkingInstructions = thinkingMode
      ? `\nMODE THINKING ACTIVÉ : Détaillez explicitement votre raisonnement étape par étape dans des balises <thinking> avant de proposer le code final.\n`
      : '';

    const systemPrompt = `
      Vous êtes un assistant de développement expert et autonome, comme Cascade AI.
      ${agentContext}
      ${skillContext}
      ${projectContext}
      ${visualWorkflowContext}
      ${n8nCatalogContext}
      
      FICHIER ACTUELLEMENT OUVERT :
      --- CODE ACTUEL ---
      ${currentCode || 'Aucun code fourni'}
      ---
      
      ${thinkingInstructions}
      ${TERMINAL_CAPABILITY_PROMPT}
      
      INSTRUCTIONS POUR AGIR COMME UN AGENT AUTONOME :
      1. **ANALYSE COMPLÈTE** : Analysez le contexte complet du projet
      2. **MODIFICATIONS PRÉCISES** : Pour chaque fichier à modifier, utilisez ce format strict :
         **FICHIER: nom_du_fichier.ext**
         \`\`\`langage
         // Code complet du fichier avec vos modifications
         \`\`\`
      3. **ACTIONS AUTONOMES** : Utilisez <run_command> pour interagir avec le terminal si besoin.
    `;

    const anthropic = new Anthropic({ apiKey });

    // Convert history to Anthropic format
    const messages = validHistory.map((msg, index) => {
      // Anthropic requires alternating user/assistant messages, starting with user.
      // For simplicity in this implementation, we map roles directly but keep in mind consecutive roles might need merging in production
      let role = msg.role === 'model' ? 'assistant' : 'user';
      let content = [];

      content.push({ type: 'text', text: String(msg.text) });

      if (msg.images && Array.isArray(msg.images)) {
        msg.images.forEach(img => {
          if (!img || !img.dataUrl) return;
          const match = String(img.dataUrl).match(/^data:(image\/[^;]+);base64,(.+)$/);
          if (match) {
            content.push({
              type: 'image',
              source: {
                type: 'base64',
                media_type: match[1],
                data: match[2],
              }
            });
          }
        });
      }
      return { role, content };
    });

    // Enforce role alternating for Anthropic API
    let mergedMessages = [];
    for (const msg of messages) {
      if (mergedMessages.length > 0 && mergedMessages[mergedMessages.length - 1].role === msg.role) {
        // Merge content
        mergedMessages[mergedMessages.length - 1].content = [
          ...mergedMessages[mergedMessages.length - 1].content,
          { type: 'text', text: '\n\n' },
          ...msg.content
        ];
      } else {
        mergedMessages.push(msg);
      }
    }

    // Anthropic API requires first message to be role 'user'
    if (mergedMessages.length > 0 && mergedMessages[0].role !== 'user') {
      mergedMessages.unshift({ role: 'user', content: [{ type: 'text', text: '(Contexte initial)' }] });
    }

    logger.info(`[Claude Agent API] Création du prompt et appel du modèle ${model}...`);

    const claudeCallWithMessages = async (msgs) => {
      const response = await anthropic.messages.create({
        model: model,
        max_tokens: options.maxTokens || 4096,
        temperature: options.temperature || 0.7,
        system: systemPrompt,
        messages: msgs
      });
      return response.content[0].text;
    };

    const MAX_ITERATIONS = 8;
    let fullTranscript = '';
    let currentMessages = [...mergedMessages];

    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      logger.info(`[Claude Agent API] Itération ReAct ${iter + 1}/${MAX_ITERATIONS}...`);
      const aiText = await claudeCallWithMessages(currentMessages);
      logger.info(`[Claude Agent API] Réponse de l'IA (Itération ${iter + 1}):\n${aiText}`);

      fullTranscript += (iter > 0 ? '\n\n---\n\n' : '') + aiText;

      const cmd = parseRunCommand(aiText);
      if (!cmd) {
        return { success: true, text: fullTranscript, terminalActions: iter };
      }

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('ai-terminal-action', { command: cmd, iteration: iter + 1 });
      }

      const { output } = await executeCommandForAI(cmd, projectPath);

      currentMessages = [
        ...currentMessages,
        { role: 'assistant', content: [{ type: 'text', text: aiText }] },
        { role: 'user', content: [{ type: 'text', text: `[RÉSULTAT TERMINAL — itération ${iter + 1}]\n\`\`\`\n${output}\n\`\`\`\nContinue si nécessaire. Si tu as terminé, réponds sans balise <run_command>.` }] }
      ];

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('ai-terminal-result', { command: cmd, output, iteration: iter + 1 });
      }
    }

    return { success: true, text: fullTranscript, terminalActions: MAX_ITERATIONS };

  } catch (error) {
    if (error.status === 429) {
      const errorMsg = "Limite de requêtes atteinte (Quota API Anthropic/Claude épuisé ou trop de requêtes). Veuillez patienter quelques instants avant de réessayer.";
      logger.error('[Claude Agent API] Erreur 429 Rate Limit:', error);
      dialog.showErrorBox('Erreur API Claude (Trop de requêtes)', errorMsg);
      return { success: false, error: 'Rate limit (429)' };
    }
    logger.error("[Claude Agent API] Erreur API:", error);
    dialog.showErrorBox('Erreur API Claude', `Erreur lors de l'appel à l'API Claude: ${error.message}.`);
    return { success: false, error: error.message };
  }
});



// ==================== VISUAL WORKFLOW SYSTEM ====================

// ==================== SNAPSHOTS (AI ROLLBACK) ====================

ipcMain.handle('create-ai-snapshot', async (event, projectPath, files = [], label = 'ai') => {
  try {
    if (!projectPath) return { success: false, error: 'Chemin projet manquant' };
    const trustedProjectPath = await ensureTrustedProjectPath(projectPath);
    if (!Array.isArray(files) || files.length === 0) {
      return { success: false, error: 'Aucun fichier fourni pour le snapshot' };
    }

    const snapshotDir = getSnapshotDir(trustedProjectPath);
    await fs.mkdir(snapshotDir, { recursive: true });

    const snapshotId = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
    const normalizedFiles = Array.from(new Set(
      files
        .map((f) => toRelativeSnapshotPath(f))
        .filter(Boolean)
    ));

    const entries = [];
    for (const relPath of normalizedFiles) {
      const fullPath = path.join(trustedProjectPath, relPath);
      assertSafePath(trustedProjectPath, fullPath);
      const state = await readTextFileIfExists(fullPath);
      entries.push({
        path: relPath.replace(/\\/g, '/'),
        exists: state.exists,
        content: state.exists ? state.content : ''
      });
    }

    const snapshot = {
      id: snapshotId,
      label: String(label || 'ai'),
      createdAt: new Date().toISOString(),
      files: entries
    };

    const snapshotPath = path.join(snapshotDir, `${snapshotId}.json`);
    await fs.writeFile(snapshotPath, JSON.stringify(snapshot, null, 2), 'utf-8');
    return { success: true, snapshotId, snapshotPath, files: entries.length };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('list-ai-snapshots', async (event, projectPath) => {
  try {
    if (!projectPath) return { success: false, error: 'Chemin projet manquant' };
    const trustedProjectPath = await ensureTrustedProjectPath(projectPath);
    const snapshotDir = getSnapshotDir(trustedProjectPath);
    let files = [];
    try {
      files = await fs.readdir(snapshotDir);
    } catch {
      return { success: true, snapshots: [] };
    }

    const snapshots = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const fullPath = path.join(snapshotDir, file);
      try {
        const raw = await fs.readFile(fullPath, 'utf-8');
        const parsed = JSON.parse(raw);
        snapshots.push({
          id: parsed.id || file.replace(/\.json$/, ''),
          label: parsed.label || 'ai',
          createdAt: parsed.createdAt || null,
          fileCount: Array.isArray(parsed.files) ? parsed.files.length : 0
        });
      } catch {
        // ignore malformed snapshot
      }
    }

    snapshots.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    return { success: true, snapshots };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('restore-ai-snapshot', async (event, projectPath, snapshotId) => {
  try {
    await ensureEditPermission();

    if (!projectPath) return { success: false, error: 'Chemin projet manquant' };
    const trustedProjectPath = await ensureTrustedProjectPath(projectPath);
    if (!snapshotId) return { success: false, error: 'snapshotId manquant' };

    const snapshotRoot = getSnapshotDir(trustedProjectPath);
    const snapshotFile = path.join(snapshotRoot, `${snapshotId}.json`);
    assertSafePath(snapshotRoot, snapshotFile);
    const raw = await fs.readFile(snapshotFile, 'utf-8');
    const snapshot = JSON.parse(raw);
    const fileEntries = Array.isArray(snapshot.files) ? snapshot.files : [];

    let restored = 0;
    for (const entry of fileEntries) {
      const rel = toRelativeSnapshotPath(entry.path);
      if (!rel) continue;
      const fullPath = path.join(trustedProjectPath, rel);
      assertSafePath(trustedProjectPath, fullPath);

      if (!entry.exists) {
        try {
          await fs.unlink(fullPath);
        } catch {
          // ignore
        }
        restored += 1;
        continue;
      }

      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, String(entry.content || ''), 'utf-8');
      restored += 1;
    }

    return { success: true, restored, snapshotId };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('agent:listRuns', async (event, projectPath) => {
  try {
    const trustedProjectPath = await ensureTrustedProjectPath(projectPath);
    const runs = await listAgentRunsForProject(trustedProjectPath);
    return { success: true, runs };
  } catch (error) {
    return { success: false, error: error.message, runs: [] };
  }
});

ipcMain.handle('agent:getRun', async (event, projectPath, runId) => {
  try {
    const trustedProjectPath = await ensureTrustedProjectPath(projectPath);
    const run = await readAgentRun(trustedProjectPath, runId);
    return { success: true, run };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('agent:createRun', async (event, projectPath, payload = {}) => {
  try {
    const trustedProjectPath = await ensureTrustedProjectPath(projectPath);
    const run = normalizeAgentRunPayload(payload);
    await writeAgentRun(trustedProjectPath, run);
    return { success: true, run };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('agent:updateRun', async (event, projectPath, runId, patch = {}) => {
  try {
    const trustedProjectPath = await ensureTrustedProjectPath(projectPath);
    const run = await readAgentRun(trustedProjectPath, runId);
    const safePatch = patch && typeof patch === 'object' ? patch : {};
    const updated = normalizeAgentRunPayload({
      ...run,
      ...safePatch,
      id: run.id,
      changes: Array.isArray(safePatch.changes) ? safePatch.changes : run.changes,
      logs: Array.isArray(safePatch.logs) ? safePatch.logs : run.logs,
      updatedAt: new Date().toISOString()
    });
    await writeAgentRun(trustedProjectPath, updated);
    return { success: true, run: updated };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('agent:appendLog', async (event, projectPath, runId, log = {}) => {
  try {
    const trustedProjectPath = await ensureTrustedProjectPath(projectPath);
    const run = await readAgentRun(trustedProjectPath, runId);
    run.logs = [...(Array.isArray(run.logs) ? run.logs : []), normalizeAgentLogEntry(log)];
    run.updatedAt = new Date().toISOString();
    await writeAgentRun(trustedProjectPath, run);
    return { success: true, run };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('agent:updateChangeStatus', async (event, projectPath, runId, changeId, status, extra = {}) => {
  try {
    const trustedProjectPath = await ensureTrustedProjectPath(projectPath);
    const run = await updateAgentRunChange(trustedProjectPath, runId, changeId, (change) => ({
      ...change,
      ...(extra && typeof extra === 'object' ? extra : {}),
      status: normalizeAgentChangeStatus(status),
      updatedAt: new Date().toISOString()
    }));
    return { success: true, run };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('agent:applyChange', async (event, projectPath, runId, changeId) => {
  try {
    await ensureEditPermission();

    const trustedProjectPath = await ensureTrustedProjectPath(projectPath);
    const run = await readAgentRun(trustedProjectPath, runId);
    const change = (run.changes || []).find((entry) => entry.id === changeId);
    if (!change) return { success: false, error: 'Changement IA introuvable' };

    const relPath = toRelativeSnapshotPath(change.filePath);
    if (!relPath) return { success: false, error: 'Chemin de fichier invalide' };

    const fullPath = path.join(trustedProjectPath, relPath);
    assertSafePath(trustedProjectPath, fullPath);
    const currentState = await readTextFileIfExists(fullPath);
    const currentHash = currentState.exists ? hashAgentContent(currentState.content) : null;
    if (change.baseHash && currentHash !== change.baseHash) {
      const updatedRun = await updateAgentRunChange(trustedProjectPath, runId, changeId, (entry) => ({
        ...entry,
        status: 'conflict',
        currentHash,
        updatedAt: new Date().toISOString()
      }), {
        status: 'failed',
        log: {
          type: 'conflict',
          filePath: relPath,
          message: `Conflit detecte avant application: ${relPath}`
        }
      });
      return { success: false, code: 'FILE_MODIFIED', error: 'Conflit detecte avant application.', run: updatedRun };
    }

    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, String(change.newContent || ''), 'utf-8');
    const readBack = await fs.readFile(fullPath, 'utf-8');
    const verified = readBack === String(change.newContent || '');
    const stats = await fs.stat(fullPath);
    const nextHash = hashAgentContent(readBack);
    const nextStatus = verified ? 'verified' : 'failed';

    const updatedRun = await updateAgentRunChange(trustedProjectPath, runId, changeId, (entry) => ({
      ...entry,
      status: nextStatus,
      appliedAt: new Date().toISOString(),
      appliedHash: nextHash,
      appliedMtimeMs: Math.round(Number(stats?.mtimeMs || 0)),
      verified,
      updatedAt: new Date().toISOString()
    }), {
      status: verified ? 'verified' : 'failed',
      finishedAt: new Date().toISOString(),
      log: {
        type: verified ? 'verified' : 'failed',
        filePath: relPath,
        message: verified ? `Changement applique et relu: ${relPath}` : `Verification post-ecriture echouee: ${relPath}`
      }
    });

    return { success: verified, verified, run: updatedRun, mtimeMs: Math.round(Number(stats?.mtimeMs || 0)), hash: nextHash };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('agent:rejectChange', async (event, projectPath, runId, changeId) => {
  try {
    const trustedProjectPath = await ensureTrustedProjectPath(projectPath);
    const run = await updateAgentRunChange(trustedProjectPath, runId, changeId, (change) => ({
      ...change,
      status: 'rejected',
      rejectedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }), {
      log: {
        type: 'rejected',
        changeId,
        message: 'Changement IA rejete'
      }
    });
    return { success: true, run };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('agent:restoreRun', async (event, projectPath, runId) => {
  try {
    await ensureEditPermission();

    const trustedProjectPath = await ensureTrustedProjectPath(projectPath);
    const run = await readAgentRun(trustedProjectPath, runId);
    let restored = 0;

    for (const change of run.changes || []) {
      const relPath = toRelativeSnapshotPath(change.filePath);
      if (!relPath) continue;
      const fullPath = path.join(trustedProjectPath, relPath);
      assertSafePath(trustedProjectPath, fullPath);

      if (change.existedBefore === false || change.existed === false) {
        try {
          await fs.unlink(fullPath);
        } catch {
          // ignore missing files during restore
        }
        restored += 1;
        continue;
      }

      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, String(change.oldContent || ''), 'utf-8');
      restored += 1;
    }

    const restoredRun = normalizeAgentRunPayload({
      ...run,
      status: 'rolled_back',
      finishedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      changes: (run.changes || []).map((change) => ({
        ...change,
        status: change.status === 'rejected' ? change.status : 'rolled_back',
        updatedAt: new Date().toISOString()
      })),
      logs: [
        ...(Array.isArray(run.logs) ? run.logs : []),
        normalizeAgentLogEntry({
          type: 'rolled_back',
          message: `Run restaure (${restored} fichier(s))`
        })
      ]
    });
    await writeAgentRun(trustedProjectPath, restoredRun);
    return { success: true, restored, run: restoredRun };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ==================== AGENTS & SKILLS LIBRARY ====================

const getGlobalAgentsDir = () => path.join(app.getPath('userData'), 'agents');
const getWorkspaceAgentsDir = (projectPath) => path.join(projectPath, '.agent', 'agents');

const getGlobalSkillsDir = () => path.join(app.getPath('userData'), 'skills');
const getWorkspaceSkillsDir = (projectPath) => path.join(projectPath, '.agent', 'skills');

const getWorkspaceVisualWorkflowsDir = (projectPath) => path.join(projectPath, '.vibe-workflows');

const getPackTargets = (projectPath) => ({
  globalWorkflows: getGlobalWorkflowsDir(),
  globalAgents: getGlobalAgentsDir(),
  globalSkills: getGlobalSkillsDir(),
  workspaceWorkflows: projectPath ? getWorkspaceWorkflowsDir(projectPath) : null,
  workspaceAgents: projectPath ? getWorkspaceAgentsDir(projectPath) : null,
  workspaceSkills: projectPath ? getWorkspaceSkillsDir(projectPath) : null,
  workspaceVisualWorkflows: projectPath ? getWorkspaceVisualWorkflowsDir(projectPath) : null
});

ipcMain.handle('export-library-pack', async (event, projectPath, options = {}) => {
  try {
    const safeOptions = options && typeof options === 'object' ? options : {};
    const scope = safeOptions.scope === 'global' || safeOptions.scope === 'both' ? safeOptions.scope : 'workspace';
    const trustedProjectPath = scope === 'global' ? null : await ensureTrustedProjectPath(projectPath);

    const targets = getPackTargets(trustedProjectPath);
    const includeTarget = (key) => {
      if (scope === 'both') return true;
      if (scope === 'global') return key.startsWith('global');
      return key.startsWith('workspace');
    };

    const pack = {
      version: 1,
      exportedAt: new Date().toISOString(),
      app: 'MonIDEAgentIA',
      scope,
      sections: {}
    };

    for (const [section, dirPath] of Object.entries(targets)) {
      if (!dirPath || !includeTarget(section)) continue;
      const fileList = await collectFilesRecursive(dirPath, dirPath, []);
      const files = [];
      for (const relPath of fileList) {
        const safeRelPath = sanitizePackPath(relPath);
        if (!safeRelPath) continue;
        const fullPath = path.join(dirPath, safeRelPath);
        try {
          const content = await fs.readFile(fullPath, 'utf-8');
          files.push({ path: safeRelPath, content });
        } catch {
          // ignore unreadable file
        }
      }
      if (files.length > 0) {
        pack.sections[section] = files;
      }
    }

    const defaultName = `vibe-library-pack-${Date.now()}.json`;
    const saveResult = safeOptions.outputPath
      ? { canceled: false, filePath: safeOptions.outputPath }
      : await dialog.showSaveDialog(mainWindow, {
        title: 'Exporter pack bibliotheque',
        defaultPath: defaultName,
        filters: [{ name: 'Vibe Pack', extensions: ['json'] }]
      });

    if (saveResult.canceled || !saveResult.filePath) {
      return { success: false, canceled: true, error: 'Export annule' };
    }

    await fs.writeFile(saveResult.filePath, JSON.stringify(pack, null, 2), 'utf-8');
    const sectionCount = Object.values(pack.sections).reduce((sum, arr) => sum + arr.length, 0);
    return { success: true, path: saveResult.filePath, entries: sectionCount };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('import-library-pack', async (event, projectPath, options = {}) => {
  try {
    await ensureEditPermission();

    const safeOptions = options && typeof options === 'object' ? options : {};
    const overwrite = !!safeOptions.overwrite;
    const trustedProjectPath = projectPath ? await ensureTrustedProjectPath(projectPath) : null;

    const openResult = safeOptions.inputPath
      ? { canceled: false, filePaths: [safeOptions.inputPath] }
      : await dialog.showOpenDialog(mainWindow, {
        title: 'Importer pack bibliotheque',
        properties: ['openFile'],
        filters: [{ name: 'Vibe Pack', extensions: ['json'] }]
      });

    if (openResult.canceled || !Array.isArray(openResult.filePaths) || !openResult.filePaths[0]) {
      return { success: false, canceled: true, error: 'Import annule' };
    }

    const sourcePath = openResult.filePaths[0];
    const raw = await fs.readFile(sourcePath, 'utf-8');
    const parsed = JSON.parse(raw);
    const sections = parsed && typeof parsed === 'object' ? parsed.sections : null;
    if (!sections || typeof sections !== 'object') {
      return { success: false, error: 'Pack invalide: sections manquantes' };
    }

    const targets = getPackTargets(trustedProjectPath);
    let imported = 0;
    let skipped = 0;

    for (const [section, files] of Object.entries(sections)) {
      const targetRoot = targets[section];
      if (!targetRoot || !Array.isArray(files)) continue;
      await fs.mkdir(targetRoot, { recursive: true });

      for (const fileEntry of files) {
        const relPath = sanitizePackPath(fileEntry?.path);
        if (!relPath) {
          skipped += 1;
          continue;
        }
        const fullPath = path.join(targetRoot, relPath);
        assertSafePath(targetRoot, fullPath);

        const exists = fsSync.existsSync(fullPath);
        if (exists && !overwrite) {
          skipped += 1;
          continue;
        }

        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, String(fileEntry?.content || ''), 'utf-8');
        imported += 1;
      }
    }

    return { success: true, imported, skipped, sourcePath };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

const parseSimpleFrontMatter = (content) => {
  const raw = String(content || '');
  const lines = raw.split('\n');
  if (!lines[0] || lines[0].trim() !== '---') {
    return { meta: {}, body: raw };
  }

  const meta = {};
  let endIndex = -1;
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (String(line || '').trim() === '---') {
      endIndex = i;
      break;
    }

    const match = String(line || '').match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;

    const key = match[1];
    let value = match[2].trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    meta[key] = value;
  }

  const body = endIndex >= 0 ? lines.slice(endIndex + 1).join('\n').trim() : raw;
  return { meta, body };
};

const safeFileBase = (value) => {
  return String(value || '')
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, '-')
    .trim();
};

const truncateTextForPrompt = (text, maxChars, suffix = '\n[...TRUNCATED...]') => {
  const raw = String(text || '');
  const limit = Math.max(0, Number(maxChars) || 0);
  if (!limit || raw.length <= limit) return raw;
  return raw.slice(0, limit) + suffix;
};

const loadAgentForCompletion = async (agentSpec, projectPath) => {
  try {
    if (!agentSpec) return null;

    const scope = agentSpec.scope === 'workspace' ? 'workspace' : 'global';
    const rawName = typeof agentSpec === 'string' ? agentSpec : agentSpec.name;
    const safeName = safeFileBase(rawName);
    if (!safeName) return null;

    let filePath;
    if (scope === 'global') {
      filePath = path.join(getGlobalAgentsDir(), `${safeName}.md`);
    } else {
      if (!projectPath) return null;
      filePath = path.join(getWorkspaceAgentsDir(projectPath), `${safeName}.md`);
    }

    if (!fsSync.existsSync(filePath)) return null;
    const content = await fs.readFile(filePath, 'utf-8');
    const { meta, body } = parseSimpleFrontMatter(content);

    return {
      name: meta.name ? String(meta.name).trim() : safeName,
      description: meta.description ? String(meta.description).trim() : '',
      scope,
      body: truncateTextForPrompt(body, 12000, '\n[...TRUNCATED AGENT...]'),
      path: filePath
    };
  } catch {
    return null;
  }
};

const loadSkillForCompletion = async (skillSpec, projectPath) => {
  try {
    if (!skillSpec) return null;

    const scope = skillSpec.scope === 'workspace' ? 'workspace' : 'global';
    const rawName = typeof skillSpec === 'string' ? skillSpec : skillSpec.name;
    const safeName = safeFileBase(rawName);
    if (!safeName) return null;

    let dir;
    if (scope === 'global') dir = getGlobalSkillsDir();
    else {
      if (!projectPath) return null;
      dir = getWorkspaceSkillsDir(projectPath);
    }

    const skillDir = path.join(dir, safeName);
    const skillFile = path.join(skillDir, 'SKILL.md');
    if (!fsSync.existsSync(skillFile)) return null;

    const content = await fs.readFile(skillFile, 'utf-8');
    return {
      name: safeName,
      scope,
      content: truncateTextForPrompt(content, 16000, '\n[...TRUNCATED SKILL...]'),
      path: skillDir
    };
  } catch {
    return null;
  }
};

const loadAllGlobalSkillsForCompletion = async () => {
  try {
    const globalDir = getGlobalSkillsDir();
    if (!fsSync.existsSync(globalDir)) return '';

    const entries = await fs.readdir(globalDir, { withFileTypes: true });
    let combinedContent = '';

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillName = entry.name;
      const skillFile = path.join(globalDir, skillName, 'SKILL.md');

      if (fsSync.existsSync(skillFile)) {
        const content = await fs.readFile(skillFile, 'utf-8');

        // Extraire uniquement le frontmatter YAML pour réduire drastiquement la taille du payload
        let summary = '';
        const yamlMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);

        if (yamlMatch) {
          summary = `---\n${yamlMatch[1]}\n---\n(Pour lire les détails complets de ce skill, utilisez un outil de style view_file ou fs.readFile sur le fichier : ${skillFile})`;
        } else {
          // Si pas de frontmatter, on prend juste les 300 premiers caractères
          summary = truncateTextForPrompt(content, 300, '\n[...TRUNCATED SKILL...]');
        }

        combinedContent += `\n\n--- SKILL GLOBAL: ${skillName} ---\n${summary}\n--- FIN SKILL GLOBAL ---`;
      }
    }

    return combinedContent;
  } catch (error) {
    console.error('[Skills] Erreur chargement all global skills:', error);
    return '';
  }
};

const formatAvailableSkillsListForPrompt = (skillsContent) => {
  const skills = Array.isArray(skillsContent) ? skillsContent : [];
  const names = skills
    .map((skill) => String(skill?.scope ? `${skill.scope}/${skill.name}` : skill?.name || '').trim())
    .filter(Boolean)
    .slice(0, 80);

  if (names.length === 0) return '';
  return `\n--- SKILLS DISPONIBLES ---\n${names.join(', ')}\nChoisissez seulement les skills pertinents pour la mission courante.\n--- FIN SKILLS DISPONIBLES ---\n`;
};

ipcMain.handle('list-agents', async (event, projectPath) => {
  try {
    const agents = [];

    const readAgentsFromDir = async (dir, scope) => {
      try {
        await fs.mkdir(dir, { recursive: true });
        const entries = await fs.readdir(dir);
        for (const file of entries) {
          if (!file.toLowerCase().endsWith('.md')) continue;
          const filePath = path.join(dir, file);
          let content = '';
          try {
            content = await fs.readFile(filePath, 'utf-8');
          } catch {
            continue;
          }

          const { meta } = parseSimpleFrontMatter(content);
          const name = meta.name ? String(meta.name).trim() : file.replace(/\.md$/i, '');
          const description = meta.description ? String(meta.description).trim() : '';

          agents.push({
            name,
            scope,
            description: description ? description.slice(0, 220) : '',
            path: filePath
          });
        }
      } catch {
        // ignore
      }
    };

    await readAgentsFromDir(getGlobalAgentsDir(), 'global');
    if (projectPath) {
      const trustedProjectPath = await ensureTrustedProjectPath(projectPath);
      await readAgentsFromDir(getWorkspaceAgentsDir(trustedProjectPath), 'workspace');
    }

    // Workspace first
    agents.sort((a, b) => {
      if (a.scope !== b.scope) return a.scope === 'workspace' ? -1 : 1;
      return String(a.name).localeCompare(String(b.name));
    });

    return { success: true, agents };
  } catch (error) {
    console.error('[Agents] Error listing agents:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-agent', async (event, name, scope, projectPath) => {
  try {
    const safeName = safeFileBase(name);
    if (!safeName) return { success: false, error: 'Nom agent invalide' };

    let filePath;
    if (scope === 'global') {
      filePath = path.join(getGlobalAgentsDir(), `${safeName}.md`);
    } else if (scope === 'workspace' && projectPath) {
      const trustedProjectPath = await ensureTrustedProjectPath(projectPath);
      filePath = path.join(getWorkspaceAgentsDir(trustedProjectPath), `${safeName}.md`);
    } else {
      return { success: false, error: 'Invalid scope or missing project path' };
    }

    const content = await fs.readFile(filePath, 'utf-8');
    const { meta, body } = parseSimpleFrontMatter(content);

    return {
      success: true,
      agent: {
        name: meta.name ? String(meta.name).trim() : safeName,
        scope,
        description: meta.description ? String(meta.description).trim() : '',
        body,
        content,
        path: filePath
      }
    };
  } catch (error) {
    console.error('[Agents] Error getting agent:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('save-agent', async (event, name, content, scope, projectPath) => {
  try {
    await ensureEditPermission();

    let dir;
    if (scope === 'global') {
      dir = getGlobalAgentsDir();
    } else if (scope === 'workspace' && projectPath) {
      const trustedProjectPath = await ensureTrustedProjectPath(projectPath);
      dir = getWorkspaceAgentsDir(trustedProjectPath);
    } else {
      return { success: false, error: 'Invalid scope or missing project path' };
    }

    const safeName = safeFileBase(name);
    if (!safeName) return { success: false, error: 'Nom agent invalide' };

    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `${safeName}.md`);
    await fs.writeFile(filePath, String(content || ''), 'utf-8');

    return { success: true, name: safeName, path: filePath };
  } catch (error) {
    console.error('[Agents] Error saving agent:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('delete-agent', async (event, name, scope, projectPath) => {
  try {
    await ensureEditPermission();

    const safeName = safeFileBase(name);
    if (!safeName) return { success: false, error: 'Nom agent invalide' };

    let filePath;
    if (scope === 'global') {
      filePath = path.join(getGlobalAgentsDir(), `${safeName}.md`);
    } else if (scope === 'workspace' && projectPath) {
      const trustedProjectPath = await ensureTrustedProjectPath(projectPath);
      filePath = path.join(getWorkspaceAgentsDir(trustedProjectPath), `${safeName}.md`);
    } else {
      return { success: false, error: 'Invalid scope or missing project path' };
    }

    await fs.unlink(filePath);
    return { success: true };
  } catch (error) {
    console.error('[Agents] Error deleting agent:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('list-skills', async (event, projectPath) => {
  try {
    const skills = [];

    const readSkillsFromDir = async (dir, scope) => {
      try {
        await fs.mkdir(dir, { recursive: true });
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const name = entry.name;
          const skillDir = path.join(dir, name);
          const skillFile = path.join(skillDir, 'SKILL.md');
          const exists = fsSync.existsSync(skillFile);
          skills.push({
            name,
            scope,
            hasSkillMd: exists,
            path: skillDir
          });
        }
      } catch {
        // ignore
      }
    };

    await readSkillsFromDir(getGlobalSkillsDir(), 'global');
    if (projectPath) {
      const trustedProjectPath = await ensureTrustedProjectPath(projectPath);
      await readSkillsFromDir(getWorkspaceSkillsDir(trustedProjectPath), 'workspace');
    }

    skills.sort((a, b) => {
      if (a.scope !== b.scope) return a.scope === 'workspace' ? -1 : 1;
      return String(a.name).localeCompare(String(b.name));
    });

    return { success: true, skills };
  } catch (error) {
    console.error('[Skills] Error listing skills:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-skill', async (event, name, scope, projectPath) => {
  try {
    const safeName = safeFileBase(name);
    if (!safeName) return { success: false, error: 'Nom skill invalide' };

    let dir;
    if (scope === 'global') dir = getGlobalSkillsDir();
    else if (scope === 'workspace' && projectPath) {
      const trustedProjectPath = await ensureTrustedProjectPath(projectPath);
      dir = getWorkspaceSkillsDir(trustedProjectPath);
    }
    else return { success: false, error: 'Invalid scope or missing project path' };

    const skillDir = path.join(dir, safeName);
    const skillFile = path.join(skillDir, 'SKILL.md');
    if (!fsSync.existsSync(skillFile)) {
      console.warn(`[Skills] SKILL.md introuvable pour "${safeName}" (${scope}): ${skillFile}`);
      return { success: false, error: `SKILL.md introuvable pour le skill "${safeName}"` };
    }
    const content = await fs.readFile(skillFile, 'utf-8');

    return {
      success: true,
      skill: {
        name: safeName,
        scope,
        content,
        path: skillDir
      }
    };
  } catch (error) {
    console.error('[Skills] Error getting skill:', error);
    return { success: false, error: error.message };
  }
});

const parseGitHubTreeUrl = (inputUrl) => {
  const rawUrl = String(inputUrl || '').trim();
  if (!rawUrl) return null;

  // Strip query/hash + trailing slashes.
  const url = rawUrl.replace(/[?#].*$/, '').replace(/\/+$/, '');

  // tree/<ref>/<path?> or tree/<ref>
  let match = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)(?:\/(.+))?$/i);
  if (match) {
    const owner = match[1];
    const repo = match[2];
    const ref = match[3];
    let repoPath = match[4] ? String(match[4]) : '';

    repoPath = repoPath.replace(/^\/+/, '').replace(/\/+$/, '');
    if (repoPath.toLowerCase().endsWith('/skill.md')) {
      repoPath = repoPath.slice(0, -('/SKILL.md'.length));
    }

    const repoUrl = `https://github.com/${owner}/${repo}.git`;
    return { repoUrl, ref, repoPath, owner, repo, kind: 'tree' };
  }

  // blob/<ref>/<path>
  match = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/i);
  if (match) {
    const owner = match[1];
    const repo = match[2];
    const ref = match[3];
    let repoPath = String(match[4] || '');

    repoPath = repoPath.replace(/^\/+/, '').replace(/\/+$/, '');
    if (repoPath.toLowerCase().endsWith('/skill.md')) {
      repoPath = repoPath.slice(0, -('/SKILL.md'.length));
    } else {
      // Fall back to the parent folder of the blob path.
      repoPath = repoPath.replace(/\/[^/]+$/, '');
    }

    const repoUrl = `https://github.com/${owner}/${repo}.git`;
    return { repoUrl, ref, repoPath, owner, repo, kind: 'blob' };
  }

  // Repo root
  match = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)$/i);
  if (match) {
    const owner = match[1];
    const repo = match[2].replace(/\.git$/i, '');
    const repoUrl = `https://github.com/${owner}/${repo}.git`;
    return { repoUrl, ref: null, repoPath: '', owner, repo, kind: 'repo' };
  }

  return null;
};

const runGit = (args, cwd) => {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, windowsHide: true });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => { stdout += String(data); });
    child.stderr.on('data', (data) => { stderr += String(data); });

    child.on('error', (error) => {
      reject(new Error(`Git error: ${error.message}`));
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`Git failed (${code}): ${stderr || stdout}`));
      }
    });
  });
};

registerGitHandlers({
  ipcMain,
  fs,
  path,
  runGit,
  ensureEditPermission,
  ensureTrustedProjectPath,
  assertSafePath
});

const runCommandForTask = async (command, cwd, timeoutMs = 180000) => {
  try {
    const trustedCwd = await ensureTrustedProjectPath(cwd);
    const spawnRequest = buildSafeSpawnRequest(command, []);
    validateCommandArgsWithinWorkspace(spawnRequest, trustedCwd);
    return await new Promise((resolve) => {
      const child = spawn(spawnRequest.executable, spawnRequest.args, {
        cwd: trustedCwd,
        shell: false,
        windowsHide: true
      });
    let stdout = '';
    let stderr = '';
    let finished = false;

    const done = (payload) => {
      if (finished) return;
      finished = true;
      resolve(payload);
    };

    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* ignore */ }
      done({
        ok: false,
        code: -1,
        timedOut: true,
        stdout: stdout.slice(0, 6000),
        stderr: stderr.slice(0, 6000)
      });
    }, timeoutMs);

    child.stdout?.on('data', (data) => { stdout += String(data); });
    child.stderr?.on('data', (data) => { stderr += String(data); });
    child.on('error', (error) => {
      clearTimeout(timer);
      done({
        ok: false,
        code: -1,
        timedOut: false,
        stdout: stdout.slice(0, 6000),
        stderr: `${stderr}\n${error.message}`.slice(0, 6000)
      });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      done({
        ok: code === 0,
        code: Number(code),
        timedOut: false,
        stdout: stdout.slice(0, 6000),
        stderr: stderr.slice(0, 6000)
      });
    });
  });
  } catch (error) {
    return {
      ok: false,
      code: -1,
      timedOut: false,
      stdout: '',
      stderr: error.message
    };
  }
};

const sanitizePackPath = (value) => {
  const normalized = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('..') || path.isAbsolute(normalized)) {
    return null;
  }
  return normalized;
};

const getSnapshotDir = (projectPath) => path.join(projectPath, '.agent', 'snapshots');

const toRelativeSnapshotPath = (inputPath) => {
  const candidate = String(inputPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!candidate || candidate.includes('..')) return null;
  return candidate;
};

const readTextFileIfExists = async (filePath) => {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return { exists: true, content };
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return { exists: false, content: '' };
    }
    throw error;
  }
};

const hashAgentContent = (content) =>
  crypto.createHash('sha256').update(String(content || ''), 'utf8').digest('hex');

const getAgentRunProjectKey = (projectPath) =>
  crypto.createHash('sha256').update(String(projectPath || ''), 'utf8').digest('hex').slice(0, 24);

const getAgentRunProjectDir = (projectPath) =>
  path.join(app.getPath('userData'), 'agent-runs', getAgentRunProjectKey(projectPath));

const sanitizeAgentRunId = (runId) => {
  const id = String(runId || '').trim();
  if (!/^[a-zA-Z0-9_.-]+$/.test(id)) return '';
  return id;
};

const buildAgentRunId = () => `run-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;

const normalizeAgentRunStatus = (status) => {
  const value = String(status || '').trim();
  if (['running', 'proposed', 'applying', 'verified', 'failed', 'rolled_back'].includes(value)) return value;
  return 'proposed';
};

const normalizeAgentChangeStatus = (status) => {
  const value = String(status || '').trim();
  if (['pending', 'partial', 'accepted', 'rejected', 'applied', 'verified', 'failed', 'conflict', 'rolled_back'].includes(value)) {
    return value;
  }
  return 'pending';
};

const normalizeAgentLogEntry = (entry = {}) => {
  const raw = entry && typeof entry === 'object' ? entry : {};
  return {
    id: raw.id || `log-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    at: raw.at || new Date().toISOString(),
    type: String(raw.type || 'info'),
    filePath: raw.filePath ? String(raw.filePath) : null,
    changeId: raw.changeId ? String(raw.changeId) : null,
    message: String(raw.message || raw.detail || raw.type || 'Action IA'),
    detail: raw.detail ? String(raw.detail) : ''
  };
};

const normalizeAgentChangePayload = (change = {}) => {
  const raw = change && typeof change === 'object' ? change : {};
  const oldContent = String(raw.oldContent || raw.previousContent || '');
  const newContent = String(raw.newContent || raw.appliedContent || '');
  const filePath = toRelativeSnapshotPath(raw.filePath || raw.path) || 'unknown.txt';
  return {
    id: String(raw.id || raw.patchId || `change-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`),
    patchId: String(raw.patchId || raw.id || ''),
    filePath,
    baseHash: raw.baseHash ?? (raw.existed === false || raw.existedBefore === false ? null : hashAgentContent(oldContent)),
    oldContent,
    newContent,
    existed: raw.existed !== false,
    existedBefore: raw.existedBefore ?? raw.existed ?? true,
    status: normalizeAgentChangeStatus(raw.status),
    additions: Number.isFinite(Number(raw.additions)) ? Number(raw.additions) : 0,
    deletions: Number.isFinite(Number(raw.deletions)) ? Number(raw.deletions) : 0,
    hunks: Array.isArray(raw.hunks) ? raw.hunks : [],
    createdAt: raw.createdAt || new Date().toISOString(),
    updatedAt: raw.updatedAt || new Date().toISOString(),
    appliedAt: raw.appliedAt || null,
    rejectedAt: raw.rejectedAt || null,
    appliedHash: raw.appliedHash || null,
    appliedMtimeMs: Number.isFinite(Number(raw.appliedMtimeMs)) ? Number(raw.appliedMtimeMs) : null,
    verified: !!raw.verified
  };
};

const normalizeAgentRunPayload = (payload = {}) => {
  const raw = payload && typeof payload === 'object' ? payload : {};
  const startedAt = raw.startedAt || raw.createdAt || new Date().toISOString();
  const changes = Array.isArray(raw.changes) ? raw.changes.map(normalizeAgentChangePayload) : [];
  const logs = Array.isArray(raw.logs) ? raw.logs.map(normalizeAgentLogEntry) : [];
  return {
    id: sanitizeAgentRunId(raw.id) || buildAgentRunId(),
    prompt: String(raw.prompt || ''),
    provider: String(raw.provider || raw.aiProvider || ''),
    model: String(raw.model || ''),
    status: normalizeAgentRunStatus(raw.status || (changes.length > 0 ? 'proposed' : 'running')),
    startedAt,
    finishedAt: raw.finishedAt || null,
    updatedAt: raw.updatedAt || startedAt,
    snapshotId: raw.snapshotId || null,
    summary: String(raw.summary || ''),
    changes,
    logs
  };
};

const getAgentRunPath = (projectPath, runId) => {
  const safeRunId = sanitizeAgentRunId(runId);
  if (!safeRunId) throw new Error('runId invalide');
  return path.join(getAgentRunProjectDir(projectPath), `${safeRunId}.json`);
};

const writeAgentRun = async (projectPath, run) => {
  const normalized = normalizeAgentRunPayload(run);
  const dirPath = getAgentRunProjectDir(projectPath);
  await fs.mkdir(dirPath, { recursive: true });
  const filePath = getAgentRunPath(projectPath, normalized.id);
  assertSafePath(dirPath, filePath);
  await fs.writeFile(filePath, JSON.stringify(normalized, null, 2), 'utf-8');
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('agent:action', {
      type: 'run-updated',
      runId: normalized.id,
      status: normalized.status,
      at: new Date().toISOString()
    });
  }
  return normalized;
};

const readAgentRun = async (projectPath, runId) => {
  const dirPath = getAgentRunProjectDir(projectPath);
  const filePath = getAgentRunPath(projectPath, runId);
  assertSafePath(dirPath, filePath);
  const raw = await fs.readFile(filePath, 'utf-8');
  return normalizeAgentRunPayload(JSON.parse(raw));
};

const listAgentRunsForProject = async (projectPath) => {
  const dirPath = getAgentRunProjectDir(projectPath);
  let files = [];
  try {
    files = await fs.readdir(dirPath);
  } catch {
    return [];
  }

  const runs = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    try {
      const raw = await fs.readFile(path.join(dirPath, file), 'utf-8');
      const run = normalizeAgentRunPayload(JSON.parse(raw));
      const additions = run.changes.reduce((sum, change) => sum + Number(change.additions || 0), 0);
      const deletions = run.changes.reduce((sum, change) => sum + Number(change.deletions || 0), 0);
      runs.push({
        id: run.id,
        prompt: run.prompt,
        provider: run.provider,
        model: run.model,
        status: run.status,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        updatedAt: run.updatedAt,
        snapshotId: run.snapshotId,
        changeCount: run.changes.length,
        additions,
        deletions,
        pendingCount: run.changes.filter((change) => change.status === 'pending' || change.status === 'partial').length,
        verifiedCount: run.changes.filter((change) => change.status === 'verified').length,
        conflictCount: run.changes.filter((change) => change.status === 'conflict').length
      });
    } catch {
      // ignore malformed agent run files
    }
  }

  runs.sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || '')));
  return runs;
};

const updateAgentRunChange = async (projectPath, runId, changeId, updater, options = {}) => {
  const run = await readAgentRun(projectPath, runId);
  let found = false;
  const changes = (run.changes || []).map((change) => {
    if (change.id !== changeId && change.patchId !== changeId) return change;
    found = true;
    return normalizeAgentChangePayload(updater(change));
  });
  if (!found) throw new Error('Changement IA introuvable');

  const updated = normalizeAgentRunPayload({
    ...run,
    changes,
    status: normalizeAgentRunStatus(options.status || run.status),
    finishedAt: options.finishedAt || run.finishedAt,
    updatedAt: new Date().toISOString(),
    logs: options.log
      ? [...(Array.isArray(run.logs) ? run.logs : []), normalizeAgentLogEntry(options.log)]
      : run.logs
  });
  await writeAgentRun(projectPath, updated);
  return updated;
};

const collectFilesRecursive = async (dirPath, baseDir, fileList = []) => {
  let entries;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return fileList;
  }

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      await collectFilesRecursive(fullPath, baseDir, fileList);
      continue;
    }
    if (!entry.isFile()) continue;
    const rel = path.relative(baseDir, fullPath).split(path.sep).join('/');
    fileList.push(rel);
  }

  return fileList;
};

const ensureEmptyDirSync = (dirPath) => {
  try {
    fsSync.rmSync(dirPath, { recursive: true, force: true });
  } catch {
    // ignore
  }
  fsSync.mkdirSync(dirPath, { recursive: true });
};

const copyDirSync = (fromDir, toDir, overwrite = false) => {
  if (!fsSync.existsSync(fromDir)) {
    throw new Error(`Source introuvable: ${fromDir}`);
  }
  if (fsSync.existsSync(toDir)) {
    if (!overwrite) {
      throw new Error(`Destination existe déjà: ${toDir}`);
    }
    fsSync.rmSync(toDir, { recursive: true, force: true });
  }
  fsSync.mkdirSync(path.dirname(toDir), { recursive: true });
  fsSync.cpSync(fromDir, toDir, {
    recursive: true,
    filter: (src) => path.basename(src) !== '.git'
  });
};

const collectSkillMdFilesRecursive = async (dirPath) => {
  const results = [];
  let items;
  try {
    items = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const item of items) {
    const fullPath = path.join(dirPath, item.name);

    if (item.isDirectory()) {
      const lower = String(item.name || '').toLowerCase();
      if (
        lower === '.git' ||
        lower === 'node_modules' ||
        lower === 'dist' ||
        lower === 'build' ||
        lower === 'out' ||
        lower === '.next' ||
        lower === 'coverage' ||
        lower === '.turbo' ||
        lower === '.cache' ||
        lower === '.parcel-cache'
      ) {
        continue;
      }

      const nested = await collectSkillMdFilesRecursive(fullPath);
      results.push(...nested);
      continue;
    }

    if (!item.isFile()) continue;
    if (String(item.name || '').toLowerCase() === 'skill.md') {
      results.push(fullPath);
    }
  }

  return results;
};

const pickBestSkillRepoPath = (repoRoot, skillMdFiles) => {
  const uniqueFolders = new Set();
  for (const filePath of Array.isArray(skillMdFiles) ? skillMdFiles : []) {
    uniqueFolders.add(path.dirname(filePath));
  }

  const candidates = Array.from(uniqueFolders).map((folderPath) => {
    const relative = path.relative(repoRoot, folderPath);
    const posix = relative.split(path.sep).join('/');
    const depth = posix ? posix.split('/').length : 0;
    return { posix, depth };
  });

  candidates.sort((a, b) => a.depth - b.depth || a.posix.localeCompare(b.posix));
  return candidates[0]?.posix ?? null;
};

const installSkillInternal = async (url, scope, projectPath, options = {}) => {
  const parsed = parseGitHubTreeUrl(url);
  if (!parsed) {
    return { success: false, error: 'URL GitHub non supportee' };
  }

  const safeOptions = options && typeof options === 'object' ? options : {};
  const overwrite = !!safeOptions.overwrite;

  let destBaseDir;
  if (scope === 'global') destBaseDir = getGlobalSkillsDir();
  else if (scope === 'workspace' && projectPath) {
    const trustedProjectPath = await ensureTrustedProjectPath(projectPath);
    destBaseDir = getWorkspaceSkillsDir(trustedProjectPath);
  }
  else return { success: false, error: 'Invalid scope or missing project path' };

  await fs.mkdir(destBaseDir, { recursive: true });

  const tempRoot = path.join(app.getPath('userData'), 'tmp');
  const tempDir = path.join(tempRoot, `skill-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  ensureEmptyDirSync(tempDir);

  try {
    let repoPathToInstall = String(parsed.repoPath || '');
    const wantsSparse = !!parsed.ref && !!repoPathToInstall;

    const cloneRepo = async ({ sparse }) => {
      const args = ['clone', '--depth', '1'];
      if (sparse) args.push('--filter=blob:none', '--sparse');
      if (parsed.ref) args.push('--branch', parsed.ref);
      args.push(parsed.repoUrl, tempDir);
      await runGit(args, tempRoot);

      if (sparse) {
        await runGit(['-C', tempDir, 'sparse-checkout', 'set', repoPathToInstall], tempRoot);
      }
    };

    try {
      await cloneRepo({ sparse: wantsSparse });
    } catch (cloneError) {
      if (!wantsSparse) throw cloneError;
      ensureEmptyDirSync(tempDir);
      await cloneRepo({ sparse: false });
    }

    if (!repoPathToInstall) {
      const skillMdFiles = await collectSkillMdFilesRecursive(tempDir);
      const bestRepoPath = pickBestSkillRepoPath(tempDir, skillMdFiles);
      if (bestRepoPath === null) {
        return { success: false, error: 'Aucun SKILL.md trouve dans ce repo (utilisez un lien /tree/... vers une skill)' };
      }
      repoPathToInstall = bestRepoPath || '';
    }

    const derivedNameBase =
      safeOptions.name ||
      (repoPathToInstall ? path.basename(repoPathToInstall) : `${parsed.owner}-${parsed.repo}`);
    const derivedName = safeFileBase(derivedNameBase);
    if (!derivedName) return { success: false, error: 'Nom skill invalide' };

    const destDir = path.join(destBaseDir, derivedName);
    const fromDir = repoPathToInstall
      ? path.join(tempDir, ...String(repoPathToInstall).split('/'))
      : tempDir;

    // Copy the skill directory
    copyDirSync(fromDir, destDir, overwrite);

    const skillMd = path.join(destDir, 'SKILL.md');
    const hasSkillMd = fsSync.existsSync(skillMd);

    return {
      success: true,
      name: derivedName,
      scope,
      path: destDir,
      hasSkillMd
    };
  } finally {
    try {
      fsSync.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
};

ipcMain.handle('install-skill-from-url', async (event, url, scope, projectPath, options = {}) => {
  try {
    await ensureEditPermission();
    return await installSkillInternal(url, scope, projectPath, options);
  } catch (error) {
    console.error('[Skills] Error installing skill:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('install-all-skills', async (event, catalogEntries) => {
  try {
    await ensureEditPermission();
  } catch (error) {
    return { success: false, error: error.message };
  }

  if (!Array.isArray(catalogEntries)) {
    return { success: false, error: 'Invalid catalog entries format' };
  }

  const results = {
    successful: [],
    failed: []
  };

  // Process sequentially to avoid overwhelming github/disk
  for (const entry of catalogEntries) {
    if (!entry || !entry.url) continue;
    try {
      // Install all globally
      const res = await installSkillInternal(entry.url, 'global', null, { overwrite: true, name: entry.label });
      if (res.success) {
        results.successful.push(entry.label || entry.url);
      } else {
        results.failed.push({ skill: entry.label || entry.url, error: res.error });
      }
    } catch (e) {
      results.failed.push({ skill: entry.label || entry.url, error: e.message });
    }
  }

  return { success: true, results };
});

const voltCatalogCache = new Map();

const fetchRawText = async (rawUrl) => {
  const response = await axios.get(rawUrl, {
    timeout: 120000,
    maxBodyLength: 50 * 1024 * 1024,
    maxContentLength: 50 * 1024 * 1024
  });
  return String(response.data || '');
};

const parseAwesomeListCatalog = (readmeText) => {
  const lines = String(readmeText || '').split('\n');
  const entries = [];

  for (const line of lines) {
    const trimmed = String(line || '').trim();
    if (!trimmed.startsWith('-') && !trimmed.startsWith('*')) continue;

    // Matches:
    // - **[label](url)** - description
    // - [label](url) - description
    const match = trimmed.match(/^[-*]\s+(?:\*\*)?\[([^\]]+)\]\((https?:\/\/[^)]+)\)(?:\*\*)?\s+-\s+(.+)$/);
    if (!match) continue;

    const label = match[1].trim();
    const url = match[2].trim();
    const description = match[3].trim();

    if (!label || !url) continue;

    entries.push({
      label,
      url,
      description: description.slice(0, 260)
    });
  }

  return entries;
};

ipcMain.handle('get-voltagent-catalog', async (event, catalogId) => {
  try {
    const id = String(catalogId || '').trim();
    if (!id) return { success: false, error: 'catalogId manquant' };

    const cached = voltCatalogCache.get(id);
    const now = Date.now();
    if (cached && cached.fetchedAt && now - cached.fetchedAt < 15 * 60 * 1000) {
      return { success: true, catalogId: id, entries: cached.entries, cached: true };
    }

    const urls = {
      'agent-skills': 'https://raw.githubusercontent.com/VoltAgent/awesome-agent-skills/main/README.md',
      'openclaw-skills': 'https://raw.githubusercontent.com/VoltAgent/awesome-openclaw-skills/main/README.md',
    };

    const rawUrl = urls[id];
    if (!rawUrl) return { success: false, error: `catalogId inconnu: ${id}` };

    const readme = await fetchRawText(rawUrl);
    const entries = parseAwesomeListCatalog(readme);

    voltCatalogCache.set(id, { fetchedAt: now, entries });
    return { success: true, catalogId: id, entries, cached: false };
  } catch (error) {
    console.error('[VoltCatalog] Error fetching catalog:', error);
    return { success: false, error: error.message };
  }
});

const collectMarkdownFilesRecursive = async (dirPath) => {
  const results = [];
  let items;
  try {
    items = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const item of items) {
    const fullPath = path.join(dirPath, item.name);
    if (item.isDirectory()) {
      const nested = await collectMarkdownFilesRecursive(fullPath);
      results.push(...nested);
      continue;
    }

    if (!item.isFile()) continue;
    if (!item.name.toLowerCase().endsWith('.md')) continue;
    if (item.name.toLowerCase() === 'readme.md') continue;
    results.push(fullPath);
  }

  return results;
};

ipcMain.handle('sync-voltagent-subagents', async (event, options = {}) => {
  try {
    await ensureEditPermission();

    const safeOptions = options && typeof options === 'object' ? options : {};
    const overwrite = !!safeOptions.overwrite;

    const cacheRoot = path.join(app.getPath('userData'), 'voltagent-cache');
    const repoDir = path.join(cacheRoot, 'awesome-claude-code-subagents');
    await fs.mkdir(cacheRoot, { recursive: true });

    // Fresh clone (simple & reliable)
    try {
      fsSync.rmSync(repoDir, { recursive: true, force: true });
    } catch {
      // ignore
    }

    await runGit(['clone', '--depth', '1', 'https://github.com/VoltAgent/awesome-claude-code-subagents', repoDir], cacheRoot);

    const agentsDir = getGlobalAgentsDir();
    await fs.mkdir(agentsDir, { recursive: true });

    const sourceAgents = await collectMarkdownFilesRecursive(path.join(repoDir, 'categories'));

    let imported = 0;
    let skipped = 0;
    let errors = 0;

    for (const filePath of sourceAgents) {
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const { meta } = parseSimpleFrontMatter(content);
        const rawName = meta.name ? String(meta.name).trim() : path.basename(filePath, '.md');
        const name = safeFileBase(rawName);
        if (!name) {
          skipped += 1;
          continue;
        }

        const dest = path.join(agentsDir, `${name}.md`);
        if (!overwrite && fsSync.existsSync(dest)) {
          skipped += 1;
          continue;
        }

        await fs.writeFile(dest, content, 'utf-8');
        imported += 1;
      } catch (e) {
        errors += 1;
      }
    }

    return { success: true, imported, skipped, errors };
  } catch (error) {
    console.error('[VoltAgent] Error syncing subagents:', error);
    return { success: false, error: error.message };
  }
});

// ==================== GIT INTEGRATION ====================

/**
 * Helper: run a git command in a given directory and return stdout.
 * Reuses the existing runGit helper (defined earlier in the file).
 */

// ==================== OLLAMA LOCAL AI ====================

const OLLAMA_BASE_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const DEFAULT_OLLAMA_MODEL = CANONICAL_QWEN_OLLAMA_MODEL;
// Anti-blocage du streaming Ollama : delai pour la reponse initiale, et delai
// d'inactivite (aucun token recu) au-dela duquel on rejette et detruit le flux.
const OLLAMA_STREAM_RESPONSE_TIMEOUT_MS = Number(process.env.OLLAMA_STREAM_RESPONSE_TIMEOUT_MS) || 180000;
const OLLAMA_STREAM_INACTIVITY_TIMEOUT_MS = Number(process.env.OLLAMA_STREAM_INACTIVITY_TIMEOUT_MS) || 90000;
const OLLAMA_KEEP_ALIVE = process.env.OLLAMA_KEEP_ALIVE || '30m';
const SIMPLE_OLLAMA_CHAT_MAX_TOKENS = 256;
const OLLAMA_DOWNLOAD_URL = process.platform === 'win32'
  ? 'https://ollama.com/download/windows'
  : 'https://ollama.com/download';
const FALLBACK_OLLAMA_MODEL_CANDIDATES = [
  DEFAULT_OLLAMA_MODEL,
  'qwen2.5-coder:14b',
  'qwen3-coder:30b',
  'qwen3:8b',
  'qwen3:14b',
  'qwen3:30b',
  'qwen3:32b'
];
const FALLBACK_OLLAMA_ARCHITECT_MODEL_CANDIDATES = [
  DEFAULT_OLLAMA_MODEL,
  'qwen3:14b',
  'qwen3:32b',
  'qwen3:8b',
  'qwen2.5-coder:14b',
  'qwen3-coder:30b'
];
const FALLBACK_OLLAMA_CODER_MODEL_CANDIDATES = [
  DEFAULT_OLLAMA_MODEL,
  'qwen2.5-coder:14b',
  'qwen3-coder:30b',
  'qwen3:14b',
  'qwen3:32b',
  'qwen3:8b'
];
const FALLBACK_OLLAMA_TESTER_MODEL_CANDIDATES = [
  DEFAULT_OLLAMA_MODEL,
  'qwen3:8b',
  'qwen3:14b',
  'qwen2.5-coder:14b',
  'qwen3-coder:30b',
  'qwen3:32b'
];
const activeOllamaPulls = new Set();
const activeOllamaRequests = new Map();
const normalizeOllamaModelName = (value) => String(value || '').trim();
const normalizeOllamaRequestId = (value) => String(value || '').trim().slice(0, 120);
const createOllamaRequestId = () => (
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `ollama-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
);
const resolveSimpleOllamaMaxTokens = (value, executionMode = 'agent') => {
  const mode = String(executionMode || '').trim().toLowerCase();
  const modeDefault = mode === 'ask' || mode === 'plan' ? 512 : 2048;
  const configured = Number(value);
  if (!Number.isFinite(configured) || configured <= 0) return modeDefault;
  const hardMax = configured > 4096 ? 8192 : 4096;
  return Math.max(128, Math.min(Math.floor(configured), hardMax));
};
const extractDecoratedUserPrompt = (value) => {
  const text = String(value || '').trim();
  const match = text.match(/DEMANDE UTILISATEUR:\s*([\s\S]*)$/i);
  return (match ? match[1] : text).trim();
};
const normalizePromptForIntent = (value) => (
  extractDecoratedUserPrompt(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[!?.,;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
);
const SIMPLE_OLLAMA_CHAT_PROMPTS = new Set([
  'hi',
  'hello',
  'hey',
  'yo',
  'salut',
  'bonjour',
  'bonsoir',
  'coucou',
  'ca va',
  'comment ca va',
  'how are you',
  'merci',
  'thanks',
  'thank you',
  'ok'
]);
const SIMPLE_OLLAMA_PROJECT_INTENT_REGEX = /\b(projet|project|repo|repository|fichier|file|code|bug|test|tests|refactor|corrige|fix|cree|creer|create|modifie|modifier|analyse|audit|terminal|commande|run|workflow|workflows|docs|documentation|php|javascript|typescript|js|jsx|ts|tsx|css|html|sql|fonction|function|classe|class|component|composant)\b/i;
const isSimpleOllamaChatPrompt = (value) => {
  const raw = extractDecoratedUserPrompt(value);
  const normalized = normalizePromptForIntent(raw);
  if (!normalized || raw.length > 80 || raw.includes('\n')) return false;
  if (SIMPLE_OLLAMA_PROJECT_INTENT_REGEX.test(normalized)) return false;
  if (/[`@/\\]|[a-z0-9_-]+\.[a-z0-9]{1,8}/i.test(raw)) return false;
  if (SIMPLE_OLLAMA_CHAT_PROMPTS.has(normalized)) return true;
  const words = normalized.split(' ').filter(Boolean);
  return words.length <= 4 && /\b(hi|hello|hey|salut|bonjour|bonsoir|coucou|merci|thanks|ca va)\b/i.test(normalized);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const runProcessCapture = (executable, args = [], options = {}) => new Promise((resolve) => {
  const { timeoutMs: rawTimeoutMs, ...spawnOptions } = options || {};
  const child = spawn(executable, args, {
    windowsHide: true,
    shell: false,
    ...spawnOptions
  });
  let stdout = '';
  let stderr = '';
  let finished = false;
  const timeoutMs = Number(rawTimeoutMs) || 30000;

  const done = (payload) => {
    if (finished) return;
    finished = true;
    try { child.kill(); } catch { /* ignore */ }
    resolve({
      stdout: stdout.slice(0, 8000),
      stderr: stderr.slice(0, 8000),
      ...payload
    });
  };

  const timer = setTimeout(() => {
    done({ ok: false, code: -1, timedOut: true, error: 'Timeout' });
  }, timeoutMs);

  child.stdout?.on('data', (data) => { stdout += String(data); });
  child.stderr?.on('data', (data) => { stderr += String(data); });
  child.on('error', (error) => {
    clearTimeout(timer);
    done({ ok: false, code: -1, error: error.message });
  });
  child.on('close', (code) => {
    clearTimeout(timer);
    done({ ok: code === 0, code });
  });
});

const getOllamaExecutableCandidates = () => {
  const candidates = [];
  if (process.env.OLLAMA_EXE) candidates.push(process.env.OLLAMA_EXE);
  if (process.platform === 'win32') {
    if (process.env.LOCALAPPDATA) {
      candidates.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'Ollama', 'ollama.exe'));
    }
    candidates.push(path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Ollama', 'ollama.exe'));
    if (process.env.ProgramFiles) {
      candidates.push(path.join(process.env.ProgramFiles, 'Ollama', 'ollama.exe'));
    }
  }
  candidates.push('ollama');
  return Array.from(new Set(candidates.filter(Boolean)));
};

const resolveOllamaExecutable = () => {
  const candidates = getOllamaExecutableCandidates();
  const fileCandidate = candidates.find((candidate) => path.isAbsolute(candidate) && fsSync.existsSync(candidate));
  return fileCandidate || 'ollama';
};

const isOllamaApiAvailable = async (timeout = 1600) => {
  try {
    await fetchOllamaTags(OLLAMA_BASE_URL, timeout);
    return true;
  } catch {
    return false;
  }
};

const waitForOllamaApi = async (timeoutMs = 8000) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    // eslint-disable-next-line no-await-in-loop
    if (await isOllamaApiAvailable(1000)) return true;
    // eslint-disable-next-line no-await-in-loop
    await sleep(500);
  }
  return false;
};

const startOllamaServerIfPossible = async () => {
  if (await isOllamaApiAvailable()) {
    return { success: true, alreadyRunning: true };
  }

  const executable = resolveOllamaExecutable();
  let launchError = '';
  try {
    const child = spawn(executable, ['serve'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      shell: false
    });
    child.once('error', (error) => {
      launchError = error.message;
    });
    child.unref();
  } catch (error) {
    return { success: false, error: `Ollama introuvable: ${error.message}` };
  }

  await sleep(300);
  if (launchError) {
    return { success: false, error: `Ollama introuvable: ${launchError}` };
  }

  const available = await waitForOllamaApi(9000);
  if (!available) {
    return {
      success: false,
      error: `Ollama ne repond pas sur ${OLLAMA_BASE_URL}. Installez Ollama ou lancez l'application Ollama.`
    };
  }

  return { success: true, alreadyRunning: false };
};

const extractOllamaModelNames = (tagsResponseData) => {
  const modelsRaw = Array.isArray(tagsResponseData?.models) ? tagsResponseData.models : [];
  return modelsRaw
    .map((model) => normalizeOllamaModelName(model?.name || model))
    .filter(Boolean);
};

const extractConfiguredOllamaModels = (rawModels) =>
  Array.from(new Set(
    (Array.isArray(rawModels) ? rawModels : [])
      .map((model) => normalizeOllamaModelName(model))
      .filter(Boolean)
  ));

const buildOllamaUpdateStatuses = (configuredModels, installedModels, errorMessage = '') => {
  const installedSet = new Set(
    Array.isArray(installedModels)
      ? installedModels.map((model) => normalizeOllamaModelName(model)).filter(Boolean)
      : []
  );

  return extractConfiguredOllamaModels(configuredModels).map((model) => ({
    model,
    status: errorMessage ? 'error' : (installedSet.has(model) ? 'installed' : 'missing'),
    ...(errorMessage ? { error: errorMessage } : {})
  }));
};

const fetchOllamaTags = async (baseUrl, timeout = null) => {
  const config = {};
  if (Number.isFinite(Number(timeout)) && Number(timeout) > 0) {
    config.timeout = Number(timeout);
  }
  return axios.get(`${baseUrl}/api/tags`, config);
};

const fetchOllamaLoadedModels = async (baseUrl, timeout = 2000) => {
  const config = {};
  if (Number.isFinite(Number(timeout)) && Number(timeout) > 0) {
    config.timeout = Number(timeout);
  }
  const response = await axios.get(`${baseUrl}/api/ps`, config);
  return Array.isArray(response?.data?.models) ? response.data.models : [];
};

const hasLoadedOllamaModel = (modelName, loadedModels) => {
  const target = normalizeOllamaModelName(modelName);
  if (!target || !Array.isArray(loadedModels)) return false;
  return loadedModels.some((entry) => {
    const name = normalizeOllamaModelName(entry?.name || entry?.model || entry);
    return name === target;
  });
};

const pickInstalledOllamaModel = (requestedModel, installedModels, preferredCandidates = []) => {
  const requested = normalizeOllamaModelName(requestedModel);
  const available = Array.isArray(installedModels)
    ? installedModels.map((name) => normalizeOllamaModelName(name)).filter(Boolean)
    : [];
  const availableSet = new Set(available);
  if (requested && availableSet.has(requested)) return requested;

  for (const candidate of preferredCandidates) {
    const normalizedCandidate = normalizeOllamaModelName(candidate);
    if (normalizedCandidate && availableSet.has(normalizedCandidate)) {
      return normalizedCandidate;
    }
  }

  const requestedBase = requested.includes(':') ? requested.split(':')[0] : requested;
  if (requestedBase) {
    const sameFamily = available.find((name) => name.startsWith(`${requestedBase}:`) || name === requestedBase);
    if (sameFamily) return sameFamily;
  }

  return available[0] || '';
};

ipcMain.handle('list-ollama-models', async () => {
  try {
    await startOllamaServerIfPossible();
    const response = await fetchOllamaTags(OLLAMA_BASE_URL, 5000);
    const models = (response.data?.models || []).map(m => ({
      name: m.name,
      size: m.size,
      modified: m.modified_at
    }));
    return { success: true, models };
  } catch (error) {
    return { success: false, error: `Ollama non disponible: ${error.message}. Installez Ollama depuis l'app ou via ${OLLAMA_DOWNLOAD_URL}` };
  }
});

// ─── Catalogue Ollama DYNAMIQUE (familles + tailles) depuis la librairie publique ───
// Source: pages HTML publiques ollama.com (pas d'auth). On detecte la famille de
// chat la plus recente (ex. qwen3 -> qwen3.6) et ses tailles reelles (8b, 14b, ...),
// sans jamais utiliser l'alias ":latest".
const OLLAMA_REGISTRY_CACHE = new Map(); // key -> { value, ts }
const OLLAMA_REGISTRY_TTL_MS = 30 * 60 * 1000;
const OLLAMA_REGISTRY_HTTP = { timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0 (FuturIA)' } };

const registryCacheGet = (key, force) => {
  if (force) return null;
  const hit = OLLAMA_REGISTRY_CACHE.get(key);
  if (hit && (Date.now() - hit.ts) < OLLAMA_REGISTRY_TTL_MS) return hit.value;
  return null;
};
const registryCacheSet = (key, value) => {
  OLLAMA_REGISTRY_CACHE.set(key, { value, ts: Date.now() });
  return value;
};

// Compare deux versions numeriques de famille ("3.6" > "3.5" > "3" > "2.5").
const compareFamilyVersions = (a, b) => {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
};

// Detecte la famille de chat de base la plus recente pour un "vendor" (ex. qwen).
// Exclut les variantes -coder/-vl/-embedding/-next/-math/qwq et la version sans numero.
const resolveOllamaFamilyFromRegistry = async (vendor = 'qwen', force = false) => {
  const cacheKey = `family:${vendor}`;
  const cached = registryCacheGet(cacheKey, force);
  if (cached) return cached;

  const url = `https://ollama.com/search?q=${encodeURIComponent(vendor)}`;
  const response = await axios.get(url, OLLAMA_REGISTRY_HTTP);
  const html = String(response.data || '');
  const found = new Set();
  const linkRegex = /\/library\/([a-z0-9._-]+)/gi;
  let m;
  while ((m = linkRegex.exec(html)) !== null) {
    found.add(m[1].toLowerCase());
  }
  const baseRegex = new RegExp(`^${vendor}(\\d+(?:\\.\\d+)?)$`, 'i');
  const families = Array.from(found)
    .map((name) => {
      const match = baseRegex.exec(name);
      return match ? { name, version: match[1] } : null;
    })
    .filter(Boolean)
    .sort((a, b) => compareFamilyVersions(b.version, a.version));

  const result = {
    family: families[0]?.name || `${vendor}3`,
    allFamilies: families.map((f) => f.name)
  };
  return registryCacheSet(cacheKey, result);
};

// Recupere les tailles (8b, 14b, ...) reellement publiees pour une famille. Exclut ":latest".
const fetchOllamaLibrarySizesFromRegistry = async (family, force = false) => {
  const safeFamily = String(family || '').trim().toLowerCase();
  if (!safeFamily) return { family: '', sizes: [] };
  const cacheKey = `sizes:${safeFamily}`;
  const cached = registryCacheGet(cacheKey, force);
  if (cached) return cached;

  const url = `https://ollama.com/library/${encodeURIComponent(safeFamily)}/tags`;
  const response = await axios.get(url, OLLAMA_REGISTRY_HTTP);
  const html = String(response.data || '');
  const escaped = safeFamily.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tagRegex = new RegExp(`${escaped}:([a-z0-9._-]+)`, 'gi');
  const sizes = new Set();
  let m;
  while ((m = tagRegex.exec(html)) !== null) {
    const tag = m[1].toLowerCase();
    if (/^\d+(\.\d+)?b$/.test(tag)) sizes.add(tag); // tailles pures uniquement, jamais "latest"
  }
  const sorted = Array.from(sizes).sort((a, b) => parseSizeBillions(a) - parseSizeBillions(b));
  const result = { family: safeFamily, sizes: sorted };
  return registryCacheSet(cacheKey, result);
};

// ─── Recommandation de taille selon la puissance machine ───
const parseSizeBillions = (tag) => {
  const match = /^(\d+(?:\.\d+)?)b$/i.exec(String(tag || '').trim());
  return match ? Number(match[1]) : null;
};
// Empreinte memoire approx. (Go) en quantification q4 par taille de modele.
const OLLAMA_SIZE_FOOTPRINT_GB = {
  '0.6b': 1, '1.7b': 2, '4b': 4, '8b': 7, '14b': 11, '30b': 22, '32b': 24, '70b': 45, '235b': 140
};
const estimateOllamaFootprintGb = (tag) => {
  const key = String(tag || '').toLowerCase();
  if (OLLAMA_SIZE_FOOTPRINT_GB[key] != null) return OLLAMA_SIZE_FOOTPRINT_GB[key];
  const billions = parseSizeBillions(key);
  return billions != null ? Number((billions * 0.75).toFixed(1)) : null;
};
// Choisit la meilleure taille selon DEUX criteres :
//  - tenir en memoire (VRAM si GPU exploitable, sinon RAM),
//  - rester REACTIF : sans GPU (inference CPU), on plafonne la taille car les gros
//    modeles sont trop lents (ex. 8B ~2-3 tokens/s sur un CPU d'ultraportable).
const recommendOllamaSize = (sizes, { vramGb = 0, totalGb = 0 } = {}) => {
  const candidates = (Array.isArray(sizes) ? sizes : [])
    .map((s) => ({ s, gb: estimateOllamaFootprintGb(s), b: parseSizeBillions(s) }))
    .filter((x) => x.gb != null && x.b != null)
    .sort((a, b) => a.b - b.b);
  if (candidates.length === 0) return null;

  const hasUsableGpu = Number(vramGb) >= 4;
  const fitBudgetGb = hasUsableGpu ? Number(vramGb) : Number(totalGb) * 0.6;
  // Plancher de QUALITE = 4B (on ne recommande jamais en dessous), puis on monte
  // jusqu'au max que la machine encaisse. Sur CPU on plafonne la VITESSE selon la RAM.
  const FLOOR_B = 4;
  const speedCapB = hasUsableGpu
    ? Infinity
    : (totalGb >= 32 ? 14 : totalGb >= 16 ? 8 : FLOOR_B);

  // Plus grande taille qui tient en memoire ET sous le plafond de vitesse.
  let best = null;
  for (const c of candidates) {
    if (c.gb <= fitBudgetGb && c.b <= speedCapB) best = c.s;
  }
  // Vise au minimum 4B si une telle taille existe et tient en memoire.
  if (!best || parseSizeBillions(best) < FLOOR_B) {
    const floorFit = candidates.find((c) => c.b >= FLOOR_B && c.gb <= fitBudgetGb);
    best = (floorFit && floorFit.s) || best || candidates[candidates.length - 1].s;
  }
  return best;
};

ipcMain.handle('resolve-ollama-family', async (_event, payload = {}) => {
  try {
    const vendor = String(payload?.vendor || 'qwen').trim().toLowerCase() || 'qwen';
    const force = payload?.force === true;
    const result = await resolveOllamaFamilyFromRegistry(vendor, force);
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: `Detection famille Ollama impossible: ${error.message}` };
  }
});

ipcMain.handle('fetch-ollama-library-sizes', async (_event, payload = {}) => {
  try {
    const family = String(payload?.family || '').trim();
    const force = payload?.force === true;
    const result = await fetchOllamaLibrarySizesFromRegistry(family, force);
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: `Recuperation tailles Ollama impossible: ${error.message}` };
  }
});

// Recommande une taille selon RAM/VRAM (respecte le consentement materiel).
ipcMain.handle('recommend-ollama-size', async (_event, payload = {}) => {
  try {
    const sizes = Array.isArray(payload?.sizes) ? payload.sizes : [];
    if (sizes.length === 0) return { success: false, error: 'Aucune taille fournie.' };

    const settings = await readSettingsSafe();
    const explicitConsent = payload?.consent === true;
    const hasConsent = explicitConsent || (settings.localAIOptimizationMode === 'auto' && settings.localAIHardwareConsent);

    const totalGb = os.totalmem() / 1024 / 1024 / 1024;
    let vramGb = 0;
    if (hasConsent) {
      try {
        const gpus = await readWindowsGpuInfo();
        vramGb = Math.max(0, ...(Array.isArray(gpus) ? gpus.map((g) => Number(g?.vramGb) || 0) : [0]));
      } catch { /* GPU non lisible: on reste sur la RAM */ }
    }
    const recommended = recommendOllamaSize(sizes, { vramGb, totalGb });
    const hasUsableGpu = vramGb >= 4;
    return {
      success: true,
      recommended,
      totalGb: Number(totalGb.toFixed(1)),
      vramGb: Number(vramGb.toFixed(1)),
      basis: hasUsableGpu ? 'gpu' : 'cpu',
      consent: hasConsent
    };
  } catch (error) {
    return { success: false, error: `Recommandation taille impossible: ${error.message}` };
  }
});

ipcMain.handle('start-ollama', async () => {
  try {
    return await startOllamaServerIfPossible();
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('install-ollama', async () => {
  try {
    if (await isOllamaApiAvailable()) {
      return { success: true, alreadyInstalled: true };
    }

    if (process.platform !== 'win32') {
      await shell.openExternal('https://ollama.com/download');
      return { success: true, openedDownload: true };
    }

    const wingetCheck = await runProcessCapture('winget', ['--version'], { timeoutMs: 10000 });
    if (!wingetCheck.ok) {
      await shell.openExternal(OLLAMA_DOWNLOAD_URL);
      return { success: true, openedDownload: true, warning: 'winget indisponible' };
    }

    const install = await runProcessCapture('winget', [
      'install',
      '--id',
      'Ollama.Ollama',
      '-e',
      '--source',
      'winget',
      '--accept-package-agreements',
      '--accept-source-agreements'
    ], { timeoutMs: 10 * 60 * 1000 });

    if (!install.ok) {
      await shell.openExternal(OLLAMA_DOWNLOAD_URL);
      return {
        success: true,
        openedDownload: true,
        warning: install.stderr || install.stdout || 'Installation winget echouee'
      };
    }

    const startResult = await startOllamaServerIfPossible();
    return {
      success: true,
      installed: true,
      started: !!startResult.success,
      warning: startResult.success ? '' : startResult.error
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('check-ollama-updates', async (_event, modelNames = []) => {
  try {
    let configuredModels = extractConfiguredOllamaModels(modelNames);
    if (configuredModels.length === 0) {
      const settings = await readSettingsSafe();
      configuredModels = extractConfiguredOllamaModels([
        settings.ollamaModel,
        settings.ollamaModelArchitect,
        settings.ollamaModelCoder,
        settings.ollamaModelTester
      ]);
    }

    if (configuredModels.length === 0) {
      return { success: true, models: [] };
    }

    try {
      await startOllamaServerIfPossible();
      const response = await fetchOllamaTags(OLLAMA_BASE_URL, 5000);
      const installedModels = extractOllamaModelNames(response?.data);
      return {
        success: true,
        models: buildOllamaUpdateStatuses(configuredModels, installedModels)
      };
    } catch (error) {
      const message = `Ollama non disponible: ${error.message}`;
      return {
        success: true,
        models: buildOllamaUpdateStatuses(configuredModels, [], message)
      };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('pull-ollama-model', async (_event, modelName) => {
  const model = normalizeOllamaModelName(modelName);
  if (!model) {
    return { success: false, error: 'Nom de modele Ollama invalide.' };
  }

  if (activeOllamaPulls.has(model)) {
    return { success: false, error: `Un telechargement est deja en cours pour "${model}".` };
  }

  activeOllamaPulls.add(model);
  const sendProgress = (payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('ollama-pull-progress', { model, ...payload });
    }
  };

  sendProgress({ status: 'starting', completed: 0, total: 0 });

  try {
    const startResult = await startOllamaServerIfPossible();
    if (!startResult.success) {
      throw new Error(startResult.error || 'Ollama indisponible.');
    }

    const response = await axios.post(`${OLLAMA_BASE_URL}/api/pull`, {
      model,
      stream: true
    }, {
      responseType: 'stream',
      timeout: 0
    });

    await new Promise((resolve, reject) => {
      let buffer = '';
      let settled = false;

      const safeResolve = () => {
        if (settled) return;
        settled = true;
        resolve();
      };

      const safeReject = (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };

      const processLine = (line) => {
        const trimmed = String(line || '').trim();
        if (!trimmed) return;

        let payload;
        try {
          payload = JSON.parse(trimmed);
        } catch {
          return;
        }

        if (typeof payload.error === 'string' && payload.error.trim()) {
          sendProgress({ status: 'error', error: payload.error.trim() });
          safeReject(new Error(payload.error.trim()));
          return;
        }

        const completed = Number(payload.completed);
        const total = Number(payload.total);
        sendProgress({
          status: String(payload.status || 'pulling'),
          completed: Number.isFinite(completed) ? completed : null,
          total: Number.isFinite(total) ? total : null
        });
      };

      response.data.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        let newlineIndex = buffer.indexOf('\n');
        while (newlineIndex >= 0) {
          const line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);
          processLine(line);
          newlineIndex = buffer.indexOf('\n');
        }
      });

      response.data.on('end', () => {
        if (buffer.trim()) processLine(buffer);
        safeResolve();
      });

      response.data.on('error', (error) => {
        safeReject(error);
      });
    });

    sendProgress({ status: 'success', completed: 1, total: 1 });
    return { success: true, model };
  } catch (error) {
    const message = axios.isAxiosError(error) && error.response?.data?.error
      ? String(error.response.data.error)
      : String(error.message || error);
    sendProgress({ status: 'error', error: message });
    return { success: false, error: `Ollama pull (${model}): ${message}` };
  } finally {
    activeOllamaPulls.delete(model);
  }
});

ipcMain.handle('cancel-ollama-request', async (_event, requestId) => {
  const id = normalizeOllamaRequestId(requestId);
  if (!id) return { success: false, cancelled: false, error: 'requestId manquant.' };
  const active = activeOllamaRequests.get(id);
  if (!active) return { success: true, cancelled: false };

  active.cancelled = true;
  try { active.controller?.abort?.(); } catch { /* noop */ }
  try { active.stream?.destroy?.(new Error('Ollama request cancelled')); } catch { /* noop */ }
  activeOllamaRequests.delete(id);
  return { success: true, cancelled: true };
});

ipcMain.handle('get-ollama-completion', async (event, history, currentCode, allProjectFiles = null, options = {}) => {
  const requestedModel = normalizeOllamaModelName(options.model || process.env.OLLAMA_MODEL);

  if (!history || !Array.isArray(history) || history.length === 0) {
    return { success: false, error: "Aucun historique fourni pour Ollama." };
  }

  const requestId = normalizeOllamaRequestId(options.requestId) || createOllamaRequestId();
  const controller = new AbortController();
  const requestState = { requestId, controller, stream: null, cancelled: false };
  activeOllamaRequests.set(requestId, requestState);
  const emitOllamaEvent = (channel, payload = {}) => {
    try {
      if (event.sender && !event.sender.isDestroyed()) {
        event.sender.send(channel, { requestId, ...payload });
      }
    } catch {
      // Renderer may have navigated away.
    }
  };
  const isCancelled = () => requestState.cancelled || controller.signal.aborted;
  const makeCancelledError = () => Object.assign(new Error('Generation Ollama annulee.'), { code: 'OLLAMA_CANCELLED' });

  try {
    const projectPath = await resolveOptionalTrustedProjectPath(options.projectPath);
    let model = requestedModel;
    let installedModelNames = [];
    try {
      const startResult = await startOllamaServerIfPossible();
      if (!startResult.success) {
        throw new Error(startResult.error || 'Ollama indisponible.');
      }
      const tagsResponse = await fetchOllamaTags(OLLAMA_BASE_URL, 5000);
      installedModelNames = extractOllamaModelNames(tagsResponse?.data);
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        emitOllamaEvent('ollama-error', { model: requestedModel, error: `Endpoint introuvable: ${OLLAMA_BASE_URL}/api/tags` });
        return {
          success: false,
          error: `Ollama: endpoint introuvable (${OLLAMA_BASE_URL}/api/tags -> 404). Verifiez OLLAMA_URL.`
        };
      }
      emitOllamaEvent('ollama-error', { model: requestedModel, error: `Impossible de joindre Ollama: ${error.message}` });
      return {
        success: false,
        error: `Ollama: impossible de joindre Ollama (${OLLAMA_BASE_URL}). ${error.message}`
      };
    }

    if (!Array.isArray(installedModelNames) || installedModelNames.length === 0) {
      emitOllamaEvent('ollama-error', { model: requestedModel, error: 'Aucun modele installe.' });
      return {
        success: false,
        error: `Ollama: aucun modele installe. Lancez par exemple: ollama pull ${DEFAULT_OLLAMA_MODEL}`
      };
    }

    const installedModelSet = new Set(installedModelNames);
    if (requestedModel) {
      if (!installedModelSet.has(requestedModel)) {
        emitOllamaEvent('ollama-error', { model: requestedModel, error: `Modele non installe: ${requestedModel}` });
        return {
          success: false,
          error: `Ollama: modele "${requestedModel}" non installe. Installez-le avec: ollama pull ${requestedModel}`,
          provider: 'ollama',
          requestedModel,
          requestId
        };
      }
      model = requestedModel;
    } else {
      model = pickInstalledOllamaModel(requestedModel, installedModelNames, FALLBACK_OLLAMA_MODEL_CANDIDATES);
    }
    if (!model) {
      emitOllamaEvent('ollama-error', { model: requestedModel, error: 'Aucun modele compatible.' });
      return {
        success: false,
        error: 'Ollama: aucun modele installe compatible avec la configuration courante.'
      };
    }
    let selectedModelLoaded = false;
    try {
      selectedModelLoaded = hasLoadedOllamaModel(model, await fetchOllamaLoadedModels(OLLAMA_BASE_URL, 2000));
    } catch {
      selectedModelLoaded = false;
    }
    emitOllamaEvent('ollama-status', {
      status: selectedModelLoaded ? 'model-ready' : 'ready',
      model,
      requestedModel,
      text: selectedModelLoaded ? `Modele pret: ${model}` : `Ollama pret: ${model}`
    });

    // Cap history to last 10 messages to avoid overflowing small local models
    const validHistory = history
      .filter(msg => msg && typeof msg === 'object' && msg.text !== undefined)
      .slice(-10);
    if (validHistory.length === 0) return { success: false, error: "Historique vide pour Ollama." };

    const lastMessage = validHistory[validHistory.length - 1];
    const lastUserText = String(lastMessage.text || '');
    if (!lastUserText.trim()) return { success: false, error: "Dernier message utilisateur vide pour Ollama." };
    const userPromptText = extractDecoratedUserPrompt(lastUserText);
    const isLightweightChat = isSimpleOllamaChatPrompt(lastUserText)
      || (options.lightweightChat === true && isSimpleOllamaChatPrompt(userPromptText));

    // Contexte A LA DEMANDE : on injecte un INDEX leger (chemins + tailles, pas le
    // contenu complet) ; l'agent lit les fichiers utiles via read_file/read_lines.
    // Fini le bourrage de 15 fichiers tronques dans chaque prompt.
    const hasProjectTools = !isLightweightChat && !!projectPath && !!allProjectFiles?.files;
    const projectContext = hasProjectTools ? buildProjectIndexContext(allProjectFiles) : '';
    const toolContract = hasProjectTools ? `\n${AGENT_FILE_TOOL_CONTRACT}\n` : '';
    const agentPrompt = isLightweightChat ? null : await loadAgentForCompletion(options.agent, projectPath);
    // Skill selectionne : charge le contenu complet (choix explicite de l'utilisateur).
    const selectedSkill = isLightweightChat ? null : await loadSkillForCompletion(options.skill, projectPath);
    // Skills globaux : noms seulement — l'agent lit le contenu via outil si besoin.
    // (Meme logique que Multi-Ollama : on ne bourre pas le prompt avec tout le contenu.)
    const skillNamesText = isLightweightChat ? '' : formatAvailableSkillsListForPrompt(options.skillsContent);
    // Workflows et n8n : charger seulement si l'intention est detectee dans la question.
    const visualWorkflowContext = isLightweightChat ? '' : await buildVisualWorkflowContextForPrompt(projectPath, lastUserText, options);
    const n8nCatalogContext = isLightweightChat ? '' : await buildN8nCatalogContextForPrompt(lastUserText, options);

    const agentContext = agentPrompt
      ? `\n--- AGENT PERSONA (${agentPrompt.name}) ---\n${agentPrompt.body}\n--- FIN AGENT ---\n`
      : '';

    const skillContext = [
      selectedSkill
        ? `\n--- SKILL ACTIF (${selectedSkill.name}) ---\n${selectedSkill.content}\n--- FIN SKILL ACTIF ---\n`
        : '',
      skillNamesText
    ].filter(Boolean).join('\n');

    const systemPrompt = isLightweightChat
      ? 'Tu es FuturIA, un assistant local. Reponds directement, brievement et naturellement.'
      : `Tu es un assistant de développement expert et autonome.
${agentContext}
${skillContext}
${projectContext}
${toolContract}
${visualWorkflowContext}
${n8nCatalogContext}
FICHIER OUVERT: ${currentCode ? currentCode.substring(0, 2000) : 'Aucun'}

${TERMINAL_CAPABILITY_PROMPT}

Pour modifier des fichiers, utilise: **FICHIER: nom.ext** \`\`\`langage\n// code complet\n\`\`\``;

    const buildOllamaMessages = (baseHistory, userPrompt) => {
      const msgs = [{ role: 'system', content: systemPrompt }];
      if (!isLightweightChat) {
        baseHistory.slice(0, -1).forEach(msg => {
          if (msg.role === 'model') msgs.push({ role: 'assistant', content: String(msg.text) });
          else if (msg.role === 'user') msgs.push({ role: 'user', content: String(msg.text) });
        });
      }
      msgs.push({ role: 'user', content: userPrompt });
      return msgs;
    };

    const maxTokens = isLightweightChat
      ? Math.min(resolveSimpleOllamaMaxTokens(options.maxTokens, options.executionMode), SIMPLE_OLLAMA_CHAT_MAX_TOKENS)
      : resolveSimpleOllamaMaxTokens(options.maxTokens, options.executionMode);
    const ollamaCall = async (messages) => {
      if (isCancelled()) throw makeCancelledError();
      let response;
      try {
        emitOllamaEvent('ollama-status', {
          status: selectedModelLoaded ? 'generating' : 'model-starting',
          model,
          text: selectedModelLoaded
            ? `Modele pret, generation en cours: ${model}`
            : `Demarrage local du modele ${model}...`
        });
        response = await axios.post(`${OLLAMA_BASE_URL}/api/chat`, {
          model,
          messages,
          stream: true,
          think: computeOllamaThink(model, options.thinkingMode),
          keep_alive: OLLAMA_KEEP_ALIVE,
          options: { temperature: options.temperature || 0.7, num_predict: maxTokens }
        }, {
          responseType: 'stream',
          timeout: OLLAMA_STREAM_RESPONSE_TIMEOUT_MS,
          signal: controller.signal
        });
        selectedModelLoaded = true;
        requestState.stream = response.data;
      } catch (error) {
        if (isCancelled() || error.code === 'ERR_CANCELED' || error.name === 'CanceledError') {
          throw makeCancelledError();
        }
        if (axios.isAxiosError(error) && error.response?.status === 404) {
          const details = String(error.response?.data?.error || error.message || '404');
          throw new Error(`Ollama 404 (modele="${model}"): ${details}`);
        }
        if (axios.isAxiosError(error) && error.code === 'ECONNABORTED') {
          throw new Error(`Ollama: aucun premier token apres ${Math.round(OLLAMA_STREAM_RESPONSE_TIMEOUT_MS / 1000)}s. Le modele "${model}" est peut-etre trop lent ou bloque.`);
        }
        throw error;
      }

      return new Promise((resolve, reject) => {
        let fullText = '';
        let buffer = '';
        let settled = false;
        let hasStarted = false;
        let inactivityTimer = null;

        const cleanup = () => {
          if (inactivityTimer) clearTimeout(inactivityTimer);
          requestState.stream = null;
        };

        const safeResolve = (value) => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(value);
        };

        const safeReject = (error) => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(error);
        };

        const resetWatchdog = () => {
          if (settled) return;
          if (inactivityTimer) clearTimeout(inactivityTimer);
          inactivityTimer = setTimeout(() => {
            try { response.data?.destroy?.(); } catch { /* noop */ }
            const phase = hasStarted ? 'generation' : 'attente du premier token';
            safeReject(new Error(
              `Ollama (modele="${model}"): aucune reponse pendant `
              + `${Math.round(OLLAMA_STREAM_INACTIVITY_TIMEOUT_MS / 1000)}s (${phase} bloque).`
            ));
          }, OLLAMA_STREAM_INACTIVITY_TIMEOUT_MS);
        };

        const processLine = (line) => {
          const trimmed = String(line || '').trim();
          if (!trimmed || settled) return;
          let payload;
          try {
            payload = JSON.parse(trimmed);
          } catch {
            return;
          }

          if (payload.error) {
            safeReject(new Error(String(payload.error)));
            return;
          }

          const token = payload?.message?.content || '';
          if (token) {
            hasStarted = true;
            fullText += token;
            emitOllamaEvent('ollama-token', {
              model,
              token,
              done: false
            });
          }

          if (payload.done) {
            safeResolve(fullText);
          }
        };

        response.data.on('data', (chunk) => {
          if (isCancelled()) {
            safeReject(makeCancelledError());
            return;
          }
          resetWatchdog();
          buffer += chunk.toString('utf8');
          let newlineIndex = buffer.indexOf('\n');
          while (newlineIndex >= 0) {
            const line = buffer.slice(0, newlineIndex);
            buffer = buffer.slice(newlineIndex + 1);
            processLine(line);
            newlineIndex = buffer.indexOf('\n');
          }
        });

        response.data.on('end', () => {
          if (buffer.trim()) processLine(buffer);
          safeResolve(fullText);
        });

        response.data.on('error', (error) => {
          if (isCancelled()) {
            safeReject(makeCancelledError());
            return;
          }
          safeReject(error);
        });

        resetWatchdog();
      });
    };

    let messages = buildOllamaMessages(validHistory, isLightweightChat ? userPromptText : String(lastMessage.text));
    let fullTranscript = '';
    const MAX_ITERATIONS = isLightweightChat ? 1 : 8;

    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      const aiText = await ollamaCall(messages);

      if (isLightweightChat) {
        const finalText = stripThinkBlocks(aiText);
        emitOllamaEvent('ollama-done', { model, done: true });
        return {
          success: true,
          text: finalText,
          terminalActions: 0,
          provider: 'ollama',
          requestedModel,
          model,
          requestId,
          maxTokens,
          lightweightChat: true
        };
      }

      // Outils a la demande (lecture fichiers) : prioritaire, et on ne pollue PAS
      // la reponse finale avec les tours d'outils (balises + resultats).
      if (hasProjectTools) {
        const toolCalls = parseAgentToolCalls(aiText);
        if (toolCalls.length > 0) {
          const toolResults = [];
          for (const call of toolCalls.slice(0, AGENT_MAX_TOOL_CALLS)) {
            // eslint-disable-next-line no-await-in-loop
            toolResults.push(await executeAgentFileToolCall(projectPath, call));
          }
          messages = [
            ...messages,
            { role: 'assistant', content: aiText },
            { role: 'user', content: `[RESULTATS_OUTILS]\n${toolResults.join('\n\n')}\n\nSi les infos suffisent, donne la reponse finale sans nouvel appel outil.` }
          ];
          continue;
        }
      }

      fullTranscript += (fullTranscript ? '\n\n---\n\n' : '') + aiText;

      const cmd = parseRunCommand(aiText);
      if (!cmd) {
        const finalText = stripThinkBlocks(fullTranscript);
        emitOllamaEvent('ollama-done', { model, done: true });
        return { success: true, text: finalText, terminalActions: iter, provider: 'ollama', requestedModel, model, requestId, maxTokens };
      }

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('ai-terminal-action', { command: cmd, iteration: iter + 1 });
      }
      const { output } = await executeCommandForAI(cmd, projectPath);
      messages = [
        ...messages,
        { role: 'assistant', content: aiText },
        { role: 'user', content: `[RÉSULTAT TERMINAL]\n\`\`\`\n${output}\n\`\`\`\nContinue ou termine.` }
      ];
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('ai-terminal-result', { command: cmd, output, iteration: iter + 1 });
      }
    }

    const finalText = stripThinkBlocks(fullTranscript);
    emitOllamaEvent('ollama-done', { model, done: true });
    return { success: true, text: finalText, terminalActions: MAX_ITERATIONS, provider: 'ollama', requestedModel, model, requestId, maxTokens };
  } catch (error) {
    if (error?.code === 'OLLAMA_CANCELLED') {
      emitOllamaEvent('ollama-done', { model: requestedModel, done: true, cancelled: true });
      return { success: false, cancelled: true, error: error.message, provider: 'ollama', requestedModel, requestId };
    }
    console.error('[Ollama] Erreur:', error.message);
    emitOllamaEvent('ollama-error', { model: requestedModel, error: error.message });
    return { success: false, error: `Ollama: ${error.message}`, provider: 'ollama', requestedModel, requestId };
  } finally {
    activeOllamaRequests.delete(requestId);
  }
});

// ==================== MULTI-OLLAMA 3 AGENTS ====================

ipcMain.handle('get-ollama-multi-completion', async (event, history, currentCode, allProjectFiles, options = {}) => {
  try {
    const OLLAMA_BASE_URL_MULTI = process.env.OLLAMA_URL || 'http://localhost:11434';
    const fallbackModel = String(options.model || process.env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL).trim() || DEFAULT_OLLAMA_MODEL;
    const modelArchitect = String(options.modelArchitect || fallbackModel).trim() || fallbackModel;
    const modelCoder = String(options.modelCoder || fallbackModel).trim() || fallbackModel;
    const modelTester = String(options.modelTester || fallbackModel).trim() || fallbackModel;
    const retryCount = toPositiveInt(options.retryCount, 1, 0, 3);
    const trustedProjectPath = await resolveOptionalTrustedProjectPath(options.projectPath);
    if (!trustedProjectPath) {
      return { success: false, error: 'Projet autorise requis pour Ollama Multi.' };
    }
    const workspaceRoot = trustedProjectPath;

    const validHistory = Array.isArray(history) ? history : [];
    const lastMessage = validHistory[validHistory.length - 1];
    if (!lastMessage || !lastMessage.text) return { success: false, error: 'Aucune question.' };
    const userPrompt = String(lastMessage.text);

    // ── Skill names only (lightweight) ──────────────────────────
    const skillsList = Array.isArray(options.skillsContent) ? options.skillsContent : [];
    const skillNamesText = skillsList.length > 0
      ? '\nSkills disponibles: ' + skillsList.map(s => s.name).join(', ') + '\nChoisis max 5 skills pertinents.'
      : '';

    // ── Build compact project index context (no raw full files) ───────────
    const fileEntries = allProjectFiles?.files && typeof allProjectFiles.files === 'object'
      ? Object.entries(allProjectFiles.files)
      : [];
    const fileIndexLines = fileEntries.slice(0, 200).map(([filePath, fileData]) => {
      const size = Number(fileData?.size || 0);
      return `- ${filePath} (${Number.isFinite(size) ? size : 0} bytes)`;
    });
    if (fileEntries.length > fileIndexLines.length) {
      fileIndexLines.push(`- ... ${fileEntries.length - fileIndexLines.length} fichiers supplementaires`);
    }
    const projectContext = fileIndexLines.length > 0
      ? `\nINDEX PROJET (sans contenu brut):\n${fileIndexLines.join('\n')}\n`
      : '\nINDEX PROJET indisponible.\n';
    const codeCtx = currentCode ? `\nFICHIER OUVERT (extrait):\n${String(currentCode).substring(0, 2000)}` : '';
    const visualWorkflowContext = await buildVisualWorkflowContextForPrompt(trustedProjectPath, userPrompt, options);
    const n8nCatalogContext = await buildN8nCatalogContextForPrompt(userPrompt, options);
    const toolContractText = `OUTILS DISPONIBLES:
- <read_file file="chemin/relatif.ext" />
- <read_lines file="chemin/relatif.ext" start="10" end="80" />
- <list_workflows />
- <read_workflow id="workflow_id" />

REGLES OUTILS:
- Utilise uniquement des chemins relatifs au workspace.
- Extensions lues: tout fichier texte (dotfiles inclus), sauf formats binaires/media/archive courants.
- Taille max fichier: ${AGENT_MAX_FILE_BYTES} bytes
- read_lines renvoie au maximum ${AGENT_MAX_LINES_PER_CALL} lignes.
- Quand tu appelles un outil, reponds uniquement avec les balises d'outil, sans texte autour.`;

    const sendStep = (label, status, text) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('ai-multi-ollama-step', { label, status, text });
      }
    };

    let installedModelNames = [];
    try {
      const startResult = await startOllamaServerIfPossible();
      if (!startResult.success) {
        throw new Error(startResult.error || 'Ollama indisponible.');
      }
      const tagsResponse = await fetchOllamaTags(OLLAMA_BASE_URL_MULTI);
      installedModelNames = extractOllamaModelNames(tagsResponse?.data);
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return {
          success: false,
          error: `Ollama Multi: endpoint introuvable (${OLLAMA_BASE_URL_MULTI}/api/tags -> 404). Vérifiez OLLAMA_URL.`
        };
      }
      return {
        success: false,
        error: `Ollama Multi: impossible de joindre Ollama (${OLLAMA_BASE_URL_MULTI}). ${error.message}`
      };
    }

    if (!Array.isArray(installedModelNames) || installedModelNames.length === 0) {
      return {
        success: false,
        error: `Ollama Multi: aucun modele installe. Lancez par exemple: ollama pull ${DEFAULT_OLLAMA_MODEL}`
      };
    }

    const resolveRoleModel = (requestedModel, roleLabel, preferredCandidates = []) => {
      const requested = normalizeOllamaModelName(requestedModel);
      const selected = pickInstalledOllamaModel(requested, installedModelNames, preferredCandidates);
      if (!selected) {
        throw new Error(`Aucun modele valide disponible pour ${roleLabel}`);
      }
      if (requested && selected !== requested) {
        sendStep('⚙️ Model Router', 'active', `${roleLabel}: "${requested}" indisponible, fallback "${selected}"`);
      }
      return selected;
    };

    const resolvedModelArchitect = resolveRoleModel(
      modelArchitect,
      'Architecte',
      FALLBACK_OLLAMA_ARCHITECT_MODEL_CANDIDATES
    );
    const resolvedModelCoder = resolveRoleModel(
      modelCoder,
      'Codeur',
      FALLBACK_OLLAMA_CODER_MODEL_CANDIDATES
    );
    const resolvedModelTester = resolveRoleModel(
      modelTester,
      'Relecteur',
      FALLBACK_OLLAMA_TESTER_MODEL_CANDIDATES
    );

    const emitStreamingDone = (agentLabel) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('ollama-multi-token', {
          agent: agentLabel,
          token: '',
          done: true
        });
      }
    };

    // ── Streaming Ollama call: sends tokens live to frontend ─────────
    const ollamaCall = async (messages, maxTokens, agentLabel, modelName) => {
      let response;
      try {
        response = await axios.post(`${OLLAMA_BASE_URL_MULTI}/api/chat`, {
          model: modelName,
          messages,
          stream: true,
          think: computeOllamaThink(modelName, options.thinkingMode),
          keep_alive: OLLAMA_KEEP_ALIVE,
          options: { temperature: 0.7, num_predict: maxTokens || 2048 }
        }, {
          responseType: 'stream',
          // Timeout sur la reponse initiale (chargement modele / premiers octets).
          // Le blocage en cours de flux est gere par le watchdog d'inactivite ci-dessous.
          timeout: OLLAMA_STREAM_RESPONSE_TIMEOUT_MS
        });
      } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 404) {
          const details = String(error.response?.data?.error || error.message || '404');
          throw new Error(`Ollama 404 (${agentLabel}, modele="${modelName}"): ${details}`);
        }
        throw error;
      }

      return new Promise((resolve, reject) => {
        let fullText = '';
        let hasStarted = false;
        let settled = false;
        let doneEmitted = false;
        let buffer = '';
        let inactivityTimer = null;

        const loadWarning = setTimeout(() => {
          if (!hasStarted) {
            sendStep(`${agentLabel} ⏳ (Chargement long...)`, 'active', '');
          }
        }, 45000);

        const execWarning = setTimeout(() => {
          sendStep(`${agentLabel} ⏳ (Generation longue...)`, 'active', '');
        }, 120000);

        const cleanupTimers = () => {
          clearTimeout(loadWarning);
          clearTimeout(execWarning);
          if (inactivityTimer) clearTimeout(inactivityTimer);
        };

        // Watchdog d'inactivite: si Ollama cesse d'emettre des tokens pendant
        // OLLAMA_STREAM_INACTIVITY_TIMEOUT_MS, on rejette vraiment et on detruit le flux
        // (evite le spinner infini quand le modele se bloque en cours de generation).
        const resetWatchdog = () => {
          if (settled) return;
          if (inactivityTimer) clearTimeout(inactivityTimer);
          inactivityTimer = setTimeout(() => {
            try { response.data?.destroy?.(); } catch { /* noop */ }
            const phase = hasStarted ? 'generation' : 'chargement';
            safeReject(new Error(
              `Ollama (${agentLabel}, modele="${modelName}"): aucune reponse pendant `
              + `${Math.round(OLLAMA_STREAM_INACTIVITY_TIMEOUT_MS / 1000)}s (${phase} bloquee).`
            ));
          }, OLLAMA_STREAM_INACTIVITY_TIMEOUT_MS);
        };

        const safeResolve = (value) => {
          if (settled) return;
          settled = true;
          cleanupTimers();
          if (!doneEmitted) {
            doneEmitted = true;
            emitStreamingDone(agentLabel);
          }
          resolve(value);
        };

        const safeReject = (error) => {
          if (settled) return;
          settled = true;
          cleanupTimers();
          if (!doneEmitted) {
            doneEmitted = true;
            emitStreamingDone(agentLabel);
          }
          reject(error);
        };

        const processLine = (line) => {
          const trimmed = String(line || '').trim();
          if (!trimmed) return;

          let json;
          try {
            json = JSON.parse(trimmed);
          } catch {
            return;
          }

          const token = json?.message?.content || '';
          if (token) {
            fullText += token;
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('ollama-multi-token', {
                agent: agentLabel,
                token,
                done: false
              });
            }
          }

          if (json?.done) {
            safeResolve(fullText);
          }
        };

        response.data.on('data', (chunk) => {
          hasStarted = true;
          resetWatchdog();
          buffer += chunk.toString('utf8');
          let newlineIndex = buffer.indexOf('\n');
          while (newlineIndex >= 0) {
            const line = buffer.slice(0, newlineIndex);
            buffer = buffer.slice(newlineIndex + 1);
            processLine(line);
            newlineIndex = buffer.indexOf('\n');
          }
        });

        response.data.on('end', () => {
          if (buffer.trim()) processLine(buffer);
          safeResolve(fullText);
        });
        response.data.on('error', (err) => {
          safeReject(err);
        });

        // Arme le watchdog des le branchement (couvre aussi le silence avant le 1er token).
        resetWatchdog();
      });
    };

    const ollamaCallWithRetry = async (messages, maxTokens, agentLabel, modelName) => {
      let lastError;
      for (let attempt = 0; attempt <= retryCount; attempt += 1) {
        try {
          if (attempt > 0) {
            sendStep(agentLabel, 'active', `Retry ${attempt}/${retryCount}`);
          }
          const attemptMessages = attempt === 0
            ? messages
            : [
              ...messages,
              {
                role: 'system',
                content: "La tentative precedente a echoue. Reprends calmement, respecte strictement le format attendu et termine."
              }
            ];
          // eslint-disable-next-line no-await-in-loop
          return await ollamaCall(attemptMessages, maxTokens, agentLabel, modelName);
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError || new Error('Echec appel Ollama');
    };

    const executeToolCall = async (call) => {
      const toolName = String(call?.name || '').trim();
      const attrs = call?.attrs && typeof call.attrs === 'object' ? call.attrs : {};
      try {
        if (toolName === 'read_file') {
          const relFile = String(attrs.file || '').trim();
          if (!relFile) throw new Error('Attribut file requis');
          const resolvedInfo = safeResolvePath(workspaceRoot, relFile);
          const content = await readAgentFileWithLimits(workspaceRoot, relFile);
          return `<tool_result name="read_file" file="${resolvedInfo.relative}" status="ok">\n${content}\n</tool_result>`;
        }
        if (toolName === 'read_lines') {
          const relFile = String(attrs.file || '').trim();
          if (!relFile) throw new Error('Attribut file requis');
          const { resolvedPath, relativePath } = await validateAgentFileAccess(workspaceRoot, relFile);
          const raw = await fs.readFile(resolvedPath);
          if (isLikelyBinary(raw)) {
            throw new Error(`Fichier binaire non supporte: ${relativePath}`);
          }
          const content = raw.toString('utf8');
          const excerpt = readAgentLinesWithLimits(content, attrs.start, attrs.end, AGENT_MAX_LINES_PER_CALL);
          return `<tool_result name="read_lines" file="${relativePath}" start="${excerpt.start}" end="${excerpt.end}" total="${excerpt.total}" status="ok">\n${excerpt.content}\n</tool_result>`;
        }
        if (toolName === 'list_workflows') {
          const index = await getVisualWorkflowIndex(trustedProjectPath, 40);
          if (index.length === 0) {
            return `<tool_result name="list_workflows" status="ok">\nAucun workflow visuel trouve.\n</tool_result>`;
          }
          const lines = index.map((wf) =>
            `- id=${wf.id} | name=${wf.name} | nodes=${wf.nodes} | edges=${wf.edges}${wf.description ? ` | desc=${wf.description}` : ''}`
          );
          return `<tool_result name="list_workflows" status="ok">\n${lines.join('\n')}\n</tool_result>`;
        }
        if (toolName === 'read_workflow') {
          const workflowId = String(attrs.id || attrs.name || attrs.filename || '').trim();
          if (!workflowId) throw new Error('Attribut id requis');
          const content = await readVisualWorkflowById(trustedProjectPath, workflowId);
          return `<tool_result name="read_workflow" id="${workflowId}" status="ok">\n${content}\n</tool_result>`;
        }
        return formatToolError(toolName || 'unknown_tool', `Outil non supporte: ${toolName}`);
      } catch (error) {
        return formatToolError(toolName || 'unknown_tool', error?.message || String(error));
      }
    };

    const executeToolCalls = async (calls) => {
      const selectedCalls = Array.isArray(calls) ? calls.slice(0, AGENT_MAX_TOOL_CALLS) : [];
      const outputs = [];
      for (const call of selectedCalls) {
        // eslint-disable-next-line no-await-in-loop
        outputs.push(await executeToolCall(call));
      }
      return outputs.join('\n\n');
    };

    const runAgentWithTools = async ({ agentLabel, modelName, systemPrompt, userMessage, maxTokens }) => {
      let messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ];
      let lastResponse = '';

      for (let round = 0; round < AGENT_TOOL_MAX_ROUNDS; round += 1) {
        // eslint-disable-next-line no-await-in-loop
        const responseText = await ollamaCallWithRetry(messages, maxTokens, agentLabel, modelName);
        lastResponse = responseText;
        const toolCalls = parseAgentToolCalls(responseText);
        if (toolCalls.length === 0) return responseText;

        sendStep(agentLabel, 'active', `${toolCalls.length} outil(s), tour ${round + 1}/${AGENT_TOOL_MAX_ROUNDS}`);
        // eslint-disable-next-line no-await-in-loop
        const toolResults = await executeToolCalls(toolCalls);
        messages = [
          ...messages,
          { role: 'assistant', content: responseText },
          {
            role: 'user',
            content: `[RESULTATS_OUTILS]\n${toolResults}\n\nSi les infos suffisent, donne la reponse finale sans nouvel appel outil.`
          }
        ];
      }

      return `${lastResponse}\n\n[NOTE SYSTEME] Limite d'appels outils atteinte (${AGENT_TOOL_MAX_ROUNDS} tours).`;
    };

    // ────────── Agent 1 : Architecte (RAPIDE — 4096 tokens) ──────────
    sendStep('🏗️ Architecte', 'active', '');
    const archSystem = `Tu es un architecte logiciel senior. Sois CONCIS (max 300 mots).
${projectContext}${codeCtx}${visualWorkflowContext}${n8nCatalogContext}${skillNamesText}
${toolContractText}

REPONDS avec:
1. Plan technique en bullet points (structure fichiers, architecture, sequence)
2. Section "## Skills attribues" avec:
   - Codeur: [max 5 noms de skills]
   - Relecteur: [max 3 noms de skills]

PAS de code. PAS d'explications longues. Juste le plan.`;

    const archPlan = await runAgentWithTools({
      agentLabel: '🏗️ Architecte',
      modelName: resolvedModelArchitect,
      systemPrompt: archSystem,
      userMessage: userPrompt,
      maxTokens: 2048
    });
    sendStep('🏗️ Architecte', 'done', archPlan);

    // ── Read only selected skills from disk ──────────────────────
    const readSkillFile = async (name, scope, pPath) => {
      try {
        const safeName = safeFileBase(name);
        if (!safeName) return '';
        let dir;
        if (scope === 'global') dir = getGlobalSkillsDir();
        else if (scope === 'workspace' && pPath) dir = getWorkspaceSkillsDir(pPath);
        else return '';
        const skillFile = path.join(dir, safeName, 'SKILL.md');
        if (fsSync.existsSync(skillFile)) {
          return await fs.readFile(skillFile, 'utf-8');
        }
      } catch (e) { }
      return '';
    };

    const parseAssignedSkills = async (plan, agentName) => {
      try {
        const regex = new RegExp(`${agentName}\\s*:\\s*(.+?)(?:\\n|$)`, 'i');
        const match = plan.match(regex);
        if (!match) return '';
        const assignedNames = match[1].split(',').map(s => s.trim().replace(/[\[\]]/g, ''));
        const filtered = skillsList.filter(s => assignedNames.some(a => a.toLowerCase().includes(s.name.toLowerCase())));
        if (filtered.length === 0) return '';
        let content = '--- SKILLS ---\n';
        for (const s of filtered.slice(0, 5)) {
          const fileContent = await readSkillFile(s.name, s.scope, trustedProjectPath);
          if (fileContent) content += `## ${s.name}\n${fileContent.substring(0, 3000)}\n\n`;
        }
        return content + '---';
      } catch { return ''; }
    };

    const coderSkills = await parseAssignedSkills(archPlan, 'Codeur');
    const reviewSkills = await parseAssignedSkills(archPlan, 'Relecteur');

    const extractArtifactKeys = (text) => {
      const keys = new Set();
      const safeText = String(text || '');
      const fileRegex = /\*\*FICHIER:\s*(.+?)\*\*/gi;
      const diffRegex = /(?:^|\n)FILE:\s*(.+?)\s*(?:\n|$)/gi;
      const workflowRegex = /\*\*WORKFLOW:\s*(.+?)\*\*/gi;
      let match;

      while ((match = fileRegex.exec(safeText)) !== null) {
        const filePath = String(match[1] || '').trim();
        if (filePath) keys.add(`file:${filePath}`);
      }

      while ((match = diffRegex.exec(safeText)) !== null) {
        const filePath = String(match[1] || '').trim();
        if (filePath) keys.add(`file:${filePath}`);
      }

      while ((match = workflowRegex.exec(safeText)) !== null) {
        const workflowName = String(match[1] || '').trim();
        if (workflowName) keys.add(`workflow:${workflowName}`);
      }

      return Array.from(keys);
    };

    // ────────── Agent 2 : Codeur (ACTION — 8192 tokens) ──────────
    sendStep('💻 Codeur', 'active', '');
    const coderSystem = `Tu es un developpeur full-stack expert. Tu produis des modifications applicables.
${projectContext}${codeCtx}${visualWorkflowContext}${n8nCatalogContext}
${coderSkills}
${toolContractText}

REGLES STRICTES:
- Pour modifier un fichier existant, utilise UNIQUEMENT:
FILE: chemin/nom.ext
<<<< SEARCH
code exact existant
====
nouveau code
>>>> REPLACE

- Si SEARCH apparait plusieurs fois dans le fichier, precise davantage le bloc SEARCH.
- Pour creer un nouveau fichier, utilise:
**FICHIER: chemin/nom.ext** \`\`\`langage\n// contenu complet\n\`\`\`
- Si un workflow visuel est demande, produis: **WORKFLOW: NomDuWorkflow** \`\`\`json
{
  "name": "Nom",
  "nodes": [{"id":"node_1","type":"trigger|ai|action|logic|output","label":"Nom","icon":"▶️|🤖|💻|🔀|🔔","position":{"x":100,"y":150},"config":{}}],
  "edges": [{"source":"node_1","target":"node_2"}]
}
\`\`\`
- Couvre TOUS les fichiers necessaires a la demande, pas seulement un extrait.
- Si la reponse tient en une seule passe, termine par **STATUT: COMPLETE**
- S'il reste des fichiers a produire, termine par **STATUT: INCOMPLETE**
- Pas d'explication, uniquement les artefacts.
${TERMINAL_CAPABILITY_PROMPT}`;

    const MAX_CODER_PASSES = 3;
    let coderOutput = '';
    const emittedArtifacts = new Set();
    for (let coderPass = 0; coderPass < MAX_CODER_PASSES; coderPass++) {
      const isFirstCoderPass = coderPass === 0;
      const passLabel = isFirstCoderPass ? '' : `Passe ${coderPass + 1}/${MAX_CODER_PASSES}`;
      sendStep('💻 Codeur', 'active', passLabel);

      const passPrompt = isFirstCoderPass
        ? `${userPrompt}\n\nPLAN:\n${archPlan}`
        : `Continue exactement la generation precedente sans repliquer les artefacts deja emis.

Artefacts deja emis:
${Array.from(emittedArtifacts).join('\n') || '- aucun'}

Rappel:
- ajoute seulement les fichiers ou workflows manquants
- si tout est fini, termine par **STATUT: COMPLETE**
- sinon termine par **STATUT: INCOMPLETE**`;

      // eslint-disable-next-line no-await-in-loop
      const coderPassOutput = await runAgentWithTools({
        agentLabel: '💻 Codeur',
        modelName: resolvedModelCoder,
        systemPrompt: coderSystem,
        userMessage: passPrompt,
        maxTokens: 8192
      });

      coderOutput = coderOutput ? `${coderOutput}\n\n${coderPassOutput}` : coderPassOutput;
      extractArtifactKeys(coderPassOutput).forEach((artifactKey) => emittedArtifacts.add(artifactKey));
      sendStep('💻 Codeur', 'done', coderPassOutput);

      if (/\*\*STATUT:\s*COMPLETE/i.test(coderPassOutput)) {
        break;
      }
    }

    // ── Helper to run a shell command and get its output ──────────────────
    const runShellCommandWithSafety = async (cmd, cwd) => {
      const result = await executeCommandForAI(cmd, cwd || trustedProjectPath);
      return {
        ok: !!result?.success,
        output: String(result?.output || '')
      };
    };

    // ── Parse <run_command>...</run_command> blocks ──
    const parseTestCommands = (text) => {
      const results = [];
      const regex = /<run_command>([\s\S]*?)<\/run_command>/gi;
      let m;
      while ((m = regex.exec(text)) !== null) {
        const cmd = m[1].trim();
        if (cmd) results.push(cmd);
      }
      return results;
    };

    // ────────── Relecteur + Correction Loop ──────────
    const MAX_CORRECTIONS = 3;
    let evolvingProposal = coderOutput;
    let testLog = '';
    const correctionHistory = [];

    for (let iteration = 0; iteration <= MAX_CORRECTIONS; iteration++) {
      sendStep('🔍 Relecteur', 'active', `Iteration ${iteration + 1}`);

      const testerSystem = `Tu es un ingenieur QA senior, specialise en verification de patchs.
${projectContext}${visualWorkflowContext}${n8nCatalogContext}
${reviewSkills}
${toolContractText}

REGLES STRICTES:
- Pour executer une commande (curl, node, npm test...): <run_command>commande</run_command>
- Liste les erreurs avec: **ERREUR:** description precise de l'erreur
- Si tout passe: **STATUT: OK**
${testLog ? `\nRESULTATS DES COMMANDES PRECEDENTES:\n${testLog}` : ''}`;

      const testerOutput = await runAgentWithTools({
        agentLabel: '🔍 Relecteur',
        modelName: resolvedModelTester,
        systemPrompt: testerSystem,
        userMessage: `Teste ce patch:\n\n${evolvingProposal.substring(0, 5000)}\n\nDemande originale: ${userPrompt}`,
        maxTokens: 2048
      });

      sendStep('🔍 Relecteur', 'done', testerOutput);

      // Run shell commands requested by reviewer
      const commands = parseTestCommands(testerOutput);
      let commandResults = '';
      for (const cmd of commands.slice(0, 5)) {
        const cmdLabel = `⚡ ${cmd.substring(0, 50)}`;
        sendStep(cmdLabel, 'active', '');

        // Soft timeout warning for long commands (30s)
        const cmdWarningId = setTimeout(() => {
          sendStep(`${cmdLabel} ⏳ (Long...)`, 'active', '');
        }, 30000);

        const result = await runShellCommandWithSafety(cmd);
        clearTimeout(cmdWarningId);

        commandResults += `\n$ ${cmd}\n-> ${result.ok ? 'ok' : 'blocked/failed'}\n${result.output}\n`;
        sendStep(cmdLabel, 'done', commandResults);
      }
      if (commandResults) testLog += commandResults;

      const hasErrors = /\*\*ERREUR:/i.test(testerOutput);
      const allOK = /\*\*STATUT:\s*OK/i.test(testerOutput);

      correctionHistory.push({
        iteration: iteration + 1,
        testerReport: testerOutput,
        commandResults,
        passed: allOK && !hasErrors
      });

      if ((allOK && !hasErrors) || iteration >= MAX_CORRECTIONS) break;

      // ── Architecte correction round ──
      sendStep('🏗️ Architecte', 'active', `Correction ${iteration + 1}`);
      const errorSummary = testerOutput.match(/\*\*ERREUR:[\s\S]*?(?=\*\*|\n\n|$)/gi)?.join('\n') || testerOutput.substring(0, 800);
      const correctionPlan = await runAgentWithTools({
        agentLabel: '🏗️ Architecte',
        modelName: resolvedModelArchitect,
        systemPrompt: `${archSystem}\n\nCorrige uniquement les erreurs signalees. Sois minimal.`,
        userMessage: `ERREURS:\n${errorSummary}\n\nPATCH:\n${evolvingProposal.substring(0, 3500)}`,
        maxTokens: 1024
      });
      sendStep('🏗️ Architecte', 'done', correctionPlan);

      // ── Codeur correction round ──
      sendStep('💻 Codeur', 'active', `Correction ${iteration + 1}`);
      const correctedCode = await runAgentWithTools({
        agentLabel: '💻 Codeur',
        modelName: resolvedModelCoder,
        systemPrompt: `${coderSystem}\n\nApplique UNIQUEMENT les corrections necessaires.`,
        userMessage: `PLAN DE CORRECTION:\n${correctionPlan}\n\nERREURS:\n${errorSummary}`,
        maxTokens: 4096
      });
      sendStep('💻 Codeur', 'done', correctedCode);
      evolvingProposal += '\n\n---CORRECTION---\n\n' + correctedCode;
    }

    // ────────── Synthèse finale ──────────
    const testSummary = correctionHistory.map(h =>
      `### Itération ${h.iteration}\n${h.passed ? '✅ Tests OK' : '❌ Erreurs détectées'}\n${h.commandResults ? '```\n' + h.commandResults + '\n```' : ''}`
    ).join('\n\n');

    const finalText = [
      `## 🏗️ Plan (Architecte)\n${archPlan}`,
      `## 💻 Patch (Codeur)\n${evolvingProposal}`,
      `## 🔍 Rapport de relecture\n${testSummary}`
    ].join('\n\n---\n\n');

    return {
      success: true,
      text: finalText,
      multiAgent: true,
      models: {
        architect: resolvedModelArchitect,
        coder: resolvedModelCoder,
        tester: resolvedModelTester
      },
      requestedModels: {
        architect: modelArchitect,
        coder: modelCoder,
        tester: modelTester
      }
    };
  } catch (error) {
    console.error('[Ollama Multi] Erreur:', error.message);
    return { success: false, error: `Ollama Multi: ${error.message}` };
  }
});
