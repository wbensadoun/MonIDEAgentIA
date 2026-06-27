'use strict';

const { app } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const axios = require('axios');
const { ensureTrustedProjectPath } = require('../core/security');
const {
  getGlobalAgentsDir,
  getGlobalSkillsDir,
  getWorkspaceSkillsDir,
  parseSimpleFrontMatter,
  safeFileBase,
} = require('./agent.service');
const { runGit } = require('./git.service');

const voltCatalogCache = new Map();

const parseGitHubTreeUrl = (inputUrl) => {
  const rawUrl = String(inputUrl || '').trim();
  if (!rawUrl) return null;

  const url = rawUrl.replace(/[?#].*$/, '').replace(/\/+$/, '');

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
      repoPath = repoPath.replace(/\/[^/]+$/, '');
    }

    const repoUrl = `https://github.com/${owner}/${repo}.git`;
    return { repoUrl, ref, repoPath, owner, repo, kind: 'blob' };
  }

  match = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)$/i);
  if (match) {
    const owner = match[1];
    const repo = match[2].replace(/\.git$/i, '');
    const repoUrl = `https://github.com/${owner}/${repo}.git`;
    return { repoUrl, ref: null, repoPath: '', owner, repo, kind: 'repo' };
  }

  return null;
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

      // eslint-disable-next-line no-await-in-loop
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

const installSkillFromUrl = async (url, scope, projectPath, options = {}) => {
  const parsed = parseGitHubTreeUrl(url);
  if (!parsed) {
    return { success: false, error: 'URL GitHub non supportee' };
  }

  const safeOptions = options && typeof options === 'object' ? options : {};
  const overwrite = !!safeOptions.overwrite;

  let destBaseDir;
  if (scope === 'global') {
    destBaseDir = getGlobalSkillsDir();
  } else if (scope === 'workspace' && projectPath) {
    const trustedProjectPath = await ensureTrustedProjectPath(projectPath);
    destBaseDir = getWorkspaceSkillsDir(trustedProjectPath);
  } else {
    return { success: false, error: 'Invalid scope or missing project path' };
  }

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

const installAllSkills = async (catalogEntries) => {
  if (!Array.isArray(catalogEntries)) {
    return { success: false, error: 'Invalid catalog entries format' };
  }

  const results = {
    successful: [],
    failed: []
  };

  for (const entry of catalogEntries) {
    if (!entry || !entry.url) continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      const res = await installSkillFromUrl(entry.url, 'global', null, { overwrite: true, name: entry.label });
      if (res.success) {
        results.successful.push(entry.label || entry.url);
      } else {
        results.failed.push({ skill: entry.label || entry.url, error: res.error });
      }
    } catch (error) {
      results.failed.push({ skill: entry.label || entry.url, error: error.message });
    }
  }

  return { success: true, results };
};

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

const getVoltagentCatalog = async (catalogId) => {
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
};

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
      // eslint-disable-next-line no-await-in-loop
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

const syncVoltagentSubagents = async (options = {}) => {
  const safeOptions = options && typeof options === 'object' ? options : {};
  const overwrite = !!safeOptions.overwrite;

  const cacheRoot = path.join(app.getPath('userData'), 'voltagent-cache');
  const repoDir = path.join(cacheRoot, 'awesome-claude-code-subagents');
  await fs.mkdir(cacheRoot, { recursive: true });

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
      // eslint-disable-next-line no-await-in-loop
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

      // eslint-disable-next-line no-await-in-loop
      await fs.writeFile(dest, content, 'utf-8');
      imported += 1;
    } catch {
      errors += 1;
    }
  }

  return { success: true, imported, skipped, errors };
};

module.exports = {
  parseGitHubTreeUrl,
  installSkillFromUrl,
  installAllSkills,
  parseAwesomeListCatalog,
  getVoltagentCatalog,
  syncVoltagentSubagents,
};
