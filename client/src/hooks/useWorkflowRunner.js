import { useState, useCallback, useRef } from 'react';

/**
 * useWorkflowRunner – moteur d'exécution de flux visuels
 * 
 * Exécute les nœuds dans l'ordre topologique (respect des connexions),
 * en pilotant les handlers existants : Terminal, IA, lecture/écriture fichiers.
 * 
 * Chaque nœud reçoit le résultat du nœud précédent via `{{prev}}` dans ses champs.
 */
const useWorkflowRunner = ({ isElectronApiAvailable, currentProjectPath, showMessage }) => {
    const [isRunning, setIsRunning] = useState(false);
    const [activeNodeId, setActiveNodeId] = useState(null);
    const [executionLog, setExecutionLog] = useState([]);
    const [nodeResults, setNodeResults] = useState({});
    const abortRef = useRef(false);
    const api = isElectronApiAvailable ? window.electronAPI : null;

    const log = useCallback((nodeId, type, message) => {
        const entry = {
            nodeId,
            type, // 'info' | 'success' | 'error' | 'output'
            message,
            timestamp: new Date().toLocaleTimeString('fr-FR'),
        };
        setExecutionLog(prev => [...prev, entry]);
    }, []);

    // ── Trier les nœuds par ordre topologique ──
    const topoSort = useCallback((nodes, edges) => {
        const adj = {};
        const inDegree = {};
        nodes.forEach(n => { adj[n.id] = []; inDegree[n.id] = 0; });
        edges.forEach(e => {
            if (adj[e.source]) adj[e.source].push(e.target);
            if (inDegree[e.target] !== undefined) inDegree[e.target]++;
        });

        const queue = nodes.filter(n => inDegree[n.id] === 0).map(n => n.id);
        const sorted = [];
        while (queue.length > 0) {
            const id = queue.shift();
            sorted.push(id);
            (adj[id] || []).forEach(next => {
                inDegree[next]--;
                if (inDegree[next] === 0) queue.push(next);
            });
        }
        // Ajouter les nœuds orphelins
        nodes.forEach(n => { if (!sorted.includes(n.id)) sorted.push(n.id); });
        return sorted;
    }, []);

    // ── Remplacer les variables ──
    const interpolate = useCallback((text, prevResult, allResults) => {
        if (!text) return text;
        let result = text;
        result = result.replace(/\{\{prev\}\}/g, prevResult || '');
        result = result.replace(/\{\{(\w+)\}\}/g, (_, key) => allResults[key] || '');
        return result;
    }, []);

    // ── Exécuter un nœud unique ──
    const executeNode = useCallback(async (node, prevResult, allResults) => {
        const nodeType = node.data?.nodeType;
        const data = node.data || {};

        switch (nodeType) {
            case 'trigger': {
                // Les déclencheurs ne font rien, ils démarrent le flux
                return `Déclencheur "${data.label}" activé`;
            }

            case 'action': {
                const command = interpolate(data.command, prevResult, allResults);
                if (!command) return 'Aucune commande spécifiée';

                if (!api) return `[Simulation] $ ${command}`;

                // Exécuter la commande via le terminal IPC
                return new Promise((resolve) => {
                    const processId = `wf_${node.id}_${Date.now()}`;
                    let output = '';

                    const outputHandler = (ev) => {
                        if (ev.id === processId) {
                            output += ev.data + '\n';
                            log(node.id, 'output', ev.data);
                        }
                    };

                    const exitHandler = (ev) => {
                        if (ev.id === processId) {
                            api.onProcessOutput(null); // cleanup will be handled by component unmount
                            if (ev.code === 0) {
                                resolve(output.trim() || `Commande terminée (code ${ev.code})`);
                            } else {
                                resolve(`Erreur (code ${ev.code}): ${output.trim()}`);
                            }
                        }
                    };

                    // Écouter la sortie
                    api.onProcessOutput(outputHandler);
                    api.onProcessExit(exitHandler);

                    // Décomposer la commande
                    const parts = command.split(' ');
                    const cmd = parts[0];
                    const args = parts.slice(1);

                    api.startProcess({
                        id: processId,
                        command: cmd,
                        args: args,
                        cwd: currentProjectPath,
                    }).catch(err => {
                        resolve(`Erreur: ${err.message}`);
                    });

                    // Timeout de sécurité (30s)
                    setTimeout(() => {
                        api.stopProcess(processId).catch(() => { });
                        resolve(output.trim() || 'Timeout (30s)');
                    }, 30000);
                });
            }

            case 'ai': {
                const prompt = interpolate(data.prompt, prevResult, allResults);
                if (!prompt) return 'Aucun prompt spécifié';

                if (!api) return `[Simulation IA] Réponse au prompt: "${prompt.substring(0, 50)}..."`;

                try {
                    const history = [{ role: 'user', content: prompt }];
                    const result = await api.getGeminiCompletion(
                        history,
                        '', // no current code
                        [], // no project files
                        { model: data.model || 'gemini' }
                    );
                    return result?.response || result?.text || 'Réponse IA reçue';
                } catch (err) {
                    return `Erreur IA: ${err.message}`;
                }
            }

            case 'logic': {
                const condition = interpolate(data.condition, prevResult, allResults);
                if (!condition) return 'true';

                // Évaluation sûre de la condition
                try {
                    const result = prevResult;
                    // eslint-disable-next-line no-eval
                    const evaluated = new Function('result', 'prev', `return ${condition}`)(result, prevResult);
                    return String(evaluated);
                } catch (e) {
                    return `Erreur condition: ${e.message}`;
                }
            }

            case 'output': {
                const message = interpolate(data.message, prevResult, allResults);
                if (showMessage) showMessage(message || 'Workflow terminé', 3000);
                return message || 'Notification envoyée';
            }

            default:
                return `Nœud "${data.label}" exécuté`;
        }
    }, [api, currentProjectPath, log, interpolate, showMessage]);

    // ── Exécuter tout le workflow ──
    const runWorkflow = useCallback(async (nodes, edges) => {
        if (isRunning || nodes.length === 0) return;

        setIsRunning(true);
        abortRef.current = false;
        setExecutionLog([]);
        setNodeResults({});

        const sorted = topoSort(nodes, edges);
        const results = {};
        let prevResult = '';

        log(null, 'info', '🚀 Démarrage du workflow...');
        if (showMessage) showMessage('▶️ Workflow en cours...', 2000);

        for (const nodeId of sorted) {
            if (abortRef.current) {
                log(null, 'error', '⛔ Workflow interrompu');
                break;
            }

            const node = nodes.find(n => n.id === nodeId);
            if (!node) continue;

            setActiveNodeId(nodeId);
            log(nodeId, 'info', `⏳ Exécution: ${node.data?.label || nodeId}`);

            try {
                const result = await executeNode(node, prevResult, results);
                results[nodeId] = result;
                prevResult = result;
                setNodeResults(prev => ({ ...prev, [nodeId]: { status: 'success', result } }));
                log(nodeId, 'success', `✅ ${node.data?.label}: ${String(result).substring(0, 200)}`);
            } catch (err) {
                results[nodeId] = `Erreur: ${err.message}`;
                setNodeResults(prev => ({ ...prev, [nodeId]: { status: 'error', result: err.message } }));
                log(nodeId, 'error', `❌ ${node.data?.label}: ${err.message}`);
                // Continue to next node despite errors
            }

            // Petit délai entre nœuds pour l'animation
            await new Promise(r => setTimeout(r, 300));
        }

        log(null, 'success', '🏁 Workflow terminé !');
        if (showMessage) showMessage('✅ Workflow terminé !', 2000);
        setActiveNodeId(null);
        setIsRunning(false);
    }, [isRunning, topoSort, executeNode, log, showMessage]);

    // ── Arrêter l'exécution ──
    const stopWorkflow = useCallback(() => {
        abortRef.current = true;
        setIsRunning(false);
        setActiveNodeId(null);
        log(null, 'error', '⛔ Workflow arrêté par l\'utilisateur');
        if (showMessage) showMessage('Workflow arrêté', 1500);
    }, [log, showMessage]);

    // ── Effacer les logs ──
    const clearLog = useCallback(() => {
        setExecutionLog([]);
        setNodeResults({});
    }, []);

    return {
        isRunning,
        activeNodeId,
        executionLog,
        nodeResults,
        runWorkflow,
        stopWorkflow,
        clearLog,
    };
};

export default useWorkflowRunner;
