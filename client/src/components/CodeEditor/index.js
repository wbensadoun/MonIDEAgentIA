import React, { useMemo, useRef, useEffect, useCallback, useState } from 'react';
import Editor, { DiffEditor } from '@monaco-editor/react';
import './CodeEditor.css';
import EditorWelcome from './EditorWelcome';
import {
  extractEditorSymbols,
  filterEditorSymbols,
  findActiveEditorSymbol,
  getEditorSymbolKindIcon,
  getEditorSymbolKindLabel
} from '../../utils/editorSymbols';
import { buildSingleAIInvocation } from '../../utils/aiProviderRouting';
import { getLanguageForFile } from '../../utils/editorLanguage';

let completionRunSequence = 0;
const createCompletionRunId = (kind) => `${kind}-${Date.now()}-${++completionRunSequence}`;

const CodeEditor = ({
  activeFile,
  code,
  previousCode,
  onCodeChange,
  onUndo,
  onAcceptDiff, // Nouvelle prop pour accepter les changements
  isDiffMode = false, // Nouvelle prop pour forcer le mode Diff
  diffSource = null,
  onCloseDiff,
  revealRequest,
  forceReadOnly = false,
  currentProjectPath = '',
  aiProvider = 'gemini',
  aiModels = {}
}) => {
  const editorRef = useRef(null);
  const monacoRef = useRef(null);
  const ghostProviderRef = useRef(null);
  const ghostTimeoutRef = useRef(null);
  const ghostAbortControllerRef = useRef(null);
  const ghostRunIdRef = useRef(null);
  const inlineRunIdRef = useRef(null);
  const cursorListenerRef = useRef(null);
  const completionConfigRef = useRef(null);

  // States pour Inline AI (Ctrl+K)
  const [inlinePrompt, setInlinePrompt] = useState({ show: false, text: '', top: 0, left: 0, range: null, selectionText: '' });
  const [isInlineThinking, setIsInlineThinking] = useState(false);
  const inlineInputRef = useRef(null);
  const symbolInputRef = useRef(null);
  const [showOutline, setShowOutline] = useState(true);
  const [showSymbolPicker, setShowSymbolPicker] = useState(false);
  const [symbolQuery, setSymbolQuery] = useState('');
  const [symbolIndex, setSymbolIndex] = useState(0);
  const [cursorLine, setCursorLine] = useState(1);
  const [diffRenderSideBySide, setDiffRenderSideBySide] = useState(true);
  const editorCompletionConfig = useMemo(() => buildSingleAIInvocation({
    aiProvider,
    models: aiModels,
    projectPath: currentProjectPath,
    disabledReason: 'Completion IA indisponible en mode Multi-IA: choisis un provider simple.'
  }), [aiModels, aiProvider, currentProjectPath]);

  useEffect(() => {
    completionConfigRef.current = editorCompletionConfig;
  }, [editorCompletionConfig]);

  // Auto-focus de l'input inline quand il s'affiche
  useEffect(() => {
    if (inlinePrompt.show && inlineInputRef.current) {
      inlineInputRef.current.focus();
    }
  }, [inlinePrompt.show]);

  useEffect(() => {
    if (showSymbolPicker && symbolInputRef.current) {
      symbolInputRef.current.focus();
    }
  }, [showSymbolPicker]);

  const handleInlineSubmit = async (e) => {
    if (e.key === 'Escape') {
      if (inlineRunIdRef.current) window.electronAPI?.cancelAIGeneration?.(inlineRunIdRef.current);
      inlineRunIdRef.current = null;
      setInlinePrompt(prev => ({ ...prev, show: false }));
      editorRef.current?.focus();
      return;
    }
    if (e.key === 'Enter') {
      setIsInlineThinking(true);
      const runId = createCompletionRunId('inline');
      inlineRunIdRef.current = runId;
      try {
        const completionConfig = completionConfigRef.current || editorCompletionConfig;
        if (completionConfig?.disabled) {
          alert(completionConfig.reason || 'Completion IA indisponible pour ce provider.');
          return;
        }

        const res = await window.electronAPI.getInlineCompletion(inlinePrompt.text, code, {
          ...completionConfig.options,
          activeFile,
          runId
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
        if (inlineRunIdRef.current === runId) inlineRunIdRef.current = null;
        setIsInlineThinking(false);
      }
    }
  };

  const language = useMemo(() => getLanguageForFile(activeFile), [activeFile]);

  const editorSymbols = useMemo(() => extractEditorSymbols(activeFile, code), [activeFile, code]);
  const filteredEditorSymbols = useMemo(() => filterEditorSymbols(editorSymbols, symbolQuery), [editorSymbols, symbolQuery]);
  const activeEditorSymbol = useMemo(() => findActiveEditorSymbol(editorSymbols, cursorLine), [editorSymbols, cursorLine]);

  useEffect(() => {
    if (symbolIndex >= filteredEditorSymbols.length) {
      setSymbolIndex(0);
    }
  }, [filteredEditorSymbols, symbolIndex]);

  useEffect(() => {
    setSymbolQuery('');
    setSymbolIndex(0);
    setShowSymbolPicker(false);
  }, [activeFile]);

  useEffect(() => {
    if (isDiffMode) {
      setShowSymbolPicker(false);
    }
  }, [isDiffMode]);

  const revealEditorPosition = useCallback((line, column = 1) => {
    const editor = editorRef.current;
    if (!editor) return;
    const safeLine = Math.max(1, Number(line) || 1);
    const safeColumn = Math.max(1, Number(column) || 1);
    try {
      editor.revealPositionInCenter({ lineNumber: safeLine, column: safeColumn });
      editor.setPosition({ lineNumber: safeLine, column: safeColumn });
      editor.focus();
      setCursorLine(safeLine);
    } catch {
      // ignore
    }
  }, []);

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
      const initialPosition = editor.getPosition();
      if (initialPosition?.lineNumber) {
        setCursorLine(initialPosition.lineNumber);
      }
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

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyO, () => {
      setShowSymbolPicker(true);
      setSymbolQuery('');
      setSymbolIndex(0);
    });

    // --- Enregistrement du Ghost Text (Autocomplétion IA) ---
    if (ghostProviderRef.current) {
      ghostProviderRef.current.dispose();
    }

    ghostProviderRef.current = monaco.languages.registerInlineCompletionsProvider('*', {
      provideInlineCompletions: async (model, position, _context, _token) => {
        // Debounce pour ne pas inonder l'API
        if (ghostTimeoutRef.current) clearTimeout(ghostTimeoutRef.current);
        if (ghostAbortControllerRef.current) ghostAbortControllerRef.current.abort();
        if (ghostRunIdRef.current) window.electronAPI?.cancelAIGeneration?.(ghostRunIdRef.current);
        ghostRunIdRef.current = null;

        return new Promise(resolve => {
          ghostTimeoutRef.current = setTimeout(async () => {
            ghostAbortControllerRef.current = new AbortController();
            const runId = createCompletionRunId('ghost');
            ghostRunIdRef.current = runId;

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

              const completionConfig = completionConfigRef.current;
              if (!completionConfig || completionConfig.disabled) return resolve({ items: [] });

              const res = await window.electronAPI.getGhostCompletion(textUntilPosition, textAfterPosition, {
                ...(completionConfig?.options || {}),
                activeFile,
                runId
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
            } finally {
              if (ghostRunIdRef.current === runId) ghostRunIdRef.current = null;
            }
          }, 350); // 350ms debounce
        });
      },
      freeInlineCompletions: () => { }
    });

    if (cursorListenerRef.current) {
      cursorListenerRef.current.dispose();
      cursorListenerRef.current = null;
    }

    cursorListenerRef.current = editor.onDidChangeCursorPosition((event) => {
      const nextLine = Number(event?.position?.lineNumber || 1);
      setCursorLine(nextLine);
    });

  }, [activeFile]);

  const handleEditorWillUnmount = useCallback((editor, _monaco) => {
    try {
      // Stop ghost text provider on unmount if it exists
      if (ghostProviderRef.current) {
        ghostProviderRef.current.dispose();
        ghostProviderRef.current = null;
      }
      if (ghostAbortControllerRef.current) {
        ghostAbortControllerRef.current.abort();
        ghostAbortControllerRef.current = null;
      }
      if (ghostRunIdRef.current) {
        window.electronAPI?.cancelAIGeneration?.(ghostRunIdRef.current);
        ghostRunIdRef.current = null;
      }
      if (inlineRunIdRef.current) {
        window.electronAPI?.cancelAIGeneration?.(inlineRunIdRef.current);
        inlineRunIdRef.current = null;
      }
      if (ghostTimeoutRef.current) {
        clearTimeout(ghostTimeoutRef.current);
        ghostTimeoutRef.current = null;
      }
      if (cursorListenerRef.current) {
        cursorListenerRef.current.dispose();
        cursorListenerRef.current = null;
      }

      // Explicitly dispose of models to avoid the "TextModel got disposed before DiffEditorWidget model got reset" error
      if (editor && typeof editor.getModel === 'function') {
        const model = editor.getModel();

        // DiffEditor returns an object { original, modified } for getModel()
        if (model && model.original && typeof model.original.dispose === 'function') {
          model.original.dispose();
        }
        if (model && model.modified && typeof model.modified.dispose === 'function') {
          model.modified.dispose();
        }

        // Standard Editor returns the model directly
        if (model && typeof model.dispose === 'function' && !model.original) {
          model.dispose();
        }
      }
    } catch (e) {
      console.error("Error during Monaco Editor unmount:", e);
    }
  }, []);

  useEffect(() => {
    return () => {
      handleEditorWillUnmount(editorRef.current, monacoRef.current);
    };
  }, [handleEditorWillUnmount]);

  useEffect(() => {
    if (!revealRequest) return;
    if (!activeFile) return;
    if (String(revealRequest.file || '') !== String(activeFile)) return;
    revealEditorPosition(revealRequest.line, revealRequest.column);
  }, [revealRequest, activeFile, revealEditorPosition]);

  const handleSymbolKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!filteredEditorSymbols.length) return;
      setSymbolIndex((prev) => Math.min(prev + 1, filteredEditorSymbols.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!filteredEditorSymbols.length) return;
      setSymbolIndex((prev) => Math.max(prev - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const symbol = filteredEditorSymbols[symbolIndex] || filteredEditorSymbols[0];
      if (!symbol) return;
      revealEditorPosition(symbol.line, symbol.column);
      setShowSymbolPicker(false);
      setSymbolQuery('');
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setShowSymbolPicker(false);
      setSymbolQuery('');
    }
  };

  return (
    <div className="code-editor-root">
      <div className="code-editor-top">
        {/* Onglets de fichiers + fil d'Ariane : remontés au niveau de la
            coquille (WorkspaceLayout) — ils décrivent le document actif au
            niveau de l'IDE, pas seulement de cet éditeur. Ce qui reste ici
            est spécifique à Monaco : symbole sous le curseur, Outline,
            bascule Diff, Accepter/Rejeter IA. */}
        <div className="editor-breadcrumb">
          <div className="editor-breadcrumb-right">
            {activeEditorSymbol && (
              <span>{getEditorSymbolKindIcon(activeEditorSymbol.kind)} {activeEditorSymbol.symbol}</span>
            )}
          </div>

          {/* Actions Diff / IA */}
          <div className="code-editor-actions">
            {!isDiffMode && activeFile && editorSymbols.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => setShowOutline((prev) => !prev)}
                  className={`code-editor-ghost-btn ${showOutline ? 'is-active' : ''}`}
                  title="Afficher l'outline"
                >
                  Outline
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowSymbolPicker(true);
                    setSymbolQuery('');
                    setSymbolIndex(0);
                  }}
                  className="code-editor-ghost-btn"
                  title="Symboles du fichier (Ctrl+Shift+O)"
                >
                  Ctrl+Shift+O
                </button>
              </>
            )}
            {isDiffMode && (
              <button
                type="button"
                onClick={() => setDiffRenderSideBySide((prev) => !prev)}
                className={`code-editor-ghost-btn ${diffRenderSideBySide ? 'is-active' : ''}`}
                title="Basculer l'affichage du diff"
              >
                {diffRenderSideBySide ? 'Diff cote a cote' : 'Diff inline'}
              </button>
            )}
            {diffSource === 'git' && (
              <button
                type="button"
                onClick={onCloseDiff}
                className="code-editor-ghost-btn"
                title="Fermer le diff Git"
              >
                Fermer le diff
              </button>
            )}
            {diffSource !== 'git' && isDiffMode && previousCode && (
              <>
                <button
                  onClick={onAcceptDiff}
                  className="btn btn-primary"
                >
                  ✓ Accepter IA
                </button>
                <button
                  onClick={onUndo}
                  className="btn btn-warning"
                >
                  ✕ Rejeter IA
                </button>
              </>
            )}
            {!isDiffMode && activeFile && previousCode && (
              <button onClick={onUndo} className="btn btn-warning">
                Annuler IA (Undo)
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="code-editor-body">
        {!isDiffMode && showOutline && activeFile && editorSymbols.length > 0 && (
          <aside className="editor-outline">
            <div className="editor-outline-header">
              <span className="editor-outline-title">Outline</span>
              <span className="editor-outline-count">{editorSymbols.length}</span>
            </div>
            <div className="editor-outline-list custom-scrollbar">
              {editorSymbols.map((symbol) => {
                const isActiveSymbol = activeEditorSymbol?.id === symbol.id;
                return (
                  <button
                    key={symbol.id}
                    type="button"
                    className={`editor-outline-item ${isActiveSymbol ? 'is-active' : ''}`}
                    onClick={() => revealEditorPosition(symbol.line, symbol.column)}
                    title={`${symbol.symbol} (${getEditorSymbolKindLabel(symbol.kind)})`}
                  >
                    <span className="editor-outline-icon">{getEditorSymbolKindIcon(symbol.kind)}</span>
                    <span className="editor-outline-copy">
                      <span className="editor-outline-name">{symbol.symbol}</span>
                      <span className="editor-outline-meta">{getEditorSymbolKindLabel(symbol.kind)} · L{symbol.line}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </aside>
        )}
        <div className="monaco-wrap">
          {isDiffMode && previousCode ? (
            <DiffEditor
              height="100%"
              width="100%"
              language={language}
              original={previousCode}
              modified={code}
              onMount={(editor, monaco) => handleMount(editor.getModifiedEditor(), monaco)}
              theme="vibe-ide"
              options={{
                fontFamily: 'var(--font-code)',
                fontSize: 15,
                lineHeight: 23,
                minimap: { enabled: false },
                renderSideBySide: diffRenderSideBySide,
                ignoreTrimWhitespace: false,
                readOnly: true // On force la lecture seule dans le DiffViewer pour l'instant
              }}
            />
          ) : !activeFile ? (
            // Écran d'accueil riche (mode code) : remplace la surface Monaco
            // vide quand aucun fichier n'est ouvert. Façon VS Code / Cursor :
            // raccourcis actionnables, aucune logique nouvelle.
            <EditorWelcome
              projectName={String(currentProjectPath || '').split(/[\\/]/).filter(Boolean).pop() || ''}
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
                fontSize: 15,
                lineHeight: 23,
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
                readOnly: !activeFile || forceReadOnly
              }}
            />
          )}
        </div>
      </div>

      {showSymbolPicker && (
        <div className="editor-symbol-overlay" onClick={() => setShowSymbolPicker(false)}>
          <div className="editor-symbol-modal" onClick={(event) => event.stopPropagation()}>
            <div className="editor-symbol-header">
              <span className="editor-symbol-title">Symboles du fichier</span>
              <span className="editor-symbol-shortcut">Ctrl+Shift+O</span>
            </div>
            <input
              ref={symbolInputRef}
              className="editor-symbol-input"
              value={symbolQuery}
              onChange={(event) => setSymbolQuery(event.target.value)}
              onKeyDown={handleSymbolKeyDown}
              placeholder="Rechercher un symbole..."
            />
            <div className="editor-symbol-list custom-scrollbar">
              {filteredEditorSymbols.length === 0 && (
                <div className="editor-symbol-empty">Aucun symbole</div>
              )}
              {filteredEditorSymbols.map((symbol, index) => (
                <button
                  key={symbol.id}
                  type="button"
                  className={`editor-symbol-item ${index === symbolIndex ? 'is-active' : ''}`}
                  onClick={() => {
                    revealEditorPosition(symbol.line, symbol.column);
                    setShowSymbolPicker(false);
                    setSymbolQuery('');
                  }}
                >
                  <span className="editor-symbol-kind">{getEditorSymbolKindIcon(symbol.kind)}</span>
                  <span className="editor-symbol-copy">
                    <span className="editor-symbol-name">{symbol.symbol}</span>
                    <span className="editor-symbol-meta">{getEditorSymbolKindLabel(symbol.kind)} · Ligne {symbol.line}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

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
