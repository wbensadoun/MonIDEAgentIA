'use strict';

const path = require('path');
const fs = require('fs').promises;
const { writeFileAtomically, withInterprocessFileLock } = require('./durable-file.service');
const { normalizeCredentialProviderId } = require('./provider-id.service');

const VAULT_VERSION = 1;
const ENCRYPTED_VALUE_PREFIX = 'electron-safe-storage:v1:';
const DEFAULT_VAULT_FILE = 'provider-secrets.vault.json';

const getElectronSafeStorage = () => {
  try {
    // Keep Electron lazy so this service can be unit-tested without starting Electron.
    return require('electron').safeStorage;
  } catch {
    return null;
  }
};

const assertSafeStorageAvailable = (safeStorage) => {
  if (!safeStorage || typeof safeStorage.isEncryptionAvailable !== 'function') {
    throw new Error('Le coffre Electron safeStorage est indisponible.');
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Le chiffrement OS du coffre Electron n’est pas disponible.');
  }
};

const cloneMetadata = (metadata = {}) => {
  const result = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (key === 'ciphertext' || key === 'value' || key === 'secret') continue;
    if (value === undefined) continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) {
      result[key] = value;
    }
    if (key === 'permissions' && Array.isArray(value) && value.every((item) => typeof item === 'string')) {
      result[key] = [...value];
    }
    if (key === 'limits' && value && typeof value === 'object' && !Array.isArray(value)
      && Object.values(value).every((item) => Number.isSafeInteger(item) && item >= 0)) {
      result[key] = { ...value };
    }
  }
  return result;
};

const cloneState = (state) => JSON.parse(JSON.stringify(state));

const toEncryptedValue = (safeStorage, value) => {
  assertSafeStorageAvailable(safeStorage);
  if (typeof safeStorage.encryptString !== 'function') {
    throw new Error('Electron safeStorage.encryptString est indisponible.');
  }
  const encrypted = safeStorage.encryptString(String(value));
  return `${ENCRYPTED_VALUE_PREFIX}${Buffer.from(encrypted).toString('base64')}`;
};

const fromEncryptedValue = (safeStorage, encryptedValue) => {
  assertSafeStorageAvailable(safeStorage);
  if (typeof safeStorage.decryptString !== 'function') {
    throw new Error('Electron safeStorage.decryptString est indisponible.');
  }
  const value = String(encryptedValue || '');
  if (!value.startsWith(ENCRYPTED_VALUE_PREFIX)) {
    throw new Error('Valeur du coffre invalide ou non chiffrée.');
  }
  const encoded = value.slice(ENCRYPTED_VALUE_PREFIX.length);
  return safeStorage.decryptString(Buffer.from(encoded, 'base64'));
};

class ProviderSecretVault {
  constructor({
    filePath,
    safeStorage = getElectronSafeStorage(),
    fsImpl = fs,
    now = () => new Date().toISOString()
  } = {}) {
    this.filePath = filePath || null;
    this.safeStorage = safeStorage;
    this.fs = fsImpl;
    this.now = now;
    this.state = null;
    this.loadFailure = null;
    this.mutationQueue = Promise.resolve();
    this.activeLeases = new Map();
  }

  static defaultFilePath(userDataPath) {
    if (!userDataPath) throw new Error('Le chemin userData Electron est requis.');
    return path.join(userDataPath, DEFAULT_VAULT_FILE);
  }

  async _load({ fresh = false, lockHeld = false } = {}) {
    if (this.loadFailure) throw this.loadFailure;
    if (this.state && !fresh) return this.state;
    if (!this.filePath) throw new Error('Le chemin du coffre est requis.');

    if (!lockHeld) return this._withLock(() => this._load({ fresh, lockHeld: true }));

    try {
      const raw = await this.fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== VAULT_VERSION || typeof parsed.secrets !== 'object') {
        throw new Error('Format du coffre de fournisseurs non supporté.');
      }
      const hasIndex = parsed.credentialIndex && typeof parsed.credentialIndex === 'object' && !Array.isArray(parsed.credentialIndex);
      const candidate = { version: VAULT_VERSION, secrets: parsed.secrets, credentialIndex: hasIndex ? parsed.credentialIndex : {} };
      if (!hasIndex) {
        candidate.credentialIndex = this._buildCredentialIndex(candidate.secrets);
        await this._save(candidate);
      }
      this.state = candidate;
    } catch (error) {
      if (error?.code === 'ENOENT') this.state = { version: VAULT_VERSION, secrets: {}, credentialIndex: {} };
      else {
        this.state = null;
        this.loadFailure = error;
        throw error;
      }
    }
    return this.state;
  }

  async _save(state) {
    await writeFileAtomically({ fsImpl: this.fs, filePath: this.filePath, content: `${JSON.stringify(state, null, 2)}\n` });
  }

  async put(secretId, secretValue, metadata = {}) {
    return this._mutate(async (state) => {
      const id = String(secretId || '').trim();
      if (!id) throw new Error('Identifiant de secret requis.');
      if (secretValue === undefined || secretValue === null || String(secretValue).trim() === '') {
        throw new Error('La valeur du secret ne peut pas être vide.');
      }
      const candidate = cloneState(state);
      const previous = candidate.secrets[id] || {};
      if (previous.status === 'revoked') throw new Error('Un credential révoqué ne peut pas être réactivé.');
      if (candidate.secrets[id]) throw new Error('Le credential existe déjà.');
      candidate.secrets[id] = {
        ...cloneMetadata(metadata),
        createdAt: this.now(),
        updatedAt: this.now(),
        version: Number.isSafeInteger(metadata.version) ? metadata.version : 1,
        status: 'active',
        ciphertext: toEncryptedValue(this.safeStorage, secretValue)
      };
      const canonicalProvider = normalizeCredentialProviderId(metadata.provider);
      const previousCredentialId = metadata.workspaceId && canonicalProvider
        ? state.credentialIndex[this._credentialIndexKey(metadata.workspaceId, canonicalProvider)] || null
        : null;
      if (metadata.workspaceId && canonicalProvider) {
        candidate.credentialIndex[this._credentialIndexKey(metadata.workspaceId, canonicalProvider)] = id;
      }
      await this._save(candidate);
      this.state = candidate;
      const result = await this.metadata(id);
      Object.defineProperty(result, 'previousCredentialId', { value: previousCredentialId, enumerable: false });
      return result;
    });
  }

  async get(secretId) {
    return this._withLock(async () => {
      const state = await this._load({ fresh: true, lockHeld: true });
      const id = String(secretId || '').trim();
      const record = state.secrets[id];
      if (!record || record.status !== 'active') return null;
      return fromEncryptedValue(this.safeStorage, record.ciphertext);
    });
  }

  async revoke(secretId) {
    this._abortLeases(secretId);
    return this._mutate(async (state) => {
      const id = String(secretId || '').trim();
      const record = state.secrets[id];
      if (!record) return false;
      const candidate = cloneState(state);
      const candidateRecord = candidate.secrets[id];
      // Keep only a tombstone; a revoked credential must not remain recoverable.
      const timestamp = this.now();
      delete candidateRecord.ciphertext;
      candidateRecord.status = 'revoked';
      candidateRecord.version = Number(candidateRecord.version || 0) + 1;
      candidateRecord.revokedAt = timestamp;
      candidateRecord.updatedAt = timestamp;
      const indexKey = this._credentialIndexKey(candidateRecord.workspaceId, candidateRecord.provider);
      if (candidate.credentialIndex[indexKey] === id) delete candidate.credentialIndex[indexKey];
      await this._save(candidate);
      this.state = candidate;
      return true;
    });
  }

  async getAndMarkUsed(secretId, now = this.now()) {
    return this._mutate(async (state) => {
      const id = String(secretId || '').trim();
      const record = state.secrets[id];
      if (!record || record.status !== 'active') return { credential: null, limited: false };
      const candidate = cloneState(state);
      const usage = candidate.secrets[id].usage || {};
      const minute = String(now).slice(0, 16);
      const day = String(now).slice(0, 10);
      const minuteCount = usage.minute === minute ? Number(usage.minuteCount || 0) : 0;
      const dayCount = usage.day === day ? Number(usage.dayCount || 0) : 0;
      const limits = candidate.secrets[id].limits || {};
      if ((limits.maxRequestsPerMinute !== undefined && minuteCount >= limits.maxRequestsPerMinute)
        || (limits.maxRequestsPerDay !== undefined && dayCount >= limits.maxRequestsPerDay)) return { credential: null, limited: true };
      candidate.secrets[id].lastUsedAt = now;
      candidate.secrets[id].version = Number(candidate.secrets[id].version || 0) + 1;
      candidate.secrets[id].usage = { minute, minuteCount: minuteCount + 1, day, dayCount: dayCount + 1 };
      await this._save(candidate);
      this.state = candidate;
      return { credential: fromEncryptedValue(this.safeStorage, candidate.secrets[id].ciphertext), limited: false };
    });
  }

  async snapshot(secretId) {
    const id = String(secretId || '').trim();
    const state = await this._load();
    return {
      record: state.secrets[id] ? cloneState(state.secrets[id]) : null,
      credentialIndex: cloneState(state.credentialIndex)
    };
  }

  async replaceActive(secretId, { expectedVersion, secretValue, metadata = {} } = {}) {
    return this._mutate(async (state) => {
      const id = String(secretId || '').trim();
      const current = state.secrets[id];
      if (!current) return { outcome: 'not_found' };
      if (current.status !== 'active') return { outcome: 'revoked' };
      if (!Number.isSafeInteger(expectedVersion) || Number(current.version || 1) !== expectedVersion) return { outcome: 'conflict' };
      if (secretValue === undefined || secretValue === null || String(secretValue).trim() === '') throw new Error('La valeur du secret ne peut pas être vide.');
      const snapshot = { record: cloneState(current), credentialIndex: cloneState(state.credentialIndex) };
      const candidate = cloneState(state);
      for (const [indexKey, credentialId] of Object.entries(candidate.credentialIndex)) {
        if (credentialId === id) delete candidate.credentialIndex[indexKey];
      }
      candidate.secrets[id] = {
        ...cloneMetadata(metadata),
        createdAt: current.createdAt,
        updatedAt: this.now(),
        version: expectedVersion + 1,
        status: 'active',
        ciphertext: toEncryptedValue(this.safeStorage, secretValue)
      };
      const canonicalProvider = normalizeCredentialProviderId(metadata.provider);
      if (metadata.workspaceId && canonicalProvider) candidate.credentialIndex[this._credentialIndexKey(metadata.workspaceId, canonicalProvider)] = id;
      await this._save(candidate);
      this.state = candidate;
      return { outcome: 'updated', snapshot, writtenVersion: candidate.secrets[id].version, record: await this.metadata(id) };
    });
  }

  async revokeActive(secretId, { expectedVersion } = {}) {
    this._abortLeases(secretId);
    return this._mutate(async (state) => {
      const id = String(secretId || '').trim();
      const current = state.secrets[id];
      if (!current) return { outcome: 'not_found' };
      if (current.status !== 'active') return { outcome: 'revoked' };
      if (!Number.isSafeInteger(expectedVersion) || Number(current.version || 1) !== expectedVersion) return { outcome: 'conflict' };
      const snapshot = { record: cloneState(current), credentialIndex: cloneState(state.credentialIndex) };
      const candidate = cloneState(state);
      const record = candidate.secrets[id];
      delete record.ciphertext;
      record.status = 'revoked';
      record.revokedAt = this.now();
      record.updatedAt = record.revokedAt;
      record.version = expectedVersion + 1;
      const indexKey = this._credentialIndexKey(record.workspaceId, record.provider);
      if (candidate.credentialIndex[indexKey] === id) delete candidate.credentialIndex[indexKey];
      await this._save(candidate);
      this.state = candidate;
      return { outcome: 'updated', snapshot, writtenVersion: record.version, record: await this.metadata(id) };
    });
  }

  async restore(secretId, snapshot, { expectedVersion } = {}) {
    return this.restoreIfVersion(secretId, snapshot, expectedVersion);
  }

  async restoreIfVersion(secretId, snapshot, expectedVersion) {
    return this._mutate(async (state) => {
      const id = String(secretId || '').trim();
      const current = state.secrets[id];
      if (!Number.isSafeInteger(expectedVersion) || !current || Number(current.version || 1) !== expectedVersion) return false;
      const candidate = cloneState(state);
      const snapshotIndexKey = snapshot?.record
        ? this._credentialIndexKey(snapshot.record.workspaceId, snapshot.record.provider)
        : null;
      const currentIndexValue = snapshotIndexKey ? candidate.credentialIndex[snapshotIndexKey] : undefined;
      for (const [indexKey, credentialId] of Object.entries(candidate.credentialIndex)) {
        if (credentialId === id) delete candidate.credentialIndex[indexKey];
      }
      if (snapshot?.record) candidate.secrets[id] = cloneState(snapshot.record);
      else delete candidate.secrets[id];
      if (snapshot?.record?.status === 'active') {
        if (currentIndexValue === id || currentIndexValue === undefined) {
          const previousCredentialId = snapshot.credentialIndex?.[snapshotIndexKey];
          if (previousCredentialId) candidate.credentialIndex[snapshotIndexKey] = previousCredentialId;
        }
      }
      await this._save(candidate);
      this.state = candidate;
      return true;
    });
  }

  async removeIfVersion(secretId, expectedVersion, previousCredentialId = null) {
    return this._mutate(async (state) => {
      const id = String(secretId || '').trim();
      const current = state.secrets[id];
      if (!Number.isSafeInteger(expectedVersion) || !current || Number(current.version || 1) !== expectedVersion) return false;
      const candidate = cloneState(state);
      const indexKey = this._credentialIndexKey(current.workspaceId, current.provider);
      delete candidate.secrets[id];
      for (const [indexKey, credentialId] of Object.entries(candidate.credentialIndex)) {
        if (credentialId === id) delete candidate.credentialIndex[indexKey];
      }
      if (previousCredentialId && state.credentialIndex[indexKey] === id) candidate.credentialIndex[indexKey] = previousCredentialId;
      await this._save(candidate);
      this.state = candidate;
      return true;
    });
  }

  async withActiveSecret(secretId, operation) {
    const id = String(secretId || '').trim();
    const controller = new AbortController();
    this._registerLease(id, controller);
    try {
      // Only the validation/decryption and lease registration happen under the
      // inter-process lock. Network I/O must never block revocation.
      const prepared = await this._serializeMutation(() => this._withLock(async () => {
        const state = await this._load({ fresh: true, lockHeld: true });
        const record = state.secrets[id];
        if (!record) return { outcome: 'not_found' };
        if (controller.signal.aborted || record.status !== 'active') return { outcome: 'revoked' };
        return { outcome: 'active', record: cloneState(record), secretValue: fromEncryptedValue(this.safeStorage, record.ciphertext) };
      }));
      if (prepared.outcome !== 'active' || controller.signal.aborted) return { outcome: 'revoked' };
      return { outcome: 'active', value: await operation({ id, record: prepared.record, secretValue: prepared.secretValue, signal: controller.signal }) };
    } finally {
      this._releaseLease(id, controller);
    }
  }

  _registerLease(secretId, controller) {
    if (!secretId) return;
    const leases = this.activeLeases.get(secretId) || new Set();
    leases.add(controller);
    this.activeLeases.set(secretId, leases);
  }

  _releaseLease(secretId, controller) {
    const leases = this.activeLeases.get(secretId);
    if (!leases) return;
    leases.delete(controller);
    if (leases.size === 0) this.activeLeases.delete(secretId);
  }

  _abortLeases(secretId) {
    for (const controller of this.activeLeases.get(String(secretId || '').trim()) || []) controller.abort();
  }

  async metadataFresh(secretId) {
    return this._withLock(async () => {
      const state = await this._load({ fresh: true, lockHeld: true });
      const id = String(secretId || '').trim();
      const record = state.secrets[id];
      if (!record) return null;
      const { ciphertext, ...safeRecord } = record;
      return { id, ...safeRecord };
    });
  }

  _serializeMutation(operation) {
    const next = this.mutationQueue.then(operation, operation);
    this.mutationQueue = next.catch(() => {});
    return next;
  }

  _withLock(operation) {
    return withInterprocessFileLock({ fsImpl: this.fs, filePath: this.filePath }, operation);
  }

  _mutate(operation) {
    return this._serializeMutation(() => this._withLock(async () => operation(await this._load({ fresh: true, lockHeld: true }))));
  }

  async metadata(secretId) {
    const state = await this._load();
    const record = state.secrets[String(secretId || '').trim()];
    if (!record) return null;
    const { ciphertext, ...safeRecord } = record;
    return { id: String(secretId || '').trim(), ...safeRecord };
  }

  async findCredentialId({ workspaceId, provider } = {}) {
    const state = await this._load();
    return state.credentialIndex[this._credentialIndexKey(workspaceId, provider)] || null;
  }

  _credentialIndexKey(workspaceId, provider) {
    return JSON.stringify([String(workspaceId || '').trim(), normalizeCredentialProviderId(provider) || String(provider || '').trim().toLowerCase()]);
  }

  _buildCredentialIndex(secrets) {
    return Object.entries(secrets).reduce((index, [id, record]) => {
      const provider = normalizeCredentialProviderId(record?.provider);
      if (!provider || record?.status !== 'active' || !record?.workspaceId) return index;
      const key = this._credentialIndexKey(record.workspaceId, provider);
      const current = secrets[index[key]];
      if (!current || String(record.updatedAt || '') >= String(current.updatedAt || '')) index[key] = id;
      return index;
    }, {});
  }

  async listMetadata() {
    const state = await this._load();
    return Object.keys(state.secrets).map((id) => {
      const { ciphertext, ...safeRecord } = state.secrets[id];
      return { id, ...safeRecord };
    });
  }
}

module.exports = {
  ENCRYPTED_VALUE_PREFIX,
  VAULT_VERSION,
  ProviderSecretVault,
  assertSafeStorageAvailable,
  getElectronSafeStorage
};
