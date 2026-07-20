import { buildSingleAIInvocation, normalizeSingleAIProvider } from './aiProviderRouting';

describe('aiProviderRouting', () => {
  test('normalizes only explicit single-provider routes', () => {
    expect(normalizeSingleAIProvider('gemini')).toBe('gemini');
    expect(normalizeSingleAIProvider('claude')).toBe('claude');
    expect(normalizeSingleAIProvider('kimi')).toBe('kimi');
    expect(normalizeSingleAIProvider('ollama')).toBe('ollama');
    expect(normalizeSingleAIProvider('ollama-multi')).toBe('ollama');
    expect(normalizeSingleAIProvider('multi')).toBe('');
    expect(normalizeSingleAIProvider('custom')).toBe('');
  });

  test('routes ollama-multi single actions to the coder Ollama model', () => {
    const request = buildSingleAIInvocation({
      aiProvider: 'ollama-multi',
      models: {
        ollamaModel: 'qwen2.5-coder:7b',
        ollamaModelCoder: 'deepseek-coder:6.7b'
      },
      projectPath: 'C:/demo'
    });

    expect(request.disabled).toBe(false);
    expect(request.provider).toBe('ollama');
    expect(request.methodName).toBe('getOllamaCompletion');
    expect(request.model).toBe('deepseek-coder:6.7b');
    expect(request.options.provider).toBe('ollama');
    expect(request.options.sourceProvider).toBe('ollama-multi');
  });

  test('does not silently choose gemini for multi-agent mode', () => {
    const request = buildSingleAIInvocation({ aiProvider: 'multi' });

    expect(request.disabled).toBe(true);
    expect(request.methodName).toBe('');
    expect(request.provider).toBe('');
  });

  test('passes the selected cloud provider API key when available', () => {
    const request = buildSingleAIInvocation({
      aiProvider: 'claude',
      models: {
        claudeModel: 'claude-test',
        claudeApiKey: 'sk-ant-test'
      }
    });

    expect(request.methodName).toBe('getClaudeCompletion');
    expect(request.options.model).toBe('claude-test');
    expect(request.options.apiKey).toBe('sk-ant-test');
  });
});
