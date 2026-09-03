'use strict';

const crypto = require('node:crypto');
const { normalizeCredentialProviderId } = require('./provider-id.service');

// Registration is deliberately separate from connectivity: unsupported providers remain manageable
// without accepting a renderer-controlled endpoint.
const PROVIDER_REGISTRY = Object.freeze(['anthropic', 'openai', 'google', 'kimi']);
const UNSUPPORTED_PROVIDER_IDS = Object.freeze(['azure', 'ollama-local']);
const PUBLIC_METADATA_FIELDS = Object.freeze([
  'id', 'provider', 'label', 'permissions', 'limits', 'createdAt', 'updatedAt',
  'lastUsedAt', 'maskedSuffix', 'status', 'revokedAt', 'version'
]);
const SENSITIVE_METADATA_KEY = /token|password|api[_-]?key|secret|credential|ciphertext|authorization/i;
const RESULT_CODES = Object.freeze({ success: 'success', invalid: 'invalid_request', notFound: 'not_found', revoked: 'revoked', unavailable: 'unavailable', unsupported: 'unsupported', failed: 'failed' });
const CREDENTIAL_ID_PATTERN = /^cred_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const normalizeProvider = (provider) => normalizeCredentialProviderId(provider);
const normalizeCredentialId = (credentialId) => {
  const id = String(credentialId || '').trim();
  return CREDENTIAL_ID_PATTERN.test(id) ? id : null;
};
const isKnownProvider = (provider) => [...PROVIDER_REGISTRY, ...UNSUPPORTED_PROVIDER_IDS].includes(normalizeProvider(provider));
const isUnsupportedProvider = (provider) => UNSUPPORTED_PROVIDER_IDS.includes(normalizeProvider(provider));
const hasSensitiveMetadata = (value) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).some((key) => SENSITIVE_METADATA_KEY.test(key));
const publicMetadata = (record = {}) => Object.fromEntries(PUBLIC_METADATA_FIELDS
  .filter((field) => record[field] !== undefined)
  .map((field) => [field, record[field]]));

const normalizeMetadata = ({ provider, label, permissions, limits } = {}) => {
  const normalizedProvider = normalizeProvider(provider);
  if (!isKnownProvider(normalizedProvider)) throw new Error('Provider credential invalide.');
  const normalizedLabel = String(label || '').trim();
  if (!normalizedLabel || normalizedLabel.length > 120) throw new Error('Label credential invalide.');
  if (!Array.isArray(permissions) || permissions.length > 20 || permissions.some((item) => typeof item !== 'string' || !item.trim() || item.length > 80)) {
    throw new Error('Permissions credential invalides.');
  }
  if (hasSensitiveMetadata(limits)) throw new Error('Métadonnées credential invalides.');
  if (limits !== undefined && (!limits || typeof limits !== 'object' || Array.isArray(limits))) throw new Error('Limites credential invalides.');
  const normalizedLimits = limits === undefined ? undefined : Object.fromEntries(Object.entries(limits).filter(([key, value]) => (
    ['maxRequestsPerMinute', 'maxRequestsPerDay'].includes(key) && Number.isSafeInteger(value) && value >= 0
  )));
  if (limits !== undefined && Object.keys(normalizedLimits).length !== Object.keys(limits).length) throw new Error('Limites credential invalides.');
  return { provider: normalizedProvider, label: normalizedLabel, permissions: [...new Set(permissions.map((item) => item.trim()))], ...(normalizedLimits ? { limits: normalizedLimits } : {}) };
};

class ProviderCredentialService {
  constructor({ vault, auditLedger, connectivityTester, now = () => new Date().toISOString(), createId = () => `cred_${crypto.randomUUID()}` } = {}) {
    if (!vault) throw new Error('Coffre credential requis.');
    this.vault = vault;
    this.auditLedger = auditLedger;
    this.connectivityTester = connectivityTester;
    this.now = now;
    this.createId = createId;
    this.mutationQueue = Promise.resolve();
  }

  async create({ workspaceId, secretValue, metadata } = {}) {
    return this._mutate('create', async (operationId) => {
      const safeMetadata = normalizeMetadata(metadata);
      const id = this.createId();
      if (!normalizeCredentialId(id)) throw new Error('Identifiant credential invalide.');
      const timestamp = this.now();
      const record = await this.vault.put(id, secretValue, {
        workspaceId: String(workspaceId || '').trim(), ...safeMetadata, createdAt: timestamp,
        updatedAt: timestamp, maskedSuffix: this._maskedSuffix(secretValue), version: 1
      });
      return this._finalizeMutation({ operation: 'create', operationId, credentialId: id, record, writtenVersion: record.version, restore: () => this.vault.removeIfVersion(id, record.version, record.previousCredentialId) });
    });
  }

  async replace({ workspaceId, credentialId, secretValue, metadata } = {}) {
    return this._mutate('replace', async (operationId) => {
      const current = await this._forWorkspace(workspaceId, credentialId);
      if (!current) return this._result('replace', credentialId, RESULT_CODES.notFound, operationId);
      if (current.status !== 'active') return this._result('replace', credentialId, RESULT_CODES.revoked, operationId);
      const safeMetadata = normalizeMetadata(metadata);
      const timestamp = this.now();
      const replaced = await this.vault.replaceActive(current.id, { expectedVersion: Number(current.version || 1), secretValue, metadata: {
        workspaceId: current.workspaceId, ...safeMetadata, createdAt: current.createdAt,
        updatedAt: timestamp, maskedSuffix: this._maskedSuffix(secretValue)
      } });
      if (replaced.outcome !== 'updated') return this._result('replace', current.id, replaced.outcome === 'not_found' ? RESULT_CODES.notFound : RESULT_CODES.revoked, operationId);
      return this._finalizeMutation({ operation: 'replace', operationId, credentialId: current.id, record: replaced.record, writtenVersion: replaced.writtenVersion, restore: () => this.vault.restoreIfVersion(current.id, replaced.snapshot, replaced.writtenVersion) });
    });
  }

  async rotate({ workspaceId, credentialId, secretValue } = {}) {
    return this._mutate('rotate', async (operationId) => {
      const current = await this._forWorkspace(workspaceId, credentialId);
      if (!current) return this._result('rotate', credentialId, RESULT_CODES.notFound, operationId);
      if (current.status !== 'active') return this._result('rotate', credentialId, RESULT_CODES.revoked, operationId);
      const timestamp = this.now();
      const rotated = await this.vault.replaceActive(current.id, { expectedVersion: Number(current.version || 1), secretValue, metadata: {
        workspaceId: current.workspaceId, provider: current.provider, label: current.label,
        permissions: current.permissions, ...(current.limits ? { limits: current.limits } : {}),
        createdAt: current.createdAt, updatedAt: timestamp, maskedSuffix: this._maskedSuffix(secretValue),
      } });
      if (rotated.outcome !== 'updated') return this._result('rotate', current.id, rotated.outcome === 'not_found' ? RESULT_CODES.notFound : RESULT_CODES.revoked, operationId);
      return this._finalizeMutation({ operation: 'rotate', operationId, credentialId: current.id, record: rotated.record, writtenVersion: rotated.writtenVersion, restore: () => this.vault.restoreIfVersion(current.id, rotated.snapshot, rotated.writtenVersion) });
    });
  }

  async revoke({ workspaceId, credentialId } = {}) {
    return this._mutate('revoke', async (operationId) => {
      const current = await this._forWorkspace(workspaceId, credentialId);
      if (!current) return this._result('revoke', credentialId, RESULT_CODES.notFound, operationId);
      if (current.status === 'revoked') return this._result('revoke', current.id, RESULT_CODES.revoked, operationId);
      let revoked = await this.vault.revokeActive(current.id, { expectedVersion: Number(current.version || 1) });
      if (revoked.outcome === 'conflict') {
        const fresh = await this.vault.metadataFresh(current.id);
        revoked = fresh?.status === 'active'
          ? await this.vault.revokeActive(current.id, { expectedVersion: Number(fresh.version || 1) })
          : { outcome: fresh ? 'revoked' : 'not_found' };
      }
      if (revoked.outcome !== 'updated') return this._result('revoke', current.id, revoked.outcome === 'not_found' ? RESULT_CODES.notFound : RESULT_CODES.revoked, operationId);
      return this._finalizeMutation({ operation: 'revoke', operationId, credentialId: current.id, record: revoked.record, writtenVersion: revoked.writtenVersion, compensateOnAuditFailure: false });
    });
  }

  async list({ workspaceId } = {}) {
    const scope = String(workspaceId || '').trim();
    const records = await this.vault.listMetadata();
    return records.filter((record) => record.workspaceId === scope).map(publicMetadata);
  }

  async connectivity({ workspaceId, credentialId } = {}) {
    let current;
    try {
      current = await this._forWorkspace(workspaceId, credentialId);
    } catch {
      return this._result('connectivity', credentialId, RESULT_CODES.unavailable);
    }
    if (!current) return this._result('connectivity', credentialId, RESULT_CODES.notFound);
    if (current.status !== 'active') return this._result('connectivity', current.id, RESULT_CODES.revoked);
    if (isUnsupportedProvider(current.provider)) return this._result('connectivity', current.id, RESULT_CODES.unsupported);
    if (typeof this.connectivityTester !== 'function') return this._result('connectivity', current.id, RESULT_CODES.unavailable);
    try {
      const fresh = await this.vault.withActiveSecret(current.id, async ({ id, record, secretValue, signal }) => this.connectivityTester({ credentialId: id, provider: record.provider, secretValue, signal }));
      if (fresh.outcome === 'not_found') return this._result('connectivity', current.id, RESULT_CODES.notFound);
      if (fresh.outcome !== 'active') return this._result('connectivity', current.id, RESULT_CODES.revoked);
      const tested = fresh.value;
      return this._result('connectivity', current.id, tested?.success === true
        ? RESULT_CODES.success
        : tested?.code === RESULT_CODES.unsupported ? RESULT_CODES.unsupported : RESULT_CODES.failed);
    } catch {
      return this._result('connectivity', current.id, RESULT_CODES.failed);
    }
  }

  async resolveActive({ workspaceId, provider } = {}) {
    try {
      const credentialId = await this.vault.findCredentialId({ workspaceId, provider });
      if (!normalizeCredentialId(credentialId)) return null;
      const current = await this._forWorkspace(workspaceId, credentialId);
      if (!current || current.status !== 'active' || isUnsupportedProvider(current.provider) || normalizeProvider(current.provider) !== normalizeProvider(provider)) return null;
      const used = await this.vault.getAndMarkUsed(credentialId, this.now());
      return used.credential ? { credentialId, credential: used.credential } : null;
    } catch {
      return null;
    }
  }

  async withActiveCredential({ workspaceId, provider } = {}, operation) {
    const credentialId = await this.vault.findCredentialId({ workspaceId, provider });
    if (!normalizeCredentialId(credentialId) || typeof operation !== 'function') return { outcome: 'not_found' };
    return this.vault.withActiveSecret(credentialId, async ({ id, record, secretValue, signal }) => {
      if (record.workspaceId !== String(workspaceId || '').trim()
        || isUnsupportedProvider(record.provider)
        || normalizeProvider(record.provider) !== normalizeProvider(provider)) return { outcome: 'revoked' };
      return operation({ credentialId: id, credential: secretValue, signal });
    });
  }

  async _forWorkspace(workspaceId, credentialId) {
    const id = normalizeCredentialId(credentialId);
    if (!id) return null;
    const current = await this.vault.metadata(id);
    return current?.workspaceId === String(workspaceId || '').trim() ? current : null;
  }

  async _finalizeMutation({ operation, operationId, credentialId, record, writtenVersion, restore, compensateOnAuditFailure = true }) {
    const auditFailure = await this._audit(operationId, operation, credentialId, RESULT_CODES.success);
    if (!auditFailure) return { success: true, operationId, credential: publicMetadata(record) };

    if (!compensateOnAuditFailure) {
      await this._audit(operationId, operation, credentialId, 'audit_unavailable');
      return auditFailure;
    }

    try {
      await restore(writtenVersion);
    } catch {
      await this._audit(operationId, operation, credentialId, RESULT_CODES.failed);
      return { success: false, operationId, credentialId: normalizeCredentialId(credentialId) || 'unknown', resultCode: RESULT_CODES.failed };
    }
    await this._audit(operationId, operation, credentialId, 'audit_unavailable');
    return auditFailure;
  }

  async _result(operation, credentialId, resultCode, operationId = crypto.randomUUID()) {
    const auditFailure = await this._audit(operationId, operation, credentialId, resultCode);
    if (auditFailure) return auditFailure;
    return { success: resultCode === RESULT_CODES.success, operationId, credentialId: normalizeCredentialId(credentialId) || 'unknown', resultCode };
  }

  async _audit(operationId, operation, credentialId, resultCode) {
    try {
      if (typeof this.auditLedger?.append !== 'function') throw new Error('Audit credential indisponible.');
      await this.auditLedger.append({ operationId, credentialId: normalizeCredentialId(credentialId) || 'unknown', operation, resultCode });
      return null;
    } catch {
      return { success: false, operationId, credentialId: normalizeCredentialId(credentialId) || 'unknown', resultCode: 'audit_unavailable' };
    }
  }

  _mutate(operation, work) {
    const run = async () => {
      const operationId = crypto.randomUUID();
      try { return await work(operationId); } catch {
        return this._result(operation, 'unknown', RESULT_CODES.invalid, operationId);
      }
    };
    const next = this.mutationQueue.then(run, run);
    this.mutationQueue = next.catch(() => {});
    return next;
  }

  _maskedSuffix(secretValue) {
    const value = String(secretValue || '');
    return value.length <= 4 ? '••••' : `••••${value.slice(-4)}`;
  }
}

module.exports = { PROVIDER_REGISTRY, UNSUPPORTED_PROVIDER_IDS, PUBLIC_METADATA_FIELDS, RESULT_CODES, CREDENTIAL_ID_PATTERN, ProviderCredentialService, isKnownProvider, isUnsupportedProvider, publicMetadata, normalizeCredentialId };
