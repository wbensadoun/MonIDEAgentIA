'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createEmbeddingAdapter,
  exactPathScore,
  exactSymbolScore,
  rankHybridResults
} = require('./hybrid-rag-retrieval.service');

const scope = (query, topK = 3) => ({
  version: 1,
  currentProject: {
    kind: 'current-project',
    projectId: 'rp_current_project_session',
    projectPath: 'C:/trusted'
  },
  openProjects: Object.freeze([]),
  nevenContext: null,
  query,
  topK
});

test('hybrid retrieval requires an opaque current project and abstains safely', async () => {
  await assert.rejects(
    () => rankHybridResults({ version: 1, currentProject: null, query: 'anything', topK: 1 }, { indexes: [] }),
    (error) => error.code === 'RETRIEVAL_NO_AUTHORIZED_PROJECT'
  );
  const result = await rankHybridResults(scope('does-not-exist'), { indexes: [{ projectKind: 'current-project', entries: [] }] });
  assert.equal(result.retrievalStatus, 'abstained');
  assert.equal(result.retrievalMode, 'lexical-fallback');
  assert.equal(result.vector.active, false);
});

test('lexical fallback ranks exact paths and symbols without pretending to be semantic', async () => {
  assert.equal(exactPathScore('src/components/App.tsx', 'src/components/App.tsx'), 100);
  assert.equal(exactSymbolScore({ symbols: ['renderApp'] }, 'renderApp'), 90);
  const result = await rankHybridResults(scope('src/components/App.tsx'), {
    indexes: [{
      projectKind: 'current-project',
      entries: [
        { filePath: 'src/components/App.tsx', text: 'export function renderApp() {}', symbols: ['renderApp'], score: 0 },
        { filePath: 'src/other.ts', text: 'unrelated', score: 0 }
      ]
    }]
  });
  assert.equal(result.retrievalMode, 'lexical-fallback');
  assert.equal(result.routing.reason, 'no-local-embedding-adapter');
  assert.equal(result.vector.enabled, false);
  assert.equal(result.results[0].filePath, 'src/components/App.tsx');
  assert.equal(result.results[0].exactPathScore, 100);
  assert.equal(result.results[0].vectorScore, 0);
});

test('a real embedding adapter activates vector reranking only with semantic index vectors', async () => {
  const adapter = createEmbeddingAdapter({ name: 'test-local-model', embed: async () => [1, 0] });
  const result = await rankHybridResults(scope('authentication'), {
    indexes: [{
      projectKind: 'current-project',
      entries: [
        { filePath: 'src/vector.ts', text: 'authentication', score: 1, embedding: [1, 0] },
        { filePath: 'src/lexical.ts', text: 'authentication', score: 1, embedding: [0, 1] }
      ]
    }]
  }, { embeddingAdapter: adapter });
  assert.equal(result.retrievalMode, 'hybrid');
  assert.equal(result.vector.active, true);
  assert.equal(result.vector.adapter, 'test-local-model');
  assert.equal(result.results[0].filePath, 'src/vector.ts');
});

test('lexical fallback ignores lexical fingerprints as semantic vectors', async () => {
  const result = await rankHybridResults(scope('query'), {
    indexes: [{
      projectKind: 'current-project',
      entries: [{ filePath: 'src/file.ts', text: 'query', score: 1, lexicalFingerprint: [1, 0] }]
    }]
  }, { embeddingAdapter: createEmbeddingAdapter({ name: 'not-enabled' }) });
  assert.equal(result.retrievalMode, 'lexical-fallback');
  assert.equal(result.vector.active, false);
  assert.equal(result.results[0].vectorScore, 0);
});
