'use strict';

const path = require('path');
const fs = require('fs').promises;

const USAGE_LEDGER_VERSION = 0.1;
const USAGE_ORIGINS = new Set(['neven', 'byok', 'local']);

const asOptionalNumber = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
};

const safeIdentifier = (value, field) => {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > 200 || /[\r\n]/.test(normalized)) {
    throw new Error(`${field} invalide.`);
  }
  return normalized;
};

const normalizeUsageEvent = (event = {}, now = () => new Date().toISOString()) => {
  const origin = String(event.origin || '').trim().toLowerCase();
  if (!USAGE_ORIGINS.has(origin)) throw new Error('Origine d’usage invalide.');
  const providerId = safeIdentifier(event.providerId || origin, 'providerId');
  return {
    version: USAGE_LEDGER_VERSION,
    recordedAt: String(event.recordedAt || now()),
    workspaceId: safeIdentifier(event.workspaceId, 'workspaceId'),
    runId: event.runId ? safeIdentifier(event.runId, 'runId') : null,
    origin,
    providerId,
    inputTokens: asOptionalNumber(event.inputTokens),
    outputTokens: asOptionalNumber(event.outputTokens),
    durationMs: asOptionalNumber(event.durationMs),
    success: event.success === undefined ? null : Boolean(event.success)
  };
};

class ProviderUsageLedger {
  constructor({ filePath, fsImpl = fs, now = () => new Date().toISOString() } = {}) {
    if (!filePath) throw new Error('Le chemin du ledger d’usage est requis.');
    this.filePath = filePath;
    this.fs = fsImpl;
    this.now = now;
  }

  static defaultFilePath(userDataPath) {
    if (!userDataPath) throw new Error('Le chemin userData Electron est requis.');
    return path.join(userDataPath, 'provider-usage.ndjson');
  }

  async append(event) {
    const normalized = normalizeUsageEvent(event, this.now);
    await this.fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await this.fs.appendFile(this.filePath, `${JSON.stringify(normalized)}\n`, 'utf8');
    return normalized;
  }

  async readAll() {
    try {
      const raw = await this.fs.readFile(this.filePath, 'utf8');
      return raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
  }

  async summarizeByOrigin() {
    const events = await this.readAll();
    return events.reduce((summary, event) => {
      const origin = event.origin;
      if (!summary[origin]) summary[origin] = { requests: 0, inputTokens: 0, outputTokens: 0 };
      summary[origin].requests += 1;
      summary[origin].inputTokens += event.inputTokens || 0;
      summary[origin].outputTokens += event.outputTokens || 0;
      return summary;
    }, { neven: { requests: 0, inputTokens: 0, outputTokens: 0 }, byok: { requests: 0, inputTokens: 0, outputTokens: 0 }, local: { requests: 0, inputTokens: 0, outputTokens: 0 } });
  }
}

module.exports = {
  ProviderUsageLedger,
  USAGE_LEDGER_VERSION,
  USAGE_ORIGINS,
  normalizeUsageEvent
};
