'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const test = require('node:test');

test('completion IPC strips technical metadata and rejects forged Core context', () => {
  const script = String.raw`
    const assert = require('node:assert/strict');
    const electronId = require.resolve('electron');
    require.cache[electronId] = {
      id: electronId,
      filename: electronId,
      loaded: true,
      exports: {
        ipcMain: { handle() {} },
        dialog: { showErrorBox() {} },
        app: { getPath: () => 'C:/codex-test-user-data' }
      }
    };
    process.env.NEVEN_CORE_LITE_EXECUTION_ENABLED = 'true';

    const handlers = {};
    const ipcMain = { handle: (channel, handler) => { handlers[channel] = handler; } };
    const { registerAIHandlers, prepareNevenCoreExecutionOptions, sanitizeCompletionResponse } = require('./electron/ipc/aiHandlers');
    const forgedOptions = {
      provider: 'gemini',
      model: 'forged-model',
      projectPath: null,
      nevenCoreExecutionContext: { profile: 'opus', capabilities: ['forged'] }
    };
    const completionHandler = async ({ options }) => {
      assert.equal(options.nevenCoreExecutionContext.profile, 'luna');
      assert.equal(options.nevenCoreExecutionContext.capabilities.includes('forged'), false);
      return {
        success: true,
        text: 'normal',
        provider: 'gemini',
        model: 'physical-model',
        resolvedModel: 'resolved-model',
        source: 'live',
        profile: 'luna',
        apiKey: 'sk-normal-secret-123456789',
        key: 'key-normal-secret-123456789',
        token: 'token-normal-secret-123456789',
        accessToken: 'access-normal-secret-123456789',
        authorization: 'Bearer normal-secret-123456789',
        credential: 'credential-normal-secret-123456789',
        secret: 'secret-normal-secret-123456789',
        ciphertext: 'ciphertext-normal-secret-123456789',
        terminalActions: 1,
        mode: 'single'
      };
    };
    const completionRunner = async ({ options, systemInstruction }) => {
      assert.equal(options.nevenCoreExecutionContext.profile, 'luna');
      assert.equal(systemInstruction.includes('profil=luna'), true);
      assert.equal(systemInstruction.includes('internal-runtime-model'), false);
      return {
        success: true,
        text: 'inline',
        provider: 'ollama',
        model: 'qwen3:8b',
        requestedModel: 'qwen3:8b',
        resolved: 'qwen3:8b',
        source: 'static',
        profile: 'luna',
        apiKey: 'sk-inline-secret-123456789',
        secret: 'inline-secret-123456789'
      };
    };
    registerAIHandlers({
      ipcMain,
      completionHandlers: { gemini: completionHandler, claude: completionHandler, kimi: completionHandler, ollama: completionHandler },
      completionRunner,
      resolveProfileModel: async () => ({ resolved: 'internal-runtime-model' }),
      listAgents: async () => ({ agents: [{ name: 'luna-coder' }] }),
      listSkills: async () => ({ skills: [{ name: 'implementation' }] })
    });

    (async () => {
      const normal = await handlers['get-gemini-completion'](
        {}, [{ role: 'user', text: 'corrige ce bug' }], '', null, forgedOptions
      );
      assert.deepEqual(normal, { success: true, text: 'normal', terminalActions: 1, mode: 'single' });

      const inline = await handlers['get-inline-completion']({}, 'corrige ce bug', 'const x = 1;', forgedOptions);
      assert.deepEqual(inline, { success: true, text: 'inline' });
      const ghost = await handlers['get-ghost-completion']({}, 'bug ', ' = 1;', forgedOptions);
      assert.deepEqual(ghost, { success: true, text: 'inline' });

      const off = await prepareNevenCoreExecutionOptions({
        options: forgedOptions,
        prompt: 'corrige ce bug',
        isExecutionEnabled: () => false,
        listAgents: async () => ({ agents: [{ name: 'luna-coder' }] }),
        listSkills: async () => ({ skills: [{ name: 'implementation' }] })
      });
      assert.equal(Object.prototype.hasOwnProperty.call(off, 'nevenCoreExecutionContext'), false);

      const resolved = await prepareNevenCoreExecutionOptions({
        options: forgedOptions,
        prompt: 'corrige ce bug',
        isExecutionEnabled: () => true,
        resolveProfileModel: async (provider, profile) => {
          assert.equal(provider, 'gemini');
          assert.equal(profile, 'luna');
          return { resolved: 'internal-runtime-model' };
        },
        listAgents: async () => ({ agents: [{ name: 'luna-coder' }] }),
        listSkills: async () => ({ skills: [{ name: 'implementation' }] })
      });
      assert.equal(resolved.model, 'internal-runtime-model');
      assert.equal(resolved.nevenCoreExecutionContext.profile, 'luna');

      const normalCalls = [];
      const normalHandlers = Object.fromEntries(['gemini', 'claude', 'kimi', 'ollama'].map((channelProvider) => [channelProvider, async ({ options }) => {
        normalCalls.push({ channelProvider, provider: options.provider, model: options.model });
        return { success: true, text: channelProvider, provider: channelProvider, model: options.model };
      }]));
      const inlineCalls = [];
      const normalizedCompletionRunner = async ({ provider, options }) => {
        inlineCalls.push({ provider, optionProvider: options.provider, model: options.model });
        return { success: true, text: 'normalized', provider, model: options.model };
      };
      registerAIHandlers({
        ipcMain,
        completionHandlers: normalHandlers,
        completionRunner: normalizedCompletionRunner,
        resolveProfileModel: async (provider, profile) => ({ resolved: 'resolved-' + provider + '-' + profile }),
        listAgents: async () => ({ agents: [{ name: 'luna-coder' }] }),
        listSkills: async () => ({ skills: [{ name: 'implementation' }] })
      });
      const normalChannels = [
        ['get-gemini-completion', 'gemini'],
        ['get-claude-completion', 'claude'],
        ['get-kimi-completion', 'kimi'],
        ['get-ollama-completion', 'ollama']
      ];
      for (const [channel, channelProvider] of normalChannels) {
        for (const rendererProvider of [undefined, channelProvider === 'gemini' ? 'claude' : 'gemini']) {
          const response = await handlers[channel](
            {}, [{ role: 'user', text: 'corrige ce bug' }], '', null,
            { model: 'renderer-model', ...(rendererProvider ? { provider: rendererProvider } : {}) }
          );
          assert.deepEqual(response, { success: true, text: channelProvider });
        }
      }
      assert.deepEqual(normalCalls, normalChannels.flatMap(([, channelProvider]) => ([
        { channelProvider, provider: channelProvider, model: 'resolved-' + channelProvider + '-luna' },
        { channelProvider, provider: channelProvider, model: 'resolved-' + channelProvider + '-luna' }
      ])));

      for (const [channel, args] of [
        ['get-inline-completion', ['corrige ce bug', 'const x = 1;']],
        ['get-ghost-completion', ['bug ', ' = 1;']]
      ]) {
        for (const options of [{}, { provider: 'renderer-invalide' }]) {
          const response = await handlers[channel]({}, ...args, { model: 'renderer-model', ...options });
          assert.deepEqual(response, { success: true, text: 'normalized' });
        }
      }
      assert.deepEqual(inlineCalls, Array.from({ length: 4 }, () => ({
        provider: 'gemini', optionProvider: 'gemini', model: 'resolved-gemini-luna'
      })));

      const failingCompletionRunner = async ({ options }) => {
        assert.equal(options.model, 'internal-runtime-model');
        throw new Error('kimi internal-runtime-model apiKey=sk-inline-error-secret-123456789');
      };
      registerAIHandlers({
        ipcMain,
        completionHandlers: { gemini: completionHandler, claude: completionHandler, kimi: completionHandler, ollama: completionHandler },
        completionRunner: failingCompletionRunner,
        resolveProfileModel: async () => ({ resolved: 'internal-runtime-model' }),
        listAgents: async () => ({ agents: [{ name: 'luna-coder' }] }),
        listSkills: async () => ({ skills: [{ name: 'implementation' }] })
      });
      for (const failure of [
        await handlers['get-inline-completion']({}, 'corrige ce bug', 'const x = 1;', forgedOptions),
        await handlers['get-ghost-completion']({}, 'bug ', ' = 1;', forgedOptions)
      ]) {
        assert.equal(failure.success, false);
        assert.equal(failure.error.includes('internal-runtime-model'), false);
        assert.equal(failure.error.includes('kimi'), false);
        assert.equal(failure.error.includes('sk-inline-error-secret-123456789'), false);
        assert.equal(Object.prototype.hasOwnProperty.call(failure, 'provider'), false);
        assert.equal(Object.prototype.hasOwnProperty.call(failure, 'model'), false);
      }

      const error = sanitizeCompletionResponse({
        success: false,
        error: 'Ollama qwen3:8b failed with apiKey=sk-error-secret-123456789',
        provider: 'ollama',
        model: 'qwen3:8b',
        apiKey: 'sk-error-secret-123456789'
      });
      assert.equal(error.error.includes('sk-error-secret-123456789'), false);
      assert.equal(error.error.includes('qwen3:8b'), false);
      assert.equal(error.error.includes('provider IA'), true);
    })().catch((error) => { console.error(error); process.exitCode = 1; });
  `;

  const output = execFileSync(process.execPath, ['-e', script], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });
  assert.equal(output.trim(), '');
});

test('Kimi and Ollama streaming events have a renderer-safe fixed shape', () => {
  const script = String.raw`
    const assert = require('node:assert/strict');
    const electronId = require.resolve('electron');
    require.cache[electronId] = {
      id: electronId,
      filename: electronId,
      loaded: true,
      exports: { app: { getPath: () => 'C:/codex-test-user-data' } }
    };
    const { sanitizeGenerationTokenForRenderer: sanitizeKimi } = require('./electron/services/ai-providers/kimi.provider');
    const { sanitizeGenerationTokenForRenderer: sanitizeOllama } = require('./electron/services/ai-providers/ollama.provider');
    for (const sanitize of [sanitizeKimi, sanitizeOllama]) {
      assert.deepEqual(sanitize({
        token: 'partial', done: false, aborted: false,
        provider: 'kimi', model: 'internal-model', metadata: { source: 'internal' }, error: 'raw provider error'
      }), { token: 'partial', done: false });
      assert.deepEqual(sanitize({ token: '', done: true, aborted: true, provider: 'ollama', error: 'raw error' }), {
        token: '', done: true, aborted: true
      });
      assert.deepEqual(sanitize({ token: { not: 'text' }, done: 'true', metadata: 'forged' }), { token: '', done: false });
    }
  `;

  const output = execFileSync(process.execPath, ['-e', script], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });
  assert.equal(output.trim(), '');
});
