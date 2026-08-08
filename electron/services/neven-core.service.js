'use strict';

const NEVEN_CORE_VERSION = '2.3.0';

const NEVEN_INTERNAL_PROFILES = Object.freeze({
  haiku: {
    label: 'Haiku',
    fallback: null,
    complexity: 'light',
    executionMode: 'agent',
    depth: 'fast'
  },
  luna: {
    label: 'Luna',
    fallback: 'haiku',
    complexity: 'premium',
    executionMode: 'agent',
    depth: 'fast'
  },
  sol: {
    label: 'Sol',
    fallback: 'luna',
    complexity: 'premium',
    executionMode: 'multi-agent',
    depth: 'deep'
  },
  opus: {
    label: 'Opus',
    fallback: 'sol',
    complexity: 'premium',
    executionMode: 'multi-agent',
    depth: 'deep'
  }
});

const NEVEN_CORE_ROLES = Object.freeze({
  sol: {
    label: 'Sol',
    purpose: 'Plan and orchestrate multi-step work',
    preferredProfile: 'sol',
    fallbackProfile: 'luna',
    keywords: ['plan', 'planning', 'architecture', 'orchestrate', 'orchestration', 'roadmap', 'repository', 'refactor', 'multi-step']
  },
  luna: {
    label: 'Luna',
    purpose: 'Implement code changes and bounded fixes',
    preferredProfile: 'luna',
    fallbackProfile: 'haiku',
    keywords: ['code', 'coding', 'bug', 'fix', 'implement', 'implementation', 'component', 'api', 'patch', 'file', 'editor']
  },
  terra: {
    label: 'Terra',
    purpose: 'Analyze, QA and validate outputs',
    preferredProfile: 'luna',
    fallbackProfile: 'haiku',
    keywords: ['qa', 'quality', 'review', 'audit', 'verify', 'validation', 'test', 'tests', 'analysis', 'analyze', 'analyse', 'security', 'risk']
  }
});

const NEVEN_CORE_CAPABILITIES = Object.freeze([
  {
    id: 'context-pack',
    owner: 'sol',
    label: 'Context Pack',
    purpose: 'Keep prompt context compact and relevant',
    keywords: ['context', 'project', 'repo', 'repository', 'scan', 'architecture', 'files']
  },
  {
    id: 'planning',
    owner: 'sol',
    label: 'Planning',
    purpose: 'Turn the request into an execution plan',
    keywords: ['plan', 'planning', 'architecture', 'roadmap', 'refactor', 'multi-step', 'orchestrate']
  },
  {
    id: 'implementation',
    owner: 'luna',
    label: 'Implementation',
    purpose: 'Write the code changes',
    keywords: ['code', 'bug', 'fix', 'implement', 'feature', 'component', 'api', 'patch']
  },
  {
    id: 'qa',
    owner: 'terra',
    label: 'QA',
    purpose: 'Check correctness and regressions',
    keywords: ['test', 'qa', 'review', 'audit', 'verify', 'validation', 'analysis', 'audit']
  },
  {
    id: 'git',
    owner: 'luna',
    label: 'Git',
    purpose: 'Handle diffs, checkpoints and merges',
    keywords: ['git', 'diff', 'commit', 'branch', 'merge', 'checkpoint', 'rollback']
  },
  {
    id: 'terminal',
    owner: 'luna',
    label: 'Terminal',
    purpose: 'Run commands and inspect local output',
    keywords: ['terminal', 'shell', 'command', 'run', 'build', 'npm', 'test']
  },
  {
    id: 'byok',
    owner: 'sol',
    label: 'BYOK',
    purpose: 'Apply provider policy without exposing secrets',
    keywords: ['byok', 'provider', 'api key', 'credential', 'vault', 'workspace']
  },
  {
    id: 'preview',
    owner: 'terra',
    label: 'Preview',
    purpose: 'Inspect UI and rendered output safely',
    keywords: ['preview', 'ui', 'render', 'layout', 'screen', 'visual', 'screenshot']
  }
]);

const NEVEN_ROUTER_CONTEXT_LIMITS = Object.freeze({
  maxAgents: 32,
  maxSkills: 32,
  maxCapabilities: 5
});

const INTENT_PATTERNS = Object.freeze([
  {
    kind: 'critical',
    profile: 'opus',
    primaryRole: 'sol',
    secondaryRole: 'terra',
    regex: /(security|secure|securit|production|payment|migration|auth|authentication|authorization|compliance|critical|risk|incident|data loss|vulnerability|vulnerab)/i
  },
  {
    kind: 'plan',
    profile: 'sol',
    primaryRole: 'sol',
    secondaryRole: 'luna',
    regex: /(architecture|architect|repository|repo|plan|planning|roadmap|orchestrate|orchestration|multi[- ]?step|refactor|design|strategy)/i
  },
  {
    kind: 'code',
    profile: 'luna',
    primaryRole: 'luna',
    secondaryRole: 'terra',
    regex: /(code|coding|bug|error|fix|implement|feature|component|api|file|patch|refactor|build|command)/i
  },
  {
    kind: 'qa',
    profile: 'luna',
    primaryRole: 'terra',
    secondaryRole: 'luna',
    regex: /(test|tests|qa|review|audit|verify|validation|analysis|analyze|analyse|inspect|benchmark|regression)/i
  }
]);

const DEFAULT_INTENT = Object.freeze({
  kind: 'general',
  profile: 'haiku',
  primaryRole: 'luna',
  secondaryRole: null,
  reason: 'general'
});

const stripDiacritics = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

const normalizeCoreText = (value) =>
  stripDiacritics(String(value || ''))
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const tokenizeCoreText = (value) =>
  normalizeCoreText(value)
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter(Boolean);

const truncateCoreText = (value, max, suffix = '...') => {
  const raw = String(value || '');
  if (!Number.isFinite(max) || max <= 0 || raw.length <= max) return raw;
  return `${raw.slice(0, max)}${suffix}`;
};

const normalizePromptText = (prompt) => normalizeCoreText(prompt);

const classifyCoreIntent = (prompt) => {
  const text = normalizePromptText(prompt);
  if (!text) return { ...DEFAULT_INTENT, reason: 'empty' };

  for (const intent of INTENT_PATTERNS) {
    if (intent.regex.test(text)) {
      return {
        kind: intent.kind,
        profile: intent.profile,
        primaryRole: intent.primaryRole,
        secondaryRole: intent.secondaryRole,
        reason: intent.kind
      };
    }
  }

  return { ...DEFAULT_INTENT, reason: 'fallback' };
};

const normalizeRoleName = (role) => {
  const normalized = String(role || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(NEVEN_CORE_ROLES, normalized) ? normalized : null;
};

const normalizeProfileName = (profile) => {
  const normalized = String(profile || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(NEVEN_INTERNAL_PROFILES, normalized) ? normalized : 'haiku';
};

const normalizeCapabilityList = (input) => {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => String(item || '').trim())
    .filter(Boolean);
};

const buildCapabilityScore = (promptText, capability) => {
  const capabilityText = normalizeCoreText([
    capability?.id,
    capability?.label,
    capability?.purpose,
    ...(normalizeCapabilityList(capability?.keywords))
  ].join(' '));

  let score = 0;
  if (!capabilityText) return 0;

  if (promptText.includes(normalizeCoreText(capability?.id))) score += 8;
  if (promptText.includes(normalizeCoreText(capability?.label))) score += 7;

  for (const keyword of normalizeCapabilityList(capability?.keywords)) {
    const normalizedKeyword = normalizeCoreText(keyword);
    if (!normalizedKeyword) continue;
    if (promptText.includes(normalizedKeyword)) {
      score += normalizedKeyword.includes(' ') ? 4 : 2;
    }
  }

  for (const token of tokenizeCoreText(capability?.purpose)) {
    if (token.length < 4) continue;
    if (promptText.includes(token)) score += 1;
  }

  return score;
};

const selectCapabilitiesForPrompt = (prompt, intent = classifyCoreIntent(prompt), limit = NEVEN_ROUTER_CONTEXT_LIMITS.maxCapabilities) => {
  const promptText = normalizePromptText(prompt);
  const scored = NEVEN_CORE_CAPABILITIES.map((capability, index) => ({
    ...capability,
    score: buildCapabilityScore(promptText, capability),
    index
  }));

  const intentDefaults = {
    critical: ['context-pack', 'qa', 'byok'],
    plan: ['context-pack', 'planning', 'git'],
    code: ['context-pack', 'implementation', 'git'],
    qa: ['context-pack', 'qa', 'preview'],
    general: ['context-pack', 'implementation']
  };

  const defaultIds = intentDefaults[intent?.kind || 'general'] || intentDefaults.general;
  for (const capability of scored) {
    if (defaultIds.includes(capability.id)) {
      capability.score += 5;
    }
    if (capability.owner === intent?.primaryRole) {
      capability.score += 2;
    }
    if (capability.owner === intent?.secondaryRole) {
      capability.score += 1;
    }
  }

  const selected = scored
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, Math.max(1, Number(limit) || NEVEN_ROUTER_CONTEXT_LIMITS.maxCapabilities))
    .map(({ score, index, ...capability }) => capability);

  return selected;
};

const normalizeCatalogEntry = (entry = {}, kind = 'agent') => {
  const raw = entry && typeof entry === 'object' ? entry : {};
  const name = String(raw.name || raw.title || raw.label || '').trim();
  const description = String(raw.description || raw.summary || raw.body || '').trim();
  const tags = Array.isArray(raw.tags)
    ? raw.tags
    : Array.isArray(raw.keywords)
      ? raw.keywords
      : [];
  return {
    name,
    description,
    scope: String(raw.scope || (kind === 'skill' ? 'global' : 'workspace')).trim() || (kind === 'skill' ? 'global' : 'workspace'),
    role: normalizeRoleName(raw.role || raw.agentRole || raw.owner),
    tags: normalizeCapabilityList(tags),
    raw
  };
};

const scoreCatalogEntry = (entry, promptText, capabilities, kind) => {
  if (!entry.name) return -1;
  let score = 0;
  const name = normalizeCoreText(entry.name);
  const description = normalizeCoreText(entry.description);
  const tags = normalizeCapabilityList(entry.tags).map((tag) => normalizeCoreText(tag)).filter(Boolean);

  if (name && promptText.includes(name)) score += 14;
  if (description) {
    for (const token of tokenizeCoreText(description)) {
      if (token.length < 4) continue;
      if (promptText.includes(token)) score += token.length >= 8 ? 2 : 1;
    }
  }

  for (const tag of tags) {
    if (!tag) continue;
    if (promptText.includes(tag)) score += tag.includes(' ') ? 4 : 2;
  }

  for (const capability of capabilities) {
    for (const keyword of normalizeCapabilityList(capability.keywords)) {
      const normalizedKeyword = normalizeCoreText(keyword);
      if (!normalizedKeyword) continue;
      if (name.includes(normalizedKeyword) || description.includes(normalizedKeyword)) score += 2;
      if (promptText.includes(normalizedKeyword)) score += normalizedKeyword.includes(' ') ? 3 : 1;
    }
    if (entry.role && capability.owner === entry.role) score += 2;
  }

  if (entry.role && entry.role === 'sol' && /plan|architecture|orchestr/i.test(promptText)) score += 2;
  if (entry.role && entry.role === 'luna' && /(code|bug|fix|implement|api|component|file)/i.test(promptText)) score += 2;
  if (entry.role && entry.role === 'terra' && /(test|qa|audit|review|verify|analysis|security)/i.test(promptText)) score += 2;

  if (kind === 'skill' && entry.scope === 'workspace') score += 1;

  return score;
};

const rankCatalogEntries = (entries, prompt, {
  kind = 'agent',
  limit = kind === 'skill' ? NEVEN_ROUTER_CONTEXT_LIMITS.maxSkills : NEVEN_ROUTER_CONTEXT_LIMITS.maxAgents,
  capabilities = [],
  forceNames = []
} = {}) => {
  const promptText = normalizePromptText(prompt);
  const normalizedEntries = Array.isArray(entries)
    ? entries.map((entry, index) => ({
      ...normalizeCatalogEntry(entry, kind),
      index
    }))
    : [];

  const scored = normalizedEntries
    .map((entry) => ({
      ...entry,
      score: scoreCatalogEntry(entry, promptText, capabilities, kind)
    }))
    .filter((entry) => entry.name);

  for (const forcedName of normalizeCapabilityList(forceNames)) {
    const forced = scored.find((entry) => normalizeCoreText(entry.name) === normalizeCoreText(forcedName));
    if (forced) forced.score += 20;
  }

  return scored
    .sort((a, b) => b.score - a.score || a.index - b.index || a.name.localeCompare(b.name))
    .slice(0, Math.max(1, Number(limit) || (kind === 'skill' ? NEVEN_ROUTER_CONTEXT_LIMITS.maxSkills : NEVEN_ROUTER_CONTEXT_LIMITS.maxAgents)))
    .map(({ index, score, raw, ...entry }) => entry);
};

const estimateSelectionBudget = (entries, selected, extraText = '') => {
  const originalCharacters = entries.reduce((sum, entry) => {
    const name = String(entry?.name || entry?.title || entry?.label || '');
    const description = String(entry?.description || entry?.summary || entry?.body || '');
    const tags = normalizeCapabilityList(entry?.tags || entry?.keywords).join(' ');
    return sum + name.length + description.length + tags.length + 4;
  }, 0);
  const selectedCharacters = selected.reduce((sum, entry) => {
    const name = String(entry?.name || '');
    const description = String(entry?.description || '');
    return sum + name.length + description.length + 4;
  }, String(extraText || '').length);
  const savedCharacters = Math.max(0, originalCharacters - selectedCharacters);
  const savedPercent = originalCharacters > 0 ? Math.round((savedCharacters / originalCharacters) * 100) : 0;
  return {
    originalCharacters,
    selectedCharacters,
    savedCharacters,
    savedPercent
  };
};

const formatAgentLine = (agent) => {
  const name = String(agent?.name || '').trim();
  if (!name) return '';
  const description = truncateCoreText(String(agent?.description || '').replace(/\s+/g, ' ').trim(), 72);
  return description ? `- ${name} - ${description}` : `- ${name}`;
};

const formatSkillLine = (skill) => {
  const name = String(skill?.name || '').trim();
  if (!name) return '';
  const description = truncateCoreText(String(skill?.description || '').replace(/\s+/g, ' ').trim(), 72);
  return description ? `- ${name} - ${description}` : `- ${name}`;
};

const resolveProfileForIntent = (intent) => normalizeProfileName(intent?.profile || DEFAULT_INTENT.profile);

const resolvePrimaryRoleForIntent = (intent) => normalizeRoleName(intent?.primaryRole) || 'luna';

const resolveSecondaryRoleForIntent = (intent) => normalizeRoleName(intent?.secondaryRole);

const buildCoreSummary = ({
  intent,
  profile,
  primaryRole,
  secondaryRole,
  capabilities,
  budget
}) => {
  const roleLabel = NEVEN_CORE_ROLES[primaryRole]?.label || primaryRole;
  const secondaryLabel = secondaryRole ? (NEVEN_CORE_ROLES[secondaryRole]?.label || secondaryRole) : null;
  const capabilityList = Array.isArray(capabilities) && capabilities.length > 0
    ? capabilities.map((capability) => capability.label).join(', ')
    : 'none';
  const routeLine = secondaryLabel
    ? `roles=${roleLabel} -> ${secondaryLabel}`
    : `role=${roleLabel}`;

  return [
    `NEVEN CORE ${NEVEN_CORE_VERSION}`,
    `intent=${intent?.kind || 'general'} | profile=${profile} | ${routeLine}`,
    `capabilities=${capabilityList}`,
    `prompt-savings=${budget.savedPercent}% (${budget.savedCharacters}/${budget.originalCharacters} chars trimmed from raw catalog lists)`
  ].join('\n');
};

const buildNevenCorePlan = ({
  prompt = '',
  agents = [],
  skills = [],
  maxAgents = NEVEN_ROUTER_CONTEXT_LIMITS.maxAgents,
  maxSkills = NEVEN_ROUTER_CONTEXT_LIMITS.maxSkills,
  maxCapabilities = NEVEN_ROUTER_CONTEXT_LIMITS.maxCapabilities
} = {}) => {
  const intent = classifyCoreIntent(prompt);
  const profile = resolveProfileForIntent(intent);
  const primaryRole = resolvePrimaryRoleForIntent(intent);
  const secondaryRole = resolveSecondaryRoleForIntent(intent);
  const capabilities = selectCapabilitiesForPrompt(prompt, intent, maxCapabilities);

  const selectedAgents = rankCatalogEntries(agents, prompt, {
    kind: 'agent',
    limit: maxAgents,
    capabilities,
    forceNames: [NEVEN_CORE_ROLES[primaryRole]?.label, NEVEN_CORE_ROLES[secondaryRole]?.label].filter(Boolean)
  });

  const selectedSkills = rankCatalogEntries(skills, prompt, {
    kind: 'skill',
    limit: maxSkills,
    capabilities,
    forceNames: [primaryRole, secondaryRole].filter(Boolean)
  });

  const budget = estimateSelectionBudget(
    [...normalizeCatalogEntryList(agents, 'agent'), ...normalizeCatalogEntryList(skills, 'skill')],
    [...selectedAgents, ...selectedSkills],
    prompt
  );

  const summary = buildCoreSummary({
    intent,
    profile,
    primaryRole,
    secondaryRole,
    capabilities,
    budget
  });

  return {
    version: NEVEN_CORE_VERSION,
    intent,
    profile,
    profileDefinition: NEVEN_INTERNAL_PROFILES[profile],
    primaryRole,
    secondaryRole,
    capabilities,
    selectedAgents,
    selectedSkills,
    budget,
    summary
  };
};

const normalizeCatalogEntryList = (entries, kind) =>
  (Array.isArray(entries) ? entries : []).map((entry) => normalizeCatalogEntry(entry, kind));

const buildNevenRouterContext = (options = {}) => {
  const plan = buildNevenCorePlan(options);
  const agentBlock = plan.selectedAgents.length > 0
    ? `NEVEN CORE (v${NEVEN_CORE_VERSION})\n${plan.summary}\n\nAGENTS DISPONIBLES (selection compacte) :\n${plan.selectedAgents.map(formatAgentLine).filter(Boolean).join('\n')}`
    : `NEVEN CORE (v${NEVEN_CORE_VERSION})\n${plan.summary}\n\nAGENTS DISPONIBLES : (aucun)`;
  const skillBlock = plan.selectedSkills.length > 0
    ? `SKILLS DISPONIBLES (selection compacte) :\n${plan.selectedSkills.map(formatSkillLine).filter(Boolean).join('\n')}`
    : 'SKILLS DISPONIBLES : (aucun)';

  return {
    ...plan,
    agentBlock,
    skillBlock
  };
};

const buildNevenCoreManifest = () => ({
  version: NEVEN_CORE_VERSION,
  profiles: NEVEN_INTERNAL_PROFILES,
  roles: NEVEN_CORE_ROLES,
  capabilities: NEVEN_CORE_CAPABILITIES
});

module.exports = {
  NEVEN_CORE_VERSION,
  NEVEN_INTERNAL_PROFILES,
  NEVEN_CORE_ROLES,
  NEVEN_CORE_CAPABILITIES,
  NEVEN_ROUTER_CONTEXT_LIMITS,
  buildNevenCoreManifest,
  buildNevenCorePlan,
  buildNevenRouterContext,
  classifyCoreIntent,
  normalizeProfileName,
  normalizeRoleName,
  selectCapabilitiesForPrompt
};
