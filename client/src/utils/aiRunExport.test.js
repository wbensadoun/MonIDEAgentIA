import { buildRunExportPayload, buildRunMarkdown } from './aiRunExport';

const run = {
  id: 'run:demo/1',
  prompt: 'Change one word',
  provider: 'gemini',
  model: 'gemini-test',
  status: 'verified',
  startedAt: '2026-05-30T10:00:00.000Z',
  finishedAt: '2026-05-30T10:01:00.000Z',
  changes: [
    {
      filePath: 'src/demo.js',
      status: 'verified',
      additions: 1,
      deletions: 1
    }
  ],
  logs: [
    {
      at: '2026-05-30T10:00:01.000Z',
      type: 'verified',
      filePath: 'src/demo.js',
      message: 'Changement applique et relu'
    }
  ]
};

test('builds a JSON export payload for an AI run', () => {
  const payload = buildRunExportPayload(run, 'json');

  expect(payload.filename).toBe('run_demo_1.json');
  expect(payload.mimeType).toBe('application/json');
  expect(JSON.parse(payload.content)).toMatchObject({
    id: 'run:demo/1',
    prompt: 'Change one word',
    status: 'verified'
  });
});

test('builds a Markdown export payload for an AI run', () => {
  const payload = buildRunExportPayload(run, 'markdown');

  expect(payload.filename).toBe('run_demo_1.md');
  expect(payload.mimeType).toBe('text/markdown');
  expect(payload.content).toContain('# AI Change Run run:demo/1');
  expect(payload.content).toContain('- src/demo.js [verified] +1 -1');
  expect(payload.content).toContain('Changement applique et relu');
});

test('buildRunMarkdown includes empty fallbacks', () => {
  const markdown = buildRunMarkdown({ id: 'run-empty' });

  expect(markdown).toContain('Status: unknown');
  expect(markdown).toContain('_No prompt captured._');
});
