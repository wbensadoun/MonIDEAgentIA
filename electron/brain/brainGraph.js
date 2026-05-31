const fs = require('fs/promises');
const path = require('path');

const BRAIN_GRAPH_SCHEMA_VERSION = 1;
const DEFAULT_MAX_FILES = 6000;
const DEFAULT_MAX_FILE_SIZE = 350000;

const IGNORE_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.nuxt',
  '.vite',
  '.cache',
  'out',
  'target',
  'vendor',
  '.turbo',
  '.parcel-cache',
  '.vibe-workspace'
]);

const TEXT_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.json', '.css', '.scss', '.sass', '.less',
  '.html', '.md', '.mdx',
  '.yml', '.yaml',
  '.py', '.go', '.rs', '.java', '.php', '.rb',
  '.vue', '.svelte', '.astro',
  '.sql', '.xml', '.toml', '.ini',
  '.sh', '.ps1', '.bat'
]);

const CONFIG_FILE_NAMES = new Set([
  'package.json',
  'tsconfig.json',
  'vite.config.js',
  'vite.config.ts',
  'webpack.config.js',
  'tailwind.config.js',
  'electron-builder.json',
  'dockerfile',
  'compose.yaml',
  'docker-compose.yml'
]);

const normalizePath = (value) => String(value || '').replace(/\\/g, '/');

const isHiddenSegment = (segment) => String(segment || '').startsWith('.') && segment !== '.vibe-workflows';

const shouldSkipDir = (dirName, options = {}) => {
  const normalized = String(dirName || '').toLowerCase();
  if (!normalized) return true;
  if (IGNORE_DIRS.has(normalized)) return true;
  if (!options.includeHidden && isHiddenSegment(normalized)) return true;
  return false;
};

const isTextFile = (filePath) => {
  const base = path.basename(filePath).toLowerCase();
  const ext = path.extname(filePath).toLowerCase();
  return TEXT_EXTENSIONS.has(ext) || CONFIG_FILE_NAMES.has(base);
};

const safeReadTextFile = async (filePath, maxFileSize = DEFAULT_MAX_FILE_SIZE) => {
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) return null;
  if (stat.size > maxFileSize) {
    return {
      content: '',
      size: stat.size,
      truncated: true
    };
  }
  const content = await fs.readFile(filePath, 'utf8');
  return {
    content,
    size: stat.size,
    truncated: false
  };
};

const scanProjectFiles = async (projectPath, options = {}) => {
  const maxFiles = Number.isFinite(Number(options.maxFiles))
    ? Math.max(200, Math.min(30000, Number(options.maxFiles)))
    : DEFAULT_MAX_FILES;
  const maxFileSize = Number.isFinite(Number(options.maxFileSize))
    ? Math.max(10000, Math.min(2000000, Number(options.maxFileSize)))
    : DEFAULT_MAX_FILE_SIZE;
  const includeHidden = !!options.includeHidden;
  const files = [];
  let skipped = 0;
  let truncated = 0;
  let hitLimit = false;

  const visit = async (dir, depth = 0) => {
    if (files.length >= maxFiles) {
      hitLimit = true;
      return;
    }
    if (depth > 60) return;

    let entries = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      skipped += 1;
      return;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (files.length >= maxFiles) {
        hitLimit = true;
        return;
      }

      const absolutePath = path.join(dir, entry.name);
      const relativePath = normalizePath(path.relative(projectPath, absolutePath));
      if (!relativePath || relativePath.startsWith('..')) continue;

      if (entry.isDirectory()) {
        if (shouldSkipDir(entry.name, { includeHidden })) continue;
        await visit(absolutePath, depth + 1);
        continue;
      }

      if (!entry.isFile() || !isTextFile(relativePath)) {
        skipped += 1;
        continue;
      }

      try {
        const read = await safeReadTextFile(absolutePath, maxFileSize);
        if (!read) continue;
        if (read.truncated) truncated += 1;
        files.push({
          path: relativePath,
          absolutePath,
          size: read.size,
          truncated: read.truncated,
          content: read.content
        });
      } catch {
        skipped += 1;
      }
    }
  };

  await visit(projectPath, 0);
  return { files, stats: { skipped, truncated, hitLimit, scanned: files.length } };
};

const unique = (values) => Array.from(new Set((values || []).filter(Boolean)));

const pushMatches = (regex, content, handler) => {
  const matches = [];
  let match;
  const safeRegex = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : `${regex.flags}g`);
  while ((match = safeRegex.exec(content)) !== null) {
    const value = handler(match);
    if (value) matches.push(value);
    if (match.index === safeRegex.lastIndex) safeRegex.lastIndex += 1;
  }
  return matches;
};

const parseImports = (content, filePath) => {
  const imports = [
    ...pushMatches(/\bimport\s+(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]/g, content, (m) => m[1]),
    ...pushMatches(/\bexport\s+[^'"]+\s+from\s+['"]([^'"]+)['"]/g, content, (m) => m[1]),
    ...pushMatches(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g, content, (m) => m[1]),
    ...pushMatches(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g, content, (m) => m[1])
  ];

  if (path.extname(filePath).toLowerCase() === '.css') {
    imports.push(...pushMatches(/@import\s+(?:url\()?['"]?([^'")]+)['"]?\)?/g, content, (m) => m[1]));
  }

  return unique(imports);
};

const parseSymbols = (content) => {
  const symbols = [];
  const add = (kind, name, line) => {
    if (!name) return;
    symbols.push({ kind, name, line });
  };
  const lineForIndex = (index) => content.slice(0, index).split(/\r?\n/).length;
  const collect = (regex, kind, groupIndex = 1) => {
    let match;
    const safeRegex = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : `${regex.flags}g`);
    while ((match = safeRegex.exec(content)) !== null) {
      add(kind, match[groupIndex], lineForIndex(match.index));
      if (match.index === safeRegex.lastIndex) safeRegex.lastIndex += 1;
    }
  };

  collect(/\bexport\s+default\s+function\s+([A-Za-z_$][\w$]*)/g, 'function');
  collect(/\bexport\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g, 'function');
  collect(/\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g, 'function');
  collect(/\bexport\s+class\s+([A-Za-z_$][\w$]*)/g, 'class');
  collect(/\bclass\s+([A-Za-z_$][\w$]*)/g, 'class');
  collect(/\bexport\s+const\s+([A-Za-z_$][\w$]*)\s*=/g, 'constant');
  collect(/\bconst\s+([A-Z][A-Za-z0-9_$]*)\s*=\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g, 'component');
  collect(/\bconst\s+([A-Za-z_$][\w$]*)\s*=/g, 'constant');
  collect(/\bexport\s+default\s+([A-Za-z_$][\w$]*)/g, 'export');

  const seen = new Set();
  return symbols.filter((symbol) => {
    const key = `${symbol.kind}:${symbol.name}:${symbol.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 80);
};

const parseExports = (content) => unique([
  ...pushMatches(/\bexport\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g, content, (m) => m[1]),
  ...pushMatches(/\bexport\s+class\s+([A-Za-z_$][\w$]*)/g, content, (m) => m[1]),
  ...pushMatches(/\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g, content, (m) => m[1]),
  ...pushMatches(/\bexport\s*\{([^}]+)\}/g, content, (m) => m[1].split(',').map((p) => p.trim().split(/\s+as\s+/i)[0]).join('|'))
]).flatMap((value) => String(value).split('|').map((item) => item.trim()).filter(Boolean));

const inferNodeKind = (filePath) => {
  const normalized = normalizePath(filePath).toLowerCase();
  const base = path.basename(normalized);
  if (normalized.includes('/.vibe-workflows/') || normalized.startsWith('.vibe-workflows/')) return 'workflow';
  if (/\.(test|spec)\.[tj]sx?$/.test(base) || normalized.includes('/__tests__/')) return 'test';
  if (base === 'package.json') return 'manifest';
  if (CONFIG_FILE_NAMES.has(base)) return 'config';
  if (normalized.includes('/components/')) return 'component';
  if (normalized.includes('/hooks/')) return 'hook';
  if (normalized.includes('/utils/') || normalized.includes('/services/')) return 'utility';
  if (normalized.endsWith('.css') || normalized.endsWith('.scss')) return 'style';
  if (normalized.endsWith('.md') || normalized.endsWith('.mdx')) return 'docs';
  return 'source';
};

const stripKnownExtension = (filePath) => normalizePath(filePath).replace(/\.(test|spec)?\.?[cm]?[tj]sx?$/i, '').replace(/\.(css|scss|sass|less)$/i, '');

const buildPathLookup = (files) => {
  const lookup = new Map();
  for (const file of files) {
    const normalized = normalizePath(file.path);
    lookup.set(normalized, normalized);
    lookup.set(stripKnownExtension(normalized), normalized);
    const withoutIndex = normalized.replace(/\/index(\.[^.]+)$/i, '');
    lookup.set(withoutIndex, normalized);
  }
  return lookup;
};

const resolveImportPath = (fromFile, rawImport, lookup) => {
  const spec = String(rawImport || '').trim();
  if (!spec || !spec.startsWith('.')) return null;
  const baseDir = path.posix.dirname(normalizePath(fromFile));
  const targetBase = normalizePath(path.posix.normalize(path.posix.join(baseDir, spec)));
  const candidates = [
    targetBase,
    `${targetBase}.js`,
    `${targetBase}.jsx`,
    `${targetBase}.ts`,
    `${targetBase}.tsx`,
    `${targetBase}.json`,
    `${targetBase}.css`,
    `${targetBase}/index.js`,
    `${targetBase}/index.jsx`,
    `${targetBase}/index.ts`,
    `${targetBase}/index.tsx`
  ];
  for (const candidate of candidates) {
    if (lookup.has(candidate)) return lookup.get(candidate);
    const stripped = stripKnownExtension(candidate);
    if (lookup.has(stripped)) return lookup.get(stripped);
  }
  return null;
};

const parsePackageDependencies = (file) => {
  if (normalizePath(file.path).toLowerCase() !== 'package.json') return [];
  try {
    const parsed = JSON.parse(file.content || '{}');
    const deps = {
      ...(parsed.dependencies || {}),
      ...(parsed.devDependencies || {})
    };
    return Object.keys(deps).sort();
  } catch {
    return [];
  }
};

const findTestTarget = (testPath, lookup) => {
  const normalized = normalizePath(testPath);
  const targetBase = normalized
    .replace(/\/__tests__\//, '/')
    .replace(/\.(test|spec)(\.[cm]?[tj]sx?)$/i, '$2');
  const stripped = stripKnownExtension(targetBase);
  return lookup.get(targetBase) || lookup.get(stripped) || null;
};

const calculateBadges = (node) => {
  const badges = [];
  const degree = node.metrics.inDegree + node.metrics.outDegree;
  if (node.metrics.inDegree >= 4 || node.metrics.centrality >= 10) badges.push('core-file');
  if (degree === 0) badges.push('isolated');
  if (degree >= 8) badges.push('high-coupling');
  if (node.kind === 'workflow' || node.metrics.workflowLinks > 0) badges.push('workflow-related');
  if (node.kind === 'config' || node.kind === 'manifest') badges.push('config');
  if (
    ['source', 'component', 'hook', 'utility'].includes(node.kind) &&
    node.metrics.inDegree >= 2 &&
    node.tests.length === 0 &&
    node.testedBy.length === 0
  ) {
    badges.push('test-missing');
  }
  return badges;
};

const buildBrainGraph = async (projectPath, options = {}) => {
  const scan = await scanProjectFiles(projectPath, options);
  const lookup = buildPathLookup(scan.files);
  const nodesById = new Map();
  const edges = [];

  for (const file of scan.files) {
    const imports = parseImports(file.content || '', file.path);
    const symbols = parseSymbols(file.content || '');
    const exports = parseExports(file.content || '');
    const packages = parsePackageDependencies(file);
    const kind = inferNodeKind(file.path);
    nodesById.set(file.path, {
      id: file.path,
      path: file.path,
      label: path.basename(file.path),
      kind,
      size: file.size,
      truncated: !!file.truncated,
      imports,
      resolvedImports: [],
      packages,
      importedBy: [],
      symbols,
      exports,
      tests: [],
      testedBy: [],
      workflows: [],
      metrics: {
        inDegree: 0,
        outDegree: 0,
        centrality: 0,
        workflowLinks: 0
      },
      badges: []
    });
  }

  for (const node of nodesById.values()) {
    for (const rawImport of node.imports) {
      const target = resolveImportPath(node.path, rawImport, lookup);
      if (!target || !nodesById.has(target)) continue;
      node.resolvedImports.push(target);
      edges.push({ source: node.id, target, type: 'imports', label: 'imports' });
      const targetNode = nodesById.get(target);
      targetNode.importedBy.push(node.id);
    }
  }

  for (const node of nodesById.values()) {
    if (node.kind !== 'test') continue;
    const target = findTestTarget(node.path, lookup);
    if (!target || !nodesById.has(target)) continue;
    node.tests.push(target);
    nodesById.get(target).testedBy.push(node.id);
    edges.push({ source: node.id, target, type: 'tests', label: 'tests' });
  }

  for (const node of nodesById.values()) {
    if (node.kind !== 'workflow') continue;
    try {
      const raw = scan.files.find((file) => file.path === node.path)?.content || '';
      const parsed = JSON.parse(raw || '{}');
      const text = JSON.stringify(parsed).toLowerCase();
      for (const candidate of nodesById.values()) {
        if (candidate.id === node.id) continue;
        const base = path.basename(candidate.path).toLowerCase();
        const withoutExt = base.replace(/\.[^.]+$/, '');
        if (!base || withoutExt.length < 4) continue;
        if (text.includes(base) || text.includes(withoutExt)) {
          node.workflows.push(candidate.id);
          candidate.metrics.workflowLinks += 1;
          edges.push({ source: node.id, target: candidate.id, type: 'workflow', label: 'workflow' });
        }
      }
    } catch {
      // Invalid workflow JSON is still kept as a graph node.
    }
  }

  for (const node of nodesById.values()) {
    node.resolvedImports = unique(node.resolvedImports);
    node.importedBy = unique(node.importedBy);
    node.tests = unique(node.tests);
    node.testedBy = unique(node.testedBy);
    node.workflows = unique(node.workflows);
    node.metrics.inDegree = node.importedBy.length + node.testedBy.length;
    node.metrics.outDegree = node.resolvedImports.length + node.tests.length;
    node.metrics.centrality = node.metrics.inDegree * 2 + node.metrics.outDegree + node.metrics.workflowLinks * 3;
    node.badges = calculateBadges(node);
  }

  const nodes = Array.from(nodesById.values()).sort((a, b) => a.path.localeCompare(b.path));
  const hotspots = nodes
    .slice()
    .sort((a, b) => b.metrics.centrality - a.metrics.centrality || a.path.localeCompare(b.path))
    .slice(0, 20)
    .map((node) => ({
      path: node.path,
      kind: node.kind,
      score: node.metrics.centrality,
      badges: node.badges,
      reason: `${node.importedBy.length} dependants, ${node.resolvedImports.length} imports`
    }));

  const stats = {
    ...scan.stats,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    symbolCount: nodes.reduce((total, node) => total + node.symbols.length, 0),
    packageCount: unique(nodes.flatMap((node) => node.packages)).length,
    testCount: nodes.filter((node) => node.kind === 'test').length,
    workflowCount: nodes.filter((node) => node.kind === 'workflow').length
  };

  return {
    schemaVersion: BRAIN_GRAPH_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    projectName: path.basename(projectPath),
    stats,
    nodes,
    edges,
    hotspots,
    summary: buildArchitectureSummary({ nodes, edges, hotspots, stats })
  };
};

const getGraphPath = (projectPath) => path.join(projectPath, '.vibe-workspace', 'brain-graph.json');

const saveBrainGraph = async (projectPath, graph) => {
  const graphPath = getGraphPath(projectPath);
  await fs.mkdir(path.dirname(graphPath), { recursive: true });
  await fs.writeFile(graphPath, JSON.stringify(graph, null, 2), 'utf8');
  return graphPath;
};

const loadBrainGraph = async (projectPath) => {
  const graphPath = getGraphPath(projectPath);
  const raw = await fs.readFile(graphPath, 'utf8');
  const graph = JSON.parse(raw);
  return { graph, graphPath };
};

const tokenize = (value) => unique(String(value || '')
  .toLowerCase()
  .split(/[^a-z0-9_.$/-]+/i)
  .map((token) => token.trim())
  .filter((token) => token.length >= 2));

const scoreNodeForQuery = (node, tokens, activeFile = '') => {
  if (!node) return 0;
  if (!tokens.length && !activeFile) return node.metrics.centrality;
  const pathText = String(node.path || '').toLowerCase();
  const symbolText = (node.symbols || []).map((symbol) => `${symbol.kind} ${symbol.name}`).join(' ').toLowerCase();
  const badgeText = (node.badges || []).join(' ').toLowerCase();
  let score = Math.min(8, node.metrics.centrality || 0);

  for (const token of tokens) {
    if (pathText.includes(token)) score += 8;
    if (symbolText.includes(token)) score += 6;
    if (badgeText.includes(token)) score += 3;
  }

  if (activeFile && node.path === activeFile) score += 20;
  if (activeFile && (node.importedBy || []).includes(activeFile)) score += 8;
  if (activeFile && (node.resolvedImports || []).includes(activeFile)) score += 8;
  return score;
};

const selectBrainGraphContext = (graph, query, options = {}) => {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const tokens = tokenize(query);
  const activeFile = normalizePath(options.activeFile || '');
  const maxFiles = Number.isFinite(Number(options.maxFiles))
    ? Math.max(1, Math.min(30, Number(options.maxFiles)))
    : 8;

  const scored = nodes
    .map((node) => ({ node, score: scoreNodeForQuery(node, tokens, activeFile) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.node.metrics.centrality - a.node.metrics.centrality)
    .slice(0, maxFiles);

  const selectedIds = new Set(scored.map((item) => item.node.id));
  for (const item of scored.slice(0, 3)) {
    for (const neighbor of [
      ...(item.node.resolvedImports || []).slice(0, 4),
      ...(item.node.importedBy || []).slice(0, 4),
      ...(item.node.testedBy || []).slice(0, 2)
    ]) {
      if (selectedIds.size >= maxFiles) break;
      if (byId.has(neighbor)) selectedIds.add(neighbor);
    }
  }

  const selected = Array.from(selectedIds)
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((node) => ({
      path: node.path,
      kind: node.kind,
      badges: node.badges,
      symbols: (node.symbols || []).slice(0, 10),
      imports: (node.resolvedImports || []).slice(0, 12),
      importedBy: (node.importedBy || []).slice(0, 12),
      tests: unique([...(node.tests || []), ...(node.testedBy || [])]).slice(0, 8),
      score: scored.find((item) => item.node.id === node.id)?.score || node.metrics.centrality || 1
    }));

  return {
    query: String(query || ''),
    generatedAt: graph?.generatedAt || null,
    selected,
    contextText: formatBrainGraphContext(graph, selected)
  };
};

const formatBrainGraphContext = (graph, selected) => {
  const lines = [
    '--- BRAIN GRAPH CONTEXT ---',
    `Projet: ${graph?.projectName || 'unknown'}`,
    `Resume: ${graph?.summary || 'Aucun resume.'}`,
    `Fichiers selectionnes: ${selected.length}`
  ];
  selected.forEach((node) => {
    const symbols = (node.symbols || []).map((symbol) => `${symbol.kind}:${symbol.name}`).join(', ');
    lines.push(`- ${node.path} [${node.kind}] badges=${(node.badges || []).join(',') || 'none'} score=${node.score}`);
    if (symbols) lines.push(`  symbols: ${symbols}`);
    if (node.imports?.length) lines.push(`  imports: ${node.imports.join(', ')}`);
    if (node.importedBy?.length) lines.push(`  usedBy: ${node.importedBy.join(', ')}`);
    if (node.tests?.length) lines.push(`  tests: ${node.tests.join(', ')}`);
  });
  lines.push('--- END BRAIN GRAPH CONTEXT ---');
  return lines.join('\n');
};

const buildArchitectureSummary = ({ nodes, hotspots, stats }) => {
  const kindCounts = nodes.reduce((acc, node) => {
    acc[node.kind] = (acc[node.kind] || 0) + 1;
    return acc;
  }, {});
  const topKinds = Object.entries(kindCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([kind, count]) => `${kind}:${count}`)
    .join(', ');
  const topHotspots = (hotspots || []).slice(0, 5).map((item) => item.path).join(', ');
  return [
    `${stats.nodeCount} fichiers indexes, ${stats.edgeCount} liens, ${stats.symbolCount} symboles.`,
    topKinds ? `Types dominants: ${topKinds}.` : '',
    topHotspots ? `Fichiers centraux: ${topHotspots}.` : ''
  ].filter(Boolean).join(' ');
};

module.exports = {
  BRAIN_GRAPH_SCHEMA_VERSION,
  buildBrainGraph,
  getGraphPath,
  loadBrainGraph,
  saveBrainGraph,
  scanProjectFiles,
  selectBrainGraphContext,
  parseImports,
  parseSymbols,
  parseExports
};
