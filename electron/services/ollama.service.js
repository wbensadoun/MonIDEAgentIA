'use strict';

const os = require('os');
const path = require('path');
const fsSync = require('fs');
const axios = require('axios');
const { spawn } = require('child_process');
const { CANONICAL_QWEN_OLLAMA_MODEL, readSettingsSafe } = require('./settings.service');

// ─── Constants ───────────────────────────────────────────────────────────────

const OLLAMA_BASE_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const DEFAULT_OLLAMA_MODEL = CANONICAL_QWEN_OLLAMA_MODEL;
const OLLAMA_STREAM_RESPONSE_TIMEOUT_MS = Number(process.env.OLLAMA_STREAM_RESPONSE_TIMEOUT_MS) || 60000;
const OLLAMA_STREAM_INACTIVITY_TIMEOUT_MS = Number(process.env.OLLAMA_STREAM_INACTIVITY_TIMEOUT_MS) || 90000;
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

// ─── Private state ───────────────────────────────────────────────────────────

const activeOllamaPulls = new Set();
const OLLAMA_REGISTRY_CACHE = new Map();
const OLLAMA_REGISTRY_TTL_MS = 30 * 60 * 1000;
const OLLAMA_REGISTRY_HTTP = { timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0 (FuturIA)' } };

// ─── Low-level utilities ─────────────────────────────────────────────────────

const normalizeOllamaModelName = (value) => String(value || '').trim();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Families with explicit reasoning blocks. Keep `think` disabled by default for
// these models unless the user asks for it, otherwise CPU-only runs can appear
// stuck before producing a useful answer.
const OLLAMA_THINKING_FAMILIES = /(qwen3|deepseek-r1|qwq|magistral|cogito|granite3\.2)/i;
const computeOllamaThink = (model, thinkingMode) => {
  if (!OLLAMA_THINKING_FAMILIES.test(String(model || ''))) return undefined;
  return thinkingMode === true;
};

const stripThinkBlocks = (text) => {
  let out = String(text || '');
  out = out.replace(/<think>[\s\S]*?<\/think>/gi, '');
  out = out.replace(/<think>[\s\S]*$/i, '');
  return out.trim();
};

const fetchOllamaTags = async (baseUrl, timeout = null) => {
  const config = {};
  if (Number.isFinite(Number(timeout)) && Number(timeout) > 0) config.timeout = Number(timeout);
  return axios.get(`${baseUrl}/api/tags`, config);
};

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

// ─── GPU info (Windows wmic) ─────────────────────────────────────────────────

const readWindowsGpuInfo = () => new Promise((resolve) => {
  if (process.platform !== 'win32') { resolve([]); return; }
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
  child.on('error', () => { clearTimeout(timer); done([]); });
  child.on('close', () => {
    clearTimeout(timer);
    if (stderr && !stdout) { done([]); return; }
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

// ─── Process management ──────────────────────────────────────────────────────

const runProcessCapture = (executable, args = [], options = {}) => new Promise((resolve) => {
  const { timeoutMs: rawTimeoutMs, ...spawnOptions } = options || {};
  const child = spawn(executable, args, { windowsHide: true, shell: false, ...spawnOptions });
  let stdout = '';
  let stderr = '';
  let finished = false;
  const timeoutMs = Number(rawTimeoutMs) || 30000;
  const done = (payload) => {
    if (finished) return;
    finished = true;
    try { child.kill(); } catch { /* ignore */ }
    resolve({ stdout: stdout.slice(0, 8000), stderr: stderr.slice(0, 8000), ...payload });
  };
  const timer = setTimeout(() => done({ ok: false, code: -1, timedOut: true, error: 'Timeout' }), timeoutMs);
  child.stdout?.on('data', (data) => { stdout += String(data); });
  child.stderr?.on('data', (data) => { stderr += String(data); });
  child.on('error', (error) => { clearTimeout(timer); done({ ok: false, code: -1, error: error.message }); });
  child.on('close', (code) => { clearTimeout(timer); done({ ok: code === 0, code }); });
});

const getOllamaExecutableCandidates = () => {
  const candidates = [];
  if (process.env.OLLAMA_EXE) candidates.push(process.env.OLLAMA_EXE);
  if (process.platform === 'win32') {
    if (process.env.LOCALAPPDATA)
      candidates.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'Ollama', 'ollama.exe'));
    candidates.push(path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Ollama', 'ollama.exe'));
    if (process.env.ProgramFiles)
      candidates.push(path.join(process.env.ProgramFiles, 'Ollama', 'ollama.exe'));
  }
  candidates.push('ollama');
  return Array.from(new Set(candidates.filter(Boolean)));
};

const resolveOllamaExecutable = () => {
  const candidates = getOllamaExecutableCandidates();
  const fileCandidate = candidates.find((c) => path.isAbsolute(c) && fsSync.existsSync(c));
  return fileCandidate || 'ollama';
};

const isOllamaApiAvailable = async (timeout = 1600) => {
  try { await fetchOllamaTags(OLLAMA_BASE_URL, timeout); return true; } catch { return false; }
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
  if (await isOllamaApiAvailable()) return { success: true, alreadyRunning: true };
  const executable = resolveOllamaExecutable();
  let launchError = '';
  try {
    const child = spawn(executable, ['serve'], {
      detached: true, stdio: 'ignore', windowsHide: true, shell: false
    });
    child.once('error', (error) => { launchError = error.message; });
    child.unref();
  } catch (error) {
    return { success: false, error: `Ollama introuvable: ${error.message}` };
  }
  await sleep(300);
  if (launchError) return { success: false, error: `Ollama introuvable: ${launchError}` };
  const available = await waitForOllamaApi(9000);
  if (!available) {
    return {
      success: false,
      error: `Ollama ne repond pas sur ${OLLAMA_BASE_URL}. Installez Ollama ou lancez l'application Ollama.`
    };
  }
  return { success: true, alreadyRunning: false };
};

// ─── Model utilities ─────────────────────────────────────────────────────────

const extractOllamaModelNames = (tagsResponseData) => {
  const modelsRaw = Array.isArray(tagsResponseData?.models) ? tagsResponseData.models : [];
  return modelsRaw.map((model) => normalizeOllamaModelName(model?.name || model)).filter(Boolean);
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

const pickInstalledOllamaModel = (requestedModel, installedModels, preferredCandidates = []) => {
  const requested = normalizeOllamaModelName(requestedModel);
  const available = Array.isArray(installedModels)
    ? installedModels.map((name) => normalizeOllamaModelName(name)).filter(Boolean)
    : [];
  const availableSet = new Set(available);
  if (requested && availableSet.has(requested)) return requested;
  for (const candidate of preferredCandidates) {
    const normalizedCandidate = normalizeOllamaModelName(candidate);
    if (normalizedCandidate && availableSet.has(normalizedCandidate)) return normalizedCandidate;
  }
  const requestedBase = requested.includes(':') ? requested.split(':')[0] : requested;
  if (requestedBase) {
    const sameFamily = available.find((name) => name.startsWith(`${requestedBase}:`) || name === requestedBase);
    if (sameFamily) return sameFamily;
  }
  return available[0] || '';
};

// ─── Registry (dynamic catalogue) ────────────────────────────────────────────

const compareFamilyVersions = (a, b) => {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
};

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
  while ((m = linkRegex.exec(html)) !== null) found.add(m[1].toLowerCase());
  const baseRegex = new RegExp(`^${vendor}(\\d+(?:\\.\\d+)?)$`, 'i');
  const families = Array.from(found)
    .map((name) => { const match = baseRegex.exec(name); return match ? { name, version: match[1] } : null; })
    .filter(Boolean)
    .sort((a, b) => compareFamilyVersions(b.version, a.version));
  const result = { family: families[0]?.name || `${vendor}3`, allFamilies: families.map((f) => f.name) };
  return registryCacheSet(cacheKey, result);
};

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
    if (/^\d+(\.\d+)?b$/.test(tag)) sizes.add(tag);
  }
  const sorted = Array.from(sizes).sort((a, b) => parseSizeBillions(a) - parseSizeBillions(b));
  const result = { family: safeFamily, sizes: sorted };
  return registryCacheSet(cacheKey, result);
};

// ─── Size recommendation ──────────────────────────────────────────────────────

const parseSizeBillions = (tag) => {
  const match = /^(\d+(?:\.\d+)?)b$/i.exec(String(tag || '').trim());
  return match ? Number(match[1]) : null;
};

const OLLAMA_SIZE_FOOTPRINT_GB = {
  '0.6b': 1, '1.7b': 2, '4b': 4, '8b': 7, '14b': 11, '30b': 22, '32b': 24, '70b': 45, '235b': 140
};

const estimateOllamaFootprintGb = (tag) => {
  const key = String(tag || '').toLowerCase();
  if (OLLAMA_SIZE_FOOTPRINT_GB[key] != null) return OLLAMA_SIZE_FOOTPRINT_GB[key];
  const billions = parseSizeBillions(key);
  return billions != null ? Number((billions * 0.75).toFixed(1)) : null;
};

const recommendOllamaSize = (sizes, { vramGb = 0, totalGb = 0 } = {}) => {
  const candidates = (Array.isArray(sizes) ? sizes : [])
    .map((s) => ({ s, gb: estimateOllamaFootprintGb(s), b: parseSizeBillions(s) }))
    .filter((x) => x.gb != null && x.b != null)
    .sort((a, b) => a.b - b.b);
  if (candidates.length === 0) return null;
  const hasUsableGpu = Number(vramGb) >= 4;
  const fitBudgetGb = hasUsableGpu ? Number(vramGb) : Number(totalGb) * 0.6;
  const FLOOR_B = 4;
  const speedCapB = hasUsableGpu ? Infinity : (totalGb >= 32 ? 14 : totalGb >= 16 ? 8 : FLOOR_B);
  let best = null;
  for (const c of candidates) {
    if (c.gb <= fitBudgetGb && c.b <= speedCapB) best = c.s;
  }
  if (!best || parseSizeBillions(best) < FLOOR_B) {
    const floorFit = candidates.find((c) => c.b >= FLOOR_B && c.gb <= fitBudgetGb);
    best = (floorFit && floorFit.s) || best || candidates[candidates.length - 1].s;
  }
  return best;
};

// ─── Service operations ───────────────────────────────────────────────────────

const listOllamaModels = async () => {
  await startOllamaServerIfPossible();
  const response = await fetchOllamaTags(OLLAMA_BASE_URL, 5000);
  const models = (response.data?.models || []).map((m) => ({
    name: m.name, size: m.size, modified: m.modified_at
  }));
  return { success: true, models };
};

const resolveOllamaFamily = async (vendor, force) => {
  const safeVendor = String(vendor || 'qwen').trim().toLowerCase() || 'qwen';
  const result = await resolveOllamaFamilyFromRegistry(safeVendor, force === true);
  return { success: true, ...result };
};

const fetchOllamaLibrarySizes = async (family, force) => {
  const result = await fetchOllamaLibrarySizesFromRegistry(String(family || '').trim(), force === true);
  return { success: true, ...result };
};

const recommendOllamaSizeForRequest = async (payload = {}) => {
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
    } catch { /* GPU non lisible */ }
  }
  const recommended = recommendOllamaSize(sizes, { vramGb, totalGb });
  const hasUsableGpu = vramGb >= 4;
  return {
    success: true, recommended,
    totalGb: Number(totalGb.toFixed(1)),
    vramGb: Number(vramGb.toFixed(1)),
    basis: hasUsableGpu ? 'gpu' : 'cpu',
    consent: hasConsent
  };
};

const installOllama = async ({ openExternalFn } = {}) => {
  if (await isOllamaApiAvailable()) return { success: true, alreadyInstalled: true };
  if (process.platform !== 'win32') {
    await openExternalFn('https://ollama.com/download');
    return { success: true, openedDownload: true };
  }
  const wingetCheck = await runProcessCapture('winget', ['--version'], { timeoutMs: 10000 });
  if (!wingetCheck.ok) {
    await openExternalFn(OLLAMA_DOWNLOAD_URL);
    return { success: true, openedDownload: true, warning: 'winget indisponible' };
  }
  const install = await runProcessCapture('winget', [
    'install', '--id', 'Ollama.Ollama', '-e', '--source', 'winget',
    '--accept-package-agreements', '--accept-source-agreements'
  ], { timeoutMs: 10 * 60 * 1000 });
  if (!install.ok) {
    await openExternalFn(OLLAMA_DOWNLOAD_URL);
    return {
      success: true, openedDownload: true,
      warning: install.stderr || install.stdout || 'Installation winget echouee'
    };
  }
  const startResult = await startOllamaServerIfPossible();
  return {
    success: true, installed: true,
    started: !!startResult.success,
    warning: startResult.success ? '' : startResult.error
  };
};

const checkOllamaUpdates = async (modelNames = []) => {
  let configuredModels = extractConfiguredOllamaModels(modelNames);
  if (configuredModels.length === 0) {
    const settings = await readSettingsSafe();
    configuredModels = extractConfiguredOllamaModels([
      settings.ollamaModel
    ]);
  }
  if (configuredModels.length === 0) return { success: true, models: [] };
  try {
    await startOllamaServerIfPossible();
    const response = await fetchOllamaTags(OLLAMA_BASE_URL, 5000);
    const installedModels = extractOllamaModelNames(response?.data);
    return { success: true, models: buildOllamaUpdateStatuses(configuredModels, installedModels) };
  } catch (error) {
    const message = `Ollama non disponible: ${error.message}`;
    return { success: true, models: buildOllamaUpdateStatuses(configuredModels, [], message) };
  }
};

const pullOllamaModel = async (modelName, sendProgressFn = () => {}) => {
  const model = normalizeOllamaModelName(modelName);
  if (!model) return { success: false, error: 'Nom de modele Ollama invalide.' };
  if (activeOllamaPulls.has(model)) {
    return { success: false, error: `Un telechargement est deja en cours pour "${model}".` };
  }
  activeOllamaPulls.add(model);
  sendProgressFn({ status: 'starting', completed: 0, total: 0 });
  try {
    const startResult = await startOllamaServerIfPossible();
    if (!startResult.success) throw new Error(startResult.error || 'Ollama indisponible.');
    const response = await axios.post(`${OLLAMA_BASE_URL}/api/pull`, { model, stream: true }, {
      responseType: 'stream', timeout: 0
    });
    await new Promise((resolve, reject) => {
      let buffer = '';
      let settled = false;
      const safeResolve = () => { if (settled) return; settled = true; resolve(); };
      const safeReject = (error) => { if (settled) return; settled = true; reject(error); };
      const processLine = (line) => {
        const trimmed = String(line || '').trim();
        if (!trimmed) return;
        let payload;
        try { payload = JSON.parse(trimmed); } catch { return; }
        if (typeof payload.error === 'string' && payload.error.trim()) {
          sendProgressFn({ status: 'error', error: payload.error.trim() });
          safeReject(new Error(payload.error.trim()));
          return;
        }
        const completed = Number(payload.completed);
        const total = Number(payload.total);
        sendProgressFn({
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
      response.data.on('end', () => { if (buffer.trim()) processLine(buffer); safeResolve(); });
      response.data.on('error', (error) => safeReject(error));
    });
    sendProgressFn({ status: 'success', completed: 1, total: 1 });
    return { success: true, model };
  } catch (error) {
    const message = axios.isAxiosError(error) && error.response?.data?.error
      ? String(error.response.data.error)
      : String(error.message || error);
    sendProgressFn({ status: 'error', error: message });
    return { success: false, error: `Ollama pull (${model}): ${message}` };
  } finally {
    activeOllamaPulls.delete(model);
  }
};

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  // Constants (re-exported for main.js AI handlers)
  OLLAMA_BASE_URL,
  DEFAULT_OLLAMA_MODEL,
  OLLAMA_STREAM_RESPONSE_TIMEOUT_MS,
  OLLAMA_STREAM_INACTIVITY_TIMEOUT_MS,
  OLLAMA_DOWNLOAD_URL,
  FALLBACK_OLLAMA_MODEL_CANDIDATES,
  // Utilities (re-exported for main.js AI handlers)
  normalizeOllamaModelName,
  computeOllamaThink,
  stripThinkBlocks,
  fetchOllamaTags,
  startOllamaServerIfPossible,
  isOllamaApiAvailable,
  extractOllamaModelNames,
  pickInstalledOllamaModel,
  recommendOllamaSize,
  readWindowsGpuInfo,
  // Service operations
  listOllamaModels,
  resolveOllamaFamily,
  fetchOllamaLibrarySizes,
  recommendOllamaSizeForRequest,
  installOllama,
  checkOllamaUpdates,
  pullOllamaModel,
};
