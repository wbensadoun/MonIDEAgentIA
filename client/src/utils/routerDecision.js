// Pure helpers consumed by the Intelligent Router integration in useAI.js.
// No React / Electron dependency here on purpose — keep these trivially
// testable and safe to call with malformed / missing data coming back from
// the backend `route-request` classification step.
//
// Backend contract (see routeRequest in electron.bridge.ts):
//   decision.mode        : 'single_agent' | 'orchestrator' | 'multi_agent'
//   decision.agent       : plain agent name (matches listAgents .name) | null
//   decision.skills      : plain skill names (matches listSkills .name)
//   decision.complexity  : 'light' | 'premium'
//   execution.executionMode : 'agent' | 'multi-agent'
//   execution.depth         : 'fast' | 'deep'

const ROUTER_MODE_TO_EXECUTION_MODE = {
  single_agent: 'agent',
  orchestrator: 'multi-agent',
  multi_agent: 'multi-agent'
};

export const mapRouterModeToExecutionMode = (routerMode) => {
  const key = String(routerMode || '').trim();
  return ROUTER_MODE_TO_EXECUTION_MODE[key] || 'agent';
};

// Convergence with the Collective mode depth axis: the router's model
// complexity maps directly onto COLLECTIVE_DEPTHS ('light' -> 'fast',
// 'premium' -> 'deep'). Mirrors the backend `execution.depth` field so the
// front-end can derive the same value defensively when it is missing.
export const mapComplexityToDepth = (complexity) => (
  String(complexity || '').trim().toLowerCase() === 'premium' ? 'deep' : 'fast'
);

const matchByName = (list, name) => {
  const target = String(name || '').trim().toLowerCase();
  if (!target) return null;
  if (!Array.isArray(list)) return null;

  for (const item of list) {
    const itemName = String(item?.name || '').trim().toLowerCase();
    if (itemName && itemName === target) return item;
  }

  return null;
};

export const matchAgentByName = (availableAgents, name) => matchByName(availableAgents, name);

// On this base skills are validated / injected by PLAIN name (listSkills .name),
// but we keep the defensive "scope/name" fallback from the archived branch so a
// scope-prefixed decision (e.g. "global/pdf-editing") still resolves.
export const matchSkillByName = (availableSkills, name) => {
  const target = String(name || '').trim().toLowerCase();
  if (!target) return null;
  if (!Array.isArray(availableSkills)) return null;

  for (const item of availableSkills) {
    const itemName = String(item?.name || '').trim().toLowerCase();
    const scopedName = String(item?.scope ? `${item.scope}/${item.name}` : item?.name || '')
      .trim()
      .toLowerCase();
    if ((itemName && itemName === target) || (scopedName && scopedName === target)) return item;
  }

  return null;
};

// Safe fallback decision — identical in spirit to the backend's fallback
// (source:'fallback'). Rendered by AIDecisionBadge and behaviorally equal to
// today's single-agent / light path.
export const createFallbackRouterDecision = () => ({
  mode: 'single_agent',
  agent: null,
  skills: [],
  complexity: 'light',
  model: null,
  source: 'fallback'
});

// ── Layer 1 (local heuristic) ────────────────────────────────────────────────
// This base has no ollamaRuntime.classifyPromptLayer1, so we ship a minimal,
// dependency-free heuristic. Trivial prompts (greetings, acknowledgements, very
// short small-talk) short-circuit the router: they never hit the backend LLM
// classification and resolve to a single-agent / light run.

const TRIVIAL_EXACT = new Set([
  'bonjour', 'bonsoir', 'salut', 'coucou', 'hello', 'hi', 'hey', 'yo',
  'merci', 'thanks', 'thank you', 'thx', 'ok', 'okay', 'oui', 'non',
  'yes', 'no', 'cool', 'super', 'nice', 'ping', 'test', 'ca va', 'ça va',
  'bye', 'ciao', 'au revoir'
]);

const TRIVIAL_PREFIXES = [
  'bonjour', 'bonsoir', 'salut', 'coucou', 'hello', 'hi ', 'hey', 'merci',
  'thanks', 'thank you'
];

const ACTION_HINT = /```|\bcode\b|\bbug\b|\berror\b|\berreur\b|\bfix\b|\brefactor\b|\btest\b|\bimpl[ée]ment|\bcr[ée]e|\bcreate\b|\badd\b|\bajoute|\bg[ée]n[èe]re|\bfunction\b|\bclass\b|\bcomponent\b|\bcompos|\bapi\b|\bfichier\b|\bfile\b/i;

/**
 * Cheap local classifier. Returns { trivial: boolean, reason: string }.
 * Never throws — always safe to call before the backend router.
 *
 * @param {string} prompt
 * @returns {{ trivial: boolean, reason: string }}
 */
export const classifyPromptLayer1 = (prompt) => {
  const text = String(prompt || '').trim();
  if (!text) return { trivial: true, reason: 'empty' };

  const normalized = text.toLowerCase().replace(/[!?.…]+$/g, '').trim();
  if (TRIVIAL_EXACT.has(normalized)) return { trivial: true, reason: 'greeting' };

  const wordCount = normalized.split(/\s+/).filter(Boolean).length;

  // A real coding request, even if short, must go through the router.
  if (ACTION_HINT.test(text)) return { trivial: false, reason: 'action' };

  if (wordCount <= 3 && TRIVIAL_PREFIXES.some((p) => normalized.startsWith(p))) {
    return { trivial: true, reason: 'short-greeting' };
  }

  // Extremely short, question-free small talk (<= 2 words) is treated as trivial.
  if (wordCount <= 2 && !normalized.includes('?')) {
    return { trivial: true, reason: 'short' };
  }

  return { trivial: false, reason: 'route' };
};
