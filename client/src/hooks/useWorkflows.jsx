import { useState, useCallback, useEffect } from 'react';

/**
 * Custom hook for managing workflows
 * Supports both global and workspace-scoped workflows
 */
export const useWorkflows = (currentProjectPath, isElectronApiAvailable) => {
    const [workflows, setWorkflows] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);

    // Load all workflows
    const loadWorkflows = useCallback(async () => {
        if (!isElectronApiAvailable || !window.electronAPI?.listWorkflows) {
            setWorkflows([]);
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            const response = await window.electronAPI.listWorkflows(currentProjectPath);
            if (response.success) {
                setWorkflows(response.workflows || []);
            } else {
                setError(response.error);
                setWorkflows([]);
            }
        } catch (err) {
            setError(err.message);
            setWorkflows([]);
        } finally {
            setIsLoading(false);
        }
    }, [currentProjectPath, isElectronApiAvailable]);

    // Get a specific workflow by name and scope
    const getWorkflow = useCallback(async (name, scope) => {
        if (!isElectronApiAvailable || !window.electronAPI?.getWorkflow) {
            return null;
        }

        try {
            const response = await window.electronAPI.getWorkflow(name, scope, currentProjectPath);
            if (response.success) {
                return response.workflow;
            }
            return null;
        } catch (err) {
            console.error('Error getting workflow:', err);
            return null;
        }
    }, [currentProjectPath, isElectronApiAvailable]);

    // Save a workflow
    const saveWorkflow = useCallback(async (name, content, scope) => {
        if (!isElectronApiAvailable || !window.electronAPI?.saveWorkflow) {
            return { success: false, error: 'API not available' };
        }

        try {
            const response = await window.electronAPI.saveWorkflow(name, content, scope, currentProjectPath);
            if (response.success) {
                await loadWorkflows(); // Refresh the list
            }
            return response;
        } catch (err) {
            return { success: false, error: err.message };
        }
    }, [currentProjectPath, isElectronApiAvailable, loadWorkflows]);

    // Delete a workflow
    const deleteWorkflow = useCallback(async (name, scope) => {
        if (!isElectronApiAvailable || !window.electronAPI?.deleteWorkflow) {
            return { success: false, error: 'API not available' };
        }

        try {
            const response = await window.electronAPI.deleteWorkflow(name, scope, currentProjectPath);
            if (response.success) {
                await loadWorkflows(); // Refresh the list
            }
            return response;
        } catch (err) {
            return { success: false, error: err.message };
        }
    }, [currentProjectPath, isElectronApiAvailable, loadWorkflows]);

    // Find a workflow by name (searches both scopes, workspace first)
    const findWorkflow = useCallback((name) => {
        // First check workspace scope
        const workspaceMatch = workflows.find(
            w => w.name.toLowerCase() === name.toLowerCase() && w.scope === 'workspace'
        );
        if (workspaceMatch) return workspaceMatch;

        // Then check global scope
        return workflows.find(
            w => w.name.toLowerCase() === name.toLowerCase() && w.scope === 'global'
        );
    }, [workflows]);

    // Parse slash command from prompt (e.g., "/deploy" -> "deploy")
    const parseSlashCommand = useCallback((prompt) => {
        const trimmed = prompt.trim();
        if (trimmed.startsWith('/')) {
            const parts = trimmed.split(/\s+/);
            const command = parts[0].substring(1); // Remove the leading /
            const args = parts.slice(1).join(' ');
            return { command, args };
        }
        return null;
    }, []);

    // Load workflows on mount and when project changes
    useEffect(() => {
        loadWorkflows();
    }, [loadWorkflows]);

    return {
        workflows,
        isLoading,
        error,
        loadWorkflows,
        getWorkflow,
        saveWorkflow,
        deleteWorkflow,
        findWorkflow,
        parseSlashCommand
    };
};

export default useWorkflows;
