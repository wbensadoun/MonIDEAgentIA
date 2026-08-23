'use strict';

const path = require('path');
const fs = require('fs').promises;
const { randomUUID } = require('crypto');

const IDENTITY_FILE = 'neven-identity.v1.json';
const ENCRYPTED_VALUE_PREFIX = 'electron-safe-storage:v1:';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const getElectronSafeStorage = () => {
  try {
    return require('electron').safeStorage;
  } catch {
    return null;
  }
};

const normalizeWorkspaceId = (value) => {
  const workspaceId = String(value || '').trim();
  if (!UUID_PATTERN.test(workspaceId)) throw new Error('Workspace Neven invalide. Un UUID est requis.');
  return workspaceId.toLowerCase();
};

const canUseSafeStorage = (safeStorage) => safeStorage
  && typeof safeStorage.isEncryptionAvailable === 'function'
  && safeStorage.isEncryptionAvailable()
  && typeof safeStorage.encryptString === 'function'
  && typeof safeStorage.decryptString === 'function';

const encrypt = (safeStorage, value) => `${ENCRYPTED_VALUE_PREFIX}${Buffer.from(safeStorage.encryptString(String(value))).toString('base64')}`;
const decrypt = (safeStorage, value) => {
  const encoded = String(value || '');
  if (!encoded.startsWith(ENCRYPTED_VALUE_PREFIX)) return null;
  return safeStorage.decryptString(Buffer.from(encoded.slice(ENCRYPTED_VALUE_PREFIX.length), 'base64'));
};

const createNevenIdentityService = ({
  workspaceId = process.env.NEVEN_WORKSPACE_ID,
  userDataPath,
  safeStorage = getElectronSafeStorage(),
  fsImpl = fs,
  pathImpl = path,
  createDeviceId = randomUUID,
  isDevelopment = process.env.NODE_ENV === 'development' || process.env.ELECTRON_IS_DEV === '1',
  allowDevelopmentSessionEnv = process.env.NEVEN_DEV_SESSION_TOKEN_ENABLED === 'true',
  developmentSessionToken = process.env.NEVEN_DEV_SESSION_TOKEN
} = {}) => {
  let configuredWorkspaceId = null;
  try {
    configuredWorkspaceId = normalizeWorkspaceId(workspaceId);
  } catch {
    // A bad local configuration must deny Neven access, never reuse a project path.
  }
  const filePath = userDataPath ? pathImpl.join(userDataPath, IDENTITY_FILE) : null;
  const senderContexts = new Map();
  let stored = null;

  const load = async () => {
    if (stored) return stored;
    try {
      const parsed = JSON.parse(await fsImpl.readFile(filePath, 'utf8'));
      stored = parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      stored = {};
    }
    return stored;
  };
  const save = async () => {
    if (!filePath) return false;
    await fsImpl.mkdir(pathImpl.dirname(filePath), { recursive: true });
    await fsImpl.writeFile(filePath, JSON.stringify(stored), { encoding: 'utf8', mode: 0o600 });
    return true;
  };
  const readStoredValue = async (name) => {
    const state = await load();
    try {
      if (canUseSafeStorage(safeStorage)) return decrypt(safeStorage, state[`${name}Encrypted`]);
      // Plaintext persistence is intentionally development-only.
      return isDevelopment ? String(state[`${name}DevelopmentOnly`] || '') || null : null;
    } catch {
      return null;
    }
  };
  const storeValue = async (name, value) => {
    const state = await load();
    if (canUseSafeStorage(safeStorage)) {
      state[`${name}Encrypted`] = encrypt(safeStorage, value);
      delete state[`${name}DevelopmentOnly`];
    } else if (isDevelopment) {
      // This fallback exists only for local development where OS encryption is unavailable.
      state[`${name}DevelopmentOnly`] = String(value);
      delete state[`${name}Encrypted`];
    } else {
      return false;
    }
    return save();
  };
  const ensureDeviceId = async () => {
    let deviceId = await readStoredValue('deviceId');
    if (UUID_PATTERN.test(String(deviceId || ''))) return String(deviceId).toLowerCase();
    deviceId = createDeviceId();
    if (!UUID_PATTERN.test(String(deviceId || '')) || !(await storeValue('deviceId', deviceId))) return null;
    return String(deviceId).toLowerCase();
  };
  const bindSender = async (event) => {
    const sender = event?.sender;
    if (!sender?.id || !sender.session || !configuredWorkspaceId) return null;
    const deviceId = await ensureDeviceId();
    if (!deviceId) return null;
    const context = Object.freeze({ workspaceId: configuredWorkspaceId, deviceId });
    senderContexts.set(sender.id, context);
    return context;
  };

  return Object.freeze({
    workspaceId: configuredWorkspaceId,
    bindSender,
    resolveWorkspaceContext: async (event) => {
      const sender = event?.sender;
      if (!sender?.id || !sender.session) return null;
      return senderContexts.get(sender.id) || null;
    },
    // Enrollment is main-process-only. No IPC exposes this method.
    storeSessionToken: async (token) => {
      const value = String(token || '').trim();
      return value ? storeValue('sessionToken', value) : false;
    },
    resolveSessionToken: async () => {
      const persisted = await readStoredValue('sessionToken');
      if (persisted) return persisted;
      // Explicit opt-in for local development; production never reads session env vars.
      return isDevelopment && allowDevelopmentSessionEnv ? String(developmentSessionToken || '').trim() || null : null;
    }
  });
};

module.exports = { IDENTITY_FILE, UUID_PATTERN, normalizeWorkspaceId, createNevenIdentityService };
