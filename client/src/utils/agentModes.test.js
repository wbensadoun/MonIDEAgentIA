import {
  decoratePromptForMode,
  getModePolicy,
  resolveProviderForExecutionMode,
  shouldProcessFileModifications
} from './agentModes';

describe('agentModes', () => {
  test('plan mode is read-only and blocks file proposal processing', () => {
    expect(getModePolicy('plan').readOnly).toBe(true);
    expect(shouldProcessFileModifications('plan')).toBe(false);
    expect(decoratePromptForMode('Change App.js', 'plan')).toContain('lecture seule');
  });

  test('agent mode can propose reviewed changes', () => {
    expect(getModePolicy('agent').canProposeFiles).toBe(true);
    expect(shouldProcessFileModifications('agent')).toBe(true);
  });

  test('multi-agent mode always routes to unified multi router', () => {
    expect(resolveProviderForExecutionMode('ollama', 'multi-agent')).toBe('multi');
    expect(resolveProviderForExecutionMode('gemini', 'multi-agent')).toBe('multi');
  });
});
