import { useState, useCallback, useRef } from 'react';

const toBackendNode = (node) => {
    const data = node?.data && typeof node.data === 'object' ? node.data : {};
    const config = { ...data };
    const label = config.label;
    const icon = config.icon;
    const nodeType = config.nodeType;
    ['label', 'icon', 'nodeType', 'onChange', '_execStatus', '_draftState', 'defaultAIProvider'].forEach((key) => delete config[key]);
    return {
        id: node.id,
        type: nodeType || 'action',
        label: label || node.id,
        icon: icon || 'lightning',
        position: node.position,
        config,
    };
};

const useWorkflowRunner = ({
    isElectronApiAvailable,
    currentProjectPath,
    showMessage,
    workflowName = 'Mon Workflow',
}) => {
    const [isRunning, setIsRunning] = useState(false);
    const [activeNodeId, setActiveNodeId] = useState(null);
    const [executionLog, setExecutionLog] = useState([]);
    const [nodeResults, setNodeResults] = useState({});
    const activeRunIdRef = useRef(null);
    const api = isElectronApiAvailable ? window.electronAPI : null;

    const startWorkflowRun = useCallback(async (nodes, edges) => {
        if (isRunning || !nodes?.length) return null;
        if (!api || typeof api.startWorkflowRun !== 'function') {
            showMessage?.('L’exécution des workflows nécessite le backend Electron.', 3000);
            return { success: false, error: 'Backend workflow indisponible.' };
        }

        setIsRunning(true);
        setActiveNodeId(null);
        setExecutionLog([]);
        setNodeResults({});
        showMessage?.('▶️ Workflow en cours côté backend…', 2000);

        const onProgress = (payload = {}) => {
            if (!payload.runId) return;
            if (activeRunIdRef.current && activeRunIdRef.current !== payload.runId) return;
            activeRunIdRef.current = payload.runId;
            if (payload.nodeId && payload.nodeStatus) {
                setActiveNodeId(payload.nodeStatus === 'running' ? payload.nodeId : null);
                setNodeResults((previous) => ({
                    ...previous,
                    [payload.nodeId]: {
                        status: payload.nodeStatus,
                        result: payload.result || payload.error || '',
                    },
                }));
            }
        };
        const onLog = (entry = {}) => {
            if (!entry.runId || (activeRunIdRef.current && entry.runId !== activeRunIdRef.current)) return;
            setExecutionLog((previous) => [...previous, {
                nodeId: entry.nodeId || null,
                type: entry.type || 'info',
                message: entry.message || '',
                timestamp: entry.timestamp
                    ? new Date(entry.timestamp).toLocaleTimeString('fr-FR')
                    : new Date().toLocaleTimeString('fr-FR'),
            }]);
        };

        const offProgress = typeof api.onWorkflowRunProgress === 'function'
            ? api.onWorkflowRunProgress(onProgress) : () => {};
        const offLog = typeof api.onWorkflowRunLog === 'function'
            ? api.onWorkflowRunLog(onLog) : () => {};

        try {
            const response = await api.startWorkflowRun(currentProjectPath, {
                schemaVersion: 2,
                name: workflowName,
                nodes: nodes.map(toBackendNode),
                edges: edges.map((edge) => ({ source: edge.source, target: edge.target })),
            });
            if (response?.success) showMessage?.('✅ Workflow terminé.', 2000);
            else if (response?.error) {
                setExecutionLog((previous) => [...previous, {
                    nodeId: null,
                    type: 'error',
                    message: response.error,
                    timestamp: new Date().toLocaleTimeString('fr-FR'),
                }]);
                showMessage?.(response.error, 3000);
            }
            return response;
        } catch (error) {
            const message = 'Échec du démarrage du workflow côté backend.';
            setExecutionLog((previous) => [...previous, {
                nodeId: null,
                type: 'error',
                message,
                timestamp: new Date().toLocaleTimeString('fr-FR'),
            }]);
            showMessage?.(message, 3000);
            return { success: false, error: message };
        } finally {
            offProgress?.();
            offLog?.();
            activeRunIdRef.current = null;
            setActiveNodeId(null);
            setIsRunning(false);
        }
    }, [api, currentProjectPath, isRunning, showMessage, workflowName]);

    const stopWorkflow = useCallback(async () => {
        if (!activeRunIdRef.current || typeof api?.stopWorkflowRun !== 'function') return;
        await api.stopWorkflowRun(activeRunIdRef.current);
        showMessage?.('Workflow en cours d’arrêt…', 1500);
    }, [api, showMessage]);

    const clearLog = useCallback(() => {
        setExecutionLog([]);
        setNodeResults({});
    }, []);

    return {
        isRunning,
        activeNodeId,
        executionLog,
        nodeResults,
        startWorkflowRun,
        stopWorkflow,
        clearLog,
    };
};

export default useWorkflowRunner;
