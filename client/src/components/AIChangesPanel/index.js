import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DiffEditor } from '@monaco-editor/react';
import { buildContentFromSelectedLines, normalizeDiffHunks, summarizeDiff } from '../../utils/aiDiff';
import { buildRunExportPayload } from '../../utils/aiRunExport';
import './AIChangesPanel.css';

const getLanguageFromPath = (filePath = '') => {
  const lower = String(filePath).toLowerCase();
  if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'typescript';
  if (lower.endsWith('.js') || lower.endsWith('.jsx')) return 'javascript';
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.css') || lower.endsWith('.scss')) return 'css';
  if (lower.endsWith('.html')) return 'html';
  if (lower.endsWith('.md')) return 'markdown';
  if (lower.endsWith('.yml') || lower.endsWith('.yaml')) return 'yaml';
  if (lower.endsWith('.py')) return 'python';
  if (lower.endsWith('.go')) return 'go';
  if (lower.endsWith('.rs')) return 'rust';
  return 'plaintext';
};

const getStatusLabel = (status) => {
  if (status === 'verified') return 'verifie';
  if (status === 'applied') return 'applique';
  if (status === 'rejected') return 'rejete';
  if (status === 'conflict') return 'conflit';
  if (status === 'failed') return 'echec';
  if (status === 'rolled_back') return 'rollback';
  if (status === 'partial') return 'partiel';
  return 'propose';
};

const shortPrompt = (text) => {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return 'Run IA sans prompt conserve';
  return normalized.length > 92 ? `${normalized.slice(0, 92)}...` : normalized;
};

const downloadTextFile = (filename, content, mimeType = 'text/plain') => {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const findPendingIndex = (pendingFileChanges, runId, change) => (
  (pendingFileChanges || []).findIndex((entry) => (
    (entry.runId && entry.runId === runId && (entry.runChangeId === change.id || entry.id === change.id))
    || (!entry.runId && entry.filePath === change.filePath && entry.id === change.id)
  ))
);

const createDiffLineDecoration = (monaco, line, selected) => {
  const lineNumber = Number(line.type === 'add' ? line.newLineNumber : line.oldLineNumber);
  const changeType = line.type === 'add' ? 'add' : 'remove';
  const selectionClass = selected ? 'is-selected' : 'is-excluded';
  const label = selected ? 'incluse' : 'exclue';

  return {
    range: new monaco.Range(lineNumber, 1, lineNumber, 1),
    options: {
      isWholeLine: true,
      className: `ai-monaco-line ai-monaco-line-${changeType} ${selectionClass}`,
      glyphMarginClassName: `ai-monaco-glyph ai-monaco-glyph-${changeType} ${selectionClass}`,
      glyphMarginHoverMessage: { value: `Ligne IA ${label}. Cliquez pour basculer.` },
      linesDecorationsClassName: `ai-monaco-line-marker ai-monaco-line-marker-${changeType} ${selectionClass}`
    }
  };
};

const AIChangesPanel = ({
  currentProjectPath,
  runs = [],
  activeRun = null,
  selectedRunId = '',
  isLoading = false,
  permissionMode = 'edit_terminal',
  pendingFileChanges = [],
  onSelectRun,
  onRefresh,
  onRunChanged,
  onSelectPendingChange,
  onApplyPendingChange,
  onRejectPendingChange,
  onUpdatePendingChangeContent,
  onAfterDiskChange,
  showMessage
}) => {
  const [selectedChangeId, setSelectedChangeId] = useState('');
  const [selectedLineIds, setSelectedLineIds] = useState([]);
  const [isWorking, setIsWorking] = useState(false);
  const [diffEditorReadyKey, setDiffEditorReadyKey] = useState(0);
  const diffEditorRef = useRef(null);
  const monacoRef = useRef(null);
  const originalDecorationsRef = useRef(null);
  const modifiedDecorationsRef = useRef(null);
  const originalLineMapRef = useRef(new Map());
  const modifiedLineMapRef = useRef(new Map());
  const diffEditorDisposablesRef = useRef([]);

  const changes = useMemo(() => (
    Array.isArray(activeRun?.changes) ? activeRun.changes : []
  ), [activeRun?.changes]);
  const selectedChange = useMemo(() => (
    changes.find((change) => change.id === selectedChangeId) || changes[0] || null
  ), [changes, selectedChangeId]);

  const diffSummary = useMemo(() => {
    if (!selectedChange) return { hunks: [], additions: 0, deletions: 0 };
    if (Array.isArray(selectedChange.hunks) && selectedChange.hunks.length > 0) {
      return {
        hunks: normalizeDiffHunks(selectedChange.hunks),
        additions: Number(selectedChange.additions || 0),
        deletions: Number(selectedChange.deletions || 0)
      };
    }
    return summarizeDiff(selectedChange.oldContent || '', selectedChange.newContent || '');
  }, [selectedChange]);

  useEffect(() => {
    setSelectedChangeId(changes[0]?.id || '');
  }, [activeRun?.id, changes]);

  const changedLineIds = useMemo(() => (
    (diffSummary.hunks || []).flatMap((hunk) => (
      hunk.lines
        .filter((line) => line.type === 'add' || line.type === 'remove')
        .map((line) => line.id)
    ))
  ), [diffSummary.hunks]);
  const selectedLineIdSet = useMemo(() => new Set(selectedLineIds), [selectedLineIds]);

  useEffect(() => {
    setSelectedLineIds(changedLineIds);
  }, [selectedChange?.id, changedLineIds]);

  const canEdit = permissionMode !== 'read_only';
  const queueIndex = selectedChange ? findPendingIndex(pendingFileChanges, activeRun?.id, selectedChange) : -1;
  const allChangesSelected = changedLineIds.length === 0 || changedLineIds.every((id) => selectedLineIdSet.has(id));
  const noChangesSelected = changedLineIds.length > 0 && changedLineIds.every((id) => !selectedLineIdSet.has(id));

  const setHunkSelection = (hunk, checked) => {
    const hunkLineIds = hunk.lines
      .filter((line) => line.type === 'add' || line.type === 'remove')
      .map((line) => line.id);
    setSelectedLineIds((prev) => {
      const next = new Set(prev);
      hunkLineIds.forEach((id) => {
        if (checked) next.add(id);
        else next.delete(id);
      });
      return Array.from(next);
    });
  };

  const setLineSelection = useCallback((lineId, checked) => {
    setSelectedLineIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(lineId);
      else next.delete(lineId);
      return Array.from(next);
    });
  }, []);

  const toggleLineSelection = useCallback((lineId) => {
    setSelectedLineIds((prev) => {
      const next = new Set(prev);
      if (next.has(lineId)) next.delete(lineId);
      else next.add(lineId);
      return Array.from(next);
    });
  }, []);

  const disposeDiffEditorBindings = useCallback(() => {
    originalDecorationsRef.current?.clear?.();
    modifiedDecorationsRef.current?.clear?.();
    diffEditorDisposablesRef.current.forEach((disposable) => disposable?.dispose?.());
    diffEditorDisposablesRef.current = [];
    originalDecorationsRef.current = null;
    modifiedDecorationsRef.current = null;
    diffEditorRef.current = null;
    monacoRef.current = null;
    originalLineMapRef.current = new Map();
    modifiedLineMapRef.current = new Map();
  }, []);

  const handleDiffEditorMount = useCallback((editor, monaco) => {
    disposeDiffEditorBindings();
    diffEditorRef.current = editor;
    monacoRef.current = monaco;

    const originalEditor = editor?.getOriginalEditor?.();
    const modifiedEditor = editor?.getModifiedEditor?.();
    if (originalEditor?.createDecorationsCollection) {
      originalDecorationsRef.current = originalEditor.createDecorationsCollection([]);
    }
    if (modifiedEditor?.createDecorationsCollection) {
      modifiedDecorationsRef.current = modifiedEditor.createDecorationsCollection([]);
    }

    const handleGlyphClick = (side, event) => {
      const glyphTarget = monaco?.editor?.MouseTargetType?.GUTTER_GLYPH_MARGIN;
      const targetType = event?.target?.type;
      const lineNumber = Number(event?.target?.position?.lineNumber || 0);
      if (glyphTarget !== undefined && targetType !== glyphTarget) return;
      if (!lineNumber) return;

      const map = side === 'original' ? originalLineMapRef.current : modifiedLineMapRef.current;
      const lineId = map.get(lineNumber);
      if (!lineId) return;

      event?.event?.preventDefault?.();
      event?.event?.stopPropagation?.();
      toggleLineSelection(lineId);
    };

    const originalMouse = originalEditor?.onMouseDown?.((event) => handleGlyphClick('original', event));
    const modifiedMouse = modifiedEditor?.onMouseDown?.((event) => handleGlyphClick('modified', event));
    diffEditorDisposablesRef.current = [originalMouse, modifiedMouse].filter(Boolean);
    setDiffEditorReadyKey((key) => key + 1);
  }, [disposeDiffEditorBindings, toggleLineSelection]);

  useEffect(() => () => disposeDiffEditorBindings(), [disposeDiffEditorBindings]);

  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco) return;

    const originalLineMap = new Map();
    const modifiedLineMap = new Map();
    const originalDecorations = [];
    const modifiedDecorations = [];

    (diffSummary.hunks || []).forEach((hunk) => {
      (hunk.lines || []).forEach((line) => {
        if (line.type !== 'add' && line.type !== 'remove') return;
        const selected = selectedLineIdSet.has(line.id);
        const lineNumber = Number(line.type === 'add' ? line.newLineNumber : line.oldLineNumber);
        if (!lineNumber) return;

        if (line.type === 'remove') {
          originalLineMap.set(lineNumber, line.id);
          originalDecorations.push(createDiffLineDecoration(monaco, line, selected));
        } else {
          modifiedLineMap.set(lineNumber, line.id);
          modifiedDecorations.push(createDiffLineDecoration(monaco, line, selected));
        }
      });
    });

    originalLineMapRef.current = originalLineMap;
    modifiedLineMapRef.current = modifiedLineMap;
    originalDecorationsRef.current?.set?.(originalDecorations);
    modifiedDecorationsRef.current?.set?.(modifiedDecorations);
  }, [diffEditorReadyKey, diffSummary.hunks, selectedLineIdSet]);

  const applySelectedChange = async () => {
    if (!selectedChange || !activeRun?.id || !canEdit) return;
    setIsWorking(true);
    try {
      if (noChangesSelected) {
        await rejectSelectedChange();
        return;
      }

      let overrideContent = null;
      if (!allChangesSelected) {
        const partialContent = buildContentFromSelectedLines(
          selectedChange.oldContent || '',
          selectedChange.newContent || '',
          selectedLineIds,
          diffSummary.hunks
        );
        overrideContent = partialContent;
        if (queueIndex >= 0 && typeof onUpdatePendingChangeContent === 'function') {
          await onUpdatePendingChangeContent(selectedChange.id, partialContent);
        } else if (window.electronAPI?.agentUpdateRun && currentProjectPath) {
          const nextChanges = changes.map((change) => (
            change.id === selectedChange.id
              ? { ...change, newContent: partialContent, status: 'partial' }
              : change
          ));
          await window.electronAPI.agentUpdateRun(currentProjectPath, activeRun.id, { changes: nextChanges });
        }
      }

      if (queueIndex >= 0 && typeof onApplyPendingChange === 'function') {
        await onSelectPendingChange?.(queueIndex);
        await onApplyPendingChange(queueIndex, overrideContent);
      } else if (window.electronAPI?.agentApplyChange && currentProjectPath) {
        const res = await window.electronAPI.agentApplyChange(currentProjectPath, activeRun.id, selectedChange.id);
        if (!res?.success) {
          showMessage?.(`Application IA: ${res?.error || 'echec verification'}`, 5000);
        } else {
          showMessage?.(`Changement IA verifie: ${selectedChange.filePath}`, 2500);
        }
        await onAfterDiskChange?.();
      }
      await onRunChanged?.(activeRun.id);
    } finally {
      setIsWorking(false);
    }
  };

  const rejectSelectedChange = async () => {
    if (!selectedChange || !activeRun?.id) return;
    setIsWorking(true);
    try {
      if (queueIndex >= 0 && typeof onRejectPendingChange === 'function') {
        await onRejectPendingChange(queueIndex);
      } else if (window.electronAPI?.agentRejectChange && currentProjectPath) {
        await window.electronAPI.agentRejectChange(currentProjectPath, activeRun.id, selectedChange.id);
      }
      await onRunChanged?.(activeRun.id);
    } finally {
      setIsWorking(false);
    }
  };

  const restoreRun = async () => {
    if (!activeRun?.id || !canEdit || !window.electronAPI?.agentRestoreRun || !currentProjectPath) return;
    setIsWorking(true);
    try {
      const res = await window.electronAPI.agentRestoreRun(currentProjectPath, activeRun.id);
      if (res?.success) {
        showMessage?.(`Run IA restaure (${res.restored} fichier(s)).`, 3000);
        await onAfterDiskChange?.();
      } else {
        showMessage?.(`Restore IA: ${res?.error || 'echec'}`, 5000);
      }
      await onRunChanged?.(activeRun.id);
    } finally {
      setIsWorking(false);
    }
  };

  const exportRun = (format) => {
    if (!activeRun) return;
    const payload = buildRunExportPayload(activeRun, format);
    downloadTextFile(payload.filename, payload.content, payload.mimeType);
    showMessage?.(format === 'markdown' ? 'Run IA exporte en Markdown.' : 'Run IA exporte en JSON.', 2200);
  };

  return (
    <div className="ai-changes-panel">
      <aside className="ai-changes-runs">
        <div className="ai-changes-header">
          <div>
            <div className="ai-changes-eyebrow">Audit IA</div>
            <h2>AI Changes</h2>
          </div>
          <button type="button" onClick={onRefresh} disabled={isLoading} className="ai-changes-icon-btn">Refresh</button>
        </div>

        <div className="ai-runs-list custom-scrollbar">
          {runs.length === 0 && (
            <div className="ai-changes-empty">Aucun run IA persistant pour ce projet.</div>
          )}
          {runs.map((run) => (
            <button
              key={run.id}
              type="button"
              className={`ai-run-item ${selectedRunId === run.id ? 'is-active' : ''}`}
              onClick={() => onSelectRun?.(run.id)}
            >
              <span className={`ai-run-status is-${run.status}`}>{getStatusLabel(run.status)}</span>
              <span className="ai-run-title">{shortPrompt(run.prompt)}</span>
              <span className="ai-run-meta">
                {run.changeCount || 0} fichier(s) | +{run.additions || 0} -{run.deletions || 0}
              </span>
            </button>
          ))}
        </div>
      </aside>

      <section className="ai-changes-review">
        {!activeRun ? (
          <div className="ai-changes-empty">Selectionnez un run IA pour revoir ses changements.</div>
        ) : (
          <>
            <div className="ai-review-top">
              <div>
                <div className="ai-changes-eyebrow">IA</div>
                <h3>{shortPrompt(activeRun.prompt)}</h3>
              </div>
              <div className="ai-review-actions">
                <button type="button" className="ai-changes-btn" onClick={() => exportRun('json')}>Export JSON</button>
                <button type="button" className="ai-changes-btn" onClick={() => exportRun('markdown')}>Export MD</button>
                <button type="button" className="ai-changes-btn" onClick={restoreRun} disabled={!canEdit || isWorking}>Rollback run</button>
                <button type="button" className="ai-changes-btn" onClick={onRefresh} disabled={isLoading}>Actualiser</button>
              </div>
            </div>

            <div className="ai-review-body">
              <div className="ai-review-files custom-scrollbar">
                {changes.map((change) => {
                  const active = selectedChange?.id === change.id;
                  const pendingIndex = findPendingIndex(pendingFileChanges, activeRun.id, change);
                  return (
                    <button
                      key={change.id}
                      type="button"
                      className={`ai-change-file ${active ? 'is-active' : ''}`}
                      onClick={() => setSelectedChangeId(change.id)}
                    >
                      <span className={`ai-change-status is-${change.status}`}>{getStatusLabel(change.status)}</span>
                      <span className="ai-change-file-path">{change.filePath}</span>
                      <span className="ai-change-file-meta">
                        +{change.additions || 0} -{change.deletions || 0}
                        {pendingIndex >= 0 ? ' | en attente' : ''}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="ai-review-diff">
                {selectedChange && (
                  <>
                    <div className="ai-diff-toolbar">
                      <div className="ai-diff-title">
                        <span>{selectedChange.filePath}</span>
                        <span>+{diffSummary.additions} -{diffSummary.deletions}</span>
                      </div>
                      <div className="ai-review-actions">
                        <button type="button" className="ai-changes-btn is-danger" onClick={rejectSelectedChange} disabled={isWorking}>Rejeter</button>
                        <button type="button" className="ai-changes-btn is-primary" onClick={applySelectedChange} disabled={!canEdit || isWorking}>
                          {allChangesSelected ? 'Appliquer' : noChangesSelected ? 'Rejeter selection' : 'Appliquer selection'}
                        </button>
                      </div>
                    </div>

                    {diffSummary.hunks.length > 0 && (
                      <div className="ai-hunks-row custom-scrollbar">
                        {diffSummary.hunks.map((hunk) => {
                          const hunkLineIds = hunk.lines
                            .filter((line) => line.type === 'add' || line.type === 'remove')
                            .map((line) => line.id);
                          const checkedCount = hunkLineIds.filter((id) => selectedLineIdSet.has(id)).length;
                          const checked = hunkLineIds.length === 0 || checkedCount === hunkLineIds.length;
                          const partial = checkedCount > 0 && checkedCount < hunkLineIds.length;
                          return (
                            <label key={hunk.id} className={`ai-hunk-toggle ${checked ? 'is-selected' : ''} ${partial ? 'is-partial' : ''} ${checkedCount === 0 ? 'is-empty' : ''}`}>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(event) => setHunkSelection(hunk, event.target.checked)}
                              />
                              <span>{hunk.id}</span>
                              <small>{checkedCount}/{hunkLineIds.length} | +{hunk.additions} -{hunk.deletions}</small>
                            </label>
                          );
                        })}
                      </div>
                    )}

                    {diffSummary.hunks.length > 0 && (
                      <div className="ai-line-review custom-scrollbar">
                        {diffSummary.hunks.map((hunk) => (
                          <div key={hunk.id} className="ai-line-hunk">
                            <div className="ai-line-hunk-title">
                              <span>{hunk.id}</span>
                              <small>lignes modifiees</small>
                            </div>
                            {hunk.lines
                              .filter((line) => line.type === 'add' || line.type === 'remove')
                              .map((line) => {
                                const lineNumber = line.type === 'add' ? line.newLineNumber : line.oldLineNumber;
                                const checked = selectedLineIdSet.has(line.id);
                                const marker = line.type === 'add' ? '+' : '-';
                                return (
                                  <label key={line.id} className={`ai-line-toggle is-${line.type} ${checked ? 'is-selected' : 'is-excluded'}`}>
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      aria-label={`${line.type} line ${lineNumber || '?'} ${line.text}`}
                                      onChange={(event) => setLineSelection(line.id, event.target.checked)}
                                    />
                                    <span className="ai-line-marker">{marker}{lineNumber || '?'}</span>
                                    <code>{line.text || ' '}</code>
                                  </label>
                                );
                              })}
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="ai-monaco-diff">
                      <DiffEditor
                        height="100%"
                        width="100%"
                        language={getLanguageFromPath(selectedChange.filePath)}
                        original={selectedChange.oldContent || ''}
                        modified={selectedChange.newContent || ''}
                        theme={document.body.classList.contains('theme-paper') ? 'vs' : 'vs-dark'}
                        onMount={handleDiffEditorMount}
                        options={{
                          readOnly: true,
                          minimap: { enabled: false },
                          glyphMargin: true,
                          renderSideBySide: true,
                          scrollBeyondLastLine: false,
                          automaticLayout: true,
                          fontSize: 13,
                          lineHeight: 20
                        }}
                      />
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="ai-run-log custom-scrollbar">
              {(activeRun.logs || []).slice(-30).map((log) => (
                <div key={log.id} className="ai-log-line">
                  <span>{new Date(log.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                  <strong>{log.type}</strong>
                  <span>{log.message}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
};

export default AIChangesPanel;
