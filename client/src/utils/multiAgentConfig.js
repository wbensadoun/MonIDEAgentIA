import { DEFAULT_OLLAMA_MODEL } from './ollamaModels';
import {
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_GEMINI_PRO_MODEL,
  DEFAULT_KIMI_MODEL,
  KIMI_K2_6_MODEL
} from './remoteModels';

export const AI_PROVIDER_OPTIONS = [
  { value: 'gemini', label: 'Gemini' },
  { value: 'claude', label: 'Claude' },
  { value: 'kimi', label: 'Kimi / Together' },
  { value: 'ollama', label: 'Ollama local' }
];

export const PROVIDER_LABELS = {
  gemini: 'Gemini',
  claude: 'Claude',
  kimi: 'Kimi',
  ollama: 'Ollama'
};

export const MULTI_AGENT_ROLE_DEFINITIONS = [
  {
    key: 'selector',
    settingsKey: 'selectionneur',
    title: 'Selectionneur',
    shortLabel: 'Selectionneur',
    provider: 'gemini',
    model: DEFAULT_GEMINI_PRO_MODEL,
    focus: 'Compose l equipe, choisit la formation, les dependances et le budget de run.',
    stage: 'selection',
    canWrite: false,
    source: 'native'
  },
  {
    key: 'captain',
    settingsKey: 'capitaineProjet',
    title: 'Capitaine Projet',
    shortLabel: 'Capitaine',
    provider: 'gemini',
    model: DEFAULT_GEMINI_PRO_MODEL,
    focus: 'Tient le plan, les criteres d acceptation et consolide le livrable.',
    stage: 'planning',
    canWrite: false,
    source: 'native'
  },
  {
    key: 'domain',
    settingsKey: 'expertMetier',
    title: 'Expert Metier',
    shortLabel: 'Metier',
    provider: 'gemini',
    model: DEFAULT_GEMINI_MODEL,
    focus: 'Analyse les regles metier, risques fonctionnels et contraintes de domaine.',
    stage: 'analysis',
    canWrite: false,
    source: 'native'
  },
  {
    key: 'ux',
    settingsKey: 'uxResearcher',
    title: 'UX Researcher',
    shortLabel: 'UX',
    provider: 'gemini',
    model: DEFAULT_GEMINI_MODEL,
    focus: 'Travaille les parcours, frictions, et criteres d experience utilisateur.',
    stage: 'analysis',
    canWrite: false,
    source: 'native'
  },
  {
    key: 'ui',
    settingsKey: 'uiDesigner',
    title: 'UI Designer',
    shortLabel: 'UI',
    provider: 'kimi',
    model: DEFAULT_KIMI_MODEL,
    focus: 'Definit la direction visuelle, les composants et la coherence graphique.',
    stage: 'analysis',
    canWrite: false,
    source: 'voltagent/awesome-claude-code-subagents'
  },
  {
    key: 'frontend',
    settingsKey: 'frontendFunctional',
    title: 'Frontend Fonctionnel',
    shortLabel: 'Frontend',
    provider: 'kimi',
    model: DEFAULT_KIMI_MODEL,
    focus: 'Implemente les interactions, etats, composants, hooks et styles utiles.',
    stage: 'implementation',
    canWrite: true,
    source: 'voltagent/awesome-claude-code-subagents'
  },
  {
    key: 'apiData',
    settingsKey: 'apiDataEngineer',
    title: 'API / Data Engineer',
    shortLabel: 'API/Data',
    provider: 'kimi',
    model: DEFAULT_KIMI_MODEL,
    focus: 'Intervient seulement si API, backend, donnees, auth ou integration serveur sont necessaires.',
    stage: 'implementation',
    canWrite: true,
    source: 'voltagent/awesome-claude-code-subagents'
  },
  {
    key: 'workflow',
    settingsKey: 'workflowAutomationExpert',
    title: 'Workflow Automation Expert',
    shortLabel: 'Workflow',
    provider: 'kimi',
    model: DEFAULT_KIMI_MODEL,
    focus: 'Concoit et valide les workflows visuels, n8n et automatisations.',
    stage: 'implementation',
    canWrite: true,
    source: 'native'
  },
  {
    key: 'security',
    settingsKey: 'securityReviewer',
    title: 'Security Reviewer',
    shortLabel: 'Security',
    provider: 'claude',
    model: DEFAULT_CLAUDE_MODEL,
    focus: 'Controle permissions, secrets, injections, auth et risques de securite.',
    stage: 'validation',
    canWrite: false,
    source: 'native'
  },
  {
    key: 'qa',
    settingsKey: 'qaValidator',
    title: 'QA Validator',
    shortLabel: 'QA',
    provider: 'kimi',
    model: DEFAULT_KIMI_MODEL,
    focus: 'Valide les tests, scenarios utilisateur, regressions et definition of done.',
    stage: 'validation',
    canWrite: false,
    source: 'native'
  },
  {
    key: 'gitRelease',
    settingsKey: 'gitReleaseManager',
    title: 'Git / Release Manager',
    shortLabel: 'Release',
    provider: 'kimi',
    model: DEFAULT_KIMI_MODEL,
    focus: 'Prepare les impacts Git, changelog, CI et notes de livraison.',
    stage: 'validation',
    canWrite: false,
    source: 'native'
  }
];

export const MULTI_AGENT_FORMATIONS = [
  {
    key: 'product-ui',
    title: 'Produit/UI',
    focus: 'Experience produit, design, frontend fonctionnel et validation visuelle.',
    defaultAgents: ['selector', 'captain', 'domain', 'ux', 'ui', 'frontend', 'qa']
  },
  {
    key: 'fullstack-useful',
    title: 'Fullstack utile',
    focus: 'Frontend, API/data seulement si necessaire, securite et validation.',
    defaultAgents: ['selector', 'captain', 'domain', 'ux', 'frontend', 'apiData', 'security', 'qa']
  },
  {
    key: 'workflow-automation',
    title: 'Workflow/automation',
    focus: 'Workflows visuels, integrations et tests de flux.',
    defaultAgents: ['selector', 'captain', 'domain', 'workflow', 'security', 'qa']
  },
  {
    key: 'audit-refactor',
    title: 'Audit/refactor',
    focus: 'Exploration, refactor prudent, risques et verification.',
    defaultAgents: ['selector', 'captain', 'frontend', 'apiData', 'security', 'qa']
  },
  {
    key: 'release-git',
    title: 'Release/Git',
    focus: 'Review, changelog, Git, CI et preparation de livraison.',
    defaultAgents: ['selector', 'captain', 'security', 'qa', 'gitRelease']
  }
];

export const MODEL_DEFAULTS_BY_PROVIDER = {
  gemini: DEFAULT_GEMINI_MODEL,
  claude: DEFAULT_CLAUDE_MODEL,
  kimi: DEFAULT_KIMI_MODEL,
  ollama: DEFAULT_OLLAMA_MODEL
};

export const REMOTE_MODEL_SUGGESTIONS = [
  DEFAULT_GEMINI_MODEL,
  DEFAULT_GEMINI_PRO_MODEL,
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_KIMI_MODEL,
  KIMI_K2_6_MODEL
];

export const normalizeAIProvider = (provider, fallback = 'gemini') => {
  const value = String(provider || '').trim().toLowerCase();
  return AI_PROVIDER_OPTIONS.some((option) => option.value === value)
    ? value
    : fallback;
};

export const getDefaultModelForProvider = (provider, fallback = DEFAULT_GEMINI_MODEL) => {
  const normalizedProvider = normalizeAIProvider(provider);
  return MODEL_DEFAULTS_BY_PROVIDER[normalizedProvider] || fallback;
};

const getRoleDefinition = (roleKey) => (
  MULTI_AGENT_ROLE_DEFINITIONS.find((role) => role.key === roleKey)
);

const LEGACY_ROLE_KEY_MAP = {
  // Old multi-agent role names → new role keys
  chef: 'captain',
  backend: 'apiData',
  // 'architect' previously mapped to 'security' which was wrong — it's the captain equivalent
  architect: 'captain',
  coder: 'frontend',
  tester: 'qa',
  scrum: 'qa'
};

export const normalizeMultiAgentRole = (roleKey, raw = {}) => {
  const definition = getRoleDefinition(roleKey) || MULTI_AGENT_ROLE_DEFINITIONS[0];
  const provider = normalizeAIProvider(raw.provider, definition.provider);
  const model = String(raw.model || '').trim() || getDefaultModelForProvider(provider, definition.model);

  return {
    provider,
    model
  };
};

export const normalizeMultiAgentRoles = (raw = {}) => (
  MULTI_AGENT_ROLE_DEFINITIONS.reduce((acc, role) => {
    const legacyKey = Object.entries(LEGACY_ROLE_KEY_MAP)
      .find(([, nextKey]) => nextKey === role.key)?.[0];
    acc[role.key] = normalizeMultiAgentRole(role.key, raw?.[role.key] || raw?.[legacyKey]);
    return acc;
  }, {})
);

export const buildMultiAgentModelMap = (rolesConfig = {}) => (
  MULTI_AGENT_ROLE_DEFINITIONS.reduce((acc, role) => {
    const normalized = normalizeMultiAgentRole(role.key, rolesConfig?.[role.key]);
    acc[role.key] = normalized.model;
    return acc;
  }, {})
);

export const getProviderLabel = (provider) => (
  PROVIDER_LABELS[normalizeAIProvider(provider)] || 'IA'
);
