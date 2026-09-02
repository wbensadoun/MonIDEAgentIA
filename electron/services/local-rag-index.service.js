'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { assertSafePath, safeResolvePath, ensureTrustedProjectPath } = require('../core/security');

const LOCAL_RAG_INDEX_VERSION = 1;
const MAX_FILES = 5000;
const MAX_FILE_BYTES = 350000;
const MAX_INDEX_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_CHUNKS = 20000;
const MAX_TRAVERSAL_ENTRIES = 10000;
const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 200;
const LEXICAL_FINGERPRINT_DIMENSIONS = 32;
const MAX_RETAINED_JOBS = 100;
const INDEX_RELATIVE_PATH = path.join('.vibe-workspace', 'rag_index.json');

const ALLOWED_EXTENSIONS = new Set([
  '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx',
  '.html', '.css', '.scss', '.sass', '.less',
  '.json', '.md', '.mdx', '.txt', '.xml', '.yml', '.yaml', '.toml', '.ini',
  '.py', '.java', '.go', '.rs', '.rb', '.php', '.c', '.h', '.cpp', '.hpp',
  '.sql', '.sh', '.bat', '.ps1', '.vue', '.svelte', '.astro'
]);

const ALLOWED_NAMES = new Set(['readme', 'readme.md', 'dockerfile', 'makefile']);
const IGNORED_DIRECTORIES = new Set([
  '.git', '.hg', '.svn', 'node_modules', 'dist', 'build', 'out', 'coverage',
  '.next', '.nuxt', '.vite', '.cache', '.turbo', '.parcel-cache', 'target',
  'vendor', '.vibe-workspace'
]);
const SECRET_SUFFIXES = new Set(['.pem', '.key', '.p12', '.pfx', '.jks', '.keystore']);
const SECRET_PARTS = new Set(['credentials', 'credential', 'secrets', 'secret', 'passwords', 'password']);
const SECRET_CONTENT_PATTERNS = [
  /-----BEGIN[^\r\n]+PRIVATE KEY-----/i,
  /["']?\b(?:OPENAI|ANTHROPIC|GEMINI|TOGETHER|AWS|AZURE|GOOGLE_APPLICATION)_?(?:API[_-]?)?KEY\b["']?\s*[:=]\s*["']?[A-Za-z0-9_./+=:-]{12,}/i,
  /["']?\b(?:api[_-]?keys?|access[_-]?tokens?|auth[_-]?tokens?|service[_-]?accounts?|client[_-]?secrets?|private[_-]?keys?|passwords?)\b["']?\s*[:=]\s*["']?[^\s"'{}\r\n,]{16,}/i,
  /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_-]{16,}|xox[baprs]-[A-Za-z0-9-]{16,}|AKIA[A-Z0-9]{16})\b/,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}\b/i
];

const toRelativePath = (projectPath, candidate) => path.relative(projectPath, candidate).replace(/\\/g, '/');

const isSensitiveName = (name) => {
  const lower = String(name || '').toLowerCase();
  if (lower === '.env' || lower.startsWith('.env.')) return true;
  if ([...SECRET_SUFFIXES].some((suffix) => lower.endsWith(suffix))) return true;
  if (lower.includes('id_rsa') || lower.includes('id_ed25519')) return true;
  if (/(^|[._-])(service[-_]?account|private[-_]?keys?|openai[-_]?keys?|access[-_]?tokens?|auth[-_]?tokens?|api[-_]?tokens?|api[-_]?keys?)([._-]|$)/i.test(lower)) return true;
  if (/(^|[._-])(token|tokens|secret|secrets|credential|credentials|password|passwords)([._-]|$)/i.test(lower)) return true;
  return SECRET_PARTS.has(lower.replace(path.extname(lower), ''));
};

const containsSecretMaterial = (content) => SECRET_CONTENT_PATTERNS.some((pattern) => pattern.test(String(content || '')));

const isAllowedFile = (name) => {
  const lower = String(name || '').toLowerCase();
  if (isSensitiveName(lower)) return false;
  return ALLOWED_NAMES.has(lower) || ALLOWED_EXTENSIONS.has(path.extname(lower));
};

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

const tokenize = (text) => [...new Set(String(text || '').toLowerCase()
  .split(/[^\p{L}\p{N}_$.-]+/u)
  .map((token) => token.trim())
  .filter((token) => token.length >= 2))].slice(0, 256);

// This is a lexical fingerprint only, not a semantic embedding. It must not
// be advertised or routed as vector-search evidence.
const buildLexicalFingerprint = (tokens) => {
  const vector = Array(LEXICAL_FINGERPRINT_DIMENSIONS).fill(0);
  for (const token of tokens) {
    const digest = crypto.createHash('sha256').update(token).digest();
    for (let index = 0; index < 4; index += 1) {
      const slot = digest[index] % LEXICAL_FINGERPRINT_DIMENSIONS;
      vector[slot] += digest[index + 4] / 255;
    }
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => Number((value / norm).toFixed(6)));
};

const parseGitignore = (content) => String(content || '').split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'))
  .map((line) => ({ negated: line.startsWith('!'), pattern: line.replace(/^!/, '').replace(/^\//, '') }))
  .filter(({ pattern }) => pattern && !pattern.includes('..'));

const escapeGlobPattern = (pattern) => String(pattern || '').replace(/\\/g, '/')
  .replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');

const globToRegExp = (pattern, directory) => {
  const escaped = escapeGlobPattern(pattern);
  return new RegExp(directory ? `(^|/)${escaped.replace(/\/$/, '')}(/|$)` : `(^|/)${escaped}$`, 'i');
};

const isGitignored = (relativePath, isDirectory, rules) => {
  const normalized = String(relativePath || '').replace(/\\/g, '/').replace(/^\.\//, '');
  let ignored = false;
  for (const rule of rules) {
    const pattern = rule.pattern;
    const matches = globToRegExp(pattern, isDirectory).test(normalized)
      || (!pattern.includes('/') && new RegExp(`(^|/)${escapeGlobPattern(pattern)}(?:$|/)`, 'i').test(normalized));
    if (matches) ignored = !rule.negated;
  }
  return ignored;
};

const detectLanguage = (relativePath) => {
  const ext = path.extname(relativePath).toLowerCase();
  return ext ? ext.slice(1) : 'text';
};

const parseStructure = (content, relativePath) => {
  const source = String(content || '');
  const imports = [...source.matchAll(/(?:import\s+(?:[^'"\n]+?\s+from\s+)?|require\s*\(|from\s+)['"]([^'"]+)['"]/g)]
    .map((match) => match[1]).filter(Boolean).slice(0, 100);
  const symbols = [...source.matchAll(/\b(?:function|class|interface|type|const|let|var|def|func)\s+([A-Za-z_$][\w$]*)/g)]
    .map((match) => match[1]).filter(Boolean).slice(0, 200);
  return { language: detectLanguage(relativePath), imports: [...new Set(imports)], symbols: [...new Set(symbols)] };
};

const chunkText = (content) => {
  const source = String(content || '');
  if (!source) return [];
  const chunks = [];
  const step = Math.max(1, CHUNK_SIZE - CHUNK_OVERLAP);
  for (let start = 0; start < source.length && chunks.length < MAX_TOTAL_CHUNKS; start += step) {
    chunks.push(source.slice(start, start + CHUNK_SIZE));
  }
  return chunks;
};

const buildChunks = (content, relativePath, structure) => chunkText(content).map((text, index) => {
  const tokens = tokenize(text);
  return {
    id: `${sha256(relativePath)}:${index}`,
    text,
    hash: sha256(text),
    start: index * Math.max(1, CHUNK_SIZE - CHUNK_OVERLAP),
    tokens,
    lexicalFingerprint: buildLexicalFingerprint(tokens),
    symbols: structure.symbols.slice(0, 32)
  };
});

const getIndexPath = (projectPath) => safeResolvePath(projectPath, INDEX_RELATIVE_PATH).resolved;

const quarantineIndex = async (indexPath) => {
  const quarantinePath = `${indexPath}.corrupt-${Date.now()}-${crypto.randomUUID()}.json`;
  await fsp.rename(indexPath, quarantinePath);
};

const readExistingIndex = async (indexPath) => {
  try {
    const stat = await fsp.lstat(indexPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_INDEX_BYTES) {
      if (stat.isFile() && !stat.isSymbolicLink()) await quarantineIndex(indexPath);
      const error = new Error('Index retrieval corrompu');
      error.code = 'RAG_INDEX_CORRUPT';
      throw error;
    }
    const parsed = JSON.parse(await fsp.readFile(indexPath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Index retrieval corrompu');
    for (const [key, value] of Object.entries(parsed)) {
      if (key.startsWith('_')) continue;
      if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.chunks)) {
        throw new Error('Index retrieval corrompu');
      }
    }
    return parsed;
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return {};
    if (error?.code === 'RAG_INDEX_CORRUPT') throw error;
    try { await quarantineIndex(indexPath); } catch { /* retain corruption failure */ }
    const corrupt = new Error('Index retrieval corrompu');
    corrupt.code = 'RAG_INDEX_CORRUPT';
    throw corrupt;
  }
};

const validateProjectRoot = async (projectPath) => {
  const trusted = await ensureTrustedProjectPath(projectPath);
  const stat = await fsp.lstat(trusted);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Projet retrieval indisponible');
  const real = await fsp.realpath(trusted);
  if (path.resolve(real) !== path.resolve(await fsp.realpath(path.resolve(trusted)))) {
    throw new Error('Projet retrieval indisponible');
  }
  return trusted;
};

const throwIfCancelled = (signal) => {
  if (signal?.aborted) {
    const error = new Error('Indexation retrieval annulee.');
    error.code = 'RAG_INDEX_CANCELLED';
    throw error;
  }
};

const scanProject = async (projectPath, previous = {}, {
  signal,
  isProjectActive = async () => true,
  maxTraversalEntries = MAX_TRAVERSAL_ENTRIES
} = {}) => {
  const gitignorePath = path.join(projectPath, '.gitignore');
  let gitignore = [];
  try { gitignore = parseGitignore(await fsp.readFile(gitignorePath, 'utf8')); } catch { /* optional */ }
  const files = new Map();
  let scanned = 0;
  let skipped = 0;
  let hitLimit = false;
  let totalChunks = 0;
  let traversalEntries = 0;
  const traversalBudget = Math.min(
    MAX_TRAVERSAL_ENTRIES,
    Number.isInteger(maxTraversalEntries) && maxTraversalEntries > 0 ? maxTraversalEntries : MAX_TRAVERSAL_ENTRIES
  );

  const visit = async (directory, depth = 0) => {
    throwIfCancelled(signal);
    if (!(await isProjectActive())) {
      const error = new Error('Projet retrieval revoque.');
      error.code = 'RAG_PROJECT_REVOKED';
      throw error;
    }
    if (files.size >= MAX_FILES) { hitLimit = true; return; }
    if (depth > 60) return;
    let entries;
    try { entries = await fsp.readdir(directory, { withFileTypes: true }); } catch { skipped += 1; return; }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      throwIfCancelled(signal);
      if (!(await isProjectActive())) {
        const error = new Error('Projet retrieval revoque.');
        error.code = 'RAG_PROJECT_REVOKED';
        throw error;
      }
      if (files.size >= MAX_FILES || traversalEntries >= traversalBudget) {
        hitLimit = true;
        return;
      }
      traversalEntries += 1;
      if (entry.isSymbolicLink?.()) { skipped += 1; continue; }
      const absolute = path.join(directory, entry.name);
      const relative = toRelativePath(projectPath, absolute);
      if (!relative || relative.startsWith('../') || isSensitiveName(entry.name)) { skipped += 1; continue; }
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name.toLowerCase()) || isGitignored(relative, true, gitignore)) { skipped += 1; continue; }
        await visit(absolute, depth + 1);
        continue;
      }
      if (!entry.isFile() || !isAllowedFile(entry.name) || isGitignored(relative, false, gitignore)) { skipped += 1; continue; }
      scanned += 1;
      try {
        const stat = await fsp.lstat(absolute);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE_BYTES) { skipped += 1; continue; }
        const content = await fsp.readFile(absolute, 'utf8');
        if (content.includes('\0') || containsSecretMaterial(content)) { skipped += 1; continue; }
        const hash = sha256(content);
        const old = previous[relative];
        if (old && old.hash === hash && Array.isArray(old.chunks)) {
          const chunks = old.chunks.slice(0, Math.max(0, MAX_TOTAL_CHUNKS - totalChunks));
          totalChunks += chunks.length;
          files.set(relative, { ...old, chunks });
          continue;
        }
        const structure = parseStructure(content, relative);
        const chunks = buildChunks(content, relative, structure)
          .slice(0, Math.max(0, MAX_TOTAL_CHUNKS - totalChunks));
        totalChunks += chunks.length;
        files.set(relative, {
          hash,
          size: stat.size,
          language: structure.language,
          imports: structure.imports,
          symbols: structure.symbols,
          chunks,
          indexedAt: new Date().toISOString()
        });
      } catch { skipped += 1; }
    }
  };

  await visit(projectPath);
  const tombstones = {};
  for (const [relative, old] of Object.entries(previous)) {
    if (relative.startsWith('_') || files.has(relative) || !old || old.tombstone) continue;
    tombstones[relative] = {
      tombstone: true,
      hash: typeof old.hash === 'string' ? old.hash : null,
      deletedAt: new Date().toISOString(),
      chunks: []
    };
  }
  return {
    files,
    tombstones,
    stats: { scanned, indexed: files.size, chunks: totalChunks, skipped, traversalEntries, hitLimit }
  };
};

const writeIndexAtomically = async (projectPath, index, { signal, isProjectActive = async () => true } = {}) => {
  throwIfCancelled(signal);
  if (!(await isProjectActive())) {
    const error = new Error('Projet retrieval revoque.');
    error.code = 'RAG_PROJECT_REVOKED';
    throw error;
  }
  const indexPath = getIndexPath(projectPath);
  const workspaceDir = path.dirname(indexPath);
  await fsp.mkdir(workspaceDir, { recursive: true });
  const dirStat = await fsp.lstat(workspaceDir);
  if (!dirStat.isDirectory() || dirStat.isSymbolicLink()) throw new Error('Index retrieval indisponible');
  assertSafePath(projectPath, indexPath);
  const serialized = JSON.stringify(index);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_INDEX_BYTES) throw new Error('Index retrieval trop volumineux');
  const temporaryPath = `${indexPath}.${crypto.randomUUID()}.tmp`;
  await fsp.writeFile(temporaryPath, serialized, { encoding: 'utf8', flag: 'wx' });
  try {
    throwIfCancelled(signal);
    if (!(await isProjectActive())) {
      const error = new Error('Projet retrieval revoque.');
      error.code = 'RAG_PROJECT_REVOKED';
      throw error;
    }
    await fsp.rename(temporaryPath, indexPath);
  } catch (error) {
    await fsp.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
  return indexPath;
};

const buildLocalRagIndex = async (projectPath, {
  signal,
  isProjectActive = async () => true,
  maxTraversalEntries = MAX_TRAVERSAL_ENTRIES
} = {}) => {
  throwIfCancelled(signal);
  if (!(await isProjectActive())) {
    const error = new Error('Projet retrieval revoque.');
    error.code = 'RAG_PROJECT_REVOKED';
    throw error;
  }
  const trustedProjectPath = await validateProjectRoot(projectPath);
  const indexPath = getIndexPath(trustedProjectPath);
  const previous = await readExistingIndex(indexPath);
  const scan = await scanProject(trustedProjectPath, previous, { signal, isProjectActive, maxTraversalEntries });
  throwIfCancelled(signal);
  if (!(await isProjectActive())) {
    const error = new Error('Projet retrieval revoque.');
    error.code = 'RAG_PROJECT_REVOKED';
    throw error;
  }
  const output = {
    _meta: {
      version: LOCAL_RAG_INDEX_VERSION,
      generatedAt: new Date().toISOString(),
      vector: null,
      vectorMode: 'lexical-placeholder-v1',
      vectorDimensions: 0,
      stats: scan.stats
    },
    ...Object.fromEntries(scan.files),
    ...scan.tombstones
  };
  await writeIndexAtomically(trustedProjectPath, output, { signal, isProjectActive });
  return { indexPath, stats: scan.stats, files: scan.files.size, tombstones: Object.keys(scan.tombstones).length };
};

const createLocalRagJobManager = ({ build = buildLocalRagIndex, isProjectActive: projectIsActive = async () => true } = {}) => {
  const jobs = new Map();
  const activeByCanonicalPath = new Map();
  const canonicalize = (projectPath) => {
    const resolved = path.resolve(String(projectPath || ''));
    try { return fs.realpathSync.native(resolved).toLowerCase(); } catch { return resolved.toLowerCase(); }
  };
  const publicJob = (job) => {
    const { projectIds, controller, canonicalPath, ...safe } = job;
    return { ...safe, projectIds: [...projectIds] };
  };
  const pruneFinished = () => {
    const finished = [...jobs.values()]
      .filter((job) => job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled')
      .sort((left, right) => String(left.finishedAt || '').localeCompare(String(right.finishedAt || '')));
    while (jobs.size > MAX_RETAINED_JOBS && finished.length > 0) jobs.delete(finished.shift().jobId);
  };
  const enqueue = (projectId, projectPath) => {
    const canonicalPath = canonicalize(projectPath);
    const active = activeByCanonicalPath.get(canonicalPath);
    if (active) {
      active.projectIds.add(projectId);
      return { ...publicJob(active), deduplicated: true };
    }
    const jobId = `rag_${crypto.randomUUID()}`;
    const controller = new AbortController();
    const job = {
      jobId,
      projectId,
      projectIds: new Set([projectId]),
      canonicalPath,
      controller,
      status: 'queued',
      createdAt: new Date().toISOString()
    };
    jobs.set(jobId, job);
    activeByCanonicalPath.set(canonicalPath, job);
    setImmediate(async () => {
      job.status = 'running';
      try {
        const isProjectActive = async () => {
          for (const id of job.projectIds) {
            if (await projectIsActive(id, projectPath)) return true;
          }
          return false;
        };
        throwIfCancelled(controller.signal);
        if (!(await isProjectActive())) {
          const error = new Error('Projet retrieval revoque.');
          error.code = 'RAG_PROJECT_REVOKED';
          throw error;
        }
        job.result = await build(projectPath, { signal: controller.signal, isProjectActive });
        job.status = 'completed';
      } catch (error) {
        job.status = error?.code === 'RAG_INDEX_CANCELLED' || error?.code === 'RAG_PROJECT_REVOKED'
          ? 'cancelled'
          : 'failed';
        job.error = job.status === 'cancelled' ? 'Indexation retrieval annulee.' : 'Indexation retrieval echouee.';
      } finally {
        job.finishedAt = new Date().toISOString();
        if (activeByCanonicalPath.get(canonicalPath) === job) activeByCanonicalPath.delete(canonicalPath);
        pruneFinished();
      }
    });
    return publicJob(job);
  };
  const cancel = (projectId) => {
    let cancelled = false;
    for (const job of jobs.values()) {
      if (job.projectIds.has(projectId) && !job.controller.signal.aborted) {
        job.controller.abort();
        cancelled = true;
      }
    }
    return cancelled;
  };
  const cancelPath = (projectPath) => {
    const job = activeByCanonicalPath.get(canonicalize(projectPath));
    if (!job || job.controller.signal.aborted) return false;
    job.controller.abort();
    return true;
  };
  return Object.freeze({
    enqueue,
    cancel,
    cancelPath,
    get: (jobId) => {
      const job = jobs.get(jobId);
      return job ? { ...publicJob(job), result: job.status === 'completed' ? job.result : undefined } : null;
    }
  });
};

module.exports = {
  LOCAL_RAG_INDEX_VERSION,
  MAX_FILES,
  MAX_FILE_BYTES,
  MAX_INDEX_BYTES,
  MAX_TOTAL_CHUNKS,
  MAX_TRAVERSAL_ENTRIES,
  LEXICAL_FINGERPRINT_DIMENSIONS,
  isSensitiveName,
  isAllowedFile,
  parseGitignore,
  isGitignored,
  parseStructure,
  buildChunks,
  scanProject,
  buildLocalRagIndex,
  createLocalRagJobManager,
  getIndexPath
};
