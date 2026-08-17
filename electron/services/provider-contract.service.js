'use strict';

const { normalizeCredentialProviderId, toRuntimeProviderId } = require('./provider-id.service');

// Contrat unique pour les fournisseurs IA. Les adaptateurs restent responsables
// du protocole HTTP/SDK propre au fournisseur; cette couche ne connait ni clé
// ni détail de modèle et standardise uniquement l'orchestration backend.
const PROVIDER_IDS = Object.freeze(['gemini', 'claude', 'openai', 'kimi', 'ollama', 'dashscope']);
const RUNTIME_UNSUPPORTED_PROVIDER_IDS = new Set(['azure', 'ollama-local']);

const isKnownProvider = (value) => PROVIDER_IDS.includes(toRuntimeProviderId(value) || String(value || '').trim().toLowerCase());

const createProviderError = (provider) => {
  const error = new Error(`Provider completion non pris en charge: ${provider || 'aucun'}`);
  error.code = 'PROVIDER_UNSUPPORTED';
  error.retryable = false;
  return error;
};

const toUsage = (usage) => {
  const source = usage && typeof usage === 'object' ? usage : {};
  const inputTokens = Number(source.inputTokens ?? source.input_tokens ?? source.prompt_tokens);
  const outputTokens = Number(source.outputTokens ?? source.output_tokens ?? source.completion_tokens);
  return {
    inputTokens: Number.isFinite(inputTokens) ? inputTokens : null,
    outputTokens: Number.isFinite(outputTokens) ? outputTokens : null,
    // Les tarifs sont variables selon le modèle et ne doivent pas être inventés.
    cost: Number.isFinite(Number(source.cost)) ? Number(source.cost) : null
  };
};

const normalizeResult = (result, provider, elapsedMs) => {
  const value = result && typeof result === 'object' ? result : { success: false, error: 'Réponse provider invalide.' };
  return {
    ...value,
    provider,
    usage: toUsage(value.usage),
    durationMs: elapsedMs
  };
};

const invokeWithTimeout = async (invoke, { timeoutMs = 0, signal } = {}) => {
  if (signal?.aborted) {
    const error = new Error('Generation annulee.');
    error.aborted = true;
    throw error;
  }
  if (!Number.isFinite(Number(timeoutMs)) || Number(timeoutMs) <= 0) return invoke(signal);
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener?.('abort', onAbort, { once: true });
  const timeoutError = new Error('Délai provider dépassé.');
  timeoutError.code = 'PROVIDER_TIMEOUT';
  timeoutError.retryable = true;
  let timer;
  try {
    return await Promise.race([
      invoke(controller.signal),
      new Promise((_, reject) => { timer = setTimeout(() => { reject(timeoutError); controller.abort(); }, Number(timeoutMs)); })
    ]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', onAbort);
  }
};

const createProviderContract = ({ adapters = {}, now = () => Date.now() } = {}) => {
  const getAdapter = (provider) => {
    const credentialProvider = normalizeCredentialProviderId(provider);
    if (RUNTIME_UNSUPPORTED_PROVIDER_IDS.has(credentialProvider)) throw createProviderError(provider);
    const normalized = toRuntimeProviderId(provider) || String(provider || '').trim().toLowerCase();
    if (!isKnownProvider(normalized) || !adapters[normalized]) throw createProviderError(provider);
    return { provider: normalized, adapter: adapters[normalized] };
  };

  const complete = async ({ provider, request = {}, options = {} } = {}) => {
    const { provider: normalized, adapter } = getAdapter(provider);
    if (typeof adapter.complete !== 'function') throw createProviderError(provider);
    const retries = Math.max(0, Math.min(2, Number(options.retryAttempts ?? 0) || 0));
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const startedAt = now();
      try {
        const result = await invokeWithTimeout(
          (signal) => adapter.complete({ ...request, options: { ...options, signal } }),
          { timeoutMs: options.timeoutMs, signal: options.signal }
        );
        const normalizedResult = normalizeResult(result, normalized, now() - startedAt);
        if (normalizedResult.success !== false) return normalizedResult;
        if (!normalizedResult.retryable || attempt === retries) {
          const fallback = String(options.fallbackProvider || '').trim().toLowerCase();
          // A managed credential is leased for the source provider only. A
          // fallback would otherwise forward it to a different adapter.
          const canFallback = options.credentialMode !== 'managed' && options.managedCredential == null;
          if (canFallback && options.allowProviderFallback === true && fallback && fallback !== normalized && isKnownProvider(fallback) && adapters[fallback]) {
            return complete({ provider: fallback, request, options: { ...options, allowProviderFallback: false } });
          }
          return normalizedResult;
        }
        lastError = Object.assign(new Error(normalizedResult.error || 'Erreur provider.'), normalizedResult);
      } catch (error) {
        if (options.signal?.aborted || error?.aborted || error?.code === 'ERR_CANCELED') {
          return normalizeResult({ success: false, aborted: true, error: 'Generation annulee.' }, normalized, now() - startedAt);
        }
        lastError = error;
        if (!error?.retryable || attempt === retries) break;
      }
    }
    const failure = normalizeResult({ success: false, error: lastError?.message || 'Erreur provider.', retryable: !!lastError?.retryable, errorCode: lastError?.code }, normalized, 0);
    const fallback = String(options.fallbackProvider || '').trim().toLowerCase();
    const canFallback = options.credentialMode !== 'managed' && options.managedCredential == null;
    if (canFallback && options.allowProviderFallback === true && fallback && fallback !== normalized && isKnownProvider(fallback) && adapters[fallback]) {
      return complete({ provider: fallback, request, options: { ...options, allowProviderFallback: false } });
    }
    return failure;
  };

  const health = async (provider, options = {}) => {
    const { provider: normalized, adapter } = getAdapter(provider);
    if (typeof adapter.health !== 'function') return { provider: normalized, healthy: false, reason: 'health-not-implemented' };
    try {
      const result = await invokeWithTimeout((signal) => adapter.health({ ...options, signal }), options);
      return { provider: normalized, healthy: result?.healthy !== false, ...(result || {}) };
    } catch (error) {
      return { provider: normalized, healthy: false, reason: error?.code || 'health-failed' };
    }
  };

  const capabilities = (provider) => {
    const { provider: normalized, adapter } = getAdapter(provider);
    return { provider: normalized, completion: true, streaming: !!adapter.stream, health: !!adapter.health, ...(adapter.capabilities || {}) };
  };

  const stream = async function* ({ provider, request = {}, options = {} } = {}) {
    const { provider: normalized, adapter } = getAdapter(provider);
    if (typeof adapter.stream !== 'function') throw createProviderError(provider);
    const source = await adapter.stream({ ...request, options });
    for await (const event of source) {
      if (options.signal?.aborted) {
        yield { token: '', done: true, aborted: true };
        return;
      }
      yield {
        token: typeof event?.token === 'string' ? event.token : '',
        done: event?.done === true,
        ...(event?.aborted === true ? { aborted: true } : {})
      };
    }
    // `provider` is intentionally not exposed in stream events: renderer shape is fixed.
    void normalized;
  };

  return { complete, stream, health, capabilities, providers: () => PROVIDER_IDS.slice() };
};

module.exports = { PROVIDER_IDS, isKnownProvider, createProviderError, createProviderContract, toUsage };
