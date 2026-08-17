'use strict';

const path = require('path');
const fs = require('fs').promises;

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
  }
  return result;
};

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
  }

  static defaultFilePath(userDataPath) {
    if (!userDataPath) throw new Error('Le chemin userData Electron est requis.');
    return path.join(userDataPath, DEFAULT_VAULT_FILE);
  }

  async _load() {
    if (this.state) return this.state;
    if (!this.filePath) throw new Error('Le chemin du coffre est requis.');

    try {
      const raw = await this.fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== VAULT_VERSION || typeof parsed.secrets !== 'object') {
        throw new Error('Format du coffre de fournisseurs non supporté.');
      }
      this.state = { version: VAULT_VERSION, secrets: parsed.secrets };
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      this.state = { version: VAULT_VERSION, secrets: {} };
    }
    return this.state;
  }

  async _save() {
    const state = await this._load();
    const directory = path.dirname(this.filePath);
    await this.fs.mkdir(directory, { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await this.fs.writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    await this.fs.rename(temporaryPath, this.filePath);
  }

  async put(secretId, secretValue, metadata = {}) {
    const id = String(secretId || '').trim();
    if (!id) throw new Error('Identifiant de secret requis.');
    if (secretValue === undefined || secretValue === null || String(secretValue).trim() === '') {
      throw new Error('La valeur du secret ne peut pas être vide.');
    }
    const state = await this._load();
    const previous = state.secrets[id] || {};
    state.secrets[id] = {
      ...cloneMetadata(metadata),
      createdAt: previous.createdAt || this.now(),
      updatedAt: this.now(),
      status: 'active',
      ciphertext: toEncryptedValue(this.safeStorage, secretValue)
    };
    await this._save();
    return this.metadata(id);
  }

  async get(secretId) {
    const id = String(secretId || '').trim();
    const state = await this._load();
    const record = state.secrets[id];
    if (!record || record.status !== 'active') return null;
    return fromEncryptedValue(this.safeStorage, record.ciphertext);
  }

  async revoke(secretId) {
    const id = String(secretId || '').trim();
    const state = await this._load();
    const record = state.secrets[id];
    if (!record) return false;
    // Keep only a tombstone; a revoked credential must not remain recoverable.
    const timestamp = this.now();
    delete record.ciphertext;
    record.status = 'revoked';
    record.revokedAt = timestamp;
    record.updatedAt = timestamp;
    await this._save();
    return true;
  }

  async metadata(secretId) {
    const state = await this._load();
    const record = state.secrets[String(secretId || '').trim()];
    if (!record) return null;
    const { ciphertext, ...safeRecord } = record;
    return { id: String(secretId || '').trim(), ...safeRecord };
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
