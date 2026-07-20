import {
  MULTI_AGENT_FORMATIONS,
  MULTI_AGENT_ROLE_DEFINITIONS,
  getProviderLabel,
  normalizeMultiAgentRoles
} from './multiAgentConfig';

const ROLE_BY_KEY = MULTI_AGENT_ROLE_DEFINITIONS.reduce((acc, role) => {
  acc[role.key] = role;
  return acc;
}, {});

const FORMATION_BY_KEY = MULTI_AGENT_FORMATIONS.reduce((acc, formation) => {
  acc[formation.key] = formation;
  return acc;
}, {});

const toLowerText = (value) => String(value || '').toLowerCase();

const pathListFromProjectFiles = (projectFiles) => {
  const files = projectFiles?.files && typeof projectFiles.files === 'object'
    ? Object.keys(projectFiles.files)
    : [];
  return files.map((filePath) => String(filePath || '').replace(/\\/g, '/'));
};

const fileContentSample = (projectFiles, maxChars = 30000) => {
  const files = projectFiles?.files && typeof projectFiles.files === 'object'
    ? projectFiles.files
    : {};
  let combined = '';
  for (const [filePath, entry] of Object.entries(files)) {
    if (combined.length >= maxChars) break;
    const content = typeof entry?.content === 'string' ? entry.content : '';
    if (!content) continue;
    combined += `\n--- ${filePath} ---\n${content.slice(0, 2500)}`;
  }
  return combined.slice(0, maxChars);
};

export const analyzeProjectSignals = (projectFiles) => {
  const paths = pathListFromProjectFiles(projectFiles);
  const pathText = paths.join('\n').toLowerCase();
  const contentText = fileContentSample(projectFiles).toLowerCase();

  const hasReact = /(^|\/)(package\.json)$/.test(pathText) && contentText.includes('"react"')
    || /\.(jsx|tsx)$/.test(pathText)
    || pathText.includes('src/app.js')
    || pathText.includes('src/app.tsx');
  const hasElectron = contentText.includes('"electron"') || pathText.includes('electron/');
  const hasBackend = /(^|\/)(server|api|routes|controllers|prisma|src\/server|src\/api)\//.test(pathText)
    || contentText.includes('"express"')
    || contentText.includes('"fastify"')
    || contentText.includes('"@nestjs');
  const hasDatabase = /(^|\/)(prisma|migrations|models|entities)\//.test(pathText)
    || contentText.includes('"mongoose"')
    || contentText.includes('"sequelize"')
    || contentText.includes('"@supabase');
  const hasWorkflows = pathText.includes('.vibe-workflows/')
    || pathText.includes('.agent/workflows/')
    || contentText.includes('"nodes"')
    || contentText.includes('"edges"');
  const hasGitConfig = pathText.includes('.github/workflows/')
    || pathText.includes('package.json');

  return {
    fileCount: paths.length,
    hasReact,
    hasElectron,
    hasBackend,
    hasDatabase,
    hasWorkflows,
    hasGitConfig,
    appKind: hasBackend || hasDatabase ? 'fullstack' : hasReact ? 'frontend-only' : 'unknown'
  };
};

export const detectTeamIntent = (userRequest) => {
  const text = toLowerText(userRequest);
  const hasAny = (words) => words.some((word) => text.includes(word));
  const hasBackendNegation = /(?:sans|without|no|aucun|aucune|pas de|pas d')\s+(?:backend|back-end|api|serveur|server|base de donnees|database|bdd)/.test(text)
    || /(?:frontend|front-end)\s*(?:only|uniquement|seul)/.test(text)
    || /(?:uniquement|seulement)\s+(?:frontend|front-end)/.test(text);
  const hasBackendNeed = hasAny(['backend', 'back-end', 'api', 'serveur', 'database', 'bdd', 'base de donnees', 'endpoint', 'prisma'])
    && !hasBackendNegation;

  return {
    ui: hasAny(['ui', 'design', 'interface', 'style', 'css', 'responsive', 'visuel', 'animation', 'ux']),
    workflow: hasAny(['workflow', 'n8n', 'automation', 'automatisation', 'flux', 'zapier']),
    backend: hasBackendNeed,
    noBackend: hasBackendNegation,
    payment: hasAny(['stripe', 'paiement', 'payment', 'checkout', 'abonnement', 'subscription']),
    auth: hasAny(['auth', 'login', 'connexion', 'session', 'oauth', 'better auth']),
    audit: hasAny(['audit', 'refactor', 'review', 'corrige', 'bug', 'performance', 'optimise']),
    release: hasAny(['git', 'commit', 'release', 'changelog', 'ci', 'pull request', 'pr', 'deploy']),
    security: hasAny(['securite', 'security', 'secret', 'permission', 'injection', 'vulnerabilite']),
    tests: hasAny(['test', 'qa', 'validation', 'verifie', 'vérifie']),
    domain: hasAny(['metier', 'métier', 'medical', 'médical', 'juridique', 'finance', 'banque', 'crm', 'erp', 'stripe'])
  };
};

const chooseFormationKey = (intent, signals) => {
  if (intent.workflow) return 'workflow-automation';
  if (intent.release) return 'release-git';
  if (intent.audit && !intent.ui && !intent.backend && !intent.payment && !intent.auth) return 'audit-refactor';
  if (intent.backend || intent.payment || intent.auth || signals.hasBackend || signals.hasDatabase) return 'fullstack-useful';
  return 'product-ui';
};

const addUnique = (target, values) => {
  values.forEach((value) => {
    if (value && !target.includes(value)) target.push(value);
  });
};

const buildAgentReason = (agentKey, formation, intent, signals) => {
  if (agentKey === 'selector') return 'Compose la formation et fixe les dependances.';
  if (agentKey === 'captain') return 'Garde le plan et consolide les sorties.';
  if (agentKey === 'domain') return intent.domain || intent.payment || intent.auth
    ? 'Besoin metier ou integration sensible detecte.'
    : 'Clarifie les criteres produit et les cas limites.';
  if (agentKey === 'apiData') return intent.backend || intent.payment || intent.auth || signals.hasBackend || signals.hasDatabase
    ? 'API, donnees, auth ou integration serveur necessaire.'
    : 'Peut intervenir si le refactor touche des donnees.';
  if (agentKey === 'workflow') return 'Demande orientee workflow/automation.';
  if (agentKey === 'security') return intent.security || intent.payment || intent.auth
    ? 'Risque securite, auth, paiement ou permissions.'
    : 'Validation de securite avant livraison.';
  if (agentKey === 'gitRelease') return 'Demande orientee Git, release ou CI.';
  if (agentKey === 'frontend') return 'Implemente les changements utilisateur visibles.';
  if (agentKey === 'ui') return 'Travaille la coherence visuelle.';
  if (agentKey === 'ux') return 'Travaille le parcours et les criteres utilisateur.';
  if (agentKey === 'qa') return 'Valide le livrable contre les criteres.';
  return formation.focus;
};

export const buildLocalAIBudget = (settings = {}, hardwareProfile = null) => {
  const modeValue = settings.localAIOptimizationMode || settings.optimizationMode;
  const mode = modeValue === 'auto' || modeValue === 'manual'
    ? modeValue
    : 'safe';
  const hasHardwareConsent = settings.localAIHardwareConsent ?? settings.hardwareConsent;
  const manualLocal = Number(settings.localAIMaxConcurrentLocal ?? settings.maxConcurrentLocal);
  const manualCloud = Number(settings.localAIMaxConcurrentCloud ?? settings.maxConcurrentCloud);
  const manualTokens = Number(settings.localAIMaxTokens ?? settings.maxTokens);
  const safeBudget = {
    mode,
    profile: 'Safe',
    maxConcurrentLocal: 1,
    maxConcurrentCloud: Number.isFinite(manualCloud) ? Math.max(1, Math.min(6, Math.floor(manualCloud))) : 3,
    maxTokens: Number.isFinite(manualTokens) ? Math.max(512, Math.min(8192, Math.floor(manualTokens))) : 4096,
    contextBudget: settings.localAIContextBudget || settings.contextBudget || 'short',
    reason: 'Mode prive/safe: aucune lecture hardware et Ollama limite a un agent.'
  };

  if (mode === 'manual') {
    return {
      ...safeBudget,
      profile: 'Manual',
      maxConcurrentLocal: Number.isFinite(manualLocal) ? Math.max(1, Math.min(4, Math.floor(manualLocal))) : 1,
      reason: 'Mode manuel expert configure par utilisateur.'
    };
  }

  if (mode !== 'auto' || !hasHardwareConsent || !hardwareProfile?.success) {
    return safeBudget;
  }

  const ramGb = Number(hardwareProfile.memory?.totalGb) || 0;
  if (ramGb >= 64) {
    return {
      ...safeBudget,
      profile: 'Workstation',
      maxConcurrentLocal: 3,
      contextBudget: 'long',
      maxTokens: Math.max(safeBudget.maxTokens, 6144),
      reason: '64 Go+ RAM detectes: parallelisme local avance mais plafonne.'
    };
  }
  if (ramGb >= 32) {
    return {
      ...safeBudget,
      profile: 'High',
      maxConcurrentLocal: 2,
      contextBudget: 'medium',
      reason: '32-63 Go RAM detectes: deux agents locaux maximum.'
    };
  }
  if (ramGb >= 16) {
    return {
      ...safeBudget,
      profile: 'Standard',
      maxConcurrentLocal: 1,
      contextBudget: 'medium',
      reason: '16-31 Go RAM detectes: un agent generatif local a la fois.'
    };
  }
  return {
    ...safeBudget,
    profile: 'Low',
    maxConcurrentLocal: 1,
    contextBudget: 'short',
    maxTokens: Math.min(safeBudget.maxTokens, 3072),
    reason: 'Moins de 16 Go RAM ou profil inconnu: mode conservateur.'
  };
};

export const buildTeamPlan = ({
  userRequest,
  projectFiles,
  rolesConfig,
  localAISettings,
  hardwareProfile,
  preferredFormationKey,
  disabledAgentKeys = []
} = {}) => {
  const intent = detectTeamIntent(userRequest);
  const signals = analyzeProjectSignals(projectFiles);
  const formationKey = FORMATION_BY_KEY[preferredFormationKey]
    ? preferredFormationKey
    : chooseFormationKey(intent, signals);
  const formation = FORMATION_BY_KEY[formationKey] || FORMATION_BY_KEY['product-ui'];
  const normalizedRoles = normalizeMultiAgentRoles(rolesConfig);
  const selectedKeys = [];
  const disabledSet = new Set(Array.isArray(disabledAgentKeys) ? disabledAgentKeys : []);

  addUnique(selectedKeys, formation.defaultAgents);

  if (intent.ui) addUnique(selectedKeys, ['ux', 'ui', 'frontend']);
  if (intent.workflow || signals.hasWorkflows) addUnique(selectedKeys, ['workflow']);
  if (intent.backend || intent.payment || intent.auth || signals.hasBackend || signals.hasDatabase) addUnique(selectedKeys, ['apiData']);
  if (intent.payment || intent.auth || intent.security) addUnique(selectedKeys, ['domain', 'security']);
  if (intent.release) addUnique(selectedKeys, ['gitRelease']);
  if (intent.tests) addUnique(selectedKeys, ['qa']);

  if (signals.appKind === 'frontend-only' && !intent.backend && !intent.payment && !intent.auth) {
    const apiIndex = selectedKeys.indexOf('apiData');
    if (apiIndex >= 0) selectedKeys.splice(apiIndex, 1);
  }

  for (let index = selectedKeys.length - 1; index >= 0; index -= 1) {
    const key = selectedKeys[index];
    if (key !== 'selector' && disabledSet.has(key)) {
      selectedKeys.splice(index, 1);
    }
  }

  const selectedSet = new Set(selectedKeys);
  const budget = buildLocalAIBudget(localAISettings, hardwareProfile);
  const selectedAgents = selectedKeys
    .map((key) => ROLE_BY_KEY[key])
    .filter(Boolean)
    .map((definition) => {
      const config = normalizedRoles[definition.key] || {};
      return {
        ...definition,
        provider: config.provider || definition.provider,
        providerLabel: getProviderLabel(config.provider || definition.provider),
        model: config.model || definition.model,
        reason: buildAgentReason(definition.key, formation, intent, signals),
        execution: definition.stage === 'analysis' || definition.stage === 'validation' ? 'parallel' : 'sequential'
      };
    });

  const excludedAgents = MULTI_AGENT_ROLE_DEFINITIONS
    .filter((definition) => !selectedSet.has(definition.key))
    .map((definition) => ({
      key: definition.key,
      title: definition.title,
      reason: definition.key === 'apiData' && signals.appKind === 'frontend-only'
        ? 'Projet detecte sans backend et demande sans API/data.'
        : 'Pas necessaire pour cette demande.'
    }));

  const phaseOrder = ['selection', 'analysis', 'planning', 'implementation', 'validation'];
  const parallelGroups = phaseOrder.map((stage) => {
    const agents = selectedAgents.filter((agent) => agent.stage === stage);
    return {
      id: stage,
      label: stage,
      agentKeys: agents.map((agent) => agent.key),
      mode: stage === 'analysis' || stage === 'validation' ? 'parallel' : 'sequential'
    };
  }).filter((group) => group.agentKeys.length > 0);

  return {
    id: `team-${Date.now()}`,
    formationKey,
    formationLabel: formation.title,
    formationFocus: formation.focus,
    appKind: signals.appKind,
    signals,
    intent,
    selectedAgents,
    excludedAgents,
    parallelGroups,
    budget,
    acceptanceCriteria: [
      'Les agents exclus ne produisent rien hors perimetre.',
      'Les artefacts respectent le format FICHIER ou WORKFLOW attendu.',
      'Le QA valide la demande, les tests prioritaires et les regressions visibles.',
      'Le livrable final explique les risques restants.'
    ]
  };
};

export const formatTeamPlanForPrompt = (teamPlan) => {
  if (!teamPlan) return 'Aucun TeamPlan disponible.';
  const selected = (teamPlan.selectedAgents || [])
    .map((agent) => `- ${agent.title} (${agent.providerLabel || agent.provider}/${agent.model}) [${agent.stage}] : ${agent.reason}`)
    .join('\n');
  const excluded = (teamPlan.excludedAgents || [])
    .map((agent) => `- ${agent.title}: ${agent.reason}`)
    .join('\n');
  const groups = (teamPlan.parallelGroups || [])
    .map((group) => `- ${group.label} (${group.mode}): ${group.agentKeys.join(', ')}`)
    .join('\n');

  return `TEAMPLAN
Formation: ${teamPlan.formationLabel}
Focus: ${teamPlan.formationFocus}
Type projet: ${teamPlan.appKind}
Budget local: ${teamPlan.budget?.profile} | local=${teamPlan.budget?.maxConcurrentLocal} | cloud=${teamPlan.budget?.maxConcurrentCloud}

Agents selectionnes:
${selected || '- aucun'}

Agents exclus:
${excluded || '- aucun'}

Groupes execution:
${groups || '- aucun'}

Criteres:
${(teamPlan.acceptanceCriteria || []).map((item) => `- ${item}`).join('\n')}`;
};
