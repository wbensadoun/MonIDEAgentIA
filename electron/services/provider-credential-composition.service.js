'use strict';

const https = require('node:https');
const { ProviderSecretVault } = require('./provider-secret-vault.service');
const { ProviderCredentialService } = require('./provider-credential.service');
const { ProviderCredentialAuditLedger } = require('./provider-credential-audit.service');

const CONNECTIVITY_TARGETS = Object.freeze({
  anthropic: { hostname: 'api.anthropic.com', path: '/v1/models', headers: (secretValue) => ({ 'x-api-key': secretValue, 'anthropic-version': '2023-06-01' }) },
  openai: { hostname: 'api.openai.com', path: '/v1/models', headers: (secretValue) => ({ authorization: `Bearer ${secretValue}` }) },
  google: { hostname: 'generativelanguage.googleapis.com', path: '/v1beta/models', headers: (secretValue) => ({ 'x-goog-api-key': secretValue }) }
});

const createBoundedConnectivityTester = ({ request = https.request, timeoutMs = 5000 } = {}) => async ({ provider, secretValue, signal }) => {
  const target = CONNECTIVITY_TARGETS[provider];
  if (!target || !secretValue) return { success: false, code: 'unsupported' };
  if (signal?.aborted) return { success: false, code: 'aborted' };
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => { if (!settled) { settled = true; resolve(result); } };
    const requestOptions = { protocol: 'https:', hostname: target.hostname, path: target.path, method: 'GET', headers: target.headers(secretValue), timeout: timeoutMs };
    let clientRequest;
    try {
      clientRequest = request(requestOptions, (response) => {
        response.resume();
        finish({ success: response.statusCode >= 200 && response.statusCode < 300, code: `http_${response.statusCode || 0}` });
      });
      clientRequest.once('timeout', () => { clientRequest.destroy(); finish({ success: false, code: 'timeout' }); });
      clientRequest.once('error', () => finish({ success: false, code: 'network_error' }));
      signal?.addEventListener?.('abort', () => { clientRequest.destroy(); finish({ success: false, code: 'aborted' }); }, { once: true });
      clientRequest.end();
    } catch {
      finish({ success: false, code: 'network_error' });
    }
  });
};

const createProviderCredentialComposition = ({ userDataPath, vault, auditLedger, connectivityTester } = {}) => {
  const resolvedVault = vault || new ProviderSecretVault({ filePath: ProviderSecretVault.defaultFilePath(userDataPath) });
  const resolvedAuditLedger = auditLedger || new ProviderCredentialAuditLedger({ filePath: ProviderCredentialAuditLedger.defaultFilePath(userDataPath) });
  const resolvedConnectivityTester = connectivityTester || createBoundedConnectivityTester();
  return {
    vault: resolvedVault,
    auditLedger: resolvedAuditLedger,
    connectivityTester: resolvedConnectivityTester,
    credentialService: new ProviderCredentialService({ vault: resolvedVault, auditLedger: resolvedAuditLedger, connectivityTester: resolvedConnectivityTester })
  };
};

module.exports = { CONNECTIVITY_TARGETS, createBoundedConnectivityTester, createProviderCredentialComposition };
