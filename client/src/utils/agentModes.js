export const EXECUTION_MODES = [
  {
    id: 'ask',
    label: 'Ask',
    description: 'Lecture, explication et recherche. Aucun fichier propose.',
    canProposeFiles: false,
    canUseTerminal: false,
    preferredProvider: null
  },
  {
    id: 'plan',
    label: 'Plan',
    description: 'Exploration et plan validable. Aucune ecriture.',
    canProposeFiles: false,
    canUseTerminal: false,
    preferredProvider: null
  },
  {
    id: 'agent',
    label: 'Agent',
    description: 'Mono-agent avec diff, permissions et rollback.',
    canProposeFiles: true,
    canUseTerminal: true,
    preferredProvider: null
  },
  {
    id: 'multi-agent',
    label: 'Collective',
    description: 'Equipe IA adaptative : Rapide ou Profond, cloud ou local prive.',
    canProposeFiles: true,
    canUseTerminal: true,
    preferredProvider: 'multi'
  }
];

export const RUN_PRESETS = [
  {
    id: 'default',
    label: 'General',
    mode: 'agent',
    instruction: ''
  },
  {
    id: 'audit',
    label: 'Audit',
    mode: 'ask',
    instruction: 'Mode Audit: analyse le code en lecture seule. Cite les fichiers et risques. Ne propose aucun bloc FICHIER ni diff.'
  },
  {
    id: 'tests',
    label: 'Tests',
    mode: 'agent',
    instruction: 'Mode Tests: concentre-toi sur les tests utiles, la couverture et les regressions. Si tu proposes du code, limite-toi aux tests et fixtures necessaires.'
  },
  {
    id: 'docs',
    label: 'Docs',
    mode: 'agent',
    instruction: 'Mode Docs: concentre-toi sur README, commentaires utiles et documentation. Evite de modifier le code applicatif sauf demande explicite.'
  },
  {
    id: 'refactor',
    label: 'Refactor',
    mode: 'agent',
    instruction: 'Mode Refactor: conserve le comportement, limite le perimetre, explique les risques et propose des changements atomiques.'
  }
];

const MODE_BY_ID = EXECUTION_MODES.reduce((acc, mode) => {
  acc[mode.id] = mode;
  return acc;
}, {});

const PRESET_BY_ID = RUN_PRESETS.reduce((acc, preset) => {
  acc[preset.id] = preset;
  return acc;
}, {});

export const normalizeExecutionMode = (value, fallback = 'agent') => (
  MODE_BY_ID[value] ? value : fallback
);

export const normalizeRunPreset = (value, fallback = 'default') => (
  PRESET_BY_ID[value] ? value : fallback
);

export const getModePolicy = (executionMode, runPreset = 'default') => {
  const preset = PRESET_BY_ID[normalizeRunPreset(runPreset)] || PRESET_BY_ID.default;
  const modeId = normalizeExecutionMode(executionMode || preset.mode || 'agent');
  const mode = MODE_BY_ID[modeId] || MODE_BY_ID.agent;
  const canProposeFiles = mode.canProposeFiles && !['audit'].includes(preset.id);
  return {
    ...mode,
    preset,
    canProposeFiles,
    readOnly: !canProposeFiles,
    canUseTerminal: !!mode.canUseTerminal && modeId !== 'ask' && modeId !== 'plan'
  };
};

export const decoratePromptForMode = (prompt, executionMode, runPreset = 'default') => {
  const policy = getModePolicy(executionMode, runPreset);
  const lines = [
    `MODE SYSTEME: ${policy.label}`,
    `PRESET: ${policy.preset.label}`,
    policy.readOnly
      ? 'CONTRAINTE: lecture seule. Ne genere pas de blocs FICHIER, WORKFLOW, SEARCH/REPLACE ou patch applicable.'
      : 'CONTRAINTE: toute modification doit etre proposee en diff/review, jamais appliquee directement.',
    policy.preset.instruction
  ].filter(Boolean);

  return `${lines.join('\n')}\n\nDEMANDE UTILISATEUR:\n${String(prompt || '').trim()}`;
};

export const shouldProcessFileModifications = (executionMode, runPreset = 'default') => (
  getModePolicy(executionMode, runPreset).canProposeFiles
);

export const isLocalOnlyProvider = (provider) => {
  const normalized = String(provider || '').trim().toLowerCase();
  return normalized === 'ollama';
};

export const resolveProviderForExecutionMode = (aiProvider, executionMode) => {
  const provider = String(aiProvider || 'gemini').trim().toLowerCase();
  const mode = normalizeExecutionMode(executionMode);
  // En mode multi-agent, on appelle TOUJOURS le routeur unifié 'multi'
  // qui déléguera chaque agent à son provider configuré dans le Roster.
  if (mode === 'multi-agent') return 'multi';
  return provider;
};
