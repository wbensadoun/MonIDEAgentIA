/**
 * Tests unitaires pour applySearchReplace.js
 * Exécution : node --experimental-vm-modules <ce_fichier>
 * (ou via babel-jest si disponible)
 */

const { applyBlock, applyBlocks, parseBlocks, normalizeLF } = require('./applySearchReplace');

// ─── Mini runner ────────────────────────────────────────────────────────────
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
  if (a !== b) throw new Error(`Expected:\n${JSON.stringify(b)}\nGot:\n${JSON.stringify(a)}`);
}

// ─── Tests parseBlocks ───────────────────────────────────────────────────────

console.log('\n── parseBlocks ──');

test('parse un seul bloc', () => {
  const text = `<<<< SEARCH
foo
====
bar
>>>> REPLACE`;
  const blocks = parseBlocks(text);
  assert(blocks.length === 1, 'doit trouver 1 bloc');
  assertEqual(blocks[0].search, 'foo');
  assertEqual(blocks[0].replace, 'bar');
});

test('parse plusieurs blocs', () => {
  const text = `<<<< SEARCH
aaa
====
bbb
>>>> REPLACE
<<<< SEARCH
ccc
====
ddd
>>>> REPLACE`;
  const blocks = parseBlocks(text);
  assert(blocks.length === 2, `attendu 2, obtenu ${blocks.length}`);
  assertEqual(blocks[1].search, 'ccc');
  assertEqual(blocks[1].replace, 'ddd');
});

test('parse bloc avec === variante (8 signes =)', () => {
  const text = `<<<< SEARCH
alpha
========
beta
>>>> REPLACE`;
  const blocks = parseBlocks(text);
  assert(blocks.length === 1, 'doit trouver 1 bloc même avec ========');
});

test('retourne [] si aucun bloc', () => {
  const blocks = parseBlocks('pas de bloc ici');
  assert(blocks.length === 0);
});

test('parse délimiteurs >>> variante', () => {
  const text = `<<<< SEARCH
x
====
y
>>>> REPLACE`;
  const blocks = parseBlocks(text);
  assert(blocks.length === 1);
});

// ─── Tests normalizeLF ──────────────────────────────────────────────────────

console.log('\n── normalizeLF ──');

test('convertit CRLF en LF', () => {
  assertEqual(normalizeLF('a\r\nb'), 'a\nb');
});

test('convertit CR seul en LF', () => {
  assertEqual(normalizeLF('a\rb'), 'a\nb');
});

test('ne touche pas aux LF simples', () => {
  assertEqual(normalizeLF('a\nb'), 'a\nb');
});

// ─── Tests applyBlock ───────────────────────────────────────────────────────

console.log('\n── applyBlock : match exact ──');

test('remplacement exact simple', () => {
  const result = applyBlock('hello world\nfoo\nend', 'foo', 'bar');
  assert(result.ok, result.error);
  assertEqual(result.matchType, 'exact');
  assertEqual(result.content, 'hello world\nbar\nend');
});

test('remplacement exact multi-lignes', () => {
  const src = 'line1\nfunction foo() {\n  return 1;\n}\nline5';
  const search = 'function foo() {\n  return 1;\n}';
  const replace = 'function foo() {\n  return 42;\n}';
  const result = applyBlock(src, search, replace);
  assert(result.ok, result.error);
  assertEqual(result.matchType, 'exact');
  assert(result.content.includes('return 42'), 'doit contenir la nouvelle valeur');
});

test('normalise CRLF avant match exact', () => {
  const src = 'aaa\r\nbbb\r\nccc';
  const search = 'bbb';
  const result = applyBlock(src, search, 'BBB');
  assert(result.ok, result.error);
  assert(result.content.includes('BBB'));
});

console.log('\n── applyBlock : ambigu ──');

test('refuse si >1 occurrence exacte', () => {
  const src = 'foo\nbar\nfoo';
  const result = applyBlock(src, 'foo', 'baz');
  assert(!result.ok, 'doit échouer si ambigu');
  assert(result.error.includes('ambigu'), result.error);
});

console.log('\n── applyBlock : match tolérant ──');

test('tolérant : indentation différente', () => {
  const src = 'function greet() {\n    console.log("hello");\n    return true;\n}';
  // L'IA produit une indentation avec 2 espaces, le fichier en a 4
  const search = 'function greet() {\n  console.log("hello");\n  return true;\n}';
  const replace = 'function greet() {\n  console.log("hi");\n  return true;\n}';
  const result = applyBlock(src, search, replace);
  assert(result.ok, `attendu ok, erreur: ${result.error}`);
  assertEqual(result.matchType, 'tolerant');
  assert(result.content.includes('"hi"'), 'doit avoir remplacé');
});

test('tolérant : espaces en fin de ligne', () => {
  const src = 'const x = 1;   \nconst y = 2;';
  const search = 'const x = 1;\nconst y = 2;';
  const result = applyBlock(src, search, 'const x = 10;\nconst y = 20;');
  assert(result.ok, `erreur: ${result.error}`);
  assertEqual(result.matchType, 'tolerant');
});

test('tolérant : lignes vides en début/fin du bloc search IA', () => {
  const src = 'alpha\nbeta\ngamma';
  // L'IA ajoute une ligne vide avant et après
  const search = '\nbeta\n';
  const result = applyBlock(src, search, 'BETA');
  assert(result.ok, `erreur: ${result.error}`);
  assert(result.content.includes('BETA'), 'doit avoir remplacé beta');
});

test('tolérant : ambigu → refuse', () => {
  const src = 'function a() {}\nfunction b() {}\nfunction a() {}';
  const search = 'function a() {}';
  const result = applyBlock(src, search, 'function a() { return 1; }');
  assert(!result.ok, 'doit refuser car ambigu');
  assert(result.error.includes('ambigu'), result.error);
});

console.log('\n── applyBlock : introuvable ──');

test('introuvable → erreur descriptive', () => {
  const result = applyBlock('hello world', 'DOES NOT EXIST', 'replacement');
  assert(!result.ok);
  assert(result.error.includes('introuvable'), result.error);
  assertEqual(result.content, 'hello world', 'content inchangé');
});

test('bloc search vide → erreur', () => {
  const result = applyBlock('hello', '   \n  \n  ', 'something');
  assert(!result.ok);
  assert(result.error.includes('vide'), result.error);
});

// ─── Tests applyBlocks ──────────────────────────────────────────────────────

console.log('\n── applyBlocks ──');

test('applique plusieurs blocs en séquence', () => {
  const src = 'const a = 1;\nconst b = 2;\nconst c = 3;';
  const aiOutput = `<<<< SEARCH
const a = 1;
====
const a = 10;
>>>> REPLACE
<<<< SEARCH
const c = 3;
====
const c = 30;
>>>> REPLACE`;
  const result = applyBlocks(src, aiOutput);
  assert(result.ok, JSON.stringify(result.errors));
  assertEqual(result.appliedCount, 2);
  assert(result.content.includes('const a = 10;'));
  assert(result.content.includes('const c = 30;'));
  assert(result.content.includes('const b = 2;'), 'b doit rester intact');
});

test('ok=false si au moins un bloc échoue, mais les autres sont appliqués', () => {
  const src = 'foo\nbar\nbaz';
  const aiOutput = `<<<< SEARCH
foo
====
FOO
>>>> REPLACE
<<<< SEARCH
DOES NOT EXIST
====
X
>>>> REPLACE`;
  const result = applyBlocks(src, aiOutput);
  assert(!result.ok, 'doit être ko à cause du bloc introuvable');
  assertEqual(result.appliedCount, 1, 'mais le premier bloc doit avoir été appliqué');
  assert(result.content.includes('FOO'));
  assert(result.errors.length === 1);
});

test('aucun bloc → erreur', () => {
  const result = applyBlocks('content', 'aucun bloc ici');
  assert(!result.ok);
  assert(result.errors[0].includes('Aucun bloc'), result.errors[0]);
});

// ─── Résumé ─────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(45)}`);
console.log(`  ${passed} passed  |  ${failed} failed`);
console.log('─'.repeat(45));

if (failed > 0) process.exit(1);
