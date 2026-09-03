'use strict';

const crypto = require('crypto');
const { URL } = require('url');
const { sanitizeVisualWorkflowPayload } = require('../workflows/visualWorkflowSchema');

const MAX_RUNS = 100;
const MAX_LOG_MESSAGE = 2000;
const MAX_FILE_BYTES = 1_200_000;
const MAX_HTTP_BYTES = 1_000_000;
const MAX_HTTP_TIMEOUT_MS = 15_000;
const MAX_DELAY_MS = 300_000;
const MAX_LOOP_ITERATIONS = 10;

const clampInteger = (value, fallback, min, max) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
};

const truncate = (value, max = MAX_LOG_MESSAGE) => String(value ?? '').slice(0, max);

const interpolate = (value, previous, results) => {
  let text = String(value ?? '');
  text = text.replace(/\{\{prev\}\}/g, previous || '');
  return text.replace(/\{\{([A-Za-z0-9_-]+)\}\}/g, (_, key) => results[key] ?? '');
};

const splitTopLevel = (expression, operator) => {
  const source = String(expression || '');
  let depth = 0;
  let quote = null;
  for (let index = 0; index <= source.length - operator.length; index += 1) {
    const char = source[index];
    const previous = source[index - 1];
    if (quote) {
      if (char === quote && previous !== '\\') quote = null;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '(') { depth += 1; continue; }
    if (char === ')') { depth -= 1; continue; }
    if (depth === 0 && source.slice(index, index + operator.length) === operator) {
      return [source.slice(0, index).trim(), source.slice(index + operator.length).trim()];
    }
  }
  return null;
};

const parseValue = (token, context) => {
  const value = String(token || '').trim().replace(/^\((.*)\)$/, '$1').trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  if (value === 'prev' || value === 'result') return context.prev;
  if (value.startsWith('results.')) return context.results[value.slice('results.'.length)];
  return value;
};

const evaluateCondition = (expression, context = {}) => {
  const source = String(expression || '').trim();
  const orParts = source.split(/\s*\|\|\s*/);
  if (orParts.length > 1) return orParts.some((part) => evaluateCondition(part, context));
  const andParts = source.split(/\s*&&\s*/);
  if (andParts.length > 1) return andParts.every((part) => evaluateCondition(part, context));
  if (source.startsWith('!')) return !evaluateCondition(source.slice(1), context);
  for (const operator of ['===', '!==', '==', '!=', '>=', '<=', '>', '<']) {
    const pair = splitTopLevel(source, operator);
    if (!pair) continue;
    const left = parseValue(pair[0], context);
    const right = parseValue(pair[1], context);
    switch (operator) {
      case '===': return left === right;
      case '!==': return left !== right;
      case '==': return left == right; // eslint-disable-line eqeqeq
      case '!=': return left != right; // eslint-disable-line eqeqeq
      case '>=': return left >= right;
      case '<=': return left <= right;
      case '>': return left > right;
      case '<': return left < right;
      default: return false;
    }
  }
  const parsed = parseValue(source, context);
  return Boolean(parsed);
};

const topoSort = (nodes, edges) => {
  const adjacency = new Map(nodes.map((node) => [node.id, []]));
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  for (const edge of edges) {
    adjacency.get(edge.source)?.push(edge.target);
    if (indegree.has(edge.target)) indegree.set(edge.target, indegree.get(edge.target) + 1);
  }
  const queue = nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id);
  const sorted = [];
  while (queue.length) {
    const id = queue.shift();
    sorted.push(id);
    for (const target of adjacency.get(id) || []) {
      indegree.set(target, indegree.get(target) - 1);
      if (indegree.get(target) === 0) queue.push(target);
    }
  }
  if (sorted.length !== nodes.length) throw new Error('Le workflow contient une boucle de dépendances.');
  return sorted;
};

const createWorkflowEngine = ({
  app,
  fs,
  path,
  getMainWindow,
  ensureEditPermission,
  ensureTerminalPermission,
  ensureTrustedProjectPath,
  assertSafePath,
  readSettingsSafe,
  runCommandForTask,
  requestTerminalApproval,
  buildSafeSpawnRequest,
  runSingleCompletionProvider,
  fetchImpl = globalThis.fetch,
  now = () => new Date().toISOString()
} = {}) => {
  const activeRuns = new Map();

  const runsDir = () => path.join(app.getPath('userData'), 'workflow-runs');
  const runPath = (runId) => path.join(runsDir(), `${runId}.json`);
  const send = (channel, payload) => {
    const mainWindow = typeof getMainWindow === 'function' ? getMainWindow() : null;
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
  };

  const persist = async (run) => {
    await fs.mkdir(runsDir(), { recursive: true });
    const temporaryPath = `${runPath(run.id)}.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify(run, null, 2), 'utf8');
    await fs.rename(temporaryPath, runPath(run.id));
  };

  const addLog = async (run, nodeId, type, message) => {
    const entry = { nodeId: nodeId || null, type, message: truncate(message), timestamp: now() };
    run.logs.push(entry);
    if (run.logs.length > 500) run.logs.shift();
    send('workflow-run-log', { runId: run.id, ...entry });
    await persist(run);
  };

  const assertNotStopped = (controller) => {
    if (controller.signal.aborted) throw new Error('Workflow arrêté.');
  };

  const assertWorkflowFilePath = (trustedProjectPath, filePath) => {
    assertSafePath(trustedProjectPath, filePath);
    const relativePath = path.relative(trustedProjectPath, filePath);
    if (!relativePath || relativePath.split(/[\\/]+/).some((segment) => segment.toLowerCase() === '.agent')) {
      throw new Error('Chemin interne .agent interdit dans un workflow.');
    }
  };

  const readProjectFile = async (projectPath, filename) => {
    const trustedProjectPath = await ensureTrustedProjectPath(projectPath);
    const requestedPath = String(filename || '').trim();
    if (!requestedPath) throw new Error('Nom de fichier requis.');
    const filePath = path.resolve(trustedProjectPath, requestedPath);
    assertWorkflowFilePath(trustedProjectPath, filePath);
    const stats = await fs.stat(filePath);
    if (!stats.isFile()) throw new Error('La cible du workflow doit être un fichier.');
    if (stats.size > MAX_FILE_BYTES) throw new Error('Fichier trop volumineux pour un workflow.');
    return fs.readFile(filePath, 'utf8');
  };

  const writeProjectFile = async (projectPath, filename, content) => {
    await ensureEditPermission();
    const trustedProjectPath = await ensureTrustedProjectPath(projectPath);
    const requestedPath = String(filename || '').trim();
    if (!requestedPath) throw new Error('Nom de fichier requis.');
    const filePath = path.resolve(trustedProjectPath, requestedPath);
    assertWorkflowFilePath(trustedProjectPath, filePath);
    if (Buffer.byteLength(String(content ?? ''), 'utf8') > MAX_FILE_BYTES) throw new Error('Contenu trop volumineux pour un workflow.');
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, String(content ?? ''), 'utf8');
    return `Fichier écrit: ${path.relative(trustedProjectPath, filePath)}`;
  };

  const requestHttp = async (config, controller) => {
    const url = new URL(String(config.url || config.command || '').trim());
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('URL HTTP invalide.');
    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(), MAX_HTTP_TIMEOUT_MS);
    const abort = () => timeoutController.abort();
    controller.signal.addEventListener('abort', abort, { once: true });
    try {
      const body = config.body === undefined ? undefined : String(config.body);
      const response = await fetchImpl(url, {
        method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(String(config.method || 'GET').toUpperCase())
          ? String(config.method || 'GET').toUpperCase() : 'GET',
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body,
        signal: timeoutController.signal,
        redirect: 'error'
      });
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > MAX_HTTP_BYTES) throw new Error('Réponse HTTP trop volumineuse.');
      const text = buffer.toString('utf8');
      if (!response.ok) throw new Error(`Requête HTTP refusée (${response.status}).`);
      return text || `HTTP ${response.status}`;
    } finally {
      clearTimeout(timer);
      controller.signal.removeEventListener('abort', abort);
    }
  };

  const executeNode = async ({ node, projectPath, previous, results, controller }) => {
    const config = node.config || {};
    const type = node.type;
    if (type === 'trigger') return `Déclencheur "${node.label}" activé`;
    if (type === 'output') return interpolate(config.message, previous, results) || 'Notification envoyée';
    if (type === 'logic') {
      const actionType = String(config.actionType || config.kind || 'condition').toLowerCase();
      if (actionType === 'delay') {
        const delayMs = clampInteger(Number(config.seconds) * 1000, 0, 0, MAX_DELAY_MS);
        await new Promise((resolve, reject) => {
          const abort = () => { clearTimeout(timer); controller.signal.removeEventListener('abort', abort); reject(new Error('Workflow arrêté.')); };
          const timer = setTimeout(() => { controller.signal.removeEventListener('abort', abort); resolve(); }, delayMs);
          controller.signal.addEventListener('abort', abort, { once: true });
        });
        return `Délai de ${delayMs} ms terminé`;
      }
      if (actionType === 'loop') return `Boucle limitée à ${clampInteger(config.count, 1, 1, MAX_LOOP_ITERATIONS)} itération(s)`;
      return String(evaluateCondition(interpolate(config.condition, previous, results) || 'true', { prev: previous, results }));
    }
    if (type === 'ai') {
      const prompt = interpolate(config.prompt, previous, results);
      if (!prompt) return 'Aucun prompt spécifié';
      if (typeof runSingleCompletionProvider !== 'function') throw new Error('Provider IA indisponible.');
      const result = await runSingleCompletionProvider({
        provider: config.model || 'gemini',
        messages: [{ role: 'user', text: prompt }],
        prompt,
        options: { includeProjectContext: false, includeGlobalSkills: false, maxTokens: 1536 },
        projectPath
      });
      if (!result?.success) throw new Error('La completion IA du workflow a échoué.');
      return result.text || result.response || 'Réponse IA reçue';
    }
    if (type !== 'action') return `Nœud "${node.label}" exécuté`;

    const actionType = String(config.actionType || config.kind || 'shell').toLowerCase();
    if (actionType === 'read_file') return readProjectFile(projectPath, interpolate(config.filename || config.path || config.command, previous, results));
    if (actionType === 'write_file') {
      return writeProjectFile(
        projectPath,
        interpolate(config.filename || config.path || 'workflow-output.txt', previous, results),
        interpolate(config.content ?? config.command ?? previous, previous, results)
      );
    }
    if (actionType === 'http' || actionType === 'webhook') {
      return requestHttp({ ...config, url: interpolate(config.url || config.command, previous, results), body: config.body === undefined ? undefined : interpolate(config.body, previous, results) }, controller);
    }

    const command = interpolate(config.command, previous, results);
    if (!command) return 'Aucune commande spécifiée';
    await ensureTerminalPermission();
    const spawnRequest = buildSafeSpawnRequest(command, []);
    const approved = await requestTerminalApproval(spawnRequest.normalizedCommandLine);
    if (!approved) throw new Error('Commande refusée par l’utilisateur.');
    const result = await runCommandForTask(command, projectPath, 30_000);
    if (!result?.ok) throw new Error(truncate(result?.stderr || `Commande échouée (${result?.code ?? -1}).`));
    return truncate(result.stdout || `Commande terminée (code ${result.code}).`);
  };

  const start = async (projectPath, workflowPayload) => {
    const trustedProjectPath = await ensureTrustedProjectPath(projectPath);
    const { workflow } = sanitizeVisualWorkflowPayload(workflowPayload, { strict: true });
    const settings = await readSettingsSafe();
    const run = {
      id: `wf_${crypto.randomUUID()}`,
      workflowName: workflow.name,
      projectPath: trustedProjectPath,
      status: 'running',
      startedAt: now(),
      completedAt: null,
      durationMs: null,
      nodes: [],
      logs: [],
      error: null
    };
    await persist(run);
    if (settings.permissionMode === 'read_only') {
      run.status = 'rejected';
      run.error = 'Le mode permissions lecture seule interdit l’exécution d’un workflow.';
      run.completedAt = now();
      run.durationMs = 0;
      await addLog(run, null, 'error', run.error);
      send('workflow-run-progress', { runId: run.id, status: run.status, workflowName: run.workflowName });
      return { success: false, runId: run.id, status: run.status, error: run.error };
    }

    const controller = new AbortController();
    activeRuns.set(run.id, { controller, run });
    const startedMs = Date.now();
    try {
      const sorted = topoSort(workflow.nodes, workflow.edges);
      await addLog(run, null, 'info', 'Démarrage du workflow côté backend.');
      send('workflow-run-progress', { runId: run.id, status: run.status, workflowName: run.workflowName });
      const results = {};
      let previous = '';
      for (const nodeId of sorted) {
        assertNotStopped(controller);
        const node = workflow.nodes.find((candidate) => candidate.id === nodeId);
        const nodeRun = { nodeId: node.id, label: node.label, status: 'running', startedAt: now(), completedAt: null, result: null, error: null };
        run.nodes.push(nodeRun);
        await addLog(run, node.id, 'info', `Exécution: ${node.label}`);
        send('workflow-run-progress', { runId: run.id, status: 'running', nodeId: node.id, nodeStatus: 'running', workflowName: run.workflowName });
        try {
          const result = await executeNode({ node, projectPath: trustedProjectPath, previous, results, controller });
          nodeRun.status = 'success';
          nodeRun.result = truncate(result);
          nodeRun.completedAt = now();
          results[node.id] = result;
          previous = result;
          await addLog(run, node.id, 'success', `Terminé: ${result}`);
          send('workflow-run-progress', { runId: run.id, status: 'running', nodeId: node.id, nodeStatus: 'success', result: truncate(result), workflowName: run.workflowName });
        } catch (error) {
          nodeRun.status = controller.signal.aborted ? 'stopped' : 'error';
          nodeRun.error = controller.signal.aborted ? 'Workflow arrêté.' : truncate(error.message || error);
          nodeRun.completedAt = now();
          run.status = controller.signal.aborted ? 'stopped' : 'failed';
          run.error = nodeRun.error;
          await addLog(run, node.id, 'error', nodeRun.error);
          send('workflow-run-progress', { runId: run.id, status: run.status, nodeId: node.id, nodeStatus: nodeRun.status, error: nodeRun.error, workflowName: run.workflowName });
          break;
        }
      }
      if (run.status === 'running') {
        run.status = 'completed';
        await addLog(run, null, 'success', 'Workflow terminé côté backend.');
      }
    } catch (error) {
      run.status = controller.signal.aborted ? 'stopped' : 'failed';
      run.error = controller.signal.aborted ? 'Workflow arrêté.' : truncate(error.message || error);
      await addLog(run, null, 'error', run.error);
    } finally {
      run.completedAt = now();
      run.durationMs = Math.max(0, Date.now() - startedMs);
      await persist(run);
      activeRuns.delete(run.id);
      send('workflow-run-progress', { runId: run.id, status: run.status, workflowName: run.workflowName, durationMs: run.durationMs });
    }
    return { success: run.status === 'completed', runId: run.id, status: run.status, error: run.error || null };
  };

  const stop = async (runId) => {
    const active = activeRuns.get(String(runId || ''));
    if (!active) return { success: false, error: 'Workflow introuvable ou déjà terminé.' };
    active.controller.abort();
    return { success: true, runId: active.run.id, status: 'stopping' };
  };

  const list = async (projectPath) => {
    const trustedProjectPath = projectPath ? await ensureTrustedProjectPath(projectPath) : null;
    let files = [];
    try { files = await fs.readdir(runsDir()); } catch { return { success: true, runs: [] }; }
    const runs = [];
    for (const file of files.filter((entry) => /^wf_[a-f0-9-]+\.json$/i.test(entry)).slice(-MAX_RUNS).reverse()) {
      try {
        const run = JSON.parse(await fs.readFile(path.join(runsDir(), file), 'utf8'));
        if (!trustedProjectPath || run.projectPath === trustedProjectPath) runs.push(run);
      } catch { /* ignore corrupt history entries */ }
    }
    return { success: true, runs };
  };

  const get = async (runId, projectPath) => {
    const trustedProjectPath = await ensureTrustedProjectPath(projectPath);
    if (!/^wf_[a-f0-9-]+$/i.test(String(runId || ''))) return { success: false, error: 'Identifiant de workflow invalide.' };
    const run = JSON.parse(await fs.readFile(runPath(runId), 'utf8'));
    if (run.projectPath !== trustedProjectPath) return { success: false, error: 'Workflow introuvable.' };
    return { success: true, run };
  };

  return { start, stop, list, get };
};

module.exports = {
  createWorkflowEngine,
  evaluateCondition,
  interpolate,
  topoSort
};
