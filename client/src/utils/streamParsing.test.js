import {
  extractLastStreamingMatch,
  extractStreamingFileDraft,
  extractStreamingFiles,
  extractStreamingWorkflowDraft,
  normalizeMarkerPath,
  stripReasoningBlocks,
  splitReasoningSegments,
  fromLegacyPermission,
  WORKFLOW_STREAM_REGEX,
  DIFF_STREAM_REGEX,
  FILE_STREAM_REGEX,
  FILE_BLOCK_STREAM_REGEX
} from './streamParsing';

describe('extractLastStreamingMatch', () => {
  test('returns null for empty/undefined text', () => {
    expect(extractLastStreamingMatch(/x/g, '')).toBeNull();
    expect(extractLastStreamingMatch(/x/g, undefined)).toBeNull();
  });

  test('returns the LAST match, not the first, for a repeated pattern', () => {
    const match = extractLastStreamingMatch(/foo(\d)/g, 'foo1 bar foo2 baz foo3');
    expect(match[1]).toBe('3');
  });

  test('does not mutate lastIndex of the regex passed in (rebuilds a fresh one)', () => {
    const shared = /foo(\d)/g;
    extractLastStreamingMatch(shared, 'foo1 foo2');
    expect(shared.lastIndex).toBe(0);
    // calling again with the same shared regex must still find matches,
    // proving no leaked lastIndex state from the previous call
    const second = extractLastStreamingMatch(shared, 'foo9');
    expect(second[1]).toBe('9');
  });
});

describe('extractStreamingFileDraft', () => {
  test('parses filePath/language/code from a **FICHIER:** block', () => {
    const text = '**FICHIER: src/App.js**\n```js\nconst x = 1;\n```';
    const draft = extractStreamingFileDraft(text);
    expect(draft).toEqual({
      filePath: 'src/App.js',
      language: 'js',
      code: 'const x = 1;\n'
    });
  });

  test('returns null when no file block is present', () => {
    expect(extractStreamingFileDraft('just some plain streamed text')).toBeNull();
  });

  test('picks the most recent file block while streaming multiple files', () => {
    const text = '**FICHIER: a.js**\n```js\nA\n```\n**FICHIER: b.js**\n```js\nB';
    expect(extractStreamingFileDraft(text).filePath).toBe('b.js');
  });
});

describe('extractStreamingFiles', () => {
  test('returns [] for empty input', () => {
    expect(extractStreamingFiles('')).toEqual([]);
    expect(extractStreamingFiles(undefined)).toEqual([]);
  });

  test('marks all but the last file as done, last as writing', () => {
    const text = '**FICHIER: a.js**\n...\n**FICHIER: b.js**\n...\n**FICHIER: c.js**\n...';
    expect(extractStreamingFiles(text)).toEqual([
      { path: 'a.js', status: 'done' },
      { path: 'b.js', status: 'done' },
      { path: 'c.js', status: 'writing' }
    ]);
  });

  test('deduplicates consecutive identical headers (re-streamed chunk)', () => {
    const text = '**FICHIER: a.js**\n**FICHIER: a.js**\n**FICHIER: b.js**';
    expect(extractStreamingFiles(text).map((f) => f.path)).toEqual(['a.js', 'b.js']);
  });
});

describe('extractStreamingWorkflowDraft', () => {
  test('parses name/json from a **WORKFLOW:** block', () => {
    const text = '**WORKFLOW: My Flow**\n```json\n{"a":1}\n```';
    expect(extractStreamingWorkflowDraft(text)).toEqual({
      name: 'My Flow',
      json: '{"a":1}\n'
    });
  });

  test('returns null when no workflow block is present', () => {
    expect(extractStreamingWorkflowDraft('no workflow here')).toBeNull();
  });
});

describe('normalizeMarkerPath', () => {
  test('converts backslashes to forward slashes', () => {
    expect(normalizeMarkerPath('src\\App.js')).toBe('src/App.js');
  });

  test('trims whitespace around segments', () => {
    expect(normalizeMarkerPath(' src / hooks / useAI.js ')).toBe('src/hooks/useAI.js');
  });

  test('handles empty/undefined input', () => {
    expect(normalizeMarkerPath('')).toBe('');
    expect(normalizeMarkerPath(undefined)).toBe('');
  });

  test('two visually-different paths pointing at the same file normalize identically', () => {
    expect(normalizeMarkerPath('src\\\\App.js'.replace(/\\\\/g, '\\'))).toBe(
      normalizeMarkerPath('src/App.js')
    );
  });
});

describe('stripReasoningBlocks', () => {
  test('removes a closed <think>...</think> block', () => {
    expect(stripReasoningBlocks('<think>hmm</think>Answer')).toBe('Answer');
  });

  test('removes an UNCLOSED <think> block (stream cut mid-reasoning)', () => {
    expect(stripReasoningBlocks('Answer so far <think>still thinking')).toBe('Answer so far');
  });

  test('handles the <thinking> alias tag too', () => {
    expect(stripReasoningBlocks('<thinking>x</thinking>Done')).toBe('Done');
  });

  test('returns empty string for empty/undefined input', () => {
    expect(stripReasoningBlocks('')).toBe('');
    expect(stripReasoningBlocks(undefined)).toBe('');
  });
});

describe('splitReasoningSegments', () => {
  test('splits interleaved text/reasoning segments in order', () => {
    const segments = splitReasoningSegments('Before <think>reasoning</think> After');
    expect(segments).toEqual([
      { type: 'text', content: 'Before ' },
      { type: 'reasoning', content: 'reasoning' },
      { type: 'text', content: ' After' }
    ]);
  });

  test('captures an unclosed trailing reasoning block (cut generation)', () => {
    const segments = splitReasoningSegments('Before <think>cut off');
    expect(segments).toEqual([
      { type: 'text', content: 'Before ' },
      { type: 'reasoning', content: 'cut off' }
    ]);
  });

  test('returns [] for empty input', () => {
    expect(splitReasoningSegments('')).toEqual([]);
    expect(splitReasoningSegments(undefined)).toEqual([]);
  });

  test('drops whitespace-only segments', () => {
    const segments = splitReasoningSegments('<think>only reasoning</think>   ');
    expect(segments).toEqual([{ type: 'reasoning', content: 'only reasoning' }]);
  });
});

describe('fromLegacyPermission', () => {
  test('maps read_only -> restricted', () => {
    expect(fromLegacyPermission('read_only')).toBe('restricted');
  });

  test('maps edit_only -> normal', () => {
    expect(fromLegacyPermission('edit_only')).toBe('normal');
  });

  test('maps edit_terminal (and any unrecognized value) -> permissive', () => {
    expect(fromLegacyPermission('edit_terminal')).toBe('permissive');
    expect(fromLegacyPermission('unknown')).toBe('permissive');
    expect(fromLegacyPermission(undefined)).toBe('permissive');
  });
});

describe('streaming-mode detector regexes', () => {
  test('WORKFLOW_STREAM_REGEX matches a workflow marker', () => {
    expect(WORKFLOW_STREAM_REGEX.test('**WORKFLOW: Foo**')).toBe(true);
    expect(WORKFLOW_STREAM_REGEX.test('plain text')).toBe(false);
  });

  test('DIFF_STREAM_REGEX matches a SEARCH/REPLACE diff marker', () => {
    expect(DIFF_STREAM_REGEX.test('<<<<<<< SEARCH')).toBe(true);
    expect(DIFF_STREAM_REGEX.test('plain text')).toBe(false);
  });

  test('FILE_STREAM_REGEX matches a legacy FILE: marker', () => {
    expect(FILE_STREAM_REGEX.test('FILE: src/App.js')).toBe(true);
    expect(FILE_STREAM_REGEX.test('plain text')).toBe(false);
  });

  test('FILE_BLOCK_STREAM_REGEX is reusable as a fresh instance across calls (g flag safety)', () => {
    const text = '**FICHIER: a.js**\n```js\nA\n```';
    const first = extractLastStreamingMatch(FILE_BLOCK_STREAM_REGEX, text);
    const second = extractLastStreamingMatch(FILE_BLOCK_STREAM_REGEX, text);
    expect(first[1]).toBe(second[1]);
  });
});
