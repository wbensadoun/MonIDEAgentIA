import { useCallback, useEffect, useState } from 'react';

const useAgentRuns = ({
  currentProjectPath,
  isElectronApiAvailable,
  activeAgentRunId,
  agentRunRefreshKey
}) => {
  const [agentRuns, setAgentRuns] = useState([]);
  const [activeAgentRun, setActiveAgentRun] = useState(null);
  const [selectedAgentRunId, setSelectedAgentRunId] = useState('');
  const [isAgentRunsLoading, setIsAgentRunsLoading] = useState(false);

  const loadAgentRun = useCallback(async (runId) => {
    if (!currentProjectPath || !isElectronApiAvailable || !window.electronAPI?.agentGetRun || !runId) {
      setActiveAgentRun(null);
      return null;
    }

    const res = await window.electronAPI.agentGetRun(currentProjectPath, runId);
    if (res?.success && res.run) {
      setActiveAgentRun(res.run);
      return res.run;
    }
    setActiveAgentRun(null);
    return null;
  }, [currentProjectPath, isElectronApiAvailable]);

  const loadAgentRuns = useCallback(async (preferredRunId = selectedAgentRunId) => {
    if (!currentProjectPath || !isElectronApiAvailable || !window.electronAPI?.agentListRuns) {
      setAgentRuns([]);
      setActiveAgentRun(null);
      setSelectedAgentRunId('');
      return;
    }

    setIsAgentRunsLoading(true);
    try {
      const res = await window.electronAPI.agentListRuns(currentProjectPath);
      const runs = res?.success && Array.isArray(res.runs) ? res.runs : [];
      setAgentRuns(runs);

      const nextRunId = preferredRunId && runs.some((run) => run.id === preferredRunId)
        ? preferredRunId
        : (runs[0]?.id || '');
      setSelectedAgentRunId(nextRunId);

      if (nextRunId) {
        await loadAgentRun(nextRunId);
      } else {
        setActiveAgentRun(null);
      }
    } finally {
      setIsAgentRunsLoading(false);
    }
  }, [currentProjectPath, isElectronApiAvailable, loadAgentRun, selectedAgentRunId]);

  const handleSelectAgentRun = useCallback((runId) => {
    setSelectedAgentRunId(runId);
    loadAgentRun(runId);
  }, [loadAgentRun]);

  const refreshAgentRunAfterMutation = useCallback(async (runId = selectedAgentRunId) => {
    await loadAgentRuns(runId);
  }, [loadAgentRuns, selectedAgentRunId]);

  useEffect(() => {
    loadAgentRuns('');
  }, [currentProjectPath, loadAgentRuns]);

  useEffect(() => {
    if (!activeAgentRunId) return;
    loadAgentRuns(activeAgentRunId);
  }, [activeAgentRunId, agentRunRefreshKey, loadAgentRuns]);

  useEffect(() => {
    if (!isElectronApiAvailable || !window.electronAPI?.onAgentAction) return undefined;
    const off = window.electronAPI.onAgentAction((event) => {
      if (!event?.runId) return;
      loadAgentRuns(event.runId);
    });
    return () => {
      if (typeof off === 'function') off();
    };
  }, [isElectronApiAvailable, loadAgentRuns]);

  return {
    agentRuns,
    activeAgentRun,
    selectedAgentRunId,
    isAgentRunsLoading,
    loadAgentRuns,
    handleSelectAgentRun,
    refreshAgentRunAfterMutation
  };
};

export default useAgentRuns;