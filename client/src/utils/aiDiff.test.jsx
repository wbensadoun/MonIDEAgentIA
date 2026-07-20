import { buildContentFromSelectedHunks, buildContentFromSelectedLines, summarizeDiff } from './aiDiff';

describe('aiDiff utilities', () => {
  test('summarizes a single word change', () => {
    const summary = summarizeDiff('const label = "old";', 'const label = "new";');
    expect(summary.additions).toBe(1);
    expect(summary.deletions).toBe(1);
    expect(summary.hunks).toHaveLength(1);
  });

  test('builds content from selected hunks', () => {
    const oldContent = ['alpha', 'beta', 'c1', 'c2', 'c3', 'c4', 'c5', 'delta'].join('\n');
    const newContent = ['alpha', 'BETA', 'c1', 'c2', 'c3', 'c4', 'c5', 'DELTA'].join('\n');
    const summary = summarizeDiff(oldContent, newContent);
    const partial = buildContentFromSelectedHunks(oldContent, newContent, [summary.hunks[0].id]);

    expect(partial).toContain('BETA');
    expect(partial).toContain('delta');
  });

  test('builds content from selected changed lines', () => {
    const oldContent = ['alpha', 'beta', 'delta'].join('\n');
    const newContent = ['alpha', 'BETA', 'DELTA'].join('\n');
    const summary = summarizeDiff(oldContent, newContent);
    const betaLineIds = summary.hunks[0].lines
      .filter((line) => line.text.toLowerCase().includes('beta'))
      .map((line) => line.id);
    const partial = buildContentFromSelectedLines(oldContent, newContent, betaLineIds, summary.hunks);

    expect(partial).toBe(['alpha', 'BETA', 'delta'].join('\n'));
  });
});
