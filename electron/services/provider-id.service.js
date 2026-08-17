'use strict';

const PROVIDER_ID_ALIASES = Object.freeze({
  anthropic: 'anthropic', claude: 'anthropic',
  google: 'google', gemini: 'google',
  openai: 'openai',
  azure: 'azure', 'azure-openai': 'azure', azureopenai: 'azure',
  ollama: 'ollama-local', 'ollama-local': 'ollama-local', local: 'ollama-local'
});
const normalizeCredentialProviderId = (provider) => PROVIDER_ID_ALIASES[String(provider || '').trim().toLowerCase()] || null;
const toRuntimeProviderId = (provider) => {
  const canonical = normalizeCredentialProviderId(provider);
  return canonical === 'anthropic' ? 'claude'
    : canonical === 'google' ? 'gemini'
      : canonical === 'ollama-local' ? 'ollama'
        : canonical;
};

module.exports = { PROVIDER_ID_ALIASES, normalizeCredentialProviderId, toRuntimeProviderId };
