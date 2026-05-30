import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AIChangesPanel from './index';
import { summarizeDiff } from '../../utils/aiDiff';

jest.mock('@monaco-editor/react', () => ({
  DiffEditor: ({ original, modified, onMount }) => {
    const React = require('react');
    const [originalDecorations, setOriginalDecorations] = React.useState([]);
    const [modifiedDecorations, setModifiedDecorations] = React.useState([]);
    const editorsRef = React.useRef(null);

    if (!editorsRef.current) {
      const createEditor = (setDecorations) => {
        let mouseDownListener = null;
        return {
          createDecorationsCollection: () => ({
            set: setDecorations,
            clear: () => setDecorations([])
          }),
          onMouseDown: (listener) => {
            mouseDownListener = listener;
            return { dispose: () => { mouseDownListener = null; } };
          },
          triggerGlyphClick: (lineNumber) => mouseDownListener?.({
            target: {
              type: 1,
              position: { lineNumber }
            },
            event: {
              preventDefault: jest.fn(),
              stopPropagation: jest.fn()
            }
          })
        };
      };
      const originalEditor = createEditor(setOriginalDecorations);
      const modifiedEditor = createEditor(setModifiedDecorations);
      editorsRef.current = {
        originalEditor,
        modifiedEditor,
        diffEditor: {
          getOriginalEditor: () => originalEditor,
          getModifiedEditor: () => modifiedEditor
        },
        monaco: {
          Range: function Range(startLineNumber, startColumn, endLineNumber, endColumn) {
            this.startLineNumber = startLineNumber;
            this.startColumn = startColumn;
            this.endLineNumber = endLineNumber;
            this.endColumn = endColumn;
          },
          editor: {
            MouseTargetType: {
              GUTTER_GLYPH_MARGIN: 1
            }
          }
        }
      };
    }

    React.useEffect(() => {
      onMount?.(editorsRef.current.diffEditor, editorsRef.current.monaco);
    }, [onMount]);

    return (
      <div data-testid="diff-editor">
        <pre>{original}</pre>
        <pre>{modified}</pre>
        <button type="button" aria-label="toggle original diff line 3" onClick={() => editorsRef.current.originalEditor.triggerGlyphClick(3)}>original 3</button>
        <button type="button" aria-label="toggle modified diff line 3" onClick={() => editorsRef.current.modifiedEditor.triggerGlyphClick(3)}>modified 3</button>
        <div data-testid="original-decorations">
          {originalDecorations.map((decoration) => decoration.options.className).join('|')}
        </div>
        <div data-testid="modified-decorations">
          {modifiedDecorations.map((decoration) => decoration.options.className).join('|')}
        </div>
      </div>
    );
  }
}));

const run = {
  id: 'run-1',
  prompt: 'Change one word',
  provider: 'gemini',
  model: 'gemini-test',
  status: 'proposed',
  startedAt: '2026-05-30T10:00:00.000Z',
  changes: [
    {
      id: 'change-1',
      filePath: 'src/demo.js',
      oldContent: 'const label = "old";',
      newContent: 'const label = "new";',
      status: 'pending',
      additions: 1,
      deletions: 1,
      hunks: [
        {
          id: 'hunk-1',
          oldStart: 1,
          newStart: 1,
          additions: 1,
          deletions: 1,
          lines: [
            { type: 'remove', text: 'const label = "old";' },
            { type: 'add', text: 'const label = "new";' }
          ]
        }
      ]
    }
  ],
  logs: [
    { id: 'log-1', at: '2026-05-30T10:00:01.000Z', type: 'proposed', message: '1 changement IA propose' }
  ]
};

const renderPanel = (overrides = {}) => {
  const props = {
    currentProjectPath: 'C:/Project',
    runs: [{ id: run.id, prompt: run.prompt, status: run.status, changeCount: 1, additions: 1, deletions: 1 }],
    activeRun: run,
    selectedRunId: run.id,
    permissionMode: 'edit_terminal',
    pendingFileChanges: [{ id: 'change-1', runId: 'run-1', runChangeId: 'change-1', filePath: 'src/demo.js' }],
    onSelectRun: jest.fn(),
    onRefresh: jest.fn(),
    onRunChanged: jest.fn(),
    onSelectPendingChange: jest.fn(),
    onApplyPendingChange: jest.fn().mockResolvedValue(true),
    onRejectPendingChange: jest.fn().mockResolvedValue(true),
    onUpdatePendingChangeContent: jest.fn().mockResolvedValue(true),
    onAfterDiskChange: jest.fn(),
    showMessage: jest.fn(),
    ...overrides
  };
  render(<AIChangesPanel {...props} />);
  return props;
};

test('renders a persistent AI run with file diff and audit log', () => {
  renderPanel();

  expect(screen.getByText('AI Changes')).toBeInTheDocument();
  expect(screen.getAllByText('Change one word').length).toBeGreaterThan(0);
  expect(screen.getAllByText('src/demo.js').length).toBeGreaterThan(0);
  expect(screen.getByTestId('diff-editor')).toHaveTextContent('old');
  expect(screen.getByTestId('diff-editor')).toHaveTextContent('new');
  expect(screen.getByText('1 changement IA propose')).toBeInTheDocument();
});

test('applies the pending change from the review panel', async () => {
  const props = renderPanel();

  fireEvent.click(screen.getByText('Appliquer'));

  await waitFor(() => {
    expect(props.onSelectPendingChange).toHaveBeenCalledWith(0);
    expect(props.onApplyPendingChange).toHaveBeenCalledWith(0, null);
  });
});

test('blocks apply in read-only mode', () => {
  renderPanel({ permissionMode: 'read_only' });

  expect(screen.getByText('Appliquer')).toBeDisabled();
});

test('applies only selected changed lines', async () => {
  const oldContent = ['alpha', 'beta', 'delta'].join('\n');
  const newContent = ['alpha', 'BETA', 'DELTA'].join('\n');
  const summary = summarizeDiff(oldContent, newContent);
  const multiRun = {
    ...run,
    changes: [
      {
        ...run.changes[0],
        oldContent,
        newContent,
        additions: summary.additions,
        deletions: summary.deletions,
        hunks: summary.hunks
      }
    ]
  };
  const props = renderPanel({ activeRun: multiRun });

  fireEvent.click(screen.getByLabelText('remove line 3 delta'));
  fireEvent.click(screen.getByLabelText('add line 3 DELTA'));
  fireEvent.click(screen.getByText('Appliquer selection'));

  await waitFor(() => {
    expect(props.onApplyPendingChange).toHaveBeenCalledWith(0, ['alpha', 'BETA', 'delta'].join('\n'));
  });
});

test('toggles changed lines from the Monaco gutter', async () => {
  const oldContent = ['alpha', 'beta', 'delta'].join('\n');
  const newContent = ['alpha', 'BETA', 'DELTA'].join('\n');
  const summary = summarizeDiff(oldContent, newContent);
  const multiRun = {
    ...run,
    changes: [
      {
        ...run.changes[0],
        oldContent,
        newContent,
        additions: summary.additions,
        deletions: summary.deletions,
        hunks: summary.hunks
      }
    ]
  };
  renderPanel({ activeRun: multiRun });

  const addLine = screen.getByLabelText('add line 3 DELTA').closest('label');
  expect(addLine).toHaveClass('is-selected');
  await waitFor(() => {
    expect(screen.getByTestId('modified-decorations')).toHaveTextContent('ai-monaco-line-add is-selected');
  });

  fireEvent.click(screen.getByLabelText('toggle modified diff line 3'));

  await waitFor(() => {
    expect(addLine).toHaveClass('is-excluded');
    expect(screen.getByText('Appliquer selection')).toBeInTheDocument();
    expect(screen.getByTestId('modified-decorations')).toHaveTextContent('ai-monaco-line-add is-excluded');
  });
});
