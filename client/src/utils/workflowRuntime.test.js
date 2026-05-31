import { buildWorkflowAIInvocation, evaluateWorkflowCondition, normalizeWorkflowProvider } from './workflowRuntime';

describe('workflowRuntime', () => {
  test('normalizeWorkflowProvider does not silently fall back to gemini', () => {
    expect(normalizeWorkflowProvider('')).toBe('');
    expect(normalizeWorkflowProvider('custom')).toBe('');
    expect(normalizeWorkflowProvider('gemini')).toBe('gemini');
    expect(normalizeWorkflowProvider('claude')).toBe('claude');
    expect(normalizeWorkflowProvider('kimi')).toBe('kimi');
    expect(normalizeWorkflowProvider('ollama')).toBe('ollama');
    expect(normalizeWorkflowProvider('ollama-multi')).toBe('ollama');
  });

  test('buildWorkflowAIInvocation routes to the selected provider', () => {
    expect(buildWorkflowAIInvocation({ provider: 'gemini', prompt: 'hello', projectPath: 'C:/demo' }).methodName)
      .toBe('getGeminiCompletion');
    expect(buildWorkflowAIInvocation({ provider: 'claude', prompt: 'hello', projectPath: 'C:/demo' }).methodName)
      .toBe('getClaudeCompletion');
    expect(buildWorkflowAIInvocation({ provider: 'kimi', prompt: 'hello', projectPath: 'C:/demo' }).methodName)
      .toBe('getKimiCompletion');
    expect(buildWorkflowAIInvocation({ provider: 'ollama', prompt: 'hello', projectPath: 'C:/demo' }).methodName)
      .toBe('getOllamaCompletion');
  });

  test('buildWorkflowAIInvocation refuses unsupported providers', () => {
    const request = buildWorkflowAIInvocation({ provider: 'multi', prompt: 'hello', projectPath: 'C:/demo' });

    expect(request.disabled).toBe(true);
    expect(request.methodName).toBe('');
    expect(request.error).toMatch(/non pris en charge/i);
  });

  test('evaluateWorkflowCondition supports comparisons and booleans without eval', () => {
    expect(evaluateWorkflowCondition('true')).toBe(true);
    expect(evaluateWorkflowCondition('result === "ok"', { result: 'ok' })).toBe(true);
    expect(evaluateWorkflowCondition('result !== "ok"', { result: 'fail' })).toBe(true);
    expect(evaluateWorkflowCondition('count >= 3 && enabled === true', { count: 4, enabled: true })).toBe(true);
    expect(evaluateWorkflowCondition('!(result === "error")', { result: 'ok' })).toBe(true);
    expect(evaluateWorkflowCondition('result.success === true', { result: { success: true } })).toBe(true);
    expect(evaluateWorkflowCondition('results.build === "done" || prev === "done"', { results: { build: 'done' }, prev: 'pending' })).toBe(true);
  });
});
