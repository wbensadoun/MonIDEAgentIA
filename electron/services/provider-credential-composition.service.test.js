'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createProviderCredentialComposition, createBoundedConnectivityTester } = require('./provider-credential-composition.service');

test('main credential composition injects the bounded connectivity tester without exposing a secret', async () => {
  const vault = {};
  const auditLedger = { append: async () => {} };
  const connectivityTester = async () => ({ success: false, code: 'network_error' });
  const composition = createProviderCredentialComposition({ vault, auditLedger, connectivityTester });
  assert.equal(composition.credentialService.vault, vault);
  assert.equal(composition.credentialService.auditLedger, auditLedger);
  assert.equal(composition.credentialService.connectivityTester, connectivityTester);

  for (const provider of ['azure', 'ollama']) {
    const unsupported = await createBoundedConnectivityTester()({ provider, secretValue: 'never-returned' });
    assert.deepEqual(unsupported, { success: false, code: 'unsupported' });
    assert.equal(JSON.stringify(unsupported).includes('never-returned'), false);
  }
});
