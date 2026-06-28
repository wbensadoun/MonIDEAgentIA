'use strict';

const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const readline = require('readline');
const { ensureTrustedProjectPath, assertSafePath } = require('../core/security');
const { ensureEditPermission } = require('./settings.service');
const { applyBlock: applySearchReplaceBlock } = require('../../client/src/utils/applySearchReplace');

// ---------------------------------------------------------------------------
// Shared helpers (used across multiple service functions)
// ---------------------------------------------------------------------------

const TEXT_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx',
  '.html', '.css', '.scss', '.sass', '.less',
  '.json', '.md', '.txt',
  '.py', '.java', '.cpp', '.c', '.h', '.hpp', '.php', '.rb', '.go', '.rs',
  '.xml', '.yml', '.yaml', '.sql',
  '.sh', '.bat', '.ps1',
  '.vue', '.svelte', '.astro',
  '.toml', '.ini', '.conf', '.config'
]);

const TEXT_FILE_NAMES = new Set([
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

const shouldReadAsText = (name) => {
  const lower = String(name || '').toLowerCase();
  if (TEXT_FILE_NAMES.has(lower)) return true;
  const ext = path.extname(lower);
  return TEXT_EXTENSIONS.has(ext);
};

const makeShouldSkipDirectory = ({ includeGit, includeNodeModules, includeBuild }) =>
  (name) => {
    if (!name) return true;
    if (!includeGit && name === '.git') return true;
    if (!includeNodeModules && name === 'node_modules') return true;
    if (!includeBuild &&
      (name === 'dist' || name === 'build' || name === 'out' ||
        name === '.next' || name === 'coverage' || name === '.turbo' ||
        name === '.cache' || name === '.parcel-cache')) {
      return true;
    }
    return false;
  };

const clampNumber = (value, min, max, fallback) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

// ---------------------------------------------------------------------------
// getAllFiles — full hierarchical tree (used by get-all-files)
// ---------------------------------------------------------------------------

const getAllFiles = async (folderPath) => {
  try {
    const trustedFolderPath = await ensureTrustedProjectPath(folderPath);

    async function buildFileTree(dirPath, relativePath = '') {
      const items = await fs.readdir(dirPath, { withFileTypes: true });
      const treeItems = [];

      for (const item of items) {
        const itemPath = path.join(dirPath, item.name);
        const relativeItemPath = relativePath ? path.join(relativePath, item.name) : item.name;

        if (item.isDirectory()) {
          treeItems.push({
            name: item.name,
            type: 'directory',
            path: relativeItemPath,
            fullPath: itemPath,
            children: [],
            hasChildren: true
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
};

// ---------------------------------------------------------------------------
// getFolderChildren — lazy-load children of a specific folder
// ---------------------------------------------------------------------------

const getFolderChildren = async (projectPath, folderPath) => {
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
};

// ---------------------------------------------------------------------------
// listProjectFiles — flat list of text files (Ctrl+P index)
// ---------------------------------------------------------------------------

const listProjectFiles = async (projectPath, options = {}) => {
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
    const maxFiles = clampNumber(safeOptions.maxFiles, 200, 500000, 30000);
    const maxDepth = clampNumber(safeOptions.maxDepth, 2, 60, 40);

    const shouldSkipDirectory = makeShouldSkipDirectory({ includeGit, includeNodeModules, includeBuild });
    const files = [];
    let skippedCount = 0;
    let hitLimit = false;

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
        if (item.isSymbolicLink && item.isSymbolicLink()) { skippedCount += 1; continue; }
        const itemName = item.name;
        if (!itemName) continue;
        if (!includeHidden && itemName.startsWith('.')) { skippedCount += 1; continue; }
        if (!includeSecrets && isSensitiveFileName(itemName)) { skippedCount += 1; continue; }
        if (itemName.endsWith('.log') || itemName.endsWith('.tmp')) { skippedCount += 1; continue; }

        const fullPath = path.join(dirPath, itemName);
        const relativeFilePath = path.join(relativePath, itemName);

        if (item.isDirectory()) {
          if (shouldSkipDirectory(itemName)) { skippedCount += 1; continue; }
          await walk(fullPath, relativeFilePath, depth + 1);
          continue;
        }
        if (!item.isFile()) { skippedCount += 1; continue; }
        if (!shouldReadAsText(itemName)) continue;

        files.push(relativeFilePath);
        if (files.length >= maxFiles) { hitLimit = true; return; }
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
        options: { includeHidden, includeSecrets, includeGit, includeNodeModules, includeBuild, maxFiles, maxDepth }
      }
    };
  } catch (error) {
    console.error('Erreur list-project-files:', error);
    return { success: false, error: error.message };
  }
};

// ---------------------------------------------------------------------------
// searchInProject — full-text search across all project text files
// ---------------------------------------------------------------------------

const searchInProject = async (projectPath, query, options = {}) => {
  try {
    if (!projectPath) return { success: false, error: 'Chemin du projet non fourni' };
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
    const maxMatches = clampNumber(safeOptions.maxMatches, 50, 50000, 800);
    const maxFileSize = clampNumber(safeOptions.maxFileSize, 5000, 5000000, 800000);
    const maxDepth = clampNumber(safeOptions.maxDepth, 2, 60, 40);

    const shouldSkipDirectory = makeShouldSkipDirectory({ includeGit, includeNodeModules, includeBuild });
    const results = [];
    let scannedFiles = 0;
    let matches = 0;
    let hitLimit = false;
    const needle = caseSensitive ? q : q.toLowerCase();

    const addResult = (relativeFilePath, lineNumber, column, lineText) => {
      results.push({ file: relativeFilePath, line: lineNumber, column, text: String(lineText || '').slice(0, 400) });
      matches += 1;
      if (matches >= maxMatches) hitLimit = true;
    };

    async function searchFile(fullPath, relativeFilePath) {
      if (hitLimit) return;
      let stats;
      try { stats = await fs.stat(fullPath); } catch { return; }
      if (stats.size > maxFileSize) return;

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
          if (idx !== -1) addResult(relativeFilePath, lineNumber, idx + 1, line);
        }
      } catch {
        // ignore read errors for individual files
      } finally {
        try { rl.close(); } catch { /* ignore */ }
        try { stream.destroy(); } catch { /* ignore */ }
      }
    }

    async function walk(dirPath, relativePath = '', depth = 0) {
      if (hitLimit) return;
      if (depth > maxDepth) return;
      let items;
      try { items = await fs.readdir(dirPath, { withFileTypes: true }); } catch { return; }

      for (const item of items) {
        if (hitLimit) return;
        if (item.isSymbolicLink && item.isSymbolicLink()) continue;
        const itemName = item.name;
        if (!itemName) continue;
        if (!includeHidden && itemName.startsWith('.')) continue;
        if (!includeSecrets && isSensitiveFileName(itemName)) continue;
        if (itemName.endsWith('.log') || itemName.endsWith('.tmp')) continue;

        const fullPath = path.join(dirPath, itemName);
        const relativeFilePath = path.join(relativePath, itemName);

        if (item.isDirectory()) {
          if (shouldSkipDirectory(itemName)) continue;
          await walk(fullPath, relativeFilePath, depth + 1);
          continue;
        }
        if (!item.isFile()) continue;
        if (!shouldReadAsText(itemName)) continue;
        await searchFile(fullPath, relativeFilePath);
      }
    }

    await walk(trustedProjectPath);
    return {
      success: true,
      results,
      stats: {
        matches, scannedFiles, hitLimit,
        options: { includeHidden, includeSecrets, includeGit, includeNodeModules, includeBuild, caseSensitive, maxMatches, maxFileSize, maxDepth }
      }
    };
  } catch (error) {
    console.error('Erreur search-in-project:', error);
    return { success: false, error: error.message };
  }
};

// ---------------------------------------------------------------------------
// searchSymbols — regex-based symbol search (functions/classes/exports)
// ---------------------------------------------------------------------------

const SYMBOL_TEXT_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.py', '.java', '.go', '.rs', '.php', '.rb',
  '.json', '.md', '.yml', '.yaml'
]);

const SYMBOL_SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'out', '.next', 'coverage']);

const SYMBOL_MATCHERS = [
  { kind: 'function', regex: /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/ },
  { kind: 'class', regex: /^\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/ },
  { kind: 'const', regex: /^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*/ },
  { kind: 'let', regex: /^\s*(?:export\s+)?let\s+([A-Za-z_$][\w$]*)\s*=\s*/ },
  { kind: 'type', regex: /^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/ },
  { kind: 'interface', regex: /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/ },
  { kind: 'enum', regex: /^\s*(?:export\s+)?enum\s+([A-Za-z_$][\w$]*)/ },
  { kind: 'default', regex: /^\s*export\s+default\s+(?:function|class)?\s*([A-Za-z_$][\w$]*)?/ }
];

const searchSymbols = async (projectPath, query, options = {}) => {
  try {
    if (!projectPath) return { success: false, error: 'Chemin du projet non fourni' };
    const trustedProjectPath = await ensureTrustedProjectPath(projectPath);

    const q = String(query || '').trim().toLowerCase();
    if (!q) return { success: true, results: [] };

    const safeOptions = options && typeof options === 'object' ? options : {};
    const maxResults = Math.min(5000, Math.max(20, Number(safeOptions.maxResults) || 300));
    const maxDepth = Math.min(50, Math.max(2, Number(safeOptions.maxDepth) || 25));

    const results = [];
    let hitLimit = false;

    const walk = async (dirPath, relativePath = '', depth = 0) => {
      if (hitLimit) return;
      if (depth > maxDepth) return;
      let entries;
      try { entries = await fs.readdir(dirPath, { withFileTypes: true }); } catch { return; }

      for (const entry of entries) {
        if (hitLimit) return;
        const fullPath = path.join(dirPath, entry.name);
        const relPath = relativePath ? path.join(relativePath, entry.name) : entry.name;

        if (entry.isDirectory()) {
          if (SYMBOL_SKIP_DIRS.has(entry.name.toLowerCase())) continue;
          await walk(fullPath, relPath, depth + 1);
          continue;
        }
        if (!entry.isFile()) continue;
        const ext = path.extname(entry.name).toLowerCase();
        if (!SYMBOL_TEXT_EXTENSIONS.has(ext)) continue;

        let content = '';
        try {
          const stat = await fs.stat(fullPath);
          if (stat.size > 1_200_000) continue;
          content = await fs.readFile(fullPath, 'utf-8');
        } catch { continue; }

        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i += 1) {
          const line = lines[i];
          for (const matcher of SYMBOL_MATCHERS) {
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
            if (results.length >= maxResults) { hitLimit = true; return; }
          }
        }
      }
    };

    await walk(trustedProjectPath);
    return { success: true, results, stats: { count: results.length, hitLimit, maxResults, maxDepth } };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

// ---------------------------------------------------------------------------
// readFile
// ---------------------------------------------------------------------------

const readFile = async (projectPath, filename) => {
  try {
    const trustedProjectPath = await ensureTrustedProjectPath(projectPath);
    const filePath = path.join(trustedProjectPath, filename);
    assertSafePath(trustedProjectPath, filePath);
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
};

// ---------------------------------------------------------------------------
// writeFile
// ---------------------------------------------------------------------------

const writeFile = async (projectPath, filename, content, writeOptions = {}) => {
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
          return { success: false, code: 'FILE_MISSING', error: `Conflit detecte: "${filename}" n'existe plus.` };
        }
        throw error;
      }
    }

    const dirPath = path.dirname(filePath);
    try { await fs.mkdir(dirPath, { recursive: true }); } catch { /* already exists */ }

    await fs.writeFile(filePath, content, 'utf-8');
    const statsAfter = await fs.stat(filePath);
    console.log(`Fichier écrit: ${filePath}`);
    return { success: true, mtimeMs: Math.round(Number(statsAfter?.mtimeMs || 0)), size: Number(statsAfter?.size || 0) };
  } catch (error) {
    console.error(`Erreur d'écriture du fichier ${filename} dans ${projectPath}:`, error);
    return { success: false, error: error.message };
  }
};

// ---------------------------------------------------------------------------
// deleteFile
// ---------------------------------------------------------------------------

const deleteFile = async (projectPath, filename, deleteOptions = {}) => {
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
};

// ---------------------------------------------------------------------------
// createNewFile
// ---------------------------------------------------------------------------

const createNewFile = async (projectPath, filename, initialContent = '') => {
  try {
    await ensureEditPermission();
    const trustedProjectPath = await ensureTrustedProjectPath(projectPath);
    const filePath = path.join(trustedProjectPath, filename);
    assertSafePath(trustedProjectPath, filePath);

    console.log(`Tentative de création du fichier: ${filePath}`);
    const dirPath = path.dirname(filePath);
    try { await fs.mkdir(dirPath, { recursive: true }); } catch { /* already exists */ }

    try {
      await fs.access(filePath);
      return { success: false, error: `Le fichier "${filename}" existe déjà` };
    } catch {
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
    return { success: false, error: `Erreur de création: ${error.message}` };
  }
};

// ---------------------------------------------------------------------------
// createDirectory
// ---------------------------------------------------------------------------

const createDirectory = async (projectPath, dirname) => {
  try {
    await ensureEditPermission();
    const trustedProjectPath = await ensureTrustedProjectPath(projectPath);
    const dirPath = path.join(trustedProjectPath, dirname);
    assertSafePath(trustedProjectPath, dirPath);

    try {
      await fs.access(dirPath);
      return { success: false, error: 'Le dossier existe déjà' };
    } catch {
      await fs.mkdir(dirPath, { recursive: true });
      return { success: true };
    }
  } catch (error) {
    console.error(`Erreur lors de la création du dossier ${dirname} dans ${projectPath}:`, error);
    return { success: false, error: error.message };
  }
};

// ---------------------------------------------------------------------------
// deleteDirectory
// ---------------------------------------------------------------------------

const deleteDirectory = async (projectPath, dirname) => {
  try {
    await ensureEditPermission();
    const trustedProjectPath = await ensureTrustedProjectPath(projectPath);
    const dirPath = path.join(trustedProjectPath, dirname);
    assertSafePath(trustedProjectPath, dirPath);
    await fs.rm(dirPath, { recursive: true, force: true });
    return { success: true };
  } catch (error) {
    console.error(`Erreur lors de la suppression du dossier ${dirname} dans ${projectPath}:`, error);
    return { success: false, error: error.message };
  }
};

// ---------------------------------------------------------------------------
// editFile — partial replacement (search/replace once)
// ---------------------------------------------------------------------------

const editFile = async (projectPath, filename, searchText, replaceText) => {
  try {
    await ensureEditPermission();
    const trustedProjectPath = await ensureTrustedProjectPath(projectPath);
    const filePath = path.join(trustedProjectPath, filename);
    assertSafePath(trustedProjectPath, filePath);

    const currentContent = await fs.readFile(filePath, 'utf-8');
    const result = applySearchReplaceBlock(currentContent, searchText, replaceText);
    if (!result.ok) {
      return { success: false, error: result.error };
    }
    await fs.writeFile(filePath, result.content, 'utf-8');
    console.log(`Fichier modifié: ${filePath} (matchType: ${result.matchType})`);
    return { success: true, message: `Section modifiée dans "${filename}"`, matchType: result.matchType };
  } catch (error) {
    console.error('Erreur lors de la modification du fichier:', error);
    return { success: false, error: error.message };
  }
};

// ---------------------------------------------------------------------------
// renameFile
// ---------------------------------------------------------------------------

const renameFile = async (projectPath, oldFilename, newFilename) => {
  try {
    await ensureEditPermission();
    const trustedProjectPath = await ensureTrustedProjectPath(projectPath);
    const oldPath = path.join(trustedProjectPath, oldFilename);
    const newPath = path.join(trustedProjectPath, newFilename);
    assertSafePath(trustedProjectPath, oldPath);
    assertSafePath(trustedProjectPath, newPath);

    try { await fs.access(oldPath); } catch {
      return { success: false, error: `Le fichier "${oldFilename}" n'existe pas` };
    }
    try {
      await fs.access(newPath);
      return { success: false, error: `Un fichier nommé "${newFilename}" existe déjà` };
    } catch { /* new name is free */ }

    await fs.rename(oldPath, newPath);
    console.log(`Fichier renommé: ${oldPath} -> ${newPath}`);
    return { success: true, message: `Fichier renommé de "${oldFilename}" vers "${newFilename}"` };
  } catch (error) {
    console.error('Erreur lors du renommage:', error);
    return { success: false, error: error.message };
  }
};

// ---------------------------------------------------------------------------
// copyFile
// ---------------------------------------------------------------------------

const copyFile = async (projectPath, sourceFilename, destFilename) => {
  try {
    await ensureEditPermission();
    const trustedProjectPath = await ensureTrustedProjectPath(projectPath);
    const sourcePath = path.join(trustedProjectPath, sourceFilename);
    const destPath = path.join(trustedProjectPath, destFilename);
    assertSafePath(trustedProjectPath, sourcePath);
    assertSafePath(trustedProjectPath, destPath);

    try { await fs.access(sourcePath); } catch {
      return { success: false, error: `Le fichier source "${sourceFilename}" n'existe pas` };
    }
    try {
      await fs.access(destPath);
      return { success: false, error: `Le fichier de destination "${destFilename}" existe déjà` };
    } catch { /* destination is free */ }

    const destDir = path.dirname(destPath);
    await fs.mkdir(destDir, { recursive: true });
    await fs.copyFile(sourcePath, destPath);
    console.log(`Fichier copié: ${sourcePath} -> ${destPath}`);
    return { success: true, message: `Fichier "${sourceFilename}" copié vers "${destFilename}"` };
  } catch (error) {
    console.error('Erreur lors de la copie:', error);
    return { success: false, error: error.message };
  }
};

// ---------------------------------------------------------------------------
// moveFile
// ---------------------------------------------------------------------------

const moveFile = async (projectPath, sourceFilename, destFilename) => {
  try {
    await ensureEditPermission();
    const trustedProjectPath = await ensureTrustedProjectPath(projectPath);
    const sourcePath = path.join(trustedProjectPath, sourceFilename);
    const destPath = path.join(trustedProjectPath, destFilename);
    assertSafePath(trustedProjectPath, sourcePath);
    assertSafePath(trustedProjectPath, destPath);

    try { await fs.access(sourcePath); } catch {
      return { success: false, error: `Le fichier source "${sourceFilename}" n'existe pas` };
    }
    try {
      await fs.access(destPath);
      return { success: false, error: `Le fichier de destination "${destFilename}" existe déjà` };
    } catch { /* destination is free */ }

    const destDir = path.dirname(destPath);
    await fs.mkdir(destDir, { recursive: true });
    await fs.rename(sourcePath, destPath);
    console.log(`Fichier déplacé: ${sourcePath} -> ${destPath}`);
    return { success: true, message: `Fichier "${sourceFilename}" déplacé vers "${destFilename}"` };
  } catch (error) {
    console.error('Erreur lors du déplacement:', error);
    return { success: false, error: error.message };
  }
};

// ---------------------------------------------------------------------------
// getAllProjectFiles — read all project files for AI context
// ---------------------------------------------------------------------------

const getAllProjectFiles = async (projectPath, options = {}) => {
  console.log('[FileService] getAllProjectFiles appelé avec projectPath:', projectPath);
  try {
    if (!projectPath) {
      return { success: false, error: 'Chemin du projet non fourni' };
    }
    const trustedProjectPath = await ensureTrustedProjectPath(projectPath);

    const safeOptions = options && typeof options === 'object' ? options : {};
    const metadataOnly = !!safeOptions.metadataOnly;
    const includeHidden = !!safeOptions.includeHidden;
    const includeSecrets = !!safeOptions.includeSecrets;
    const includeGit = !!safeOptions.includeGit;
    const includeNodeModules = !!safeOptions.includeNodeModules;
    const includeBuild = !!safeOptions.includeBuild;
    const includeVisualWorkflows = safeOptions.includeVisualWorkflows !== false;
    const largeFileStrategy = safeOptions.largeFileStrategy === 'truncate' ? 'truncate' : 'skip';
    const maxFileSize = clampNumber(safeOptions.maxFileSize, 5000, 2000000, 50000);
    const maxFiles = clampNumber(safeOptions.maxFiles, 200, 50000, 8000);
    const maxTotalBytes = clampNumber(safeOptions.maxTotalBytes, 200000, 200000000, 25000000);
    const maxDepth = clampNumber(safeOptions.maxDepth, 2, 60, 30);

    const shouldSkipDirectory = makeShouldSkipDirectory({ includeGit, includeNodeModules, includeBuild });
    const projectFiles = {};
    let totalBytes = 0;
    let hitLimit = false;
    let truncatedCount = 0;
    let skippedCount = 0;

    const recordFile = (relativeFilePath, payload, approxBytes = 0) => {
      const currentCount = Object.keys(projectFiles).length;
      if (currentCount >= maxFiles || totalBytes >= maxTotalBytes) { hitLimit = true; return false; }
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
        try { await handle.close(); } catch { /* ignore */ }
      }
    }

    async function readDirectory(dirPath, relativePath = '', depth = 0) {
      if (depth > maxDepth || hitLimit) return;
      let items;
      try { items = await fs.readdir(dirPath, { withFileTypes: true }); } catch { skippedCount += 1; return; }

      for (const item of items) {
        if (hitLimit) return;
        if (item.isSymbolicLink && item.isSymbolicLink()) { skippedCount += 1; continue; }
        const itemName = item.name;
        if (!itemName) continue;

        const isVisualWorkflowDir = itemName === '.vibe-workflows';
        if (!includeHidden && itemName.startsWith('.') && !(includeVisualWorkflows && isVisualWorkflowDir)) {
          skippedCount += 1; continue;
        }
        if (!includeSecrets && isSensitiveFileName(itemName)) { skippedCount += 1; continue; }
        if (itemName.endsWith('.log') || itemName.endsWith('.tmp')) { skippedCount += 1; continue; }

        const fullPath = path.join(dirPath, itemName);
        const relativeFilePath = path.join(relativePath, itemName);

        if (item.isDirectory()) {
          if (shouldSkipDirectory(itemName)) { skippedCount += 1; continue; }
          await readDirectory(fullPath, relativeFilePath, depth + 1);
          continue;
        }
        if (!item.isFile()) { skippedCount += 1; continue; }

        try {
          const stats = await fs.stat(fullPath);
          if (metadataOnly) { recordFile(relativeFilePath, { type: 'file', content: '', size: stats.size }, 0); continue; }

          const treatAsText = shouldReadAsText(itemName);
          if (!treatAsText) {
            recordFile(relativeFilePath, { type: 'file', content: '[FICHIER BINAIRE - Non lu]', size: stats.size }, 0);
            continue;
          }
          if (stats.size > maxFileSize) {
            if (largeFileStrategy === 'truncate') {
              const content = await readFileTruncated(fullPath, maxFileSize);
              truncatedCount += 1;
              recordFile(relativeFilePath, { type: 'file', content, size: stats.size, truncated: true }, Math.min(maxFileSize, stats.size));
            } else {
              recordFile(relativeFilePath, { type: 'file', content: '[FICHIER TROP VOLUMINEUX - Non lu]', size: stats.size }, 0);
            }
            continue;
          }
          const content = await fs.readFile(fullPath, 'utf-8');
          recordFile(relativeFilePath, { type: 'file', content, size: stats.size }, stats.size);
        } catch (readError) {
          recordFile(relativeFilePath, { type: 'file', content: '[ERREUR DE LECTURE]', error: readError.message }, 0);
        }
      }
    }

    await readDirectory(trustedProjectPath);
    const fileCount = Object.keys(projectFiles).length;
    console.log(`[FileService] Succès: ${fileCount} fichiers lus (octets=${totalBytes}, limite=${hitLimit})`);
    return {
      success: true,
      files: projectFiles,
      projectPath: trustedProjectPath,
      stats: {
        fileCount, totalBytes, hitLimit, truncatedCount, skippedCount,
        options: { includeHidden, includeSecrets, includeGit, includeNodeModules, includeBuild, includeVisualWorkflows, maxFileSize, maxFiles, maxTotalBytes, maxDepth, largeFileStrategy }
      }
    };
  } catch (error) {
    console.error('Erreur lors de la lecture du projet:', error);
    return { success: false, error: error.message };
  }
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  getAllFiles,
  getFolderChildren,
  listProjectFiles,
  searchInProject,
  searchSymbols,
  readFile,
  writeFile,
  deleteFile,
  createNewFile,
  createDirectory,
  deleteDirectory,
  editFile,
  renameFile,
  copyFile,
  moveFile,
  getAllProjectFiles,
};
