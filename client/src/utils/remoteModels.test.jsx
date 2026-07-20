import {
  getRemoteModelOptions,
  normalizeRemoteModelName
} from './remoteModels';

describe('remote model helpers', () => {
  test('normalizes custom model names without enforcing a known catalog', () => {
    expect(normalizeRemoteModelName('  moonshotai/Kimi-K2.6  ')).toBe('moonshotai/Kimi-K2.6');
    expect(normalizeRemoteModelName('Kimi-K2.7')).toBe('Kimi-K2.7');
    expect(normalizeRemoteModelName('', 'fallback-model')).toBe('fallback-model');
  });

  test('keeps suggestions unique while including current custom values', () => {
    const options = getRemoteModelOptions('kimi', ' moonshotai/Kimi-K2.7 ');

    expect(options).toContain('moonshotai/Kimi-K2.5');
    expect(options).toContain('moonshotai/Kimi-K2.6');
    expect(options).toContain('moonshotai/Kimi-K2.7');
    expect(new Set(options).size).toBe(options.length);
  });
});
