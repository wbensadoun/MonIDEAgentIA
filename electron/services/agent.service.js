'use strict';

const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const crypto = require('crypto');
const { app } = require('electron');
const { ensureTrustedProjectPath, assertSafePath } = require('../core/security');
const { ensureEditPermission } = require('./settings.service');
const {
  toRelativeSnapshotPath,
  readTextFileIfExists,
} = require('./snapshot.service');

// ---------------------------------------------------------------------------
// Directory helpers
// ---------------------------------------------------------------------------

const getGlobalAgentsDir = () => path.join(app.getPath('userData'), 'agents');
const getWorkspaceAgentsDir = (projectPath) => path.join(projectPath, '.agent', 'agents');
const getGlobalSkillsDir = () => path.join(app.getPath('userData'), 'skills');
const getWorkspaceSkillsDir = (projectPath) => path.join(projectPath, '.agent', 'skills');
const getWorkspaceVisualWorkflowsDir = (projectPath) => path.join(projectPath, '.vibe-workflows');
const getGlobalWorkflowsDir = () => path.join(app.getPath('userData'), 'workflows');
const getWorkspaceWorkflowsDir = (projectPath) => path.join(projectPath, '.agent', 'workflows');

const getPackTargets = (projectPath) => ({
  globalWorkflows: getGlobalWorkflowsDir(),
  globalAgents: getGlobalAgentsDir(),
  globalSkills: getGlobalSkillsDir(),
  workspaceWorkflows: projectPath ? getWorkspaceWorkflowsDir(projectPath) : null,
  workspaceAgents: projectPath ? getWorkspaceAgentsDir(projectPath) : null,
  workspaceSkills: projectPath ? getWorkspaceSkillsDir(projectPath) : null,
  workspaceVisualWorkflows: projectPath ? getWorkspaceVisualWorkflowsDir(projectPath) : null
});

// ---------------------------------------------------------------------------
// Agent run helpers (pure)
// ---------------------------------------------------------------------------

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
  if (['pending', 'partial', 'accepted', 'rejected', 'applied', 'verified', 'failed', 'conflict', 'rolled_back'].includes(value)) return value;
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

// ---------------------------------------------------------------------------
// Agent run persistence
// ---------------------------------------------------------------------------

const getAgentRunPath = (projectPath, runId) => {
  const safeRunId = sanitizeAgentRunId(runId);
  if (!safeRunId) throw new Error('runId invalide');
  return path.join(getAgentRunProjectDir(projectPath), `${safeRunId}.json`);
};

// notifyFn: optional (type, run) => void — used to push IPC events without coupling to mainWindow
const writeAgentRun = async (projectPath, run, notifyFn = null) => {
  const normalized = normalizeAgentRunPayload(run);
  const dirPath = getAgentRunProjectDir(projectPath);
  await fs.mkdir(dirPath, { recursive: true });
  const filePath = getAgentRunPath(projectPath, normalized.id);
  assertSafePath(dirPath, filePath);
  await fs.writeFile(filePath, JSON.stringify(normalized, null, 2), 'utf-8');
  if (typeof notifyFn === 'function') {
    notifyFn('run-updated', normalized);
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
        pendingCount: run.changes.filter((c) => c.status === 'pending' || c.status === 'partial').length,
        verifiedCount: run.changes.filter((c) => c.status === 'verified').length,
        conflictCount: run.changes.filter((c) => c.status === 'conflict').length
      });
    } catch {
      // ignore malformed agent run files
    }
  }

  runs.sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || '')));
  return runs;
};

const updateAgentRunChange = async (projectPath, runId, changeId, updater, options = {}, notifyFn = null) => {
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
  await writeAgentRun(projectPath, updated, notifyFn);
  return updated;
};

// ---------------------------------------------------------------------------
// Agent run IPC service operations
// ---------------------------------------------------------------------------

const agentListRuns = async (projectPath) => {
  const trustedProjectPath = await ensureTrustedProjectPath(projectPath);
  const runs = await listAgentRunsForProject(trustedProjectPath);
  return { success: true, runs };
};

const agentGetRun = async (projectPath, runId) => {
  const trustedProjectPath = await ensureTrustedProjectPath(projectPath);
  const run = await readAgentRun(trustedProjectPath, runId);
  return { success: true, run };
};

const agentCreateRun = async (projectPath, payload = {}, notifyFn = null) => {
  const trustedProjectPath = await ensureTrustedProjectPath(projectPath);
  const run = normalizeAgentRunPayload(payload);
  await writeAgentRun(trustedProjectPath, run, notifyFn);
  return { success: true, run };
};

const agentUpdateRun = async (projectPath, runId, patch = {}, notifyFn = null) => {
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
  await writeAgentRun(trustedProjectPath, updated, notifyFn);
  return { success: true, run: updated };
};

const agentAppendLog = async (projectPath, runId, log = {}, notifyFn = null) => {
  const trustedProjectPath = await ensureTrustedProjectPath(projectPath);
  const run = await readAgentRun(trustedProjectPath, runId);
  run.logs = [...(Array.isArray(run.logs) ? run.logs : []), normalizeAgentLogEntry(log)];
  run.updatedAt = new Date().toISOString();
  await writeAgentRun(trustedProjectPath, run, notifyFn);
  return { success: true, run };
};

const agentUpdateChangeStatus = async (projectPath, runId, changeId, status, extra = {}, notifyFn = null) => {
  const trustedProjectPath = await ensureTrustedProjectPath(projectPath);
  const run = await updateAgentRunChange(trustedProjectPath, runId, changeId, (change) => ({
    ...change,
    ...(extra && typeof extra === 'object' ? extra : {}),
    status: normalizeAgentChangeStatus(status),
    updatedAt: new Date().toISOString()
  }), {}, notifyFn);
  return { success: true, run };
};

const agentApplyChange = async (projectPath, runId, changeId, notifyFn = null) => {
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
      log: { type: 'conflict', filePath: relPath, message: `Conflit detecte avant application: ${relPath}` }
    }, notifyFn);
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
      message: verified
        ? `Changement applique et relu: ${relPath}`
        : `Verification post-ecriture echouee: ${relPath}`
    }
  }, notifyFn);

  return { success: verified, verified, run: updatedRun, mtimeMs: Math.round(Number(stats?.mtimeMs || 0)), hash: nextHash };
};

const agentRejectChange = async (projectPath, runId, changeId, notifyFn = null) => {
  const trustedProjectPath = await ensureTrustedProjectPath(projectPath);
  const run = await updateAgentRunChange(trustedProjectPath, runId, changeId, (change) => ({
    ...change,
    status: 'rejected',
    rejectedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }), {
    log: { type: 'rejected', changeId, message: 'Changement IA rejete' }
  }, notifyFn);
  return { success: true, run };
};

const agentRestoreRun = async (projectPath, runId, notifyFn = null) => {
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
      try { await fs.unlink(fullPath); } catch { /* ignore missing files */ }
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
      normalizeAgentLogEntry({ type: 'rolled_back', message: `Run restaure (${restored} fichier(s))` })
    ]
  });
  await writeAgentRun(trustedProjectPath, restoredRun, notifyFn);
  return { success: true, restored, run: restoredRun };
};

// ---------------------------------------------------------------------------
// Agents & Skills CRUD
// ---------------------------------------------------------------------------

const parseSimpleFrontMatter = (content) => {
  const raw = String(content || '');
  const lines = raw.split('\n');
  if (!lines[0] || lines[0].trim() !== '---') return { meta: {}, body: raw };

  const meta = {};
  let endIndex = -1;
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (String(line || '').trim() === '---') { endIndex = i; break; }
    const match = String(line || '').match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    meta[key] = value;
  }

  const body = endIndex >= 0 ? lines.slice(endIndex + 1).join('\n').trim() : raw;
  return { meta, body };
};

const safeFileBase = (value) =>
  String(value || '').replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '-').trim();

const truncateTextForPrompt = (text, maxChars, suffix = '\n[...TRUNCATED...]') => {
  const raw = String(text || '');
  const limit = Math.max(0, Number(maxChars) || 0);
  if (!limit || raw.length <= limit) return raw;
  return raw.slice(0, limit) + suffix;
};

const listAgents = async (projectPath) => {
  const agents = [];

  const readAgentsFromDir = async (dir, scope) => {
    try {
      await fs.mkdir(dir, { recursive: true });
      const entries = await fs.readdir(dir);
      for (const file of entries) {
        if (!file.toLowerCase().endsWith('.md')) continue;
        const filePath = path.join(dir, file);
        let content = '';
        try { content = await fs.readFile(filePath, 'utf-8'); } catch { continue; }
        const { meta } = parseSimpleFrontMatter(content);
        const name = meta.name ? String(meta.name).trim() : file.replace(/\.md$/i, '');
        const description = meta.description ? String(meta.description).trim() : '';
        agents.push({ name, scope, description: description ? description.slice(0, 220) : '', path: filePath });
      }
    } catch { /* ignore */ }
  };

  await readAgentsFromDir(getGlobalAgentsDir(), 'global');
  if (projectPath) {
    const trustedProjectPath = await ensureTrustedProjectPath(projectPath);
    await readAgentsFromDir(getWorkspaceAgentsDir(trustedProjectPath), 'workspace');
  }

  agents.sort((a, b) => {
    if (a.scope !== b.scope) return a.scope === 'workspace' ? -1 : 1;
    return String(a.name).localeCompare(String(b.name));
  });
  return { success: true, agents };
};

const getAgent = async (name, scope, projectPath) => {
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
};

const saveAgent = async (name, content, scope, projectPath) => {
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
};

const deleteAgent = async (name, scope, projectPath) => {
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
};

const listSkills = async (projectPath) => {
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
        skills.push({ name, scope, hasSkillMd: exists, path: skillDir });
      }
    } catch { /* ignore */ }
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
};

const getSkill = async (name, scope, projectPath) => {
  const safeName = safeFileBase(name);
  if (!safeName) return { success: false, error: 'Nom skill invalide' };

  let dir;
  if (scope === 'global') dir = getGlobalSkillsDir();
  else if (scope === 'workspace' && projectPath) {
    const trustedProjectPath = await ensureTrustedProjectPath(projectPath);
    dir = getWorkspaceSkillsDir(trustedProjectPath);
  } else {
    return { success: false, error: 'Invalid scope or missing project path' };
  }

  const skillDir = path.join(dir, safeName);
  const skillFile = path.join(skillDir, 'SKILL.md');
  if (!fsSync.existsSync(skillFile)) {
    return { success: false, error: `SKILL.md introuvable pour le skill "${safeName}"` };
  }
  const content = await fs.readFile(skillFile, 'utf-8');
  return { success: true, skill: { name: safeName, scope, content, path: skillDir } };
};

// ---------------------------------------------------------------------------
// Completion helpers — used by AI stream handler to build context
// ---------------------------------------------------------------------------

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
        let summary = '';
        const yamlMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (yamlMatch) {
          summary = `---\n${yamlMatch[1]}\n---\n(Pour lire les détails complets de ce skill, utilisez un outil de style view_file ou fs.readFile sur le fichier : ${skillFile})`;
        } else {
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

// ---------------------------------------------------------------------------
// Library pack utilities (shared with handlers)
// ---------------------------------------------------------------------------

const collectFilesRecursive = async (dirPath, baseDir, fileList = []) => {
  let entries;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return fileList;
  }
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) { await collectFilesRecursive(fullPath, baseDir, fileList); continue; }
    if (!entry.isFile()) continue;
    const rel = path.relative(baseDir, fullPath).split(path.sep).join('/');
    fileList.push(rel);
  }
  return fileList;
};

const sanitizePackPath = (value) => {
  const normalized = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('..') || path.isAbsolute(normalized)) return null;
  return normalized;
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  // Directory helpers
  getGlobalAgentsDir,
  getWorkspaceAgentsDir,
  getGlobalSkillsDir,
  getWorkspaceSkillsDir,
  getWorkspaceVisualWorkflowsDir,
  getGlobalWorkflowsDir,
  getWorkspaceWorkflowsDir,
  getPackTargets,
  // Agent run helpers
  hashAgentContent,
  getAgentRunProjectDir,
  sanitizeAgentRunId,
  buildAgentRunId,
  normalizeAgentRunStatus,
  normalizeAgentChangeStatus,
  normalizeAgentLogEntry,
  normalizeAgentChangePayload,
  normalizeAgentRunPayload,
  writeAgentRun,
  readAgentRun,
  listAgentRunsForProject,
  updateAgentRunChange,
  // Agent run service operations
  agentListRuns,
  agentGetRun,
  agentCreateRun,
  agentUpdateRun,
  agentAppendLog,
  agentUpdateChangeStatus,
  agentApplyChange,
  agentRejectChange,
  agentRestoreRun,
  // Agents & Skills CRUD
  parseSimpleFrontMatter,
  safeFileBase,
  truncateTextForPrompt,
  listAgents,
  getAgent,
  saveAgent,
  deleteAgent,
  listSkills,
  getSkill,
  // Completion helpers
  loadAgentForCompletion,
  loadSkillForCompletion,
  loadAllGlobalSkillsForCompletion,
  formatAvailableSkillsListForPrompt,
  // Pack utilities
  collectFilesRecursive,
  sanitizePackPath,
};
