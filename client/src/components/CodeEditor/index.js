import React, { useMemo, useRef, useEffect, useCallback } from 'react';
import Editor from '@monaco-editor/react';
import './CodeEditor.css';

const CodeEditor = ({
  openFiles = [],
  activeFile,
  code,
  previousCode,
  onCodeChange,
  onUndo,
  onSelectFile,
  onCloseFile,
  revealRequest
}) => {
  const editorRef = useRef(null);
  const monacoRef = useRef(null);

  const activeLabel = useMemo(() => {
    if (!activeFile) return 'Aucun fichier ouvert';
    return String(activeFile);
  }, [activeFile]);

  const language = useMemo(() => {
    if (!activeFile) return 'plaintext';
    const lower = String(activeFile).toLowerCase();
    if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'typescript';
    if (lower.endsWith('.js') || lower.endsWith('.jsx')) return 'javascript';
    if (lower.endsWith('.json')) return 'json';
    if (lower.endsWith('.css') || lower.endsWith('.scss') || lower.endsWith('.sass') || lower.endsWith('.less')) return 'css';
    if (lower.endsWith('.html')) return 'html';
    if (lower.endsWith('.md')) return 'markdown';
    if (lower.endsWith('.yml') || lower.endsWith('.yaml')) return 'yaml';
    if (lower.endsWith('.xml')) return 'xml';
    if (lower.endsWith('.sql')) return 'sql';
    if (lower.endsWith('.py')) return 'python';
    if (lower.endsWith('.sh') || lower.endsWith('.ps1') || lower.endsWith('.bat')) return 'shell';
    if (lower.endsWith('.go')) return 'go';
    if (lower.endsWith('.rs')) return 'rust';
    if (lower.endsWith('.java')) return 'java';
    if (lower.endsWith('.cpp') || lower.endsWith('.c') || lower.endsWith('.h') || lower.endsWith('.hpp')) return 'cpp';
    return 'plaintext';
  }, [activeFile]);

  const handleMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    try {
      monaco.editor.defineTheme('vibe-ide', {
        base: 'vs-dark',
        inherit: true,
        rules: [
          { token: 'comment', foreground: '7f91aa' },
          { token: 'string', foreground: 'a8ffb5' },
          { token: 'keyword', foreground: '00f5d4' },
          { token: 'number', foreground: 'ffd166' }
        ],
        colors: {
          'editor.background': '#0b1118',
          'editor.foreground': '#e7eef9',
          'editorLineNumber.foreground': '#55657a',
          'editorLineNumber.activeForeground': '#b8c7dd',
          'editorCursor.foreground': '#00f5d4',
          'editor.selectionBackground': '#00f5d433',
          'editor.inactiveSelectionBackground': '#00f5d41f',
          'editor.lineHighlightBackground': '#ffffff08',
          'editorIndentGuide.background1': '#ffffff10',
          'editorIndentGuide.activeBackground1': '#00f5d433',
          'editorWhitespace.foreground': '#ffffff0f',
          'editor.findMatchBackground': '#ffd16633',
          'editor.findMatchHighlightBackground': '#ffd1661f',
          'editorWidget.background': '#0f1622',
          'editorWidget.border': '#ffffff14',
          'editorSuggestWidget.background': '#0f1622',
          'editorSuggestWidget.border': '#ffffff14',
          'editorSuggestWidget.selectedBackground': '#00f5d426',
          'editorHoverWidget.background': '#0f1622',
          'editorHoverWidget.border': '#ffffff14'
        }
      });
      monaco.editor.setTheme('vibe-ide');
    } catch {
      // ignore
    }

    try {
      editor.focus();
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (!revealRequest) return;
    if (!activeFile) return;
    if (String(revealRequest.file || '') !== String(activeFile)) return;

    const editor = editorRef.current;
    if (!editor) return;

    const line = Math.max(1, Number(revealRequest.line) || 1);
    const column = Math.max(1, Number(revealRequest.column) || 1);
    try {
      editor.revealPositionInCenter({ lineNumber: line, column });
      editor.setPosition({ lineNumber: line, column });
      editor.focus();
    } catch {
      // ignore
    }
  }, [revealRequest, activeFile]);

  return (
    <div className="code-editor-root">
      <div className="code-editor-top">
        <div className="editor-tabs custom-scrollbar">
          {openFiles.length === 0 && (
            <div className="editor-tabs-empty">Ouvrez un fichier (Ctrl+P)</div>
          )}
          {openFiles.map((filePath) => {
            const fileName = String(filePath).split(/[\\/]/).pop() || String(filePath);
            const isActive = String(filePath) === String(activeFile);
            return (
              <button
                key={filePath}
                type="button"
                className={`editor-tab ${isActive ? 'is-active' : ''}`}
                onClick={() => onSelectFile && onSelectFile(filePath)}
                title={String(filePath)}
              >
                <span className="editor-tab-name">{fileName}</span>
                <span
                  className="editor-tab-close"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onCloseFile && onCloseFile(filePath);
                  }}
                  role="button"
                  aria-label={`Fermer ${fileName}`}
                >
                  ×
                </span>
              </button>
            );
          })}
        </div>

        <div className="code-editor-header">
          <span className="code-editor-label">Éditeur</span>
          <span className="code-editor-file">{activeLabel}</span>
          {activeFile && previousCode && (
            <button onClick={onUndo} className="btn btn-warning">
              Annuler IA
            </button>
          )}
        </div>
      </div>

      <div className="code-editor-body">
        <div className="monaco-wrap">
          <Editor
            height="100%"
            width="100%"
            language={language}
            value={code}
            onChange={(value) => onCodeChange && onCodeChange(value ?? '')}
            onMount={handleMount}
            theme="vibe-ide"
            options={{
              fontFamily: 'var(--font-code)',
              fontSize: 14,
              minimap: { enabled: false },
              tabSize: 2,
              insertSpaces: true,
              wordWrap: 'off',
              smoothScrolling: true,
              scrollBeyondLastLine: false,
              automaticLayout: true,
              renderWhitespace: 'selection',
              renderControlCharacters: false,
              cursorSmoothCaretAnimation: 'on',
              cursorBlinking: 'smooth',
              bracketPairColorization: { enabled: true },
              padding: { top: 10, bottom: 10 },
              guides: { bracketPairs: true, indentation: true },
              glyphMargin: true,
              readOnly: !activeFile
            }}
          />
        </div>
      </div>
    </div>
  );
};

export default CodeEditor;
