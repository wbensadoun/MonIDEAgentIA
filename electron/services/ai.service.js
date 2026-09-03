'use strict';

const path = require('path');
const fs = require('fs').promises;
const { spawn } = require('child_process');
const axios = require('axios');
const Anthropic = require('@anthropic-ai/sdk');
const { createProviderContract, isKnownProvider } = require('./provider-contract.service');
const { executeProviderPolicy, normalizePolicy } = require('./provider-policy.service');
const { runDashScopePromptCompletion } = require('./ai-providers/dashscope.provider');
const { sanitizeVisualWorkflowPayload } = require('../workflows/visualWorkflowSchema');
const {
  assertSafePath,
  safeResolvePath,
  toPositiveInt,
  ensureTrustedProjectPath,
  AGENT_MAX_FILE_BYTES,
  AGENT_MAX_LINES_PER_CALL,
  AGENT_MAX_TOOL_CALLS,
  AGENT_TOOL_CONTENT_MAX_CHARS,
  validateAgentFileAccess,
  readAgentFileWithLimits,
  readAgentLinesWithLimits,
  isLikelyBinary,
  parseTagAttributes,
  parseAgentToolCalls,
  AGENT_FILE_TOOL_CONTRACT,
  executeAgentFileToolCall,
  buildProjectIndexContext,
  formatToolError
} = require('../core/security');
const {
  readSettingsSafe,
  canUseTerminal,
  buildSafeSpawnRequest,
  MAX_CMD_OUTPUT,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_KIMI_MODEL,
  DEFAULT_CLAUDE_MODEL
} = require('./settings.service');
const { getWorkspaceVisualWorkflowsDir } = require('./agent.service');
const {
  OLLAMA_BASE_URL,
  FALLBACK_OLLAMA_MODEL_CANDIDATES,
  normalizeOllamaModelName,
  computeOllamaThink,
  stripThinkBlocks,
  fetchOllamaTags,
  startOllamaServerIfPossible,
  extractOllamaModelNames,
  pickInstalledOllamaModel
} = require('./ollama.service');

let serviceDeps = {
  dialog: null,
  getMainWindow: null,
  ptyService: null,
  resolveProviderCredential: null,
  resolveProviderPolicy: null,
  resolveProviderExecutionContext: null,
  executeManagedGateway: null,
  providerUsageLedger: null
};

const configureAIService = (deps = {}) => {
  serviceDeps = {
    ...serviceDeps,
    ...deps
  };
};

// ---------------------------------------------------------------------------
// Visual workflows prompt context
// ---------------------------------------------------------------------------

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
  const target = path.join(baseDir, selected);
  assertSafePath(baseDir, target);
  return target;
};

const getVisualWorkflowIndex = async (projectPath, maxItems = 20) => {
  if (!projectPath) return [];
  const baseDir = getWorkspaceVisualWorkflowsDir(projectPath);
  let filenames = [];
  try {
    filenames = await fs.readdir(baseDir);
  } catch {
    return [];
  }

  const workflows = [];
  for (const filename of filenames) {
    if (!String(filename).toLowerCase().endsWith('.json')) continue;
    if (workflows.length >= maxItems) break;
    const filePath = path.join(baseDir, filename);
    try {
      assertSafePath(baseDir, filePath);
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
};

const readVisualWorkflowById = async (projectPath, workflowId) => {
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
};

const VISUAL_WORKFLOW_INTENT_REGEX = /\b(workflow|workflows|flux|visuel|visuels|diagram|diagramme|n8n)\b/i;

const buildVisualWorkflowContextForPrompt = async (projectPath, userText = '', options = {}) => {
  if (!projectPath) return '';
  const safeOptions = options && typeof options === 'object' ? options : {};
  if (safeOptions.includeVisualWorkflows === false) return '';

  const maxIndexItems = toPositiveInt(safeOptions.maxVisualWorkflowIndexItems, 20, 1, 60);
  const maxDetailedItems = toPositiveInt(safeOptions.maxVisualWorkflowDetailedItems, 4, 0, 15);
  const maxContentChars = toPositiveInt(safeOptions.maxVisualWorkflowContentChars, 7000, 800, 50000);
  const workflowIntent = safeOptions.forceVisualWorkflowContext === true
    || VISUAL_WORKFLOW_INTENT_REGEX.test(String(userText || ''));

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
};

// ---------------------------------------------------------------------------
// Vibe Flow template catalog prompt context and compatible import helpers
// ---------------------------------------------------------------------------

const TEMPLATE_CATALOG_INTENT_REGEX = /\b(n8n|catalog|catalogue|template|templates)\b/i;
const TEMPLATE_CATALOG_REPO_OWNER = 'Danitilahun';
const TEMPLATE_CATALOG_REPO_NAME = 'n8n-workflow-templates';
const TEMPLATE_CATALOG_WORKFLOWS_DIR = 'workflows/';
const TEMPLATE_CATALOG_BRANCH_CANDIDATES = ['main', 'master'];
const TEMPLATE_CATALOG_ALLOWED_RAW_HOST = 'raw.githubusercontent.com';
const TEMPLATE_CATALOG_IMMUTABLE_REF_REGEX = /^[a-f0-9]{40}$/i;
const TEMPLATE_CATALOG_MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024;
const TEMPLATE_IMPORT_MAX_NODES = 500;
let templateCatalogPromptCache = {
  fetchedAt: 0,
  items: [],
  total: 0,
  source: 'none',
  truncated: false
};

const sanitizeImportedWorkflowFilename = (rawName, fallbackName = 'imported_template_workflow') => {
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

const isTrustedCompatibleDownloadUrl = (rawUrl) => {
  try {
    const parsed = new URL(String(rawUrl || '').trim());
    if (parsed.protocol !== 'https:') return false;
    if (parsed.hostname.toLowerCase() !== TEMPLATE_CATALOG_ALLOWED_RAW_HOST) return false;
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length < 5) return false;
    if (parts[0].toLowerCase() !== TEMPLATE_CATALOG_REPO_OWNER.toLowerCase()) return false;
    if (parts[1].toLowerCase() !== TEMPLATE_CATALOG_REPO_NAME.toLowerCase()) return false;
    const immutableRef = parts[2];
    if (!TEMPLATE_CATALOG_IMMUTABLE_REF_REGEX.test(immutableRef)) return false;
    const relPath = parts.slice(3).join('/');
    if (!relPath.toLowerCase().startsWith(TEMPLATE_CATALOG_WORKFLOWS_DIR)) return false;
    if (!relPath.toLowerCase().endsWith('.json')) return false;
    return true;
  } catch {
    return false;
  }
};

const parseCompatibleWorkflowPayload = (rawData) => {
  if (typeof rawData === 'string') {
    try {
      return JSON.parse(rawData);
    } catch {
      throw new Error('Le fichier telecharge n est pas un JSON valide.');
    }
  }
  return rawData;
};

const isValidCompatibleWorkflowPayload = (payload) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  if (!Array.isArray(payload.nodes)) return false;
  if (payload.nodes.length === 0 || payload.nodes.length > TEMPLATE_IMPORT_MAX_NODES) return false;
  if (payload.connections !== undefined && (payload.connections === null || typeof payload.connections !== 'object' || Array.isArray(payload.connections))) {
    return false;
  }
  return payload.nodes.every((node) => node && typeof node === 'object' && typeof node.type === 'string');
};

const fetchTrustedCompatibleWorkflow = async (downloadUrl, timeoutMs = 15000) => {
  if (!isTrustedCompatibleDownloadUrl(downloadUrl)) {
    throw new Error('URL non autorisee. Utilisez une URL provenant de la galerie de templates configuree.');
  }

  const response = await axios.get(downloadUrl, {
    timeout: timeoutMs,
    responseType: 'text',
    maxContentLength: TEMPLATE_CATALOG_MAX_DOWNLOAD_BYTES,
    maxBodyLength: TEMPLATE_CATALOG_MAX_DOWNLOAD_BYTES,
    transformResponse: [(data) => data]
  });
  const payload = parseCompatibleWorkflowPayload(response.data);
  if (!isValidCompatibleWorkflowPayload(payload)) {
    throw new Error('Le fichier telecharge ne semble pas etre un workflow compatible valide.');
  }
  return payload;
};

const toTemplateCatalogItem = (entryPath, size = 0, ref = 'main') => {
  const normalizedPath = String(entryPath || '').replace(/\\/g, '/');
  const filename = path.posix.basename(normalizedPath);
  const rawName = filename.replace(/\.json$/i, '');
  const name = rawName.replace(/[_-]+/g, ' ').trim() || rawName || filename;
  return {
    name,
    filename,
    repoPath: normalizedPath,
    downloadUrl: `https://raw.githubusercontent.com/${TEMPLATE_CATALOG_REPO_OWNER}/${TEMPLATE_CATALOG_REPO_NAME}/${ref}/${normalizedPath}`,
    size: Number(size) || 0
  };
};

const fetchTemplateBranchCommitSha = async (branch, timeoutMs = 12000) => {
  const url = `https://api.github.com/repos/${TEMPLATE_CATALOG_REPO_OWNER}/${TEMPLATE_CATALOG_REPO_NAME}/commits/${branch}`;
  const response = await axios.get(url, {
    headers: {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'Code Companion'
    },
    timeout: timeoutMs
  });
  const sha = String(response.data?.sha || '').trim();
  if (!TEMPLATE_CATALOG_IMMUTABLE_REF_REGEX.test(sha)) {
    throw new Error(`SHA commit invalide pour la branche ${branch}`);
  }
  return sha;
};

const sortTemplateCatalogItems = (items) => {
  return Array.isArray(items)
    ? items.slice().sort((a, b) =>
      String(a?.filename || '').localeCompare(String(b?.filename || ''), undefined, { numeric: true, sensitivity: 'base' }))
    : [];
};

const fetchTemplateCatalogFromGitTree = async (timeoutMs = 12000) => {
  let lastError = null;
  for (const branch of TEMPLATE_CATALOG_BRANCH_CANDIDATES) {
    try {
      const commitSha = await fetchTemplateBranchCommitSha(branch, timeoutMs);
      const url = `https://api.github.com/repos/${TEMPLATE_CATALOG_REPO_OWNER}/${TEMPLATE_CATALOG_REPO_NAME}/git/trees/${commitSha}?recursive=1`;
      const response = await axios.get(url, {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'Code Companion'
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
          entry.path.toLowerCase().startsWith(TEMPLATE_CATALOG_WORKFLOWS_DIR) &&
          entry.path.toLowerCase().endsWith('.json'))
        .map((entry) => toTemplateCatalogItem(entry.path, entry.size, commitSha));

      if (items.length > 0) {
        return {
          items: sortTemplateCatalogItems(items),
          source: `git-tree:${branch}@${commitSha.slice(0, 12)}`,
          truncated
        };
      }
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Impossible de lire la galerie de templates (git tree)');
};

const fetchTemplateCatalogFromContents = async (timeoutMs = 12000) => {
  let lastError = null;
  for (const branch of TEMPLATE_CATALOG_BRANCH_CANDIDATES) {
    try {
      const commitSha = await fetchTemplateBranchCommitSha(branch, timeoutMs);
      const url = `https://api.github.com/repos/${TEMPLATE_CATALOG_REPO_OWNER}/${TEMPLATE_CATALOG_REPO_NAME}/contents/workflows?ref=${commitSha}`;
      const response = await axios.get(url, {
        headers: {
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'Code Companion'
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
          .map((entry) => toTemplateCatalogItem(entry.path, entry.size, commitSha))
        : [];

      if (items.length > 0) {
        return {
          items: sortTemplateCatalogItems(items),
          source: `contents:${branch}@${commitSha.slice(0, 12)}`,
          truncated: false
        };
      }
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Impossible de lire la galerie de templates (contents)');
};

const getTemplateCatalogEntries = async (timeoutMs = 12000) => {
  const now = Date.now();
  const cacheAgeMs = now - Number(templateCatalogPromptCache.fetchedAt || 0);
  const cacheFreshMs = 3 * 60 * 1000;
  if (Array.isArray(templateCatalogPromptCache.items) && templateCatalogPromptCache.items.length > 0 && cacheAgeMs < cacheFreshMs) {
    return {
      items: templateCatalogPromptCache.items,
      total: Number(templateCatalogPromptCache.total) || templateCatalogPromptCache.items.length,
      source: templateCatalogPromptCache.source || 'cache',
      truncated: !!templateCatalogPromptCache.truncated,
      cached: true
    };
  }

  let fetched;
  try {
    fetched = await fetchTemplateCatalogFromGitTree(timeoutMs);
  } catch {
    fetched = await fetchTemplateCatalogFromContents(timeoutMs);
  }
  const items = Array.isArray(fetched?.items) ? fetched.items : [];

  templateCatalogPromptCache = {
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
};

const fetchTemplateCatalogForPrompt = async (maxItems = 50, timeoutMs = 12000) => {
  const catalog = await getTemplateCatalogEntries(timeoutMs);
  return {
    items: catalog.items.slice(0, maxItems),
    total: catalog.total,
    source: catalog.source,
    truncated: catalog.truncated
  };
};

const buildTemplateCatalogContextForPrompt = async (userText = '', options = {}) => {
  const safeOptions = options && typeof options === 'object' ? options : {};
  if (safeOptions.includeTemplateCatalog === false) return '';

  const intent = safeOptions.forceTemplateCatalogContext === true
    || TEMPLATE_CATALOG_INTENT_REGEX.test(String(userText || ''));
  if (!intent) return '';

  const maxItems = toPositiveInt(safeOptions.maxTemplateCatalogItems, 50, 5, 500);
  const timeoutMs = toPositiveInt(safeOptions.templateCatalogTimeoutMs, 12000, 2000, 30000);

  try {
    const catalog = await fetchTemplateCatalogForPrompt(maxItems, timeoutMs);
    const entries = Array.isArray(catalog.items) ? catalog.items : [];
    if (entries.length === 0) {
      return '\n--- GALERIE DE TEMPLATES (COMMUNITY) ---\nAucun workflow trouve.\n--- FIN GALERIE DE TEMPLATES ---\n';
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
    return `\n--- GALERIE DE TEMPLATES (COMMUNITY) ---\n${summary}${sourceInfo}${truncInfo}\n${lines.join('\n')}\n--- FIN GALERIE DE TEMPLATES ---\n`;
  } catch (error) {
    return `\n--- GALERIE DE TEMPLATES (COMMUNITY) ---\nIndisponible: ${error?.message || 'erreur reseau'}\n--- FIN GALERIE DE TEMPLATES ---\n`;
  }
};

// ---------------------------------------------------------------------------
// Prompt helpers
// ---------------------------------------------------------------------------

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
    'vite.config.js': 4
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

const buildFullProjectContext = (allProjectFiles, {
  maxFiles = 20,
  charsPerFile = 2000,
  header = '--- CONTEXTE COMPLET DU PROJET ---',
  footer = '--- FIN CONTEXTE PROJET ---'
} = {}) => {
  if (!allProjectFiles?.files) return '';
  let projectContext = `\n${header}\n`;
  const fileEntries = Object.entries(allProjectFiles.files);
  const filesToShow = pickFilesForContext(allProjectFiles.files, maxFiles);

  for (const [filePath, fileData] of filesToShow) {
    projectContext += `\n=== FICHIER: ${filePath} ===\n`;
    if (fileData.content && !String(fileData.content).startsWith('[')) {
      const content = fileData.content.length > charsPerFile
        ? fileData.content.substring(0, charsPerFile) + '\n[...CONTENU TRONQUE...]'
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
  projectContext += `${footer}\n`;
  return projectContext;
};

const buildContextPrompt = (projectFiles, agents) => {
  const projectIndex = buildProjectIndexContext(projectFiles);
  const agentList = Array.isArray(agents) && agents.length > 0
    ? `\nAGENTS DISPONIBLES:\n${agents.map((agent) => `- ${agent?.name || agent}`).join('\n')}\n`
    : '';
  return [projectIndex, agentList].filter(Boolean).join('\n');
};

const normalizeCompletionProvider = (value) => {
  const provider = String(value || '').trim().toLowerCase();
  if (!provider) return 'gemini'; // défaut explicite historique, jamais pour une valeur inconnue.
  return isKnownProvider(provider) ? provider : null;
};

const injectManagedProviderCredential = async (options = {}) => {
  if (options.credentialMode !== 'managed' || typeof serviceDeps.resolveProviderCredential !== 'function') return options;
  const provider = normalizeCompletionProvider(options.provider);
  if (!provider) return options;
  const resolved = await serviceDeps.resolveProviderCredential({
    provider,
    workspaceId: options.projectPath,
    policy: options.providerPolicy
  });
  return { ...options, managedCredential: resolved?.credential || null };
};

// This boundary is used by chat, inline and ghost completions. Renderer input
// never selects the policy, workspace or credential origin.
const runProviderCompletionWithPolicy = async ({ provider, request = {}, options = {}, execute } = {}) => {
  if (typeof execute !== 'function') throw new Error('Execution provider requise.');
  if (typeof serviceDeps.resolveProviderExecutionContext !== 'function' || typeof serviceDeps.resolveProviderPolicy !== 'function' || typeof serviceDeps.resolveProviderCredential !== 'function') {
    // Only non-Electron/unit callers can use the legacy execution path. Main
    // configures all managed dependencies before it registers IPC handlers.
    return execute({ ...request, options });
  }
  const context = await serviceDeps.resolveProviderExecutionContext({ request, options, provider });
  if (!context?.workspaceId) return { success: false, error: 'Accès workspace fournisseur refusé.' };
  let policy;
  try {
    policy = normalizePolicy(await serviceDeps.resolveProviderPolicy({ ...context, provider }));
  } catch {
    return { success: false, error: 'Policy fournisseur refusée.' };
  }
  return executeProviderPolicy({
    provider,
    workspaceId: context.workspaceId,
    policy,
    resolveCredential: ({ origin, ...identity }) => serviceDeps.resolveProviderCredential({ ...identity, origin, context, policy }),
    attempt: async ({ origin, credential, signal }) => {
      if (origin === 'neven' && typeof serviceDeps.executeManagedGateway === 'function') {
        // A Neven grant authorizes the gateway; it is never injected as a
        // provider API key or passed to a provider adapter.
        return serviceDeps.executeManagedGateway({
          workspaceId: context.workspaceId,
          deviceId: context.deviceId,
          profile: context.profile || 'haiku',
          capability: 'completion',
          access: context.access,
          mode: request.mode,
          request,
        });
      }
      const managedOptions = {
        ...options,
        signal: signal && options.signal ? AbortSignal.any([options.signal, signal]) : signal || options.signal,
        credentialMode: 'managed',
        credentialOrigin: origin,
        managedCredential: credential
      };
      // A lease is scoped to the selected provider. Provider fallback must
      // resolve a new target-provider lease before it can ever be supported.
      delete managedOptions.allowProviderFallback;
      delete managedOptions.fallbackProvider;
      return execute({
        ...request,
        options: managedOptions
      });
    },
    ledger: serviceDeps.providerUsageLedger,
    usage: (result) => ({
      runId: context.runId || null,
      inputTokens: result?.usage?.inputTokens ?? result?.usage?.promptTokens,
      outputTokens: result?.usage?.outputTokens ?? result?.usage?.completionTokens,
      durationMs: result?.durationMs
    })
  });
};

const stripCompletionMarkdown = (value, { trimEndOnly = false } = {}) => {
  const source = String(value || '')
    .replace(/^```[a-z]*\n/i, '')
    .replace(/\n```$/i, '');
  return trimEndOnly ? source.trimEnd() : source.trim();
};

const runLegacySingleCompletionProvider = async ({
  provider,
  systemInstruction,
  userPrompt,
  options = {},
  maxTokens = 512,
  trimEndOnly = false
}) => {
  if (options.signal?.aborted) return { success: false, aborted: true, error: 'Generation annulee.' };
  const rawProvider = String(provider || '').trim().toLowerCase();
  if (!isKnownProvider(rawProvider)) {
    return { success: false, error: `Provider completion non pris en charge: ${provider || 'aucun'}` };
  }
  const normalizedProvider = normalizeCompletionProvider(provider);
  const managedCredentials = options.credentialMode === 'managed';
  // The policy executor selected this credential and origin already. Resolving
  // again here can select a different origin and must never happen.
  const managedCredential = managedCredentials ? options.managedCredential || null : null;
  const resolveApiKey = (legacyKey, ...environmentKeys) => {
    if (managedCredentials) return managedCredential;
    return legacyKey || environmentKeys.map((key) => process.env[key]).find(Boolean) || null;
  };
  const temperature = Number.isFinite(Number(options.temperature)) ? Number(options.temperature) : 0.1;

  if (options.localOnly && normalizedProvider !== 'ollama') {
    return {
      success: false,
      error: `Local-only actif: provider cloud interdit (${normalizedProvider}).`,
      provider: normalizedProvider
    };
  }

  if (normalizedProvider === 'kimi') {
    const apiKey = resolveApiKey(null, 'KIMI_API_KEY', 'TOGETHER_API_KEY');
    const model = options.model || process.env.KIMI_MODEL || DEFAULT_KIMI_MODEL;
    if (!apiKey) return { success: false, error: 'La cle API Together/Kimi est requise.', provider: 'kimi', model };

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
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 60000,
      signal: options.signal
    });
    if (options.signal?.aborted) return { success: false, aborted: true, error: 'Generation annulee.', provider: 'kimi', model };

    const text = resp.data?.choices?.[0]?.message?.content || '';
    return { success: true, text: stripCompletionMarkdown(text, { trimEndOnly }), provider: 'kimi', model };
  }

  if (normalizedProvider === 'claude') {
    const apiKey = resolveApiKey(null, 'CLAUDE_API_KEY', 'ANTHROPIC_API_KEY');
    const model = options.model || process.env.CLAUDE_MODEL || DEFAULT_CLAUDE_MODEL;
    if (!apiKey) return { success: false, error: 'La cle API Claude est requise.', provider: 'claude', model };

    const anthropic = new Anthropic({ apiKey });
    const resp = await anthropic.messages.create({
      model,
      max_tokens: maxTokens,
      temperature,
      system: systemInstruction,
      messages: [{ role: 'user', content: userPrompt }]
    }, { signal: options.signal });
    if (options.signal?.aborted) return { success: false, aborted: true, error: 'Generation annulee.', provider: 'claude', model };

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
      options: {
        temperature,
        num_predict: maxTokens
      }
    }, { timeout: 90000, signal: options.signal });
    if (options.signal?.aborted) return { success: false, aborted: true, error: 'Generation annulee.', provider: 'ollama', requestedModel, model };

    const text = stripThinkBlocks(resp.data?.message?.content || '');
    return { success: true, text: stripCompletionMarkdown(text, { trimEndOnly }), provider: 'ollama', requestedModel, model };
  }

  if (normalizedProvider === 'dashscope') {
    return runDashScopePromptCompletion({
      systemInstruction,
      userPrompt,
      options: { ...options, managedCredential },
      maxTokens,
      trimEndOnly
    });
  }

  if (normalizedProvider === 'neven') {
    return {
      success: false,
      error: 'La passerelle Neven doit être exécutée depuis le workspace authentifié.',
      provider: 'neven'
    };
  }

  if (normalizedProvider === 'openai') {
    const apiKey = resolveApiKey(null, 'OPENAI_API_KEY');
    const model = options.model || process.env.OPENAI_MODEL || 'gpt-4o-mini';
    if (!apiKey) return { success: false, error: 'La cle API OpenAI est requise.', provider: 'openai', model };

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemInstruction },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: maxTokens,
        temperature
      }),
      signal: options.signal
    });

    if (options.signal?.aborted) return { success: false, aborted: true, error: 'Generation annulee.', provider: 'openai', model };

    const data = await response.json();
    if (!response.ok) {
      const error = new Error(data.error?.message || `Erreur HTTP: ${response.status}`);
      error.status = response.status;
      throw error;
    }

    const text = data.choices?.[0]?.message?.content || '';
    return { success: true, text: stripCompletionMarkdown(text, { trimEndOnly }), provider: 'openai', model, usage: data.usage };
  }

  const apiKey = resolveApiKey(null, 'GEMINI_API_KEY');
  const model = options.model || process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  if (!apiKey) return { success: false, error: 'La cle API Gemini est requise.', provider: 'gemini', model };

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
    body: JSON.stringify(payload),
    signal: options.signal
  });

  if (options.signal?.aborted) return { success: false, aborted: true, error: 'Generation annulee.', provider: 'gemini', model };

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || `Erreur HTTP: ${response.status}`);
  }

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return { success: true, text: stripCompletionMarkdown(text, { trimEndOnly }), provider: 'gemini', model };
};

// Les complétions inline et ghost passent elles aussi par le même contrat que
// le chat. Les appels SDK existants restent ici: aucun secret ni SDK n'est
// déplacé vers le renderer, et aucune logique provider n'est dupliquée.
const runSingleCompletionProvider = async (request = {}) => {
  const provider = normalizeCompletionProvider(request.provider ?? request.options?.provider);
  if (!provider) return { success: false, error: `Provider completion non pris en charge: ${request.provider || request.options?.provider || 'aucun'}` };
  const { __skipProviderPolicy, ...providerRequest } = request;
  const contract = createProviderContract({
    adapters: Object.fromEntries(['gemini', 'claude', 'openai', 'kimi', 'ollama', 'dashscope', 'neven'].map((id) => [id, {
      capabilities: { streaming: false, usage: true, cost: 'unpriced' },
      complete: ({ options, ...payload }) => runLegacySingleCompletionProvider({ ...payload, provider: id, options })
    }]))
  });
  const options = providerRequest.options || {};
  if (__skipProviderPolicy === true) {
    return contract.complete({ provider, request: providerRequest, options });
  }
  return runProviderCompletionWithPolicy({
    provider,
    request: { ...providerRequest, provider },
    options,
    execute: (executionRequest) => contract.complete({ provider, request: executionRequest, options: executionRequest.options || options })
  });
};

// ---------------------------------------------------------------------------
// Terminal/tool execution
// ---------------------------------------------------------------------------

const TERMINAL_CAPABILITY_PROMPT = `
CAPACITÉ TERMINAL — AGENT AUTONOME :
Tu peux exécuter des commandes shell directement dans le projet de l'utilisateur.
Pour exécuter une commande, utilise EXACTEMENT ce format XML (une seule commande par balise) :

<run_command>npm install lodash</run_command>

Tu recevras le résultat (stdout/stderr) dans ton prochain tour.
Règles :
- Utilise cette capacité pour : lire des fichiers, lancer des builds, installer des packages, vérifier des erreurs, lancer des tests.
- N'utilise PAS pour : supprimer des fichiers importants (rm -rf), commandes destructives.
- Tu peux enchaîner plusieurs commandes en plusieurs tours (max 8 itérations automatiques).
- Si une commande échoue, analyse l'erreur et essaie une solution alternative.
- Quand tu n'as plus besoin d'exécuter de commandes, réponds normalement sans balise <run_command>.

LECTURE DU TERMINAL PARTAGÉ :
L'utilisateur dispose d'un terminal interactif dans lequel il tape lui-même.
Son contenu ne t'est PAS fourni par défaut. Si — et seulement si — la question
porte sur ce qui s'est passé dans CE terminal (erreur affichée à l'écran, sortie
d'une commande lancée par l'utilisateur), demande-le avec exactement :

<read_terminal/>

Tu recevras les dernières lignes du tampon dans ton prochain tour. N'utilise pas
cette balise pour lire le résultat de TES propres commandes : celui-ci t'est déjà
renvoyé automatiquement après chaque <run_command>. Une seule balise par tour.

ÉDITION DE FICHIERS — PROTOCOLE CHIRURGICAL :
Pour MODIFIER un fichier EXISTANT → SEARCH/REPLACE:
  FILE: chemin/relatif/nom.ext
  <<<< SEARCH
  <bloc exact du fichier actuel>
  ====
  <nouveau contenu>
  >>>> REPLACE
Pour CRÉER un NOUVEAU fichier → **FICHIER: chemin** \`\`\`langage\ncontenu\n\`\`\`
JAMAIS réécrire un fichier entier qui existe déjà.

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

const FILE_EDIT_PROTOCOL = `
ÉDITION DE FICHIERS — PROTOCOLE CHIRURGICAL :
Pour MODIFIER un fichier EXISTANT → SEARCH/REPLACE:
  FILE: chemin/relatif/nom.ext
  <<<< SEARCH
  <bloc exact du fichier actuel>
  ====
  <nouveau contenu>
  >>>> REPLACE
Pour CRÉER un nouveau fichier → **FICHIER: chemin** \`\`\`langage\ncontenu\n\`\`\`
JAMAIS réécrire un fichier entier qui existe déjà.`;

const parseRunCommand = (text) => {
  const match = String(text || '').match(/<run_command>([\s\S]*?)<\/run_command>/i);
  return match ? match[1].trim() : null;
};

// La commande est deja remontee a l'UI par l'evenement 'ai-terminal-action',
// qui lui donne sa propre carte terminal. La laisser dans le transcript
// affichait en plus du XML brut (<run_command>npm install</run_command>) au
// milieu de la reponse finale.
const stripRunCommandTags = (text) => String(text || '')
  .replace(/<run_command>[\s\S]*?<\/run_command>/gi, '')
  .replace(/[ \t]+\n/g, '\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

// ─── Lecture du terminal partage (outil explicite, JAMAIS injecte d'office) ──
// Le tampon pty peut peser 20 000 caracteres : l'injecter dans chaque prompt
// systeme couterait des milliers de tokens a chaque tour, y compris quand la
// question n'a rien a voir avec le terminal. Il n'est donc lu QUE lorsque le
// modele emet explicitement <read_terminal/>.
const READ_TERMINAL_MAX_CHARS = 6000;

const parseReadTerminalCall = (text) =>
  /<read_terminal\s*\/?>(?:\s*<\/read_terminal>)?/i.test(String(text || ''));

const stripReadTerminalTags = (text) => String(text || '')
  .replace(/<read_terminal\s*\/?>(?:\s*<\/read_terminal>)?/gi, '')
  .replace(/[ \t]+\n/g, '\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

const readSharedTerminalBuffer = (deps = serviceDeps) => {
  const ptyService = deps?.ptyService;
  if (!ptyService || typeof ptyService.readLatestBuffer !== 'function') {
    return { success: false, text: '[TERMINAL PARTAGE] Service terminal indisponible.' };
  }
  const res = ptyService.readLatestBuffer();
  if (!res?.success) {
    return { success: false, text: `[TERMINAL PARTAGE] ${res?.error || 'Aucun tampon disponible.'}` };
  }
  let buffer = String(res.buffer || '');
  if (!buffer.trim()) {
    return { success: true, text: '[TERMINAL PARTAGE] Le tampon est vide (aucune sortie depuis l\'ouverture de la session).' };
  }
  let truncated = false;
  if (buffer.length > READ_TERMINAL_MAX_CHARS) {
    buffer = buffer.slice(buffer.length - READ_TERMINAL_MAX_CHARS);
    truncated = true;
  }
  return {
    success: true,
    text: `[TERMINAL PARTAGE${truncated ? ' - dernieres lignes seulement' : ''}]\n\`\`\`\n${buffer}\n\`\`\``
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

const requestTerminalApproval = async (commandText, deps = serviceDeps) => {
  try {
    const dialog = deps?.dialog;
    if (!dialog || typeof dialog.showMessageBox !== 'function') return false;
    const win = typeof deps?.getMainWindow === 'function' ? deps.getMainWindow() : null;
    const targetWindow = win && !win.isDestroyed() ? win : null;
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

const buildCompatibleWorkflowAdapter = (importedWorkflow, saveName) => {
  const guessNodeType = (sourceType) => {
    if (!sourceType) return 'action';
    const t = sourceType.toLowerCase();
    if (t.includes('trigger') || t.includes('cron') || t.includes('schedule') || t.includes('webhook') || t.includes('manual')) return 'trigger';
    if (t.includes('openai') || t.includes('ai') || t.includes('gpt') || t.includes('llm')) return 'ai';
    if (t.includes('if') || t.includes('switch') || t.includes('merge') || t.includes('loop') || t.includes('wait')) return 'logic';
    if (t.includes('slack') || t.includes('email') || t.includes('telegram') || t.includes('discord') || t.includes('notification')) return 'output';
    return 'action';
  };

  const guessNodeIcon = (sourceType) => {
    if (!sourceType) return '⚡';
    const t = sourceType.toLowerCase();
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
    name: importedWorkflow.name || saveName.replace('.json', ''),
    nodes: (importedWorkflow.nodes || []).map((n, i) => ({
      id: `node_${i + 1}`,
      type: guessNodeType(n.type),
      label: n.name || n.type,
      icon: guessNodeIcon(n.type),
      position: n.position ? { x: n.position[0] || 100, y: n.position[1] || 100 } : { x: 100 + i * 220, y: 150 },
      config: {
        command: n.parameters?.command || '',
        prompt: n.parameters?.text || n.parameters?.prompt || '',
        message: n.parameters?.message || ''
      }
    })),
    edges: []
  };

  if (importedWorkflow.connections) {
    Object.entries(importedWorkflow.connections).forEach(([sourceName, conns]) => {
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

  return adapted;
};

// runContext porte le mode d'execution ('ask' | 'plan' | 'agent') et le niveau
// d'autonomie, transmis depuis le renderer via options. Avant, ces deux notions
// n'existaient QUE dans le prompt : un modele qui ignorait la consigne
// "CONTRAINTE: lecture seule" pouvait executer n'importe quelle commande de
// l'allowlist en mode Ask. Le controle est desormais ici, cote serveur, hors de
// portee du modele.
const executeCommandForAI = (cmd, projectPath, deps = serviceDeps, runContext = {}) => {
  return new Promise(async (resolve) => {
    if (!cmd || typeof cmd !== 'string' || !cmd.trim()) {
      return resolve({ success: false, output: '[AI TERMINAL] Commande vide ignoree.' });
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

    // ── Enveloppe de capacites par mode d'execution (non negociable) ──────────
    const executionMode = String(runContext?.executionMode || 'agent').toLowerCase();

    if (executionMode === 'ask') {
      return resolve({
        success: false,
        output: '[AI TERMINAL] Mode Ask: aucune commande ne peut etre executee. Passez en Plan (lecture) ou Agent.'
      });
    }

    if (executionMode === 'plan' && !spawnRequest.readOnly) {
      return resolve({
        success: false,
        output: `[AI TERMINAL] Mode Plan: seules les commandes de lecture sont autorisees (git status, git log, git diff, npm ls, ls, cat...). Refusee: ${spawnRequest.normalizedCommandLine}`
      });
    }

    // ── Politique de confirmation (autopilot) ─────────────────────────────────
    // C'est le NIVEAU D'AUTONOMIE qui decide, pas un reglage separe : choisir
    // "Autonome" dans une pill au ton danger EST le consentement explicite.
    // Lier l'autopilot a aiTerminalApprovalMode (defaut true) aurait rendu le
    // niveau d'autonomie decoratif — l'exact defaut qu'on corrige ici.
    //
    // Ce qui reste actif en Autonome, parce que ces garde-fous ne dependent pas
    // d'un clic : allowlist de binaires, interdiction des operateurs shell et
    // blocage des patterns destructeurs (rm -rf, git reset --hard, mkfs...),
    // tous appliques par buildSafeSpawnRequest plus haut. L'autopilot supprime
    // le dialogue, pas les limites.
    // L'autopilot terminal exige DEUX consentements, comme l'auto-approve de
    // Copilot qui est opt-in : etre en Autonome (permissionMode edit_terminal)
    // ET avoir decoche la confirmation par commande. Raison : edit_terminal est
    // le mode par DEFAUT, donc s'y fier seul reviendrait a activer l'execution
    // silencieuse de commandes shell sur une installation neuve.
    // L'auto-application des PATCHS, elle, ne demande qu'un consentement
    // (choisir Autonome) : elle est reversible — snapshot, undo, detection de
    // conflit par mtime. Une commande shell ne l'est pas.
    const autopilotTerminal = settings.permissionMode === 'edit_terminal'
      && settings.aiTerminalApprovalMode === false;

    if (!autopilotTerminal && settings.aiTerminalApprovalMode !== false) {
      const approved = await requestTerminalApproval(spawnRequest.normalizedCommandLine, deps);
      if (!approved) {
        return resolve({
          success: false,
          output: `[AI TERMINAL] Commande refusee par l'utilisateur: ${spawnRequest.normalizedCommandLine}`
        });
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

    console.log(`[AI Terminal] Execution: ${spawnRequest.normalizedCommandLine}`);
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
      try { child.kill(); } catch { /* ignore */ }
      const output = `[AI TERMINAL - TIMEOUT apres 30s]\nstdout: ${stdout.slice(0, 2000)}\nstderr: ${stderr.slice(0, 2000)}`;
      resolve({ success: false, exitCode: null, output });
    }, 30000);

    child.on('close', (code) => {
      clearTimeout(timer);
      let output = '';
      if (stdout) output += stdout;
      if (stderr) output += `\n[stderr] ${stderr}`;
      if (!output.trim()) output = `[Process exited with code ${code}]`;
      if (output.length > MAX_CMD_OUTPUT) {
        output = output.substring(0, MAX_CMD_OUTPUT) + '\n[...sortie tronquee...]';
      }
      resolve({ success: code === 0, exitCode: typeof code === 'number' ? code : null, output });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ success: false, exitCode: null, output: `[AI TERMINAL ERREUR] ${err.message}` });
    });
  });
};

module.exports = {
  configureAIService,
  injectManagedProviderCredential,
  runProviderCompletionWithPolicy,
  runLegacySingleCompletionProvider,
  buildContextPrompt,
  buildProjectIndexContext,
  buildFullProjectContext,
  runSingleCompletionProvider,
  normalizeCompletionProvider,
  stripCompletionMarkdown,
  buildVisualWorkflowContextForPrompt,
  buildTemplateCatalogContextForPrompt,
  getTemplateCatalogEntries,
  fetchTrustedCompatibleWorkflow,
  sanitizeImportedWorkflowFilename,
  isTrustedCompatibleDownloadUrl,
  getVisualWorkflowIndex,
  readVisualWorkflowById,
  executeCommandForAI,
  requestTerminalApproval,
  parseRunCommand,
  stripRunCommandTags,
  parseReadTerminalCall,
  stripReadTerminalTags,
  readSharedTerminalBuffer,
  parseTagAttributes,
  parseAgentToolCalls,
  executeAgentFileToolCall,
  readAgentFileWithLimits,
  readAgentLinesWithLimits,
  validateAgentFileAccess,
  validateCommandPathTokenForWorkspace,
  validateCommandArgsWithinWorkspace,
  safeResolvePath,
  isLikelyBinary,
  formatToolError,
  pickFilesForContext,
  AGENT_FILE_TOOL_CONTRACT,
  TERMINAL_CAPABILITY_PROMPT,
  FILE_EDIT_PROTOCOL,
  AGENT_MAX_FILE_BYTES,
  AGENT_MAX_LINES_PER_CALL,
  AGENT_MAX_TOOL_CALLS,
  AGENT_TOOL_CONTENT_MAX_CHARS
};
