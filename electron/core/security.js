'use strict';

const path = require('path');
const fs = require('fs').promises;

// ---------------------------------------------------------------------------
// Shared mutable state: set of project paths the user has explicitly trusted.
// Node.js module caching guarantees a single instance across all requires.
// ---------------------------------------------------------------------------
const trustedProjectPaths = new Set();

// ---------------------------------------------------------------------------
// Path utilities
// ---------------------------------------------------------------------------

const toPositiveInt = (value, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

function assertSafePath(root, sub) {
  const rootResolved = path.resolve(root) + path.sep;
  const subResolved = path.resolve(sub);
  if (subResolved !== path.resolve(root) && !subResolved.startsWith(rootResolved)) {
    throw new Error(`Accès refusé: chemin hors projet "${sub}"`);
  }
}

function safeResolvePath(workspaceRoot, relativePath) {
  const root = path.resolve(String(workspaceRoot || '').trim() || process.cwd());
  const candidateRaw = String(relativePath || '').trim();
  if (!candidateRaw) throw new Error('Chemin vide');
  if (candidateRaw.includes('\0')) throw new Error('Chemin invalide');
  if (path.isAbsolute(candidateRaw)) throw new Error(`Chemin absolu interdit: "${candidateRaw}"`);
  const normalizedRelative = path.normalize(candidateRaw);
  if (
    normalizedRelative === '..' ||
    normalizedRelative.startsWith(`..${path.sep}`) ||
    normalizedRelative.includes(`${path.sep}..${path.sep}`)
  ) {
    throw new Error(`Path traversal interdit: "${candidateRaw}"`);
  }
  const resolved = path.resolve(root, normalizedRelative);
  assertSafePath(root, resolved);
  return { root, resolved, relative: normalizedRelative.replace(/\\/g, '/') };
}

// ---------------------------------------------------------------------------
// Trust system
// ---------------------------------------------------------------------------

const normalizeProjectPathForTrust = (projectPath) => {
  const raw = String(projectPath || '').trim();
  if (!raw || raw.includes('\0')) return '';
  return path.resolve(raw);
};

const isInternalProjectPath = (projectPath) =>
  normalizeProjectPathForTrust(projectPath)
    .split(/[\\/]+/)
    .some((segment) => segment.toLowerCase() === '.agent');

const resolveNearestExistingPath = async (candidate) => {
  let current = path.resolve(candidate);
  while (true) {
    try {
      return await fs.realpath(current);
    } catch (error) {
      if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') throw error;
      const parent = path.dirname(current);
      if (parent === current) return current;
      current = parent;
    }
  }
};

const assertNotInternalProjectPath = async (root, candidate) => {
  const rootResolved = path.resolve(root);
  const candidateResolved = path.resolve(candidate);
  const relativePath = path.relative(rootResolved, candidateResolved);
  if (isInternalProjectPath(relativePath)) {
    throw new Error('Chemin interne .agent interdit');
  }

  const [realRoot, realCandidate] = await Promise.all([
    resolveNearestExistingPath(rootResolved),
    resolveNearestExistingPath(candidateResolved)
  ]);
  if (isInternalProjectPath(realRoot) || isInternalProjectPath(realCandidate)) {
    throw new Error('Chemin interne .agent interdit');
  }

  const realRootPrefix = realRoot.endsWith(path.sep) ? realRoot : `${realRoot}${path.sep}`;
  if (realCandidate !== realRoot && !realCandidate.startsWith(realRootPrefix)) {
    throw new Error(`Accès refusé: chemin hors projet "${candidate}"`);
  }
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

// Main-process revocation hook. Any future project/session close or logout
// flow can invalidate local access immediately; retrieval re-checks this set
// immediately before reading an index.
const revokeProjectPath = (projectPath) => {
  const normalized = normalizeProjectPathForTrust(projectPath);
  if (!normalized) return false;
  return trustedProjectPaths.delete(normalized);
};

const ensureTrustedProjectPath = async (projectPath) => {
  const normalized = normalizeProjectPathForTrust(projectPath);
  if (!normalized) throw new Error('Chemin projet manquant ou invalide');
  if (isInternalProjectPath(normalized)) throw new Error('Chemin interne .agent interdit');
  await assertNotInternalProjectPath(normalized, normalized);
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

/**
 * Shows a native Electron dialog asking the user to trust a project path.
 * @param {string} projectPath
 * @param {{ dialog: object, getMainWindow: () => BrowserWindow|null }} deps
 */
const requestProjectPathApproval = async (projectPath, { dialog, getMainWindow }) => {
  const normalized = normalizeProjectPathForTrust(projectPath);
  if (!normalized) return { success: false, error: 'Chemin projet invalide' };
  if (isInternalProjectPath(normalized)) return { success: false, error: 'Chemin interne .agent interdit' };
  try {
    await assertNotInternalProjectPath(normalized, normalized);
  } catch (error) {
    return { success: false, error: error.message };
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

  const targetWindow = (getMainWindow?.() && !getMainWindow().isDestroyed()) ? getMainWindow() : null;
  const result = await dialog.showMessageBox(targetWindow, {
    type: 'question',
    title: 'Autoriser le projet',
    message: 'Autoriser Code companion à rouvrir ce dossier ?',
    detail: normalized,
    buttons: ['Autoriser', 'Refuser'],
    defaultId: 0,
    cancelId: 1,
    noLink: true
  });
  if (result.response !== 0) return { success: false, error: 'Autorisation projet refusee' };
  trustProjectPath(normalized);
  return { success: true, path: normalized, alreadyTrusted: false };
};

// ---------------------------------------------------------------------------
// Agent file-access constants & guards
// ---------------------------------------------------------------------------

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

const formatToolError = (name, message) =>
  `<tool_result name="${name}" status="error">\n${message}\n</tool_result>`;

async function validateAgentFileAccess(workspaceRoot, relativePath) {
  const resolvedPathInfo = safeResolvePath(workspaceRoot, relativePath);
  const { resolved, relative } = resolvedPathInfo;
  if (!hasAllowedAgentExtension(relative)) throw new Error(`Extension non autorisee: ${relative}`);
  let stats;
  try {
    stats = await fs.lstat(resolved);
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`Fichier introuvable: ${relative}`);
    throw error;
  }
  if (stats.isSymbolicLink()) throw new Error(`Liens symboliques interdits: ${relative}`);
  if (!stats.isFile()) throw new Error(`Cible non-fichier: ${relative}`);
  if (stats.size > AGENT_MAX_FILE_BYTES) {
    throw new Error(`Fichier trop volumineux (${stats.size} bytes > ${AGENT_MAX_FILE_BYTES})`);
  }
  return { resolvedPath: resolved, relativePath: relative, stats };
}

async function readAgentFileWithLimits(workspaceRoot, relativePath) {
  const { resolvedPath, relativePath: relPath } = await validateAgentFileAccess(workspaceRoot, relativePath);
  const raw = await fs.readFile(resolvedPath);
  if (isLikelyBinary(raw)) throw new Error(`Fichier binaire non supporte: ${relPath}`);
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
  return { start: s, end: eCapped, total, content: lines.slice(s - 1, eCapped).join('\n') };
}

// ---------------------------------------------------------------------------
// Agent tool-call parsing & execution (provider-agnostic)
// ---------------------------------------------------------------------------

const parseTagAttributes = (rawAttrs) => {
  const attrs = {};
  const text = String(rawAttrs || '');
  const regex = /([a-zA-Z_][a-zA-Z0-9_-]*)\s*=\s*"([^"]*)"/g;
  let match;
  while ((match = regex.exec(text)) !== null) attrs[match[1]] = match[2];
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
  while ((match = readFileRegex.exec(source)) !== null) pushCall({ name: 'read_file', attrs: parseTagAttributes(match[1]) });
  while ((match = readLinesRegex.exec(source)) !== null) pushCall({ name: 'read_lines', attrs: parseTagAttributes(match[1]) });
  while ((match = listWorkflowsRegex.exec(source)) !== null) pushCall({ name: 'list_workflows', attrs: {} });
  while ((match = readWorkflowRegex.exec(source)) !== null) pushCall({ name: 'read_workflow', attrs: parseTagAttributes(match[1]) });
  return calls;
};

const AGENT_FILE_TOOL_CONTRACT = `OUTILS DISPONIBLES (lecture du projet a la demande):
- <read_file file="chemin/relatif.ext" />
- <read_lines file="chemin/relatif.ext" start="10" end="80" />

REGLES OUTILS:
- Utilise uniquement des chemins relatifs au workspace, pris dans l'INDEX PROJET.
- Ne demande que les fichiers reellement utiles a la reponse.
- Taille max fichier: ${AGENT_MAX_FILE_BYTES} bytes ; read_lines renvoie au max ${AGENT_MAX_LINES_PER_CALL} lignes.
- Quand tu appelles un outil, reponds UNIQUEMENT avec les balises d'outil, sans texte autour.`;

const executeAgentFileToolCall = async (workspaceRoot, call, toolPolicy = {}) => {
  const toolName = String(call?.name || '').trim();
  const attrs = call?.attrs && typeof call.attrs === 'object' ? call.attrs : {};
  try {
    if (toolPolicy?.toolsAllowed === false || toolPolicy?.allowToolCalls === false
      || toolPolicy?.promptSafety?.allowToolCalls === false) {
      throw new Error('Tool calls disabled by retrieval safety policy');
    }
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

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  // Path guards
  assertSafePath,
  assertNotInternalProjectPath,
  safeResolvePath,
  toPositiveInt,
  // Trust system
  trustedProjectPaths,
  normalizeProjectPathForTrust,
  isInternalProjectPath,
  trustProjectPath,
  isTrustedProjectPath,
  revokeProjectPath,
  ensureTrustedProjectPath,
  resolveOptionalTrustedProjectPath,
  requestProjectPathApproval,
  // Agent file utilities
  AGENT_BLOCKED_EXTENSIONS,
  AGENT_MAX_FILE_BYTES,
  AGENT_MAX_LINES_PER_CALL,
  AGENT_MAX_TOOL_CALLS,
  AGENT_TOOL_MAX_ROUNDS,
  AGENT_TOOL_CONTENT_MAX_CHARS,
  hasAllowedAgentExtension,
  isLikelyBinary,
  formatToolError,
  validateAgentFileAccess,
  readAgentFileWithLimits,
  readAgentLinesWithLimits,
  parseTagAttributes,
  parseAgentToolCalls,
  AGENT_FILE_TOOL_CONTRACT,
  executeAgentFileToolCall,
  buildProjectIndexContext,
};
