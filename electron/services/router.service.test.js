'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  classifyPromptProfile,
  resolveModelForProfile,
  validateRouterDecision,
  routeToDecision,
  normalizeReasoningEffort,
  applyReasoningEffortFloor,
  raiseDecisionProfile
} = require('./router.service');

test('internal profile classifier keeps strong signals deterministic', () => {
  assert.equal(classifyPromptProfile('bonjour').profile, 'lumen');
  assert.equal(classifyPromptProfile('corrige ce bug dans App.js').profile, 'luna');
  assert.equal(classifyPromptProfile('analyse l architecture du repository et planifie le refactoring').profile, 'sol');
  assert.equal(classifyPromptProfile('audite la sécurité et la migration de paiement en production').profile, 'astral');
});

test('profile resolution selects a physical model without changing the internal profile', async () => {
  const lumen = await resolveModelForProfile('claude', 'lumen', {
    liveModels: ['claude-haiku-4-6', 'claude-sonnet-4-6']
  });
  const astral = await resolveModelForProfile('claude', 'astral', {
    liveModels: ['claude-haiku-4-6', 'claude-sonnet-4-6', 'claude-opus-4-1']
  });
  const sol = await resolveModelForProfile('claude', 'sol', {
    liveModels: ['claude-haiku-4-6', 'claude-sonnet-4-6', 'claude-opus-4-1']
  });

  assert.equal(lumen.resolved, 'claude-haiku-4-6');
  assert.equal(sol.resolved, 'claude-sonnet-4-6');
  assert.equal(astral.resolved, 'claude-opus-4-1');
});

test('Neven router leaves physical model selection to the managed control plane', async () => {
  const calls = [];
  const result = await routeToDecision({
    projectPath: null,
    userPrompt: 'compare les agents disponibles et choisis le meilleur workflow',
    trustedRouterConfiguration: { provider: 'neven' },
    listAgents: async () => ({ agents: [{ name: 'coder' }] }),
    listSkills: async () => ({ skills: [] }),
    runSingleCompletionProvider: async (request) => {
      calls.push(request);
      return { success: false };
    }
  });

  assert.equal(calls[0].provider, 'neven');
  assert.equal(calls[0].options.model, null);
  assert.equal(result.model.provider, 'neven');
  assert.equal(result.model.resolved, null);
});

test('profile validation overrides contradictory mode and complexity fields', () => {
  const result = validateRouterDecision({
    mode: 'single_agent',
    complexity: 'light',
    profile: 'astral'
  }, new Set(), new Set());

  assert.deepEqual(result, {
    mode: 'multi_agent',
    agent: null,
    skills: [],
    complexity: 'premium',
    profile: 'astral'
  });
});

test('route decision uses the internal profile while the UI-facing decision stays semantic', async () => {
  const result = await routeToDecision({
    projectPath: null,
    userPrompt: 'bonjour',
    trustedRouterConfiguration: { provider: 'claude' },
    listAgents: async () => ({ agents: [{ name: 'neven-coder' }] }),
    listSkills: async () => ({ skills: [] }),
    runSingleCompletionProvider: async () => ({ success: false })
  });

  assert.equal(result.decision.profile, 'lumen');
  assert.equal(result.model.resolved, 'claude-haiku-4-6');
  assert.equal(result.execution.profile, 'lumen');
});

test('route fallback does not call an LLM when agents and skills are absent', async () => {
  let completionCalls = 0;
  const result = await routeToDecision({
    projectPath: null,
    userPrompt: 'refactor the complete repository architecture',
    trustedRouterConfiguration: { provider: 'claude' },
    listAgents: async () => ({ agents: [] }),
    listSkills: async () => ({ skills: [] }),
    runSingleCompletionProvider: async () => {
      completionCalls += 1;
      return { success: true, text: '{}' };
    }
  });

  assert.equal(completionCalls, 0);
  assert.equal(result.source, 'fallback');
  assert.equal(result.decision.profile, 'lumen');
  assert.equal(result.execution.profile, 'lumen');
});

// ---------------------------------------------------------------------------
// Effort de raisonnement (plancher sur le profil interne)
// ---------------------------------------------------------------------------

test('reasoning effort normalization falls back to auto for unknown values', () => {
  assert.equal(normalizeReasoningEffort('low'), 'low');
  assert.equal(normalizeReasoningEffort('ULTRA'), 'ultra');
  assert.equal(normalizeReasoningEffort('  Medium '), 'medium');
  assert.equal(normalizeReasoningEffort('max'), 'auto');
  assert.equal(normalizeReasoningEffort(null), 'auto');
  assert.equal(normalizeReasoningEffort(undefined), 'auto');
});

test('reasoning effort floor raises the profile without ever lowering it', () => {
  // low -> plancher luna
  assert.equal(applyReasoningEffortFloor('lumen', 'low'), 'luna');
  assert.equal(applyReasoningEffortFloor('luna', 'low'), 'luna');
  assert.equal(applyReasoningEffortFloor('astral', 'low'), 'astral');
  // medium -> plancher sol
  assert.equal(applyReasoningEffortFloor('lumen', 'medium'), 'sol');
  assert.equal(applyReasoningEffortFloor('sol', 'medium'), 'sol');
  // high/ultra -> plancher astral
  assert.equal(applyReasoningEffortFloor('lumen', 'high'), 'astral');
  assert.equal(applyReasoningEffortFloor('sol', 'ultra'), 'astral');
  assert.equal(applyReasoningEffortFloor('astral', 'ultra'), 'astral');
  // auto -> aucun changement
  assert.equal(applyReasoningEffortFloor('lumen', 'auto'), 'lumen');
  assert.equal(applyReasoningEffortFloor('astral', 'auto'), 'astral');
  // valeur invalide -> auto -> aucun changement
  assert.equal(applyReasoningEffortFloor('lumen', 'nawak'), 'lumen');
});

test('raiseDecisionProfile keeps agent/skills and derives mode/complexity from the raised profile', () => {
  const decision = { mode: 'single_agent', agent: 'coder', skills: ['review'], complexity: 'light', profile: 'lumen' };
  const raised = raiseDecisionProfile(decision, 'medium');
  assert.equal(raised.profile, 'sol');
  assert.equal(raised.mode, 'orchestrator');
  assert.equal(raised.complexity, 'premium');
  assert.equal(raised.agent, 'coder');
  assert.deepEqual(raised.skills, ['review']);

  const raisedOpus = raiseDecisionProfile(decision, 'ultra');
  assert.equal(raisedOpus.profile, 'astral');
  assert.equal(raisedOpus.mode, 'multi_agent');

  // Pas de rehaussement -> decision d'origine retournee telle quelle.
  assert.equal(raiseDecisionProfile(decision, 'auto'), decision);
});

test('routeToDecision applies the reasoning effort floor on the L1 trivial path', async () => {
  const result = await routeToDecision({
    projectPath: null,
    userPrompt: 'bonjour',
    trustedRouterConfiguration: { provider: 'claude', settings: { reasoningEffort: 'high' } },
    listAgents: async () => ({ agents: [{ name: 'coder' }] }),
    listSkills: async () => ({ skills: [] }),
    runSingleCompletionProvider: async () => ({ success: false })
  });

  assert.equal(result.reasoningEffort, 'high');
  assert.equal(result.decision.profile, 'astral');
  assert.equal(result.execution.profile, 'astral');
});

test('routeToDecision with auto effort keeps the historical profile', async () => {
  const result = await routeToDecision({
    projectPath: null,
    userPrompt: 'bonjour',
    trustedRouterConfiguration: { provider: 'claude', settings: { reasoningEffort: 'auto' } },
    listAgents: async () => ({ agents: [{ name: 'coder' }] }),
    listSkills: async () => ({ skills: [] }),
    runSingleCompletionProvider: async () => ({ success: false })
  });

  assert.equal(result.reasoningEffort, 'auto');
  assert.equal(result.decision.profile, 'lumen');
});

test('routeToDecision applies the reasoning effort floor on the L2 classification path', async () => {
  const result = await routeToDecision({
    projectPath: null,
    userPrompt: 'compare les agents disponibles et choisis le meilleur workflow',
    trustedRouterConfiguration: { provider: 'claude', settings: { reasoningEffort: 'medium' } },
    listAgents: async () => ({ agents: [{ name: 'coder' }] }),
    listSkills: async () => ({ skills: [] }),
    runSingleCompletionProvider: async () => ({
      success: true,
      text: '{"mode":"single_agent","agent":null,"skills":[],"complexity":"light","profile":"lumen"}'
    })
  });

  assert.equal(result.source, 'llm');
  assert.equal(result.decision.profile, 'sol');
  assert.equal(result.model.profile, 'sol');
});
