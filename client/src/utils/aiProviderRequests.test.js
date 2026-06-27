import { callSingleAIProvider } from './aiProviderRequests';

const buildBaseArgs = (overrides = {}) => ({
  effectiveAIProvider: 'gemini',
  updatedHistory: [],
  aiConversationHistory: [{ role: 'assistant', text: 'Bonjour' }],
  newMessage: { role: 'user', text: 'Original' },
  promptToSend: 'Prompt enrichi',
  code: 'const answer = 42;',
  allProjectFiles: { files: {} },
  thinkingMode: true,
  deepContextEnabled: false,
  currentProjectPath: 'C:/demo',
  activeAgent: { name: 'agent' },
  activeSkill: { name: 'skill' },
  sharedAgentContextOptions: { localOnly: false },
  models: {
    geminiModel: 'gemini-test',
    claudeModel: 'claude-test',
    kimiModel: 'kimi-test',
    ollamaModel: 'ollama-test'
  },
  apiKeys: {
    geminiApiKey: 'gemini-key',
    claudeApiKey: 'claude-key',
    kimiApiKey: 'kimi-key'
  },
  electronAPI: {
    getGeminiCompletion: jest.fn().mockResolvedValue({ success: true, text: 'gemini' }),
    getClaudeCompletion: jest.fn().mockResolvedValue({ success: true, text: 'claude' }),
    getKimiCompletion: jest.fn().mockResolvedValue({ success: true, text: 'kimi' }),
    getOllamaCompletion: jest.fn().mockResolvedValue({ success: true, text: 'ollama' })
  },
  ...overrides
});

describe('callSingleAIProvider', () => {
  test('routes Gemini requests with enriched prompt and shared options', async () => {
    const args = buildBaseArgs();

    await callSingleAIProvider(args);

    expect(args.electronAPI.getGeminiCompletion).toHaveBeenCalledWith(
      [
        { role: 'assistant', text: 'Bonjour' },
        { role: 'user', text: 'Prompt enrichi' }
      ],
      'const answer = 42;',
      { files: {} },
      expect.objectContaining({
        model: 'gemini-test',
        thinkingMode: true,
        apiKey: 'gemini-key',
        projectPath: 'C:/demo',
        localOnly: false
      })
    );
  });

  test('routes Kimi requests with recent history, images and fast-mode options', async () => {
    const args = buildBaseArgs({
      effectiveAIProvider: 'kimi',
      updatedHistory: [
        {
          role: 'user',
          text: 'Image',
          images: [{ dataUrl: 'data:image/png;base64,abc', mimeType: 'image/png' }]
        }
      ],
      aiConversationHistory: Array.from({ length: 9 }, (_, index) => ({
        role: 'assistant',
        text: `old-${index}`
      })),
      deepContextEnabled: true
    });

    await callSingleAIProvider(args);

    const [history, , , options] = args.electronAPI.getKimiCompletion.mock.calls[0];
    expect(history).toHaveLength(8);
    expect(history[history.length - 1]).toEqual({ role: 'user', text: 'Prompt enrichi' });
    expect(options).toMatchObject({
      model: 'kimi-test',
      apiKey: 'kimi-key',
      fastMode: true,
      streamResponse: true,
      contextFilesLimit: 16,
      images: [{ dataUrl: 'data:image/png;base64,abc', mimeType: 'image/png' }]
    });
  });

  test('routes Claude and Ollama through their provider-specific IPC methods', async () => {
    const claudeArgs = buildBaseArgs({ effectiveAIProvider: 'claude' });
    const ollamaArgs = buildBaseArgs({ effectiveAIProvider: 'ollama' });

    await callSingleAIProvider(claudeArgs);
    await callSingleAIProvider(ollamaArgs);

    expect(claudeArgs.electronAPI.getClaudeCompletion).toHaveBeenCalledWith(
      expect.any(Array),
      'const answer = 42;',
      { files: {} },
      expect.objectContaining({
        model: 'claude-test',
        apiKey: 'claude-key'
      })
    );
    expect(ollamaArgs.electronAPI.getOllamaCompletion).toHaveBeenCalledWith(
      expect.any(Array),
      'const answer = 42;',
      { files: {} },
      expect.objectContaining({
        model: 'ollama-test',
        projectPath: 'C:/demo'
      })
    );
  });
});
