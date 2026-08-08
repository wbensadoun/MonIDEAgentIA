'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  NEVEN_CORE_VERSION,
  buildNevenCoreManifest,
  buildNevenCorePlan,
  buildNevenRouterContext,
  classifyCoreIntent,
  normalizeProfileName
} = require('./neven-core.service');

test('core manifest exposes the expected versioned roles and profiles', () => {
  const manifest = buildNevenCoreManifest();
  assert.equal(manifest.version, NEVEN_CORE_VERSION);
  assert.deepEqual(Object.keys(manifest.roles), ['sol', 'luna', 'terra']);
  assert.deepEqual(Object.keys(manifest.profiles), ['haiku', 'luna', 'sol', 'opus']);
});

test('core intent maps plan, code, qa and critical prompts to the right profile and role', () => {
  const plan = classifyCoreIntent('je dois planifier l architecture du repository');
  const code = classifyCoreIntent('corrige ce bug dans le composant');
  const qa = classifyCoreIntent('audite les tests et verifie les regressions');
  const critical = classifyCoreIntent('migration critique de paiement en production');
  const general = classifyCoreIntent('bonjour');

  assert.equal(plan.kind, 'plan');
  assert.equal(plan.profile, 'sol');
  assert.equal(plan.primaryRole, 'sol');
  assert.equal(code.kind, 'code');
  assert.equal(code.profile, 'luna');
  assert.equal(code.primaryRole, 'luna');
  assert.equal(qa.kind, 'qa');
  assert.equal(qa.profile, 'luna');
  assert.equal(qa.primaryRole, 'terra');
  assert.equal(critical.kind, 'critical');
  assert.equal(critical.profile, 'opus');
  assert.equal(critical.primaryRole, 'sol');
  assert.equal(general.kind, 'general');
  assert.equal(normalizeProfileName('unknown-profile'), 'haiku');
});

test('core plan keeps the right role and capability focus for a planning request', () => {
  const plan = buildNevenCorePlan({
    prompt: 'planifie une refonte de repository avec architecture et checkpoints',
    agents: [
      { name: 'sol-orchestrator', description: 'Plan and orchestrate repository refactors and multi-step architecture work' },
      { name: 'luna-coder', description: 'Implement code changes, fix bugs and patch files' },
      { name: 'terra-qa', description: 'Run test reviews, audit regressions and validate output' },
      { name: 'docs-writer', description: 'Write documentation and release notes' }
    ],
    skills: [
      { name: 'architecture-map', description: 'Design the system architecture and execution stages' },
      { name: 'code-patch', description: 'Apply code changes and patches' },
      { name: 'qa-checklist', description: 'Run checks, tests and regression analysis' },
      { name: 'token-budget', description: 'Keep prompts small and focus on relevant context' }
    ],
    maxAgents: 2,
    maxSkills: 2,
    maxCapabilities: 3
  });

  assert.equal(plan.profile, 'sol');
  assert.equal(plan.primaryRole, 'sol');
  assert.equal(plan.secondaryRole, 'luna');
  assert.ok(plan.capabilities.some((capability) => capability.id === 'planning'));
  assert.ok(plan.selectedAgents.length <= 2);
  assert.ok(plan.selectedSkills.length <= 2);
  assert.ok(plan.summary.includes('NEVEN CORE 2.3.0'));
  assert.ok(plan.summary.includes('profile=sol'));
});

test('router context keeps a compact selection and reports savings', () => {
  const context = buildNevenRouterContext({
    prompt: 'audit la securite du paiement et du workflow',
    agents: [
      { name: 'sol-orchestrator', description: 'Plan and orchestrate repository refactors and multi-step architecture work' },
      { name: 'luna-coder', description: 'Implement code changes, fix bugs and patch files' },
      { name: 'terra-qa', description: 'Run test reviews, audit regressions and validate output' },
      { name: 'security-auditor', description: 'Security review and risk analysis for critical changes' },
      { name: 'docs-writer', description: 'Write documentation and release notes' }
    ],
    skills: [
      { name: 'architecture-map', description: 'Design the system architecture and execution stages' },
      { name: 'security-check', description: 'Security audit and verification checklist' },
      { name: 'code-patch', description: 'Apply code changes and patches' },
      { name: 'qa-checklist', description: 'Run checks, tests and regression analysis' },
      { name: 'token-budget', description: 'Keep prompts small and focus on relevant context' }
    ],
    maxAgents: 2,
    maxSkills: 2,
    maxCapabilities: 3
  });

  assert.equal(context.profile, 'opus');
  assert.equal(context.primaryRole, 'sol');
  assert.equal(context.selectedAgents.length, 2);
  assert.equal(context.selectedSkills.length, 2);
  assert.equal(context.agentBlock.includes('selection compacte'), true);
  assert.equal(context.skillBlock.includes('selection compacte'), true);
  assert.ok(context.budget.savedPercent > 0);
  assert.ok(!context.summary.includes('claude'));
  assert.ok(!context.summary.includes('gemini'));
});
