/**
 * Tests pour collectiveMode.js
 * Exécution : node client/src/utils/collectiveMode.test.js
 *
 * NOTE : ce fichier utilise require() + un shim minimal d'ESM pour charger le module ES.
 * On se place dans le répertoire du projet principal pour accéder à node_modules.
 */

const { createRequire } = require('module');
const path = require('path');
const fs = require('fs');

// ── Shim ESM-in-CJS : on transpile via @babel/core (dépôt principal) ──
const MAIN_NODE_MODULES = 'C:/Users/Utilisateur1/GeminiAgentProject/MonIDEAgentIA/client/node_modules';
const babel = require(`${MAIN_NODE_MODULES}/@babel/core`);
const presetPath = `${MAIN_NODE_MODULES}/babel-preset-react-app/index.js`;

function loadESM(relPath) {
  const absPath = path.resolve(__dirname, relPath);
  const src = fs.readFileSync(absPath, 'utf-8');
  const result = babel.transformSync(src, {
    filename: absPath,
    presets: [presetPath],
    sourceType: 'module'
  });
  const mod = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', result.code)(mod, mod.exports, require);
  return mod.exports;
}

process.env.NODE_ENV = 'development';
const { COLLECTIVE_DEPTHS, applyCollectiveDepth, resolveCollectiveProvider } = loadESM('./collectiveMode.js');

// ── Mini runner ──────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗  ${name}`);
    console.error(`     ${err.message}`);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'assertion failed');
}

function assertEqual(a, b) {
  const as = JSON.stringify(a);
  const bs = JSON.stringify(b);
  if (as !== bs) throw new Error(`Expected:\n${bs}\nGot:\n${as}`);
}

// ── Fixture buildTeamPlan-like ────────────────────────────────────────────────
const makePlan = () => ({
  id: 'team-1',
  formationKey: 'product-ui',
  formationLabel: 'Produit/UI',
  formationFocus: 'Experience produit',
  appKind: 'frontend-only',
  selectedAgents: [
    { key: 'selector', title: 'Selectionneur', stage: 'selection' },
    { key: 'captain', title: 'Capitaine Projet', stage: 'planning' },
    { key: 'domain', title: 'Expert Metier', stage: 'analysis' },
    { key: 'ux', title: 'UX Researcher', stage: 'analysis' },
    { key: 'ui', title: 'UI Designer', stage: 'analysis' },
    { key: 'frontend', title: 'Frontend Fonctionnel', stage: 'implementation' },
    { key: 'qa', title: 'QA Validator', stage: 'validation' }
  ],
  excludedAgents: [{ key: 'apiData', title: 'API / Data Engineer', reason: 'Pas necessaire.' }],
  parallelGroups: [
    { id: 'selection', label: 'selection', agentKeys: ['selector'], mode: 'sequential' },
    { id: 'analysis', label: 'analysis', agentKeys: ['domain', 'ux', 'ui'], mode: 'parallel' },
    { id: 'planning', label: 'planning', agentKeys: ['captain'], mode: 'sequential' },
    { id: 'implementation', label: 'implementation', agentKeys: ['frontend'], mode: 'sequential' },
    { id: 'validation', label: 'validation', agentKeys: ['qa'], mode: 'parallel' }
  ],
  budget: {
    mode: 'safe',
    profile: 'Standard',
    maxConcurrentLocal: 1,
    maxConcurrentCloud: 3,
    maxTokens: 8192,
    contextBudget: 'medium'
  },
  acceptanceCriteria: ['Les agents exclus ne produisent rien hors perimetre.']
});

// ── Tests COLLECTIVE_DEPTHS ───────────────────────────────────────────────────
console.log('\n── COLLECTIVE_DEPTHS ──');

test('contient 2 entrées fast et deep', () => {
  assert(Array.isArray(COLLECTIVE_DEPTHS), 'doit être un tableau');
  assertEqual(COLLECTIVE_DEPTHS.length, 2);
  assertEqual(COLLECTIVE_DEPTHS[0].id, 'fast');
  assertEqual(COLLECTIVE_DEPTHS[1].id, 'deep');
});

test('fast a maxTokens ≤ 4096', () => {
  const fast = COLLECTIVE_DEPTHS.find((d) => d.id === 'fast');
  assert(fast.maxTokens <= 4096, `maxTokens devrait être ≤ 4096, obtenu: ${fast.maxTokens}`);
});

// ── Tests applyCollectiveDepth — deep ─────────────────────────────────────────
console.log('\n── applyCollectiveDepth : deep ──');

test('deep → retourne le plan tel quel', () => {
  const plan = makePlan();
  const result = applyCollectiveDepth(plan, 'deep');
  assert(result === plan, 'doit retourner la même référence');
});

test('depth non fournie → deep par défaut', () => {
  const plan = makePlan();
  const result = applyCollectiveDepth(plan);
  assert(result === plan, 'sans paramètre = deep');
});

test('plan null → retourne null', () => {
  assert(applyCollectiveDepth(null, 'fast') === null);
});

// ── Tests applyCollectiveDepth — fast ────────────────────────────────────────
console.log('\n── applyCollectiveDepth : fast ──');

test('fast → selectedAgents ne contient que selector/captain/frontend/apiData/workflow/qa', () => {
  const result = applyCollectiveDepth(makePlan(), 'fast');
  const keys = result.selectedAgents.map((a) => a.key);
  const forbidden = keys.filter((k) => ['domain', 'ux', 'ui', 'security', 'gitRelease'].includes(k));
  assertEqual(forbidden, []);
  assert(keys.includes('selector'), 'selector doit rester');
  assert(keys.includes('captain'), 'captain doit rester');
  assert(keys.includes('frontend'), 'frontend doit rester');
  assert(keys.includes('qa'), 'qa doit rester');
});

test('fast → domain/ux/ui migrent vers excludedAgents avec la bonne raison', () => {
  const result = applyCollectiveDepth(makePlan(), 'fast');
  const excludedKeys = result.excludedAgents.map((a) => a.key);
  assert(excludedKeys.includes('domain'), 'domain doit être exclu');
  assert(excludedKeys.includes('ux'), 'ux doit être exclu');
  assert(excludedKeys.includes('ui'), 'ui doit être exclu');
  const domainEntry = result.excludedAgents.find((a) => a.key === 'domain');
  assert(domainEntry.reason.includes('Mode Rapide'), `reason incorrecte : ${domainEntry.reason}`);
});

test('fast → excludedAgents combine anciens + nouveaux (apiData déjà exclu conservé)', () => {
  const result = applyCollectiveDepth(makePlan(), 'fast');
  const excludedKeys = result.excludedAgents.map((a) => a.key);
  assert(excludedKeys.includes('apiData'), 'apiData préexistant doit rester exclu');
});

test('fast → parallelGroups ne contiennent pas les clés écartées', () => {
  const result = applyCollectiveDepth(makePlan(), 'fast');
  const allKeysInGroups = result.parallelGroups.flatMap((g) => g.agentKeys);
  const forbidden = allKeysInGroups.filter((k) => ['domain', 'ux', 'ui'].includes(k));
  assertEqual(forbidden, []);
});

test('fast → le groupe analysis disparaît (tous ses agents écartés)', () => {
  const result = applyCollectiveDepth(makePlan(), 'fast');
  const analysisGroup = result.parallelGroups.find((g) => g.id === 'analysis');
  assert(!analysisGroup, 'le groupe analysis doit être supprimé');
});

test('fast → groupes restants ont des agentKeys non vides', () => {
  const result = applyCollectiveDepth(makePlan(), 'fast');
  result.parallelGroups.forEach((g) => {
    assert(g.agentKeys.length > 0, `groupe ${g.id} est vide`);
  });
});

test('fast → budget.maxTokens abaissé à ≤ 4096', () => {
  const result = applyCollectiveDepth(makePlan(), 'fast');
  assert(result.budget.maxTokens <= 4096, `maxTokens = ${result.budget.maxTokens}, devrait être ≤ 4096`);
});

test('fast → budget.contextBudget = "short"', () => {
  assertEqual(applyCollectiveDepth(makePlan(), 'fast').budget.contextBudget, 'short');
});

test('fast → autres propriétés du plan conservées (id, formationKey, appKind…)', () => {
  const plan = makePlan();
  const result = applyCollectiveDepth(plan, 'fast');
  assertEqual(result.id, plan.id);
  assertEqual(result.formationKey, plan.formationKey);
  assertEqual(result.appKind, plan.appKind);
});

// ── Test immutabilité ────────────────────────────────────────────────────────
console.log('\n── Immutabilité ──');

test('fast → le plan original n\'est pas muté', () => {
  const plan = makePlan();
  const originalCount = plan.selectedAgents.length;
  const originalExcluded = plan.excludedAgents.length;
  applyCollectiveDepth(plan, 'fast');
  assertEqual(plan.selectedAgents.length, originalCount);
  assertEqual(plan.excludedAgents.length, originalExcluded);
  assertEqual(plan.budget.maxTokens, 8192);
});

// ── Tests resolveCollectiveProvider ──────────────────────────────────────────
console.log('\n── resolveCollectiveProvider ──');

test('localPrivate=true → ollama-multi', () => {
  assertEqual(resolveCollectiveProvider(true), 'ollama-multi');
});

test('localPrivate=false → multi', () => {
  assertEqual(resolveCollectiveProvider(false), 'multi');
});

test('sans argument → multi', () => {
  assertEqual(resolveCollectiveProvider(), 'multi');
});

// ── Résumé ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(45)}`);
console.log(`  ${passed} passed  |  ${failed} failed`);
console.log('─'.repeat(45));

if (failed > 0) process.exit(1);
