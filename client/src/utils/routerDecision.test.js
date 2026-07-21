import {
  mapRouterModeToExecutionMode,
  mapComplexityToDepth,
  matchAgentByName,
  matchSkillByName,
  createFallbackRouterDecision,
  classifyPromptLayer1
} from './routerDecision';

describe('routerDecision', () => {
  describe('mapRouterModeToExecutionMode', () => {
    test('single_agent -> agent', () => {
      expect(mapRouterModeToExecutionMode('single_agent')).toBe('agent');
    });

    test('orchestrator and multi_agent -> multi-agent', () => {
      expect(mapRouterModeToExecutionMode('orchestrator')).toBe('multi-agent');
      expect(mapRouterModeToExecutionMode('multi_agent')).toBe('multi-agent');
    });

    test('unknown / malformed -> agent (safe default)', () => {
      expect(mapRouterModeToExecutionMode('nonsense')).toBe('agent');
      expect(mapRouterModeToExecutionMode(null)).toBe('agent');
      expect(mapRouterModeToExecutionMode(undefined)).toBe('agent');
    });
  });

  describe('mapComplexityToDepth', () => {
    test('premium -> deep, light -> fast', () => {
      expect(mapComplexityToDepth('premium')).toBe('deep');
      expect(mapComplexityToDepth('light')).toBe('fast');
    });

    test('is case-insensitive and defaults to fast', () => {
      expect(mapComplexityToDepth('PREMIUM')).toBe('deep');
      expect(mapComplexityToDepth('')).toBe('fast');
      expect(mapComplexityToDepth(undefined)).toBe('fast');
    });
  });

  describe('matchAgentByName', () => {
    const agents = [
      { name: 'Refactor Pro', scope: 'global' },
      { name: 'Test Writer', scope: 'project' }
    ];

    test('matches by plain name, case-insensitively', () => {
      expect(matchAgentByName(agents, 'refactor pro')).toBe(agents[0]);
    });

    test('returns null for missing name or non-array input', () => {
      expect(matchAgentByName(agents, 'unknown')).toBeNull();
      expect(matchAgentByName(agents, '')).toBeNull();
      expect(matchAgentByName(null, 'Refactor Pro')).toBeNull();
    });
  });

  describe('matchSkillByName', () => {
    const skills = [
      { name: 'pdf-editing', scope: 'global' },
      { name: 'sql-tuning', scope: 'project' }
    ];

    test('matches by plain name', () => {
      expect(matchSkillByName(skills, 'pdf-editing')).toBe(skills[0]);
    });

    test('matches by defensive scope/name form', () => {
      expect(matchSkillByName(skills, 'project/sql-tuning')).toBe(skills[1]);
    });

    test('returns null for unknown / empty / non-array', () => {
      expect(matchSkillByName(skills, 'unknown')).toBeNull();
      expect(matchSkillByName(skills, '')).toBeNull();
      expect(matchSkillByName(undefined, 'pdf-editing')).toBeNull();
    });
  });

  describe('createFallbackRouterDecision', () => {
    test('is a single-agent / light / fallback decision', () => {
      expect(createFallbackRouterDecision()).toEqual({
        mode: 'single_agent',
        agent: null,
        skills: [],
        complexity: 'light',
        model: null,
        source: 'fallback'
      });
    });
  });

  describe('classifyPromptLayer1', () => {
    test('empty and greetings are trivial', () => {
      expect(classifyPromptLayer1('').trivial).toBe(true);
      expect(classifyPromptLayer1('Bonjour').trivial).toBe(true);
      expect(classifyPromptLayer1('merci !').trivial).toBe(true);
      expect(classifyPromptLayer1('hello there').trivial).toBe(true);
    });

    test('real coding requests are not trivial even when short', () => {
      expect(classifyPromptLayer1('fix the bug').trivial).toBe(false);
      expect(classifyPromptLayer1('crée un composant').trivial).toBe(false);
      expect(classifyPromptLayer1('Refactor App.js and add tests for the router').trivial).toBe(false);
    });
  });
});
