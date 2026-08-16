'use strict';

const axios = require('axios');

const DEFAULT_DASHSCOPE_MODEL = 'qwen-plus';
const DASHSCOPE_API_URL = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions';

const stripMarkdown = (value, trimEndOnly = false) => {
  const text = String(value || '').replace(/^```[a-z]*\n/i, '').replace(/\n```$/i, '');
  return trimEndOnly ? text.trimEnd() : text.trim();
};

const getDashScopeCredential = (options = {}) => (
  // `managedCredential` est injecté par le main process. Ne jamais accepter
  // `options.apiKey`, qui vient du renderer via IPC.
  options.managedCredential || process.env.DASHSCOPE_API_KEY || null
);

const runDashScopePromptCompletion = async ({ systemInstruction, userPrompt, options = {}, maxTokens = 512, trimEndOnly = false } = {}) => {
  if (options.localOnly) return { success: false, error: 'Local-only actif: DashScope interdit.', provider: 'dashscope' };
  const credential = getDashScopeCredential(options);
  const model = options.model || process.env.DASHSCOPE_MODEL || DEFAULT_DASHSCOPE_MODEL;
  if (!credential) return { success: false, error: 'La clé API DashScope doit être configurée côté backend.', provider: 'dashscope', model };
  try {
    const response = await axios.post(options.apiUrl || process.env.DASHSCOPE_API_URL || DASHSCOPE_API_URL, {
      model,
      messages: [{ role: 'system', content: systemInstruction }, { role: 'user', content: userPrompt }],
      temperature: Number.isFinite(Number(options.temperature)) ? Number(options.temperature) : 0.1,
      max_tokens: maxTokens
    }, {
      headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
      timeout: Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 60000,
      signal: options.signal
    });
    return {
      success: true,
      text: stripMarkdown(response.data?.choices?.[0]?.message?.content, trimEndOnly),
      provider: 'dashscope', model,
      usage: response.data?.usage
    };
  } catch (error) {
    if (error?.code === 'ERR_CANCELED' || options.signal?.aborted) return { success: false, aborted: true, error: 'Generation annulee.', provider: 'dashscope' };
    const status = Number(error?.response?.status);
    return { success: false, error: status === 401 || status === 403 ? 'Accès DashScope refusé.' : (error?.message || 'Erreur DashScope.'), retryable: [429, 502, 503, 504].includes(status), provider: 'dashscope', model };
  }
};

const getDashScopeCompletion = async ({ history, currentCode, options = {} } = {}) => {
  const messages = Array.isArray(history) ? history.filter((message) => message && message.text !== undefined) : [];
  if (!messages.length) return { success: false, error: 'Aucun historique fourni pour DashScope.', provider: 'dashscope' };
  const transcript = messages.slice(-12).map((message) => `${message.role === 'model' ? 'Assistant' : 'Utilisateur'}: ${String(message.text)}`).join('\n\n');
  return runDashScopePromptCompletion({
    systemInstruction: `Tu es un assistant de développement. Réponds dans la langue de l'utilisateur.\nFICHIER OUVERT:\n${String(currentCode || '').slice(0, 4000)}`,
    userPrompt: transcript,
    options,
    maxTokens: options.maxTokens || 4096
  });
};

module.exports = { DEFAULT_DASHSCOPE_MODEL, DASHSCOPE_API_URL, runDashScopePromptCompletion, getDashScopeCompletion };
