import React from 'react';

const StatusBar = ({
  centerView,
  previewStatus,
  isStreamingCodePreview,
  aiDraftPreview,
  gitDiffPreview,
  aiProvider,
  thinkingMode,
  deepContextEnabled,
  contextMode,
  ollamaStatusLabel,
  permissionMode,
  projectName
}) => (
  <footer className="statusbar">
    <div className="status-group">
      <span className="status-label">Vue</span>
      <span className="status-value">{centerView}</span>
    </div>
    <div className="status-group">
      <span className="status-label">Preview</span>
      <span className={`status-value ${previewStatus === 'running' ? 'status-live' : ''}`}>
        {previewStatus}
      </span>
    </div>
    {isStreamingCodePreview && (
      <div className="status-group">
        <span className="status-label">Flux IA</span>
        <span className="status-value">{aiDraftPreview?.agent || 'generation'}: {aiDraftPreview?.filePath}</span>
      </div>
    )}
    {gitDiffPreview && !isStreamingCodePreview && (
      <div className="status-group">
        <span className="status-label">Compare</span>
        <span className="status-value">{`${gitDiffPreview.baseLabel} -> ${gitDiffPreview.targetLabel}`}</span>
      </div>
    )}
    <div className="status-group">
      <span className="status-label">IA</span>
      <span className="status-value">
        {aiProvider}
        {thinkingMode ? ' +Think' : ''}
        {deepContextEnabled ? ' +Ctx' : ''}
        {contextMode !== 'auto' ? ` (${contextMode})` : ''}
      </span>
    </div>
    {(aiProvider === 'ollama' || aiProvider === 'ollama-multi') && (
      <div className="status-group">
        <span className="status-label">Model</span>
        <span className="status-value">{ollamaStatusLabel}</span>
      </div>
    )}
    <div className="status-group">
      <span className="status-label">Mode</span>
      <span className="status-value">{permissionMode}</span>
    </div>
    <div className="status-group">
      <span className="status-label">Projet</span>
      <span className="status-value">{projectName}</span>
    </div>
  </footer>
);

export default StatusBar;
