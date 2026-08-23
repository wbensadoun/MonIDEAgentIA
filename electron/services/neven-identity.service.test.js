'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createNevenIdentityService, normalizeWorkspaceId } = require('./neven-identity.service');

const WORKSPACE_ID = '123e4567-e89b-42d3-a456-426614174000';
const DEVICE_ID = '123e4567-e89b-42d3-a456-426614174001';

const createMemoryFs = () => {
  const files = new Map();
  return {
    files,
    readFile: async (file) => {
      if (!files.has(file)) throw new Error('missing');
      return files.get(file);
    },
    mkdir: async () => {},
    writeFile: async (file, value) => { files.set(file, String(value)); }
  };
};

const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`encrypted:${value}`),
  decryptString: (value) => Buffer.from(value).toString().replace(/^encrypted:/, '')
};

test('identity uses only configured UUID and isolates main-derived sender contexts', async () => {
  const fsImpl = createMemoryFs();
  const identity = createNevenIdentityService({
    workspaceId: WORKSPACE_ID,
    userDataPath: '/user-data',
    fsImpl,
    safeStorage,
    createDeviceId: () => DEVICE_ID,
    isDevelopment: false
  });
  const one = await identity.bindSender({ sender: { id: 1, session: {} }, rendererPayload: { workspaceId: 'C:/forged/path', token: 'forged' } });
  const two = await identity.bindSender({ sender: { id: 2, session: {} }, rendererPayload: { workspaceId: 'forged-workspace' } });

  assert.deepEqual(one, { workspaceId: WORKSPACE_ID, deviceId: DEVICE_ID });
  assert.deepEqual(two, { workspaceId: WORKSPACE_ID, deviceId: DEVICE_ID });
  assert.notEqual(one, two);
  assert.equal(await identity.resolveWorkspaceContext({ sender: { id: 1, session: {} } }), one);
  assert.equal(await identity.resolveWorkspaceContext({ sender: { id: 3, session: {} } }), null);
  assert.equal(JSON.stringify(one).includes('forged'), false);
  assert.equal(JSON.stringify(one).includes('token'), false);
  assert.equal([...fsImpl.files.values()].join('\n').includes(DEVICE_ID), false);
});

test('identity refuses non-UUID workspace configuration and production plaintext fallback', async () => {
  assert.throws(() => normalizeWorkspaceId('C:/local/project'), /UUID/);
  const fsImpl = createMemoryFs();
  const identity = createNevenIdentityService({
    workspaceId: 'C:/local/project', userDataPath: '/user-data', fsImpl, safeStorage: null, isDevelopment: false
  });
  assert.equal(await identity.bindSender({ sender: { id: 1, session: {} } }), null);
  assert.equal(await identity.resolveSessionToken(), null);
  assert.equal(fsImpl.files.size, 0);
});

test('identity denies context deterministically when no userData file path is available', async () => {
  const identity = createNevenIdentityService({
    workspaceId: WORKSPACE_ID, userDataPath: null, safeStorage, createDeviceId: () => DEVICE_ID, isDevelopment: false
  });
  assert.equal(await identity.bindSender({ sender: { id: 1, session: {} } }), null);
  assert.equal(await identity.resolveWorkspaceContext({ sender: { id: 1, session: {} } }), null);
});

test('development session environment fallback requires an explicit development flag', async () => {
  const disabled = createNevenIdentityService({ isDevelopment: true, allowDevelopmentSessionEnv: false, developmentSessionToken: 'test-session-value' });
  const enabled = createNevenIdentityService({ isDevelopment: true, allowDevelopmentSessionEnv: true, developmentSessionToken: 'test-session-value' });
  const production = createNevenIdentityService({ isDevelopment: false, allowDevelopmentSessionEnv: true, developmentSessionToken: 'test-session-value' });
  assert.equal(await disabled.resolveSessionToken(), null);
  assert.equal(await enabled.resolveSessionToken(), 'test-session-value');
  assert.equal(await production.resolveSessionToken(), null);
});
