'use strict';

const path = require('path');
const fs = require('fs').promises;
const { writeFileAtomically, withInterprocessFileLock } = require('./durable-file.service');

const CREDENTIAL_AUDIT_VERSION = 1;
const CREDENTIAL_AUDIT_OPERATIONS = new Set(['create', 'replace', 'revoke', 'rotate', 'connectivity']);
const CREDENTIAL_AUDIT_RESULT_CODES = new Set(['success', 'invalid_request', 'not_found', 'revoked', 'unavailable', 'unsupported', 'audit_unavailable', 'failed']);
const CREDENTIAL_ID_PATTERN = /^cred_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const bounded = (value, allowed, fallback) => allowed.has(value) ? value : fallback;

class ProviderCredentialAuditLedger {
  constructor({ filePath, fsImpl = fs, now = () => new Date().toISOString(), maxEvents = 1000, maxBytes = 1024 * 1024, maxRotations = 3 } = {}) {
    if (!filePath) throw new Error('Le chemin d’audit credential est requis.');
    if (!Number.isSafeInteger(maxEvents) || maxEvents <= 0) throw new Error('La limite d’événements d’audit credential doit être un entier positif.');
    this.filePath = filePath;
    this.fs = fsImpl;
    this.now = now;
    this.maxEvents = maxEvents;
    this.maxBytes = maxBytes;
    this.maxRotations = maxRotations;
    this.mutationQueue = Promise.resolve();
  }

  static defaultFilePath(userDataPath) {
    if (!userDataPath) throw new Error('Le chemin userData Electron est requis.');
    return path.join(userDataPath, 'provider-credential-audit.ndjson');
  }

  async append(event = {}) {
    return this._serializeMutation(async () => {
      return withInterprocessFileLock({ fsImpl: this.fs, filePath: this.filePath }, async () => this._appendLocked(event));
    });
  }

  async _appendLocked(event) {
      const operationId = String(event.operationId || '').trim();
      const credentialId = String(event.credentialId || '').trim();
      if (!operationId) throw new Error('Audit credential invalide.');
      const normalized = {
        version: CREDENTIAL_AUDIT_VERSION,
        recordedAt: this.now(),
        operationId: operationId.slice(0, 80),
        credentialId: CREDENTIAL_ID_PATTERN.test(credentialId) ? credentialId : 'unknown',
        operation: bounded(String(event.operation || ''), CREDENTIAL_AUDIT_OPERATIONS, 'connectivity'),
        resultCode: bounded(String(event.resultCode || ''), CREDENTIAL_AUDIT_RESULT_CODES, 'failed')
      };
      const line = `${JSON.stringify(normalized)}\n`;
      await this.fs.mkdir(path.dirname(this.filePath), { recursive: true });
      let lines = await this._readLines();
      const retainedEvents = this.maxEvents - 1;
      lines = retainedEvents === 0 ? [] : lines.slice(-retainedEvents);
      const content = `${lines.join('\n')}${lines.length ? '\n' : ''}${line}`;
      if (Buffer.byteLength(content, 'utf8') > this.maxBytes && lines.length > 0) {
        await this._rotate();
        await writeFileAtomically({ fsImpl: this.fs, filePath: this.filePath, content: line });
      } else {
        await writeFileAtomically({ fsImpl: this.fs, filePath: this.filePath, content });
      }
      return normalized;
  }

  _serializeMutation(operation) {
    const next = this.mutationQueue.then(operation, operation);
    this.mutationQueue = next.catch(() => {});
    return next;
  }

  async _readLines() {
    try {
      return (await this.fs.readFile(this.filePath, 'utf8')).split(/\r?\n/).filter(Boolean);
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
  }

  async _rotate() {
    for (let index = this.maxRotations; index >= 1; index -= 1) {
      const from = index === 1 ? this.filePath : `${this.filePath}.${index - 1}`;
      const to = `${this.filePath}.${index}`;
      try { await this.fs.rename(from, to); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    }
  }
}

module.exports = {
  CREDENTIAL_AUDIT_VERSION,
  CREDENTIAL_AUDIT_OPERATIONS,
  CREDENTIAL_AUDIT_RESULT_CODES,
  ProviderCredentialAuditLedger
};
