import React from 'react';
import { OPAQUE_AI_LABEL, OPAQUE_WORKING_LABEL } from '../../utils/rendererOpacity';

const StatusBar = ({
  viewMode,
  centerView,
  previewStatus,
  isStreamingCodePreview,
  aiDraftPreview,
  gitDiffPreview,
  thinkingMode,
  deepContextEnabled,
  contextMode,
  multiAIState,
  permissionMode,
  projectName,
  pendingAIChangeCount = 0,
}) => {
  const steps = Array.isArray(multiAIState?.steps) ? multiAIState.steps : [];
  const doneCount = steps.filter((s) => s?.status === 'done' || s?.status === 'completed').length;
  const multiLabel = multiAIState?.mode
    ? multiAIState.error
      ? 'Équipe erreur'
      : multiAIState.isActive
        ? `Équipe ${doneCount}/${steps.length || 0}`
        : `Équipe ${doneCount}/${steps.length || 0} OK`
    : '';

  const permLabel = permissionMode === 'read_only' ? 'Lecture seule' : permissionMode === 'edit' ? 'Édition' : 'Édition + terminal';

  return (
    <footer className="statusbar">
      {/* Indicateur connexion */}
      <div className="statusbar-item">
        <span
          className="statusbar-dot"
          style={{ background: previewStatus === 'running' ? 'var(--success)' : 'var(--text-muted)' }}
        />
        <span className="statusbar-value" style={{ color: 'var(--text-dim)' }}>
          {projectName}
        </span>
      </div>

      {/* Vue active */}
      <div className="statusbar-item">
        <span className="statusbar-label">Mode</span>
        <span className="statusbar-value">{viewMode}</span>
        {viewMode === 'ide' && (
          <>
            <span className="statusbar-label" style={{ marginLeft: '8px' }}>Panneau</span>
            <span className="statusbar-value">{centerView}</span>
          </>
        )}
      </div>

      {/* Preview */}
      <div className="statusbar-item">
        <span className="statusbar-label">Preview</span>
        <span className={`statusbar-value ${previewStatus === 'running' ? 'is-live' : ''}`}>
          {previewStatus === 'running' ? '● actif' : previewStatus}
        </span>
      </div>

      {/* Streaming IA */}
      {isStreamingCodePreview && (
        <div className="statusbar-item">
          <span className="statusbar-dot accent" />
          <span className="statusbar-value" style={{ color: 'var(--accent)' }}>
            Flux IA: {OPAQUE_WORKING_LABEL} {aiDraftPreview?.filePath || ''}
          </span>
        </div>
      )}

      {/* Git diff */}
      {gitDiffPreview && !isStreamingCodePreview && (
        <div className="statusbar-item">
          <span className="statusbar-label">Diff</span>
          <span className="statusbar-value">{gitDiffPreview.baseLabel} → {gitDiffPreview.targetLabel}</span>
        </div>
      )}

      {pendingAIChangeCount > 0 && (
        <div className="statusbar-item">
          <span className="statusbar-dot accent" />
          <span className="statusbar-value" style={{ color: 'var(--accent)' }}>
            IA review: {pendingAIChangeCount}
          </span>
        </div>
      )}

      {/* IA */}
      <div className="statusbar-item">
        <span className="statusbar-label">IA</span>
        <span className="statusbar-value">
          {OPAQUE_AI_LABEL}
          {thinkingMode ? ' +Think' : ''}
          {deepContextEnabled ? ' +Ctx' : ''}
          {contextMode !== 'auto' ? ` (${contextMode})` : ''}
        </span>
      </div>

      {/* Multi-IA */}
      {multiLabel && (
        <div className="statusbar-item">
          <span
            className="statusbar-dot"
            style={{ background: multiAIState?.error ? 'var(--danger)' : multiAIState?.isActive ? 'var(--accent)' : 'var(--success)' }}
          />
          <span className="statusbar-value">{multiLabel}</span>
        </div>
      )}

      <div className="statusbar-spacer" />

      {/* Permissions */}
      <div className="statusbar-item">
        <span className="statusbar-label">Permissions</span>
        <span className="statusbar-value">{permLabel}</span>
      </div>
    </footer>
  );
};

export default StatusBar;
