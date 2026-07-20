import { mapRouterModeToExecutionMode, matchAgentByName, matchSkillByName } from './routerDecision';

describe('routerDecision', () => {
  test('maps router modes to existing execution modes', () => {
    expect(mapRouterModeToExecutionMode('single_agent')).toBe('agent');
    expect(mapRouterModeToExecutionMode('orchestrator')).toBe('multi-agent');
    expect(mapRouterModeToExecutionMode('multi_agent')).toBe('multi-agent');
  });

  test('falls back to agent for unrecognized or missing modes', () => {
    expect(mapRouterModeToExecutionMode('something_unknown')).toBe('agent');
    expect(mapRouterModeToExecutionMode('')).toBe('agent');
    expect(mapRouterModeToExecutionMode(null)).toBe('agent');
    expect(mapRouterModeToExecutionMode(undefined)).toBe('agent');
  });

  test('matches an agent by case-insensitive exact name', () => {
    const agents = [
      { name: 'Frontend', scope: 'workspace' },
      { name: 'API Data', scope: 'global' }
    ];

    expect(matchAgentByName(agents, 'frontend')).toBe(agents[0]);
    expect(matchAgentByName(agents, 'API DATA')).toBe(agents[1]);
    expect(matchAgentByName(agents, 'Frontend')).toBe(agents[0]);
  });

  test('returns null when the agent name is falsy or unmatched', () => {
    const agents = [{ name: 'Frontend', scope: 'workspace' }];

    expect(matchAgentByName(agents, '')).toBeNull();
    expect(matchAgentByName(agents, null)).toBeNull();
    expect(matchAgentByName(agents, undefined)).toBeNull();
    expect(matchAgentByName(agents, 'Unknown Agent')).toBeNull();
  });

  test('never throws on empty or malformed agent input', () => {
    expect(matchAgentByName([], 'frontend')).toBeNull();
    expect(matchAgentByName(null, 'frontend')).toBeNull();
    expect(matchAgentByName(undefined, 'frontend')).toBeNull();
    expect(matchAgentByName([null, undefined, {}, { name: 42 }], 'frontend')).toBeNull();
  });

  test('matches a skill by case-insensitive exact name', () => {
    const skills = [
      { name: 'Code Review', scope: 'global' },
      { name: 'Docs', scope: 'workspace' }
    ];

    expect(matchSkillByName(skills, 'code review')).toBe(skills[0]);
    expect(matchSkillByName(skills, 'DOCS')).toBe(skills[1]);
  });

  test('never throws on empty or malformed skill input', () => {
    expect(matchSkillByName([], 'docs')).toBeNull();
    expect(matchSkillByName(null, 'docs')).toBeNull();
    expect(matchSkillByName(undefined, 'docs')).toBeNull();
    expect(matchSkillByName([{ name: '' }, { name: null }], 'docs')).toBeNull();
  });
});
