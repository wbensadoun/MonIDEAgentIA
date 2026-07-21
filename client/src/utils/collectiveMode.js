/**
 * collectiveMode.js
 *
 * Couche de présentation "Collective" au-dessus de buildTeamPlan.
 * - COLLECTIVE_DEPTHS : constante UI (Rapide / Profond)
 * - applyCollectiveDepth(teamPlan, depth) : filtre pur, sans modifier le moteur
 */

/** Agents conservés en mode Rapide (minimum viable pour livrer du code) */
const FAST_KEEP_KEYS = new Set(['selector', 'captain', 'frontend', 'apiData', 'workflow', 'qa']);

export const COLLECTIVE_DEPTHS = [
  {
    id: 'fast',
    label: 'Rapide',
    description: 'Équipe réduite : implémenteurs + QA uniquement. Moins de tokens, résultat immédiat.',
    maxTokens: 4096,
    contextBudget: 'short'
  },
  {
    id: 'deep',
    label: 'Profond',
    description: 'Formation complète : analyse UX/métier, sécurité, validation. Meilleure qualité.',
    maxTokens: null,   // hérite du plan
    contextBudget: null
  }
];

/**
 * Filtre pur : applique la profondeur choisie sur un teamPlan existant.
 * N'appelle pas buildTeamPlan, ne le modifie pas — retourne une copie.
 *
 * @param {object} teamPlan   - Résultat de buildTeamPlan(...)
 * @param {'fast'|'deep'} depth
 * @returns {object} Nouveau teamPlan (copies shallow des tableaux)
 */
export const applyCollectiveDepth = (teamPlan, depth = 'deep') => {
  if (!teamPlan || depth === 'deep') return teamPlan;

  const depthConfig = COLLECTIVE_DEPTHS.find((d) => d.id === depth) || COLLECTIVE_DEPTHS[1];

  // Séparer agents conservés / écartés
  const kept = (teamPlan.selectedAgents || []).filter((a) => FAST_KEEP_KEYS.has(a.key));
  const trimmed = (teamPlan.selectedAgents || []).filter((a) => !FAST_KEEP_KEYS.has(a.key));

  const trimmedAsExcluded = trimmed.map((a) => ({
    key: a.key,
    title: a.title,
    reason: 'Mode Rapide : agent optionnel écarté.'
  }));

  // Recalculer parallelGroups en ne gardant que les keys présentes dans kept
  const keptKeys = new Set(kept.map((a) => a.key));
  const parallelGroups = (teamPlan.parallelGroups || [])
    .map((group) => ({
      ...group,
      agentKeys: group.agentKeys.filter((k) => keptKeys.has(k))
    }))
    .filter((group) => group.agentKeys.length > 0);

  // Abaisser le budget
  const prevBudget = teamPlan.budget || {};
  const budget = {
    ...prevBudget,
    maxTokens: Math.min(
      Number.isFinite(prevBudget.maxTokens) ? prevBudget.maxTokens : depthConfig.maxTokens,
      depthConfig.maxTokens
    ),
    contextBudget: depthConfig.contextBudget
  };

  return {
    ...teamPlan,
    selectedAgents: kept,
    excludedAgents: [
      ...(teamPlan.excludedAgents || []),
      ...trimmedAsExcluded
    ],
    parallelGroups,
    budget
  };
};
