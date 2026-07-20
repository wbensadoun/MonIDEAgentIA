import { findInstalledInstructVariant, isSimpleOllamaChatPrompt, resolveSimpleOllamaMaxTokens } from './ollamaRuntime';

describe('ollamaRuntime', () => {
  test('uses small defaults for simple Ollama chat by mode', () => {
    expect(resolveSimpleOllamaMaxTokens('ask', { maxTokens: 4096 })).toBe(512);
    expect(resolveSimpleOllamaMaxTokens('plan', { maxTokens: 4096 })).toBe(512);
    expect(resolveSimpleOllamaMaxTokens('agent', { maxTokens: 4096 })).toBe(2048);
  });

  test('honors explicit token settings with a hard cap', () => {
    expect(resolveSimpleOllamaMaxTokens('agent', { maxTokens: 3072 })).toBe(3072);
    expect(resolveSimpleOllamaMaxTokens('agent', { maxTokens: 12000 })).toBe(8192);
    expect(resolveSimpleOllamaMaxTokens('ask', { maxTokens: 64 })).toBe(128);
  });

  test('uses lightweight chat settings for greetings only', () => {
    expect(isSimpleOllamaChatPrompt('Hi')).toBe(true);
    expect(isSimpleOllamaChatPrompt('MODE SYSTEME: Agent\n\nDEMANDE UTILISATEUR:\nSalut')).toBe(true);
    expect(resolveSimpleOllamaMaxTokens('agent', { maxTokens: 4096 }, 'Hi')).toBe(256);
    expect(isSimpleOllamaChatPrompt('Hi, corrige ce fichier App.js')).toBe(false);
  });

  test('finds installed instruct variant without switching automatically', () => {
    expect(findInstalledInstructVariant('qwen3:4b', ['qwen3:4b', 'qwen3:4b-instruct'])).toBe('qwen3:4b-instruct');
    expect(findInstalledInstructVariant('qwen3:4b-instruct', ['qwen3:4b-instruct'])).toBe('');
    expect(findInstalledInstructVariant('qwen3:8b', ['qwen3:4b-instruct'])).toBe('');
  });
});
