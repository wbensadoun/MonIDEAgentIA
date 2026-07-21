import type { Agent, AgentClient, AgentRoleKey, InstructionResult } from '../types';
import type { AIMessage, CompletionFn, CompletionResult, ElectronAIApi } from './electronApi';
import { getElectronAIApi } from './electronApi';

/**
 * Real backend: routes each agent instruction to the IDE's existing AI bridge
 * (`window.electronAPI.get*Completion`). One short, role-scoped system prompt is
 * prepended so each PNJ answers in character (UX vs backend vs QA…).
 *
 * Provider/model are read once from the IDE settings; the agent's role decides
 * the tone, not the model. This keeps the world consistent with whatever the
 * user already configured in Settings.
 */

type ProviderId = 'gemini' | 'claude' | 'kimi' | 'ollama';

interface ResolvedProvider {
  id: ProviderId;
  fn: CompletionFn;
  options: Record<string, unknown>;
}

/** Per-role persona used to steer the reply. Kept short on purpose. */
const ROLE_PERSONA: Record<AgentRoleKey, string> = {
  pm: "Tu es Product Manager. Tu cadres le besoin, découpes en tâches claires et fixes des critères d'acceptation. Tu ne codes pas.",
  ux: "Tu es UX Designer. Tu raisonnes parcours, frictions et lisibilité. Tu proposes des écrans simples, pas du code.",
  frontend: 'Tu es Frontend Developer. Tu parles composants, état, interactions et style. Tu peux esquisser du code court si utile.',
  backend: "Tu es Backend Developer. Tu parles API, données, auth et contrats. Tu restes concis et concret.",
  qa: "Tu es QA Tester. Tu penses cas limites, scénarios et non-régression. Tu listes ce qui doit être vérifié.",
  devops: 'Tu es DevOps. Tu parles CI, build, déploiement et rollback. Tu restes pragmatique et orienté fiabilité.',
};

/**
 * Build an AgentClient bound to the Electron AI bridge.
 *
 * @param getSettings reads the latest IDE settings (provider, models, keys).
 *                    Defaults to `window.electronAPI.loadSettings`.
 */
export function createElectronAgentClient(): AgentClient {
  return {
    async sendInstruction(agent: Agent, prompt: string): Promise<InstructionResult> {
      const started = Date.now();
      const provider = await resolveProvider();

      if (!provider) {
        throw new Error('Aucun fournisseur IA disponible (Electron requis).');
      }

      const history = buildHistory(agent, prompt);
      let result: CompletionResult;
      try {
        // The IDE bridge expects (history, currentCode, allProjectFiles, options).
        // AgentVerse has no editor file in scope, so we pass empty code + files.
        result = await provider.fn(history, '', [], provider.options);
      } catch (err) {
        throw new Error(err instanceof Error ? err.message : 'Échec de la requête IA');
      }

      if (!result.success) {
        const hint = result.retryable ? ' (temporaire, réessaie)' : '';
        throw new Error(`${result.error || 'Erreur IA inconnue'}${hint}`);
      }

      const reply = cleanReply(result.text || '');
      const elapsed = Date.now() - started;
      return {
        taskTitle: prompt.length > 64 ? `${prompt.slice(0, 61)}…` : prompt,
        reply: reply || 'Reçu, je m’en occupe.',
        // Keep the "working" animation visible for at least a beat, even when
        // the real model answers fast.
        durationMs: Math.max(2200, Math.min(elapsed, 12000)),
      };
    },
  };
}

/** Compose the short conversation sent to the model for one instruction. */
function buildHistory(agent: Agent, prompt: string): AIMessage[] {
  const persona = ROLE_PERSONA[agent.roleKey];
  const system = [
    persona,
    `Ton prénom est ${agent.name}.`,
    'Réponds en français, en 1 à 3 phrases, ton collègue d’équipe, concret et actionnable.',
    'Pas de markdown lourd, pas de blocs de code longs.',
  ].join(' ');

  // Replay the agent's own recent thread so it keeps context across turns.
  const recent: AIMessage[] = agent.chat.slice(-6).map((m) => ({
    role: m.from === 'user' ? 'user' : m.from === 'agent' ? 'model' : 'system',
    text: m.text,
  }));

  return [
    { role: 'system', text: system },
    ...recent,
    { role: 'user', text: prompt },
  ];
}

/** Read IDE settings and pick the matching completion endpoint + options. */
async function resolveProvider(): Promise<ResolvedProvider | null> {
  const api = getElectronAIApi();
  if (!api) return null;

  let settings: Record<string, unknown> = {};
  try {
    const res = await api.loadSettings?.();
    if (res?.success && res.settings) settings = res.settings;
  } catch {
    /* fall back to defaults below */
  }

  const requested = normalizeProvider(settings.defaultProvider);
  const order: ProviderId[] = [requested, 'gemini', 'claude', 'kimi', 'ollama'];

  for (const id of order) {
    const fn = endpointFor(api, id);
    if (fn) {
      return { id, fn, options: optionsFor(id, settings) };
    }
  }
  return null;
}

function normalizeProvider(value: unknown): ProviderId {
  const v = String(value || '').toLowerCase();
  if (v === 'claude' || v === 'kimi' || v === 'ollama' || v === 'gemini') return v;
  return 'gemini';
}

function endpointFor(api: ElectronAIApi, id: ProviderId): CompletionFn | undefined {
  switch (id) {
    case 'claude': return api.getClaudeCompletion;
    case 'kimi': return api.getKimiCompletion;
    case 'ollama': return api.getOllamaCompletion;
    case 'gemini': return api.getGeminiCompletion;
    default: return undefined;
  }
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

/** Map IDE settings → the options shape each completion endpoint expects. */
function optionsFor(id: ProviderId, s: Record<string, unknown>): Record<string, unknown> {
  // thinkingMode stays off by default — the user's machine is CPU-only.
  const base = { thinkingMode: s.thinkingMode === true };
  switch (id) {
    case 'claude':
      return { ...base, model: str(s.claudeModel), apiKey: str(s.claudeApiKey) };
    case 'kimi':
      return { ...base, model: str(s.kimiModel), apiKey: str(s.kimiApiKey) };
    case 'ollama':
      return { model: str(s.ollamaModel), lightweightChat: true };
    case 'gemini':
    default:
      return { ...base, model: str(s.geminiModel), apiKey: str(s.geminiApiKey) };
  }
}

/** Strip stray FILE/diff blocks the IDE prompt format may elicit. */
function cleanReply(text: string): string {
  let out = text.trim();
  // Drop fenced code blocks (the personas ask for none, but be defensive).
  out = out.replace(/```[\s\S]*?```/g, '').trim();
  // Drop the IDE's "FICHIER:" action blocks if any leaked in.
  out = out.replace(/FICHIER\s*:[\s\S]*$/i, '').trim();
  if (out.length > 400) out = `${out.slice(0, 397)}…`;
  return out;
}
