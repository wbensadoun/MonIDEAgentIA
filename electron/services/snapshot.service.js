'use strict';

const path = require('path');
const fs = require('fs').promises;
const { ensureTrustedProjectPath, assertSafePath } = require('../core/security');
const { ensureEditPermission } = require('./settings.service');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
    if (error && error.code === 'ENOENT') return { exists: false, content: '' };
    throw error;
  }
};

// ---------------------------------------------------------------------------
// createAISnapshot
// ---------------------------------------------------------------------------

const createAISnapshot = async (projectPath, files = [], label = 'ai') => {
  if (!projectPath) return { success: false, error: 'Chemin projet manquant' };
  const trustedProjectPath = await ensureTrustedProjectPath(projectPath);
  if (!Array.isArray(files) || files.length === 0) {
    return { success: false, error: 'Aucun fichier fourni pour le snapshot' };
  }

  const snapshotDir = getSnapshotDir(trustedProjectPath);
  await fs.mkdir(snapshotDir, { recursive: true });

  const snapshotId = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  const normalizedFiles = Array.from(new Set(
    files.map((f) => toRelativeSnapshotPath(f)).filter(Boolean)
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
};

// ---------------------------------------------------------------------------
// listAISnapshots
// ---------------------------------------------------------------------------

const listAISnapshots = async (projectPath) => {
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
      // ignore malformed snapshot file
    }
  }

  snapshots.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  return { success: true, snapshots };
};

// ---------------------------------------------------------------------------
// restoreAISnapshot
// ---------------------------------------------------------------------------

const restoreAISnapshot = async (projectPath, snapshotId) => {
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
      try { await fs.unlink(fullPath); } catch { /* ignore */ }
      restored += 1;
      continue;
    }

    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, String(entry.content || ''), 'utf-8');
    restored += 1;
  }

  return { success: true, restored, snapshotId };
};

// ---------------------------------------------------------------------------
// Exports (helpers exported for agent.service reuse)
// ---------------------------------------------------------------------------

module.exports = {
  createAISnapshot,
  listAISnapshots,
  restoreAISnapshot,
  getSnapshotDir,
  toRelativeSnapshotPath,
  readTextFileIfExists,
};
