export const EXECUTION_MODES = [
  {
    id: 'ask',
    label: 'Ask',
    icon: '💬',
    description: 'Lecture, explication et recherche. Aucun fichier propose.',
    canProposeFiles: false,
    canUseTerminal: false,
    preferredProvider: null
  },
  {
    id: 'plan',
    label: 'Plan',
    icon: '📋',
    description: 'Exploration et plan validable. Aucune ecriture.',
    canProposeFiles: false,
    canUseTerminal: false,
    preferredProvider: null
  },
  {
    id: 'agent',
    label: 'Agent',
    icon: '🔧',
    description: 'Mono-agent avec diff, permissions et rollback.',
    canProposeFiles: true,
    canUseTerminal: true,
    preferredProvider: null
  }
];

const MODE_BY_ID = EXECUTION_MODES.reduce((acc, mode) => {
  acc[mode.id] = mode;
  return acc;
}, {});

export const normalizeExecutionMode = (value, fallback = 'agent') => (
  MODE_BY_ID[value] ? value : fallback
);

export const getModePolicy = (executionMode) => {
  const modeId = normalizeExecutionMode(executionMode || 'agent');
  const mode = MODE_BY_ID[modeId] || MODE_BY_ID.agent;
  const canProposeFiles = mode.canProposeFiles;
  return {
    ...mode,
    canProposeFiles,
    readOnly: !canProposeFiles,
    canUseTerminal: !!mode.canUseTerminal && modeId !== 'ask' && modeId !== 'plan'
  };
};

export const decoratePromptForMode = (prompt, executionMode) => {
  const policy = getModePolicy(executionMode);
  const lines = [
    `MODE SYSTEME: ${policy.label}`,
    policy.readOnly
      ? 'CONTRAINTE: lecture seule. Ne genere pas de blocs FICHIER, WORKFLOW, SEARCH/REPLACE ou patch applicable.'
      : 'CONTRAINTE: toute modification doit etre proposee en diff/review, jamais appliquee directement.'
  ].filter(Boolean);

  return `${lines.join('\n')}\n\nDEMANDE UTILISATEUR:\n${String(prompt || '').trim()}`;
};

export const shouldProcessFileModifications = (executionMode) => (
  getModePolicy(executionMode).canProposeFiles
);

export const isLocalOnlyProvider = (provider) => {
  const normalized = String(provider || '').trim().toLowerCase();
  return normalized === 'ollama';
};

// _executionMode conservé dans la signature pour compatibilité des call sites
// existants ; n'a plus que 'ask'/'plan'/'agent' (mode Collective/multi-agent
// retiré de l'UI, cf. EXECUTION_MODES ci-dessus), donc le provider actif
// suffit désormais sans branche dédiée.
export const resolveProviderForExecutionMode = (aiProvider, _executionMode) => (
  String(aiProvider || 'gemini').trim().toLowerCase()
);
