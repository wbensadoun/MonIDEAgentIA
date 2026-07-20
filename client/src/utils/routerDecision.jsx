// Pure helpers consumed by the Intelligent Router integration in useAI.jsx.
// No React / Electron dependency here on purpose - keep these trivially
// testable and safe to call with malformed/missing data from the backend
// classification step.

const ROUTER_MODE_TO_EXECUTION_MODE = {
  single_agent: 'agent',
  orchestrator: 'multi-agent',
  multi_agent: 'multi-agent'
};

export const mapRouterModeToExecutionMode = (routerMode) => {
  const key = String(routerMode || '').trim();
  return ROUTER_MODE_TO_EXECUTION_MODE[key] || 'agent';
};

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

// Skills are offered to the router (and validated in main.js) using the
// "scope/name" form produced by formatAvailableSkillsListForPrompt /
// validateRouterDecision's skillNameSet (e.g. "global/pdf-editing"), so a
// router decision's skill name arrives scope-prefixed. Match against that
// combined form first, falling back to a plain name match for safety.
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
