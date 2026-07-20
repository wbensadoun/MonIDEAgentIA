import {
  assertProviderAllowedByPolicy,
  estimateCapabilityCost,
  getModelCapabilities
} from './modelCapabilities';

describe('modelCapabilities', () => {
  test('marks Ollama as local and zero cost', () => {
    const capabilities = getModelCapabilities({ provider: 'ollama', model: 'qwen3:latest' });
    expect(capabilities.local).toBe(true);
    expect(capabilities.endpointType).toBe('local');
    expect(estimateCapabilityCost({ provider: 'ollama', inputTokens: 1000, outputTokens: 1000 })).toBe(0);
  });

  test('blocks cloud providers in local-only policy', () => {
    const gemini = assertProviderAllowedByPolicy({ provider: 'gemini', localOnly: true });
    const ollama = assertProviderAllowedByPolicy({ provider: 'ollama', localOnly: true });
    expect(gemini.allowed).toBe(false);
    expect(ollama.allowed).toBe(true);
  });
});
