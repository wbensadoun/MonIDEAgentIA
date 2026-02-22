import React, { useMemo, useRef, useEffect, useCallback, useState } from 'react';
import Editor, { DiffEditor } from '@monaco-editor/react';
import './CodeEditor.css';

const CodeEditor = ({
  openFiles = [],
  activeFile,
  code,
  previousCode,
  onCodeChange,
  onUndo,
  onAcceptDiff, // Nouvelle prop pour accepter les changements
  isDiffMode = false, // Nouvelle prop pour forcer le mode Diff
  onSelectFile,
  onCloseFile,
  revealRequest
}) => {
  const editorRef = useRef(null);
  const monacoRef = useRef(null);
  const ghostProviderRef = useRef(null);
  const ghostTimeoutRef = useRef(null);
  const ghostAbortControllerRef = useRef(null);

  // States pour Inline AI (Ctrl+K)
  const [inlinePrompt, setInlinePrompt] = useState({ show: false, text: '', top: 0, left: 0, range: null, selectionText: '' });
  const [isInlineThinking, setIsInlineThinking] = useState(false);
  const inlineInputRef = useRef(null);

  // Auto-focus de l'input inline quand il s'affiche
  useEffect(() => {
    if (inlinePrompt.show && inlineInputRef.current) {
      inlineInputRef.current.focus();
    }
  }, [inlinePrompt.show]);

  const handleInlineSubmit = async (e) => {
    if (e.key === 'Escape') {
      setInlinePrompt(prev => ({ ...prev, show: false }));
      editorRef.current?.focus();
      return;
    }
    if (e.key === 'Enter') {
      setIsInlineThinking(true);
      try {
        const res = await window.electronAPI.getInlineCompletion(inlinePrompt.text, code, {
          // options au besoin
        });

        if (res && res.success) {
          editorRef.current.executeEdits('inline-ai', [{
            range: inlinePrompt.range,
            text: res.text,
            forceMoveMarkers: true
          }]);
          setInlinePrompt(prev => ({ ...prev, show: false }));
          editorRef.current.focus();
          // Optionnel: déclencher onCodeChange
          if (onCodeChange) {
            onCodeChange(editorRef.current.getValue());
          }
        } else {
          alert("Erreur IA: " + (res?.error || "Inconnue"));
        }
      } catch (err) {
        console.error(err);
      } finally {
        setIsInlineThinking(false);
      }
    }
  };

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

    // Ajout raccourci Ctrl+K / Cmd+K pour l'édition Inline
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, () => {
      if (editor.getOption(monaco.editor.EditorOption.readOnly)) return;

      const selection = editor.getSelection();
      let text = editor.getModel().getValueInRange(selection);

      // Si aucune sélection, on prend la ligne courante
      if (!text) {
        const line = selection.startLineNumber;
        text = editor.getModel().getLineContent(line);
      }

      // Calculer la position visuelle dans l'éditeur (approximatif)
      // getScrolledVisiblePosition renvoie the position relative to the editor div.
      const pos = editor.getScrolledVisiblePosition(selection.getStartPosition());

      setInlinePrompt({
        show: true,
        text: '',
        top: pos ? pos.top + 30 : 50,  // décalage pour ne pas masquer la ligne en cours
        left: pos ? pos.left + 20 : 50,
        range: selection,
        selectionText: text
      });
    });

    // --- Enregistrement du Ghost Text (Autocomplétion IA) ---
    if (ghostProviderRef.current) {
      ghostProviderRef.current.dispose();
    }

    ghostProviderRef.current = monaco.languages.registerInlineCompletionsProvider('*', {
      provideInlineCompletions: async (model, position, context, token) => {
        // Debounce pour ne pas inonder l'API
        if (ghostTimeoutRef.current) clearTimeout(ghostTimeoutRef.current);
        if (ghostAbortControllerRef.current) ghostAbortControllerRef.current.abort();

        return new Promise(resolve => {
          ghostTimeoutRef.current = setTimeout(async () => {
            ghostAbortControllerRef.current = new AbortController();

            try {
              const textUntilPosition = model.getValueInRange({
                startLineNumber: 1,
                startColumn: 1,
                endLineNumber: position.lineNumber,
                endColumn: position.column
              });
              const textAfterPosition = model.getValueInRange({
                startLineNumber: position.lineNumber,
                startColumn: position.column,
                endLineNumber: model.getLineCount(),
                endColumn: model.getLineMaxColumn(model.getLineCount())
              });

              if (textUntilPosition.trim().length < 5) return resolve({ items: [] });

              const res = await window.electronAPI.getGhostCompletion(textUntilPosition, textAfterPosition, {
                // pass whatever options needed
              });

              if (res && res.success && res.text) {
                resolve({
                  items: [{
                    insertText: res.text,
                    range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column)
                  }]
                });
              } else {
                resolve({ items: [] });
              }
            } catch (err) {
              resolve({ items: [] });
            }
          }, 350); // 350ms debounce
        });
      },
      freeInlineCompletions: () => { }
    });

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

          {/* Actions Diff / IA */}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
            {isDiffMode && previousCode && (
              <>
                <button
                  onClick={onAcceptDiff}
                  className="btn btn-primary"
                  style={{ background: 'rgba(0, 245, 212, 0.15)', borderColor: 'rgba(0, 245, 212, 0.4)', color: '#00f5d4', padding: '4px 12px', fontSize: '11px' }}
                >
                  ✓ Accepter IA
                </button>
                <button
                  onClick={onUndo}
                  className="btn btn-warning"
                  style={{ padding: '4px 12px', fontSize: '11px' }}
                >
                  ✕ Rejeter IA
                </button>
              </>
            )}
            {!isDiffMode && activeFile && previousCode && (
              <button onClick={onUndo} className="btn btn-warning" style={{ padding: '4px 12px', fontSize: '11px' }}>
                Annuler IA (Undo)
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="code-editor-body">
        <div className="monaco-wrap">
          {isDiffMode && previousCode ? (
            <DiffEditor
              height="100%"
              width="100%"
              language={language}
              original={previousCode}
              modified={code}
              onMount={handleMount}
              theme="vibe-ide"
              options={{
                fontFamily: 'var(--font-code)',
                fontSize: 14,
                minimap: { enabled: false },
                renderSideBySide: true,
                ignoreTrimWhitespace: false,
                readOnly: true // On force la lecture seule dans le DiffViewer pour l'instant
              }}
            />
          ) : (
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
          )}
        </div>
      </div>

      {inlinePrompt.show && (
        <div
          className="inline-prompt-box"
          style={{
            top: inlinePrompt.top,
            left: inlinePrompt.left
          }}
        >
          <div className="inline-prompt-header">G&eacute;n&eacute;rer avec l&apos;IA</div>
          <div className="inline-prompt-input-wrapper">
            <span role="img" aria-label="sparkles" className="inline-prompt-icon">✨</span>
            <input
              ref={inlineInputRef}
              className="inline-prompt-input"
              value={inlinePrompt.text}
              onChange={e => setInlinePrompt(prev => ({ ...prev, text: e.target.value }))}
              onKeyDown={handleInlineSubmit}
              placeholder="Ex: Refactorise cette fonction (Entrée = Valider, Echap = Annuler)"
              disabled={isInlineThinking}
            />
            {isInlineThinking && <span className="inline-prompt-spinner">⚙️</span>}
          </div>
        </div>
      )}
    </div>
  );
};

export default CodeEditor;
