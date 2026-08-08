'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  classifyPromptProfile,
  resolveModelForProfile,
  validateRouterDecision,
  routeToDecision
} = require('./router.service');

test('internal profile classifier keeps strong signals deterministic', () => {
  assert.equal(classifyPromptProfile('bonjour').profile, 'haiku');
  assert.equal(classifyPromptProfile('corrige ce bug dans App.js').profile, 'luna');
  assert.equal(classifyPromptProfile('analyse l architecture du repository et planifie le refactoring').profile, 'sol');
  assert.equal(classifyPromptProfile('audite la sécurité et la migration de paiement en production').profile, 'opus');
});

test('profile resolution selects a physical model without changing the internal profile', async () => {
  const haiku = await resolveModelForProfile('claude', 'haiku', {
    liveModels: ['claude-haiku-4-6', 'claude-sonnet-4-6']
  });
  const opus = await resolveModelForProfile('claude', 'opus', {
    liveModels: ['claude-haiku-4-6', 'claude-sonnet-4-6', 'claude-opus-4-1']
  });
  const sol = await resolveModelForProfile('claude', 'sol', {
    liveModels: ['claude-haiku-4-6', 'claude-sonnet-4-6', 'claude-opus-4-1']
  });

  assert.equal(haiku.resolved, 'claude-haiku-4-6');
  assert.equal(sol.resolved, 'claude-sonnet-4-6');
  assert.equal(opus.resolved, 'claude-opus-4-1');
});

test('profile validation overrides contradictory mode and complexity fields', () => {
  const result = validateRouterDecision({
    mode: 'single_agent',
    complexity: 'light',
    profile: 'opus'
  }, new Set(), new Set());

  assert.deepEqual(result, {
    mode: 'multi_agent',
    agent: null,
    skills: [],
    complexity: 'premium',
    profile: 'opus'
  });
});

test('route decision uses the internal profile while the UI-facing decision stays semantic', async () => {
  const result = await routeToDecision({
    projectPath: null,
    userPrompt: 'bonjour',
    provider: 'claude',
    listAgents: async () => ({ agents: [{ name: 'neven-coder' }] }),
    listSkills: async () => ({ skills: [] }),
    runSingleCompletionProvider: async () => ({ success: false })
  });

  assert.equal(result.decision.profile, 'haiku');
  assert.equal(result.model.resolved, 'claude-haiku-4-6');
  assert.equal(result.execution.profile, 'haiku');
});
