const sanitizeRunId = (runId) => {
  const safeId = String(runId || 'ai-run').replace(/[^a-zA-Z0-9_.-]/g, '_');
  return safeId || 'ai-run';
};

export const buildRunMarkdown = (run) => {
  const changes = Array.isArray(run?.changes) ? run.changes : [];
  const logs = Array.isArray(run?.logs) ? run.logs : [];
  return [
    `# AI Change Run ${run?.id || ''}`,
    '',
    `Status: ${run?.status || 'unknown'}`,
    `Provider: ${run?.provider || '-'}`,
    `Model: ${run?.model || '-'}`,
    `Started: ${run?.startedAt || '-'}`,
    `Finished: ${run?.finishedAt || '-'}`,
    '',
    '## Prompt',
    '',
    run?.prompt || '_No prompt captured._',
    '',
    '## Changes',
    '',
    ...changes.map((change) => (
      `- ${change.filePath} [${change.status}] +${change.additions || 0} -${change.deletions || 0}`
    )),
    '',
    '## Logs',
    '',
    ...logs.map((log) => (
      `- ${log.at || ''} [${log.type || 'info'}] ${log.filePath ? `${log.filePath}: ` : ''}${log.message || ''}`
    )),
    ''
  ].join('\n');
};

export const buildRunExportPayload = (run, format = 'json') => {
  const safeId = sanitizeRunId(run?.id);
  if (format === 'markdown') {
    return {
      filename: `${safeId}.md`,
      content: buildRunMarkdown(run),
      mimeType: 'text/markdown'
    };
  }

  return {
    filename: `${safeId}.json`,
    content: JSON.stringify(run || {}, null, 2),
    mimeType: 'application/json'
  };
};
