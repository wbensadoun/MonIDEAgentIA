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
    const completionRunner = async ({ options }) => {
      assert.equal(options.nevenCoreExecutionContext.profile, 'luna');
      return {
        success: true,
        text: 'inline',
        provider: 'ollama',
        model: 'qwen3:8b',
        requestedModel: 'qwen3:8b',
        resolved: 'qwen3:8b',
        source: 'static',
        profile: 'luna'
        ,apiKey: 'sk-inline-secret-123456789'
        ,secret: 'inline-secret-123456789'
      };
    };
    registerAIHandlers({
      ipcMain,
      completionHandlers: { gemini: completionHandler, claude: completionHandler, kimi: completionHandler, ollama: completionHandler },
      completionRunner,
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

test('managed completions use the gateway runner for chat, inline and ghost without calling a provider', () => {
  const script = String.raw`
    const assert = require('node:assert/strict');
    const electronId = require.resolve('electron');
    require.cache[electronId] = { id: electronId, filename: electronId, loaded: true, exports: { ipcMain: { handle() {} }, dialog: { showErrorBox() {} }, app: { getPath: () => 'C:/test' } } };
    const handlers = {};
    let directCalls = 0;
    const managedCalls = [];
    const { registerAIHandlers } = require('./electron/ipc/aiHandlers');
    registerAIHandlers({
      ipcMain: { handle: (channel, handler) => { handlers[channel] = handler; } },
      completionHandlers: { gemini: async () => { directCalls += 1; return { success: true, text: 'wrong' }; }, claude: async () => ({}), kimi: async () => ({}), ollama: async () => ({}) },
      completionRunner: async () => { directCalls += 1; return { success: true, text: 'wrong' }; },
      managedCompletionRunner: async (call) => { managedCalls.push(call); return { success: true, text: 'managed', accessToken: 'never-return' }; }
    });
    (async () => {
      const options = { credentialMode: 'managed', workspaceId: 'workspace-1', provider: 'gemini' };
      assert.deepEqual(await handlers['get-gemini-completion']({}, [{ role: 'user', text: 'prompt' }], '', null, options), { success: true, text: 'managed' });
      assert.deepEqual(await handlers['get-inline-completion']({}, 'prompt', 'code', options), { success: true, text: 'managed' });
      assert.deepEqual(await handlers['get-ghost-completion']({}, 'pre', 'post', options), { success: true, text: 'managed' });
      assert.equal(directCalls, 0);
      assert.equal(managedCalls.length, 3);
      assert.equal(JSON.stringify(managedCalls).includes('never-return'), false);
    })().catch((error) => { console.error(error); process.exitCode = 1; });
  `;
  assert.equal(execFileSync(process.execPath, ['-e', script], { cwd: process.cwd(), encoding: 'utf8' }).trim(), '');
});
