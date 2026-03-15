import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import ReactFlow, {
    addEdge,
    Background,
    Controls,
    MiniMap,
    useNodesState,
    useEdgesState,
    Handle,
    Position,
} from 'reactflow';
import 'reactflow/dist/style.css';
import './VisualWorkflow.css';
import useWorkflowRunner from '../../hooks/useWorkflowRunner';

/* ═══════════════════════════════════════════
   Catalogue de nœuds disponibles
   ═══════════════════════════════════════════ */
const NODE_CATALOG = [
    // Déclencheurs
    { category: 'Déclencheurs', type: 'trigger', label: 'Déclencheur Manuel', icon: '▶️', desc: 'Démarre le flux manuellement' },
    { category: 'Déclencheurs', type: 'trigger', label: 'Cron / Planifié', icon: '⏰', desc: 'Exécution planifiée' },
    { category: 'Déclencheurs', type: 'trigger', label: 'Webhook', icon: '🌐', desc: 'Réception HTTP' },
    // IA
    { category: 'Intelligence Artificielle', type: 'ai', label: 'Prompt IA', icon: '🤖', desc: 'Envoyer un prompt au LLM' },
    { category: 'Intelligence Artificielle', type: 'ai', label: 'Analyser Code', icon: '🔍', desc: 'Analyse IA du code source' },
    { category: 'Intelligence Artificielle', type: 'ai', label: 'Générer Code', icon: '✨', desc: 'Génération de code par IA' },
    // Actions
    { category: 'Actions', type: 'action', label: 'Commande Terminal', icon: '💻', desc: 'Exécuter une commande shell' },
    { category: 'Actions', type: 'action', label: 'Lire Fichier', icon: '📄', desc: 'Lire un fichier du projet' },
    { category: 'Actions', type: 'action', label: 'Écrire Fichier', icon: '✏️', desc: 'Écrire dans un fichier' },
    { category: 'Actions', type: 'action', label: 'Requête HTTP', icon: '🔗', desc: 'Appel API externe' },
    { category: 'Actions', type: 'action', label: 'Git Commit', icon: '📦', desc: 'Commit automatique' },
    // Logique
    { category: 'Logique', type: 'logic', label: 'Condition Si/Sinon', icon: '🔀', desc: 'Branchement conditionnel' },
    { category: 'Logique', type: 'logic', label: 'Boucle', icon: '🔁', desc: 'Répéter N fois' },
    { category: 'Logique', type: 'logic', label: 'Délai', icon: '⏳', desc: 'Attendre X secondes' },
    // Sorties
    { category: 'Sorties', type: 'output', label: 'Notification', icon: '🔔', desc: 'Afficher un message' },
    { category: 'Sorties', type: 'output', label: 'Enregistrer Résultat', icon: '💾', desc: 'Sauvegarder les données' },
];

const VALID_NODE_TYPES = new Set(['trigger', 'ai', 'action', 'logic', 'output']);
const DEFAULT_NODE_ICONS = {
    trigger: 'TR',
    ai: 'AI',
    action: 'AC',
    logic: 'LG',
    output: 'OUT'
};
const AI_WORKFLOW_PHASES = [
    'Analyse du besoin',
    'Structuration du JSON',
    'Placement des noeuds',
    'Connexion des liens',
    'Finalisation du canvas'
];

/* ═══════════════════════════════════════════
   Nœud personnalisé
   ═══════════════════════════════════════════ */
const CustomNode = ({ id, data, selected }) => {
    const nodeType = data.nodeType || 'action';
    const execStatus = data._execStatus; // 'running' | 'success' | 'error' | undefined
    const draftState = data._draftState;

    return (
        <div className={`vw-node ${selected ? 'selected' : ''} ${execStatus ? `exec-${execStatus}` : ''} ${draftState ? `draft-${draftState}` : ''}`}>
            <Handle type="target" position={Position.Left} />
            <div className="vw-node-header">
                <div className={`vw-node-icon ${nodeType}`}>
                    {data.icon || '⚡'}
                </div>
                <div className="vw-node-title">{data.label}</div>
            </div>
            <div className="vw-node-body">
                {nodeType === 'trigger' && (
                    <div className="vw-node-field">
                        <span className="vw-node-label">Type</span>
                        <select
                            className="vw-node-select"
                            value={data.triggerType || 'manual'}
                            onChange={e => data.onChange?.(id, 'triggerType', e.target.value)}
                        >
                            <option value="manual">Manuel</option>
                            <option value="cron">Planifié (Cron)</option>
                            <option value="webhook">Webhook</option>
                        </select>
                    </div>
                )}

                {nodeType === 'ai' && (
                    <>
                        <div className="vw-node-field">
                            <span className="vw-node-label">Provider IA</span>
                            <select
                                className="vw-node-select"
                                value={data.model || 'gemini'}
                                onChange={e => data.onChange?.(id, 'model', e.target.value)}
                            >
                                <option value="gemini">Gemini</option>
                                <option value="kimi">Kimi K2.5</option>
                                <option value="ollama">Ollama</option>
                            </select>
                        </div>
                        <div className="vw-node-field">
                            <span className="vw-node-label">Prompt</span>
                            <textarea
                                className="vw-node-input"
                                rows={2}
                                placeholder="Votre instruction IA..."
                                value={data.prompt || ''}
                                onChange={e => data.onChange?.(id, 'prompt', e.target.value)}
                            />
                        </div>
                    </>
                )}

                {nodeType === 'action' && (
                    <div className="vw-node-field">
                        <span className="vw-node-label">Commande / Chemin</span>
                        <input
                            className="vw-node-input"
                            placeholder="ex: npm test"
                            value={data.command || ''}
                            onChange={e => data.onChange?.(id, 'command', e.target.value)}
                        />
                    </div>
                )}

                {nodeType === 'logic' && (
                    <div className="vw-node-field">
                        <span className="vw-node-label">Condition / Valeur</span>
                        <input
                            className="vw-node-input"
                            placeholder="ex: result.success === true"
                            value={data.condition || ''}
                            onChange={e => data.onChange?.(id, 'condition', e.target.value)}
                        />
                    </div>
                )}

                {nodeType === 'output' && (
                    <div className="vw-node-field">
                        <span className="vw-node-label">Message</span>
                        <input
                            className="vw-node-input"
                            placeholder="Message à afficher..."
                            value={data.message || ''}
                            onChange={e => data.onChange?.(id, 'message', e.target.value)}
                        />
                    </div>
                )}
            </div>
            <Handle type="source" position={Position.Right} />
        </div>
    );
};

/* ═══════════════════════════════════════════
   Composant principal
   ═══════════════════════════════════════════ */
const VisualWorkflowEditor = ({ currentProjectPath, isElectronApiAvailable, showMessage }) => {
    const [nodes, setNodes, onNodesChange] = useNodesState([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState([]);

    const [workflowName, setWorkflowName] = useState('Mon Workflow');
    const reactFlowWrapper = useRef(null);
    const [reactFlowInstance, setReactFlowInstance] = useState(null);
    const nodeIdCounter = useRef(1);
    const [showLog, setShowLog] = useState(false);

    // ── Panels ──
    const [activePanel, setActivePanel] = useState(null); // 'add' | 'saved' | 'catalog' | null
    const [savedWorkflows, setSavedWorkflows] = useState([]);
    const [catalogItems, setCatalogItems] = useState([]);
    const [catalogLoading, setCatalogLoading] = useState(false);
    const [catalogSearch, setCatalogSearch] = useState('');
    const [aiWritePulse, setAiWritePulse] = useState(false);
    const [highlightedWorkflowFilename, setHighlightedWorkflowFilename] = useState('');
    const [aiPrompt, setAiPrompt] = useState('');
    const [aiGenerating, setAiGenerating] = useState(false);
    const [aiBuildState, setAiBuildState] = useState({
        active: false,
        phaseIndex: 0,
        statusText: '',
        progress: 0,
        nodesAdded: 0,
        totalNodes: 0,
        edgesAdded: 0,
        totalEdges: 0
    });
    const draftSaveTimerRef = useRef(null);
    const draftLoadedRef = useRef(false);
    const aiWritePulseTimerRef = useRef(null);
    const aiWriteHighlightTimerRef = useRef(null);
    const aiBuildTimersRef = useRef([]);

    const nodeTypes = useMemo(() => ({ custom: CustomNode }), []);
    const api = isElectronApiAvailable ? window.electronAPI : null;
    const draftStorageKey = useMemo(() => {
        if (!currentProjectPath) return '';
        return `vibeIDE_workflowDraft:${currentProjectPath}`;
    }, [currentProjectPath]);

    // ── Execution engine ──
    const {
        isRunning,
        activeNodeId,
        executionLog,
        nodeResults,
        runWorkflow,
        stopWorkflow,
        clearLog,
    } = useWorkflowRunner({ isElectronApiAvailable, currentProjectPath, showMessage });

    // ── Update node visual status during execution ──
    useEffect(() => {
        if (!isRunning && !activeNodeId && Object.keys(nodeResults).length === 0) return;
        setNodes(nds => nds.map(n => {
            const execResult = nodeResults[n.id];
            const isActive = n.id === activeNodeId;
            return {
                ...n,
                data: {
                    ...n.data,
                    _execStatus: isActive ? 'running' : execResult?.status || undefined,
                },
            };
        }));
    }, [activeNodeId, nodeResults, setNodes, isRunning]);

    // ── Load saved workflows list ──
    const refreshSavedList = useCallback(async () => {
        if (!api || !currentProjectPath) return;
        try {
            const result = await api.listVisualWorkflows(currentProjectPath);
            if (result.success) setSavedWorkflows(result.workflows || []);
        } catch (e) { console.error('Error loading saved workflows:', e); }
    }, [api, currentProjectPath]);

    useEffect(() => { refreshSavedList(); }, [refreshSavedList]);

    useEffect(() => {
        const handleWorkflowWrite = async (event) => {
            const detail = event?.detail && typeof event.detail === 'object' ? event.detail : {};
            if (detail.projectPath && currentProjectPath && detail.projectPath !== currentProjectPath) return;

            if (aiWritePulseTimerRef.current) {
                clearTimeout(aiWritePulseTimerRef.current);
                aiWritePulseTimerRef.current = null;
            }
            if (aiWriteHighlightTimerRef.current) {
                clearTimeout(aiWriteHighlightTimerRef.current);
                aiWriteHighlightTimerRef.current = null;
            }

            setAiWritePulse(false);
            setTimeout(() => setAiWritePulse(true), 0);
            aiWritePulseTimerRef.current = setTimeout(() => {
                setAiWritePulse(false);
                aiWritePulseTimerRef.current = null;
            }, 1300);

            const filename = String(detail.filename || '').trim().toLowerCase();
            if (filename) {
                setHighlightedWorkflowFilename(filename);
                aiWriteHighlightTimerRef.current = setTimeout(() => {
                    setHighlightedWorkflowFilename('');
                    aiWriteHighlightTimerRef.current = null;
                }, 2200);
            }

            await refreshSavedList();
        };

        window.addEventListener('ai-visual-workflow-written', handleWorkflowWrite);
        return () => {
            window.removeEventListener('ai-visual-workflow-written', handleWorkflowWrite);
            if (aiWritePulseTimerRef.current) {
                clearTimeout(aiWritePulseTimerRef.current);
                aiWritePulseTimerRef.current = null;
            }
            if (aiWriteHighlightTimerRef.current) {
                clearTimeout(aiWriteHighlightTimerRef.current);
                aiWriteHighlightTimerRef.current = null;
            }
        };
    }, [currentProjectPath, refreshSavedList]);

    // ── Connexion des edges ──
    const onConnect = useCallback(
        (params) => setEdges((eds) => addEdge({ ...params, animated: true, style: { stroke: 'rgba(0,245,212,0.5)' } }, eds)),
        [setEdges]
    );

    // ── Mise à jour des données d'un nœud ──
    const handleNodeDataChange = useCallback((nodeId, field, value) => {
        setNodes((nds) =>
            nds.map((n) =>
                n.id === nodeId ? { ...n, data: { ...n.data, [field]: value } } : n
            )
        );
    }, [setNodes]);

    // ── Ajouter un nœud ──
    const addNode = useCallback((catalogItem) => {
        const newId = `node_${nodeIdCounter.current++}`;
        const position = reactFlowInstance
            ? reactFlowInstance.project({ x: 250 + Math.random() * 200, y: 150 + Math.random() * 200 })
            : { x: 250 + Math.random() * 200, y: 150 + Math.random() * 200 };

        const newNode = {
            id: newId,
            type: 'custom',
            position,
            data: {
                label: catalogItem.label,
                icon: catalogItem.icon,
                nodeType: catalogItem.type,
                onChange: handleNodeDataChange,
            },
        };

        setNodes((nds) => [...nds, newNode]);
        setActivePanel(null);
        if (showMessage) showMessage(`Nœud "${catalogItem.label}" ajouté`, 1500);
    }, [setNodes, reactFlowInstance, handleNodeDataChange, showMessage]);

    // ── Supprimer les nœuds/edges sélectionnés ──
    const deleteSelected = useCallback(() => {
        setNodes((nds) => nds.filter((n) => !n.selected));
        setEdges((eds) => eds.filter((e) => !e.selected));
    }, [setNodes, setEdges]);

    // ── Tout effacer ──
    const clearAll = useCallback(() => {
        setNodes([]);
        setEdges([]);
        nodeIdCounter.current = 1;
        setWorkflowName('Mon Workflow');
    }, [setNodes, setEdges]);

    // ── Sérialiser le workflow pour sauvegarde/export ──
    const serializeWorkflow = useCallback(() => {
        return {
            schemaVersion: 2,
            name: workflowName,
            nodes: nodes.map(n => ({
                id: n.id,
                type: n.data.nodeType,
                label: n.data.label,
                icon: n.data.icon,
                position: n.position,
                config: {
                    triggerType: n.data.triggerType,
                    model: n.data.model,
                    prompt: n.data.prompt,
                    command: n.data.command,
                    condition: n.data.condition,
                    message: n.data.message,
                },
            })),
            edges: edges.map(e => ({ source: e.source, target: e.target })),
        };
    }, [nodes, edges, workflowName]);

    // ── Charger un workflow dans le canvas ──
    const parseWorkflowPayload = useCallback((rawPayload) => {
        if (rawPayload && typeof rawPayload === 'object' && !Array.isArray(rawPayload)) {
            return rawPayload;
        }
        if (typeof rawPayload !== 'string') {
            throw new Error('Format workflow invalide');
        }
        const cleanContent = rawPayload.replace(/```(?:json)?|```/gi, '').trim();
        if (!cleanContent) {
            throw new Error('Workflow vide');
        }
        return JSON.parse(cleanContent);
    }, []);

    const normalizeWorkflowForCanvas = useCallback((workflow) => {
        const source = workflow && typeof workflow === 'object' ? workflow : {};
        const sourceNodes = Array.isArray(source.nodes) ? source.nodes : [];
        const sourceEdges = Array.isArray(source.edges) ? source.edges : [];

        const takenIds = new Set();
        const aliasByOriginalId = new Map();

        let nextGeneratedId = sourceNodes.reduce((max, node) => {
            const rawId = node && node.id !== undefined && node.id !== null ? String(node.id) : '';
            const match = rawId.match(/^node_(\d+)$/);
            if (!match) return max;
            const value = Number.parseInt(match[1], 10);
            if (!Number.isFinite(value)) return max;
            return Math.max(max, value + 1);
        }, 1);

        const allocateNodeId = (candidate) => {
            const trimmed = typeof candidate === 'string' ? candidate.trim() : '';
            if (trimmed && !takenIds.has(trimmed)) {
                takenIds.add(trimmed);
                return trimmed;
            }
            let generated = `node_${nextGeneratedId++}`;
            while (takenIds.has(generated)) {
                generated = `node_${nextGeneratedId++}`;
            }
            takenIds.add(generated);
            return generated;
        };

        const toFiniteNumber = (value, fallback) => {
            const parsed = Number(value);
            return Number.isFinite(parsed) ? parsed : fallback;
        };

        const normalizedNodes = [];
        sourceNodes.forEach((node, index) => {
            if (!node || typeof node !== 'object') return;

            const originalId = node.id !== undefined && node.id !== null ? String(node.id) : '';
            const nodeId = allocateNodeId(originalId);
            if (originalId && !aliasByOriginalId.has(originalId)) {
                aliasByOriginalId.set(originalId, nodeId);
            }

            const fallbackPosition = {
                x: 120 + (index % 4) * 240,
                y: 120 + Math.floor(index / 4) * 170
            };
            const rawPosition = node.position && typeof node.position === 'object' ? node.position : {};
            const nodeType = VALID_NODE_TYPES.has(node.type) ? node.type : 'action';
            const nodeConfig = node.config && typeof node.config === 'object' ? node.config : {};
            const label = typeof node.label === 'string' && node.label.trim()
                ? node.label
                : `Node ${index + 1}`;
            const icon = typeof node.icon === 'string' && node.icon.trim()
                ? node.icon
                : (DEFAULT_NODE_ICONS[nodeType] || 'AC');

            normalizedNodes.push({
                id: nodeId,
                type: 'custom',
                position: {
                    x: toFiniteNumber(rawPosition.x, fallbackPosition.x),
                    y: toFiniteNumber(rawPosition.y, fallbackPosition.y)
                },
                data: {
                    label,
                    icon,
                    nodeType,
                    onChange: handleNodeDataChange,
                    ...nodeConfig,
                },
            });
        });

        const validNodeIds = new Set(normalizedNodes.map((node) => node.id));
        const seenEdgePairs = new Set();
        const normalizedEdges = [];

        sourceEdges.forEach((edge, index) => {
            if (!edge || typeof edge !== 'object') return;

            const rawSource = edge.source !== undefined && edge.source !== null ? String(edge.source) : '';
            const rawTarget = edge.target !== undefined && edge.target !== null ? String(edge.target) : '';
            const sourceId = aliasByOriginalId.get(rawSource) || rawSource;
            const targetId = aliasByOriginalId.get(rawTarget) || rawTarget;

            if (!validNodeIds.has(sourceId) || !validNodeIds.has(targetId)) return;

            const pairKey = `${sourceId}->${targetId}`;
            if (seenEdgePairs.has(pairKey)) return;
            seenEdgePairs.add(pairKey);

            normalizedEdges.push({
                id: `e_${sourceId}_${targetId}_${index}`,
                source: sourceId,
                target: targetId,
                animated: true,
                style: { stroke: 'rgba(0,245,212,0.5)' },
            });
        });

        return {
            name: typeof source.name === 'string' ? source.name.trim() : '',
            nodes: normalizedNodes,
            edges: normalizedEdges,
            nextNodeCounter: Math.max(1, nextGeneratedId)
        };
    }, [handleNodeDataChange]);

    const loadWorkflowIntoCanvas = useCallback((wf) => {
        const normalized = normalizeWorkflowForCanvas(wf);
        if (normalized.name) setWorkflowName(normalized.name);
        setNodes(normalized.nodes);
        setEdges(normalized.edges);
        nodeIdCounter.current = normalized.nextNodeCounter;
    }, [setNodes, setEdges, normalizeWorkflowForCanvas]);

    const clearAiBuildTimers = useCallback(() => {
        aiBuildTimersRef.current.forEach((timerId) => clearTimeout(timerId));
        aiBuildTimersRef.current = [];
    }, []);

    const scheduleAiBuildTimer = useCallback((callback, delay) => {
        const timerId = window.setTimeout(() => {
            aiBuildTimersRef.current = aiBuildTimersRef.current.filter((entry) => entry !== timerId);
            callback();
        }, delay);
        aiBuildTimersRef.current.push(timerId);
        return timerId;
    }, []);

    const animateWorkflowIntoCanvas = useCallback(async (wf) => {
        const normalized = normalizeWorkflowForCanvas(wf);
        const totalNodes = normalized.nodes.length;
        const totalEdges = normalized.edges.length;
        const progressFor = (nodesAdded, edgesAdded) => {
            const totalUnits = Math.max(1, totalNodes + totalEdges);
            const completedUnits = Math.min(totalUnits, nodesAdded + edgesAdded);
            return Math.round((completedUnits / totalUnits) * 100);
        };

        clearAiBuildTimers();
        setActivePanel(null);
        if (normalized.name) setWorkflowName(normalized.name);
        setNodes([]);
        setEdges([]);
        nodeIdCounter.current = normalized.nextNodeCounter;
        setAiBuildState({
            active: true,
            phaseIndex: 2,
            statusText: totalNodes > 0 ? 'Placement progressif des noeuds...' : 'Initialisation du workflow...',
            progress: totalNodes + totalEdges > 0 ? 4 : 100,
            nodesAdded: 0,
            totalNodes,
            edgesAdded: 0,
            totalEdges
        });

        let cursorDelay = 120;
        const nodeStepDelay = totalNodes > 10 ? 90 : 130;
        const edgeStepDelay = totalEdges > 12 ? 75 : 110;

        normalized.nodes.forEach((node, index) => {
            scheduleAiBuildTimer(() => {
                setNodes((prev) => [
                    ...prev,
                    {
                        ...node,
                        data: {
                            ...node.data,
                            _draftState: 'entering'
                        }
                    }
                ]);
                setAiBuildState((prev) => ({
                    ...prev,
                    phaseIndex: 2,
                    statusText: `Ajout du noeud ${index + 1}/${totalNodes}: ${node.data?.label || node.id}`,
                    nodesAdded: index + 1,
                    progress: progressFor(index + 1, prev.edgesAdded)
                }));
                scheduleAiBuildTimer(() => {
                    setNodes((prev) => prev.map((entry) => (
                        entry.id === node.id
                            ? { ...entry, data: { ...entry.data, _draftState: 'settled' } }
                            : entry
                    )));
                }, 380);
            }, cursorDelay);
            cursorDelay += nodeStepDelay;
        });

        if (totalEdges > 0) {
            scheduleAiBuildTimer(() => {
                setAiBuildState((prev) => ({
                    ...prev,
                    phaseIndex: 3,
                    statusText: 'Connexion des liens entre noeuds...'
                }));
            }, Math.max(80, cursorDelay - 40));
        }

        normalized.edges.forEach((edge, index) => {
            scheduleAiBuildTimer(() => {
                setEdges((prev) => [
                    ...prev,
                    {
                        ...edge,
                        className: 'vw-edge-entering'
                    }
                ]);
                setAiBuildState((prev) => ({
                    ...prev,
                    phaseIndex: 3,
                    statusText: `Connexion ${index + 1}/${totalEdges}: ${edge.source} -> ${edge.target}`,
                    edgesAdded: index + 1,
                    progress: progressFor(prev.nodesAdded, index + 1)
                }));
            }, cursorDelay);
            cursorDelay += edgeStepDelay;
        });

        if (totalNodes === 0 && totalEdges === 0) {
            cursorDelay += 120;
        }

        scheduleAiBuildTimer(() => {
            setAiBuildState((prev) => ({
                ...prev,
                phaseIndex: 4,
                statusText: 'Finalisation et cadrage du workflow...',
                progress: 100
            }));
            if (reactFlowInstance?.fitView) {
                setTimeout(() => {
                    reactFlowInstance.fitView({ padding: 0.18, duration: 700 });
                }, 20);
            }
        }, cursorDelay + 120);

        scheduleAiBuildTimer(() => {
            setAiBuildState((prev) => ({
                ...prev,
                active: false,
                statusText: ''
            }));
        }, cursorDelay + 1300);
    }, [
        clearAiBuildTimers,
        normalizeWorkflowForCanvas,
        reactFlowInstance,
        scheduleAiBuildTimer,
        setEdges,
        setNodes
    ]);

    // ── Restore draft on project change ──
    useEffect(() => {
        draftLoadedRef.current = false;
        if (!draftStorageKey) {
            draftLoadedRef.current = true;
            return;
        }
        try {
            const raw = localStorage.getItem(draftStorageKey);
            if (!raw) {
                draftLoadedRef.current = true;
                return;
            }
            const parsed = JSON.parse(raw);
            if (parsed && Array.isArray(parsed.nodes) && Array.isArray(parsed.edges)) {
                loadWorkflowIntoCanvas(parsed);
                if (showMessage) showMessage('Brouillon workflow restaure.', 1800);
            }
        } catch {
            // ignore broken draft
        } finally {
            draftLoadedRef.current = true;
        }
    }, [draftStorageKey, loadWorkflowIntoCanvas, showMessage]);

    useEffect(() => {
        return () => {
            clearAiBuildTimers();
        };
    }, [clearAiBuildTimers]);

    // ── Auto-save draft ──
    useEffect(() => {
        if (!draftStorageKey || !draftLoadedRef.current) return;
        if (draftSaveTimerRef.current) {
            clearTimeout(draftSaveTimerRef.current);
        }
        draftSaveTimerRef.current = setTimeout(() => {
            try {
                const payload = serializeWorkflow();
                localStorage.setItem(draftStorageKey, JSON.stringify(payload));
            } catch {
                // ignore localStorage failure
            }
        }, 400);

        return () => {
            if (draftSaveTimerRef.current) {
                clearTimeout(draftSaveTimerRef.current);
            }
        };
    }, [draftStorageKey, serializeWorkflow]);

    // ── 💾 Sauvegarder le workflow ──
    const saveWorkflow = useCallback(async () => {
        if (!api || !currentProjectPath) {
            if (showMessage) showMessage('Ouvrez un projet pour sauvegarder', 2000);
            return;
        }
        const wf = serializeWorkflow();
        const result = await api.saveVisualWorkflow(currentProjectPath, wf);
        if (result.success) {
            if (showMessage) showMessage(`Workflow "${wf.name}" sauvegardé !`, 2000);
            refreshSavedList();
        } else {
            if (showMessage) showMessage('Erreur de sauvegarde', 2000);
        }
    }, [api, currentProjectPath, serializeWorkflow, showMessage, refreshSavedList]);

    // ── 📂 Charger un workflow sauvegardé ──
    const loadSavedWorkflow = useCallback(async (filename) => {
        if (!api || !currentProjectPath) return;
        try {
            const res = await api.readFile(currentProjectPath, `.vibe-workflows/${filename}`);
            if (res && res.success) {
                try {
                    const wf = parseWorkflowPayload(res.content);
                    loadWorkflowIntoCanvas(wf);
                    setActivePanel(null);
                    if (showMessage) showMessage(`Workflow "${wf.name}" chargé !`, 2000);
                } catch (parseErr) {
                    console.error('Erreur parsing workflow:', parseErr);
                    if (showMessage) showMessage(`Workflow corrompu: ${filename}`, 3000);
                }
            } else if (res && !res.success) {
                if (showMessage) showMessage(`Erreur lecture workflow: ${res.error || filename}`, 3000);
            }
        } catch (e) {
            console.error('Erreur IO lecture workflow:', e);
            if (showMessage) showMessage('Erreur de lecture du fichier', 3000);
        }
    }, [api, currentProjectPath, loadWorkflowIntoCanvas, parseWorkflowPayload, showMessage]);

    // ── 🗑 Supprimer un workflow sauvegardé ──
    const deleteSavedWorkflow = useCallback(async (filename) => {
        if (!api || !currentProjectPath) return;
        const result = await api.deleteVisualWorkflow(currentProjectPath, filename);
        if (result.success) {
            if (showMessage) showMessage('Workflow supprimé', 1500);
            refreshSavedList();
        }
    }, [api, currentProjectPath, showMessage, refreshSavedList]);

    // ── 📤 Exporter en JSON (clipboard) ──
    const exportWorkflow = useCallback(() => {
        const json = JSON.stringify(serializeWorkflow(), null, 2);
        navigator.clipboard.writeText(json).then(() => {
            if (showMessage) showMessage('Workflow copié dans le presse-papier !', 2000);
        }).catch(() => {
            // console.log('Workflow JSON:', json);
            if (showMessage) showMessage('Workflow exporté (voir console)', 2000);
        });
    }, [serializeWorkflow, showMessage]);

    // ── 📥 Import file dialog ──
    const triggerImport = useCallback(() => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                try {
                    const wf = parseWorkflowPayload(ev?.target?.result);
                    loadWorkflowIntoCanvas(wf);
                    if (showMessage) showMessage('Workflow importé !', 2000);
                } catch (err) {
                    if (showMessage) showMessage('Erreur d\'import JSON', 2000);
                }
            };
            reader.readAsText(file);
        };
        input.click();
    }, [loadWorkflowIntoCanvas, parseWorkflowPayload, showMessage]);

    // ── 📦 Charger le catalogue n8n ──
    const fetchCatalog = useCallback(async () => {
        if (!api) return;
        setCatalogLoading(true);
        try {
            const result = await api.fetchN8nCatalog(1, 5000);
            if (result.success) {
                setCatalogItems(result.items || []);
            } else {
                if (showMessage) showMessage('Erreur catalogue n8n', 2000);
            }
        } catch (e) {
            if (showMessage) showMessage('Erreur réseau', 2000);
        }
        setCatalogLoading(false);
    }, [api, showMessage]);

    // ── Importer un workflow n8n depuis le catalogue ──
    const importN8nWorkflow = useCallback(async (item) => {
        if (!api) return;
        if (showMessage) showMessage(`Téléchargement de "${item.name}"...`, 1500);
        try {
            const result = await api.downloadN8nWorkflow(item.downloadUrl);
            if (result.success && result.data) {
                const n8nWf = result.data;
                // Adapter le format n8n → notre format
                const adapted = {
                    name: n8nWf.name || item.name,
                    nodes: (n8nWf.nodes || []).map((n, i) => ({
                        id: `node_${i + 1}`,
                        type: guessNodeType(n.type),
                        label: n.name || n.type,
                        icon: guessNodeIcon(n.type),
                        position: n.position ? { x: n.position[0] || 100, y: n.position[1] || 100 } : { x: 100 + i * 220, y: 150 },
                        config: {
                            command: n.parameters?.command,
                            prompt: n.parameters?.text || n.parameters?.prompt,
                            message: n.parameters?.message,
                        },
                    })),
                    edges: [],
                };
                // Reconstruire les edges à partir des connections n8n
                if (n8nWf.connections) {
                    Object.entries(n8nWf.connections).forEach(([sourceName, conns]) => {
                        const sourceNode = adapted.nodes.find(n => n.label === sourceName);
                        if (!sourceNode) return;
                        Object.values(conns).forEach(outputs => {
                            outputs.forEach(outputArr => {
                                outputArr.forEach(conn => {
                                    const targetNode = adapted.nodes.find(n => n.label === conn.node);
                                    if (targetNode) {
                                        adapted.edges.push({ source: sourceNode.id, target: targetNode.id });
                                    }
                                });
                            });
                        });
                    });
                }
                loadWorkflowIntoCanvas(adapted);
                setActivePanel(null);
                if (showMessage) showMessage(`Workflow n8n "${adapted.name}" importé !`, 2000);
            }
        } catch (e) {
            if (showMessage) showMessage('Erreur import n8n', 2000);
        }
    }, [api, loadWorkflowIntoCanvas, showMessage]);

    // ── Helpers pour adapter les types n8n ──
    const guessNodeType = (n8nType) => {
        if (!n8nType) return 'action';
        const t = n8nType.toLowerCase();
        if (t.includes('trigger') || t.includes('cron') || t.includes('schedule') || t.includes('webhook') || t.includes('manual')) return 'trigger';
        if (t.includes('openai') || t.includes('ai') || t.includes('gpt') || t.includes('llm')) return 'ai';
        if (t.includes('if') || t.includes('switch') || t.includes('merge') || t.includes('loop') || t.includes('wait')) return 'logic';
        if (t.includes('slack') || t.includes('email') || t.includes('telegram') || t.includes('discord') || t.includes('notification')) return 'output';
        return 'action';
    };

    const guessNodeIcon = (n8nType) => {
        if (!n8nType) return '⚡';
        const t = n8nType.toLowerCase();
        if (t.includes('trigger') || t.includes('manual')) return '▶️';
        if (t.includes('cron') || t.includes('schedule')) return '⏰';
        if (t.includes('webhook')) return '🌐';
        if (t.includes('openai') || t.includes('ai') || t.includes('gpt')) return '🤖';
        if (t.includes('http')) return '🔗';
        if (t.includes('git')) return '📦';
        if (t.includes('if') || t.includes('switch')) return '🔀';
        if (t.includes('loop') || t.includes('merge')) return '🔁';
        if (t.includes('wait')) return '⏳';
        if (t.includes('email') || t.includes('gmail')) return '📧';
        if (t.includes('slack')) return '💬';
        if (t.includes('telegram')) return '✈️';
        if (t.includes('file') || t.includes('read') || t.includes('write')) return '📄';
        if (t.includes('notification')) return '🔔';
        return '⚡';
    };

    // ── Grouper le catalogue par catégorie ──
    const catalogByCategory = useMemo(() => {
        const map = {};
        NODE_CATALOG.forEach((item) => {
            if (!map[item.category]) map[item.category] = [];
            map[item.category].push(item);
        });
        return map;
    }, []);

    // ── Filtrer le catalogue n8n ──
    const filteredCatalog = useMemo(() => {
        if (!catalogSearch) return catalogItems;
        const q = catalogSearch.toLowerCase();
        return catalogItems.filter(it => it.name.toLowerCase().includes(q));
    }, [catalogItems, catalogSearch]);

    // ── Toggle panel ──
    const togglePanel = useCallback((panel) => {
        setActivePanel(prev => prev === panel ? null : panel);
        if (panel === 'catalog' && catalogItems.length === 0) {
            fetchCatalog();
        }
    }, [catalogItems.length, fetchCatalog]);

    // ── 🤖 Génération IA de workflow ──
    const generateWithAI = useCallback(async () => {
        if (!aiPrompt.trim() || aiGenerating) return;
        if (!api) {
            if (showMessage) showMessage('API non disponible (mode navigateur)', 2000);
            return;
        }
        clearAiBuildTimers();
        setAiGenerating(true);
        setActivePanel(null);
        setAiBuildState({
            active: true,
            phaseIndex: 0,
            statusText: 'Analyse du prompt et preparation de la structure...',
            progress: 8,
            nodesAdded: 0,
            totalNodes: 0,
            edgesAdded: 0,
            totalEdges: 0
        });
        scheduleAiBuildTimer(() => {
            setAiBuildState((prev) => (
                prev.active && prev.phaseIndex < 1
                    ? { ...prev, phaseIndex: 1, statusText: 'Generation du JSON de workflow...', progress: 26 }
                    : prev
            ));
        }, 480);
        if (showMessage) showMessage('🤖 Génération du workflow...', 2000);

        const systemPrompt = `Tu es un générateur de workflows visuels. L'utilisateur décrit ce qu'il veut, et tu génères un JSON de workflow.

Règles STRICTES :
- Réponds UNIQUEMENT avec du JSON valide, sans texte autour, sans markdown.
- Format exact :
{
  "name": "Nom du workflow",
  "nodes": [
    {
      "id": "node_1",
      "type": "trigger|ai|action|logic|output",
      "label": "Nom du n\u0153ud",
      "icon": "\u25b6\ufe0f|\ud83e\udd16|\ud83d\udcbb|\ud83d\udd00|\ud83d\udd14",
      "position": { "x": 100, "y": 150 },
      "config": {
        "triggerType": "manual|cron|webhook",
        "model": "gemini|ollama",
        "prompt": "texte du prompt",
        "command": "commande shell",
        "condition": "expression JS",
        "message": "texte notification"
      }
    }
  ],
  "edges": [
    { "source": "node_1", "target": "node_2" }
  ]
}

Types de n\u0153uds disponibles :
- trigger (déclencheur) : icon \u25b6\ufe0f, config.triggerType
- ai (intelligence artificielle) : icon \ud83e\udd16, config.prompt, config.model
- action (commande terminal, fichier) : icon \ud83d\udcbb, config.command
- logic (condition, boucle) : icon \ud83d\udd00, config.condition
- output (notification) : icon \ud83d\udd14, config.message

Espace les n\u0153uds horizontalement (x += 250) et verticalement si branchés.
Utilise {{prev}} dans les champs pour référencer le résultat du n\u0153ud précédent.`;

        try {
            const history = [
                { role: 'user', content: systemPrompt + '\n\nG\u00e9n\u00e8re un workflow pour : ' + aiPrompt }
            ];
            const result = await api.getGeminiCompletion(history, '', [], {});
            const responseText = result?.response || result?.text || '';

            // Extraire le JSON de la réponse
            let jsonStr = responseText;
            const jsonMatch = responseText.match(/```(?:json)?\n?([\s\S]*?)```/);
            if (jsonMatch) jsonStr = jsonMatch[1];
            // Essayer de trouver le premier { ... } valide
            const firstBrace = jsonStr.indexOf('{');
            const lastBrace = jsonStr.lastIndexOf('}');
            if (firstBrace >= 0 && lastBrace > firstBrace) {
                jsonStr = jsonStr.substring(firstBrace, lastBrace + 1);
            }

            const wf = parseWorkflowPayload(jsonStr);
            setAiBuildState((prev) => ({
                ...prev,
                active: true,
                phaseIndex: 2,
                statusText: 'Workflow recu. Injection visuelle en cours...',
                progress: Math.max(prev.progress, 34)
            }));
            await animateWorkflowIntoCanvas(wf);
            setAiPrompt('');
            if (showMessage) showMessage(`Workflow "${wf.name}" g\u00e9n\u00e9r\u00e9 par IA !`, 2000);
        } catch (err) {
            console.error('AI workflow generation error:', err);
            setAiBuildState((prev) => ({
                ...prev,
                active: false,
                statusText: ''
            }));
            if (showMessage) showMessage('Erreur de g\u00e9n\u00e9ration IA: ' + err.message, 3000);
        }
        setAiGenerating(false);
    }, [aiPrompt, aiGenerating, animateWorkflowIntoCanvas, api, clearAiBuildTimers, parseWorkflowPayload, scheduleAiBuildTimer, showMessage]);

    return (
        <div className={`vw-editor${aiWritePulse ? ' vw-editor-ai-write' : ''}`}>
            {/* ── Toolbar ── */}
            <div className="vw-toolbar">
                <div className="vw-toolbar-left">
                    <span className="vw-toolbar-title">⚡ Flux Visuel</span>
                    <input
                        className="vw-workflow-name"
                        value={workflowName}
                        onChange={e => setWorkflowName(e.target.value)}
                        placeholder="Nom du workflow..."
                    />
                </div>
                <div className="vw-toolbar-right">
                    <button className="vw-btn vw-btn-primary" onClick={() => togglePanel('add')}>
                        + Nœud
                    </button>
                    {!isRunning ? (
                        <button
                            className="vw-btn vw-btn-run"
                            onClick={() => { setShowLog(true); runWorkflow(nodes, edges); }}
                            disabled={nodes.length === 0}
                        >
                            ▶️ Exécuter
                        </button>
                    ) : (
                        <button className="vw-btn vw-btn-danger" onClick={stopWorkflow}>
                            ⏹ Arrêter
                        </button>
                    )}
                    <button className="vw-btn vw-btn-success" onClick={saveWorkflow}>
                        💾 Sauver
                    </button>
                    <button className="vw-btn" onClick={() => togglePanel('saved')}>
                        📂 Ouvrir {savedWorkflows.length > 0 && <span className="vw-badge">{savedWorkflows.length}</span>}
                    </button>
                    <button className="vw-btn vw-btn-catalog" onClick={() => togglePanel('catalog')}>
                        📦 n8n
                    </button>
                    <button className={`vw-btn vw-btn-ai ${activePanel === 'ai' ? 'active' : ''}`} onClick={() => togglePanel('ai')}>
                        🤖 IA
                    </button>
                    <button className="vw-btn" onClick={deleteSelected}>🗑</button>
                    <button className="vw-btn" onClick={exportWorkflow}>📤</button>
                    <button className="vw-btn" onClick={triggerImport}>📥</button>
                    <button className="vw-btn vw-btn-danger" onClick={clearAll}>✖</button>
                </div>
            </div>

            {/* ── Canvas ── */}
            <div className="vw-canvas" ref={reactFlowWrapper}>
                {(aiGenerating || aiBuildState.active) && (
                    <div className="vw-ai-overlay">
                        <div className="vw-ai-overlay-badge">IA</div>
                        <div className="vw-ai-overlay-title">
                            {AI_WORKFLOW_PHASES[Math.min(aiBuildState.phaseIndex, AI_WORKFLOW_PHASES.length - 1)] || 'Generation'}
                        </div>
                        <div className="vw-ai-overlay-status">{aiBuildState.statusText || 'Generation du workflow...'}</div>
                        <div className="vw-ai-overlay-progress">
                            <span style={{ width: `${Math.max(4, Math.min(100, aiBuildState.progress || 0))}%` }} />
                        </div>
                        <div className="vw-ai-overlay-stats">
                            <span>Noeuds {aiBuildState.nodesAdded}/{aiBuildState.totalNodes}</span>
                            <span>Liens {aiBuildState.edgesAdded}/{aiBuildState.totalEdges}</span>
                        </div>
                    </div>
                )}
                {nodes.length === 0 && !activePanel ? (
                    <div className="vw-empty">
                        <div className="vw-empty-icon">⚡</div>
                        <div className="vw-empty-text">
                            Cliquez sur <strong>+ Nœud</strong> pour créer votre flux,
                            ou importez depuis le <strong>catalogue n8n 📦</strong>.
                        </div>
                        <div className="vw-empty-actions">
                            <button className="vw-btn vw-btn-primary" onClick={() => togglePanel('add')}>
                                + Commencer
                            </button>
                            <button className="vw-btn vw-btn-catalog" onClick={() => togglePanel('catalog')}>
                                📦 Explorer n8n
                            </button>
                            {savedWorkflows.length > 0 && (
                                <button className="vw-btn" onClick={() => togglePanel('saved')}>
                                    📂 Mes Workflows ({savedWorkflows.length})
                                </button>
                            )}
                        </div>
                    </div>
                ) : (
                    <ReactFlow
                        nodes={nodes}
                        edges={edges}
                        onNodesChange={onNodesChange}
                        onEdgesChange={onEdgesChange}
                        onConnect={onConnect}
                        onInit={setReactFlowInstance}
                        nodeTypes={nodeTypes}
                        fitView
                        deleteKeyCode="Delete"
                        snapToGrid
                        snapGrid={[15, 15]}
                    >
                        <Background color="rgba(255,255,255,0.04)" gap={20} size={1} />
                        <Controls />
                        <MiniMap
                            nodeColor={(node) => {
                                const t = node.data?.nodeType;
                                if (t === 'trigger') return '#ffd166';
                                if (t === 'ai') return '#a78bfa';
                                if (t === 'action') return '#00f5d4';
                                if (t === 'logic') return '#fb923c';
                                if (t === 'output') return '#4ade80';
                                return '#7f91aa';
                            }}
                            maskColor="rgba(4,7,10,0.7)"
                        />
                    </ReactFlow>
                )}

                {/* ── Add-Node Panel ── */}
                {activePanel === 'add' && (
                    <div className="vw-add-panel">
                        <div className="vw-add-header">
                            <span className="vw-add-title">Ajouter un nœud</span>
                            <button className="vw-add-close" onClick={() => setActivePanel(null)}>✕</button>
                        </div>
                        {Object.entries(catalogByCategory).map(([category, items]) => (
                            <div key={category}>
                                <div className="vw-add-category">{category}</div>
                                {items.map((item) => (
                                    <button
                                        key={`${category}-${item.type}-${item.label}`}
                                        className="vw-add-item"
                                        onClick={() => addNode(item)}
                                    >
                                        <span className="vw-add-item-icon">{item.icon}</span>
                                        <div className="vw-add-item-info">
                                            <span className="vw-add-item-name">{item.label}</span>
                                            <span className="vw-add-item-desc">{item.desc}</span>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        ))}
                    </div>
                )}

                {/* ── Saved Workflows Panel ── */}
                {activePanel === 'saved' && (
                    <div className="vw-add-panel">
                        <div className="vw-add-header">
                            <span className="vw-add-title">📂 Mes Workflows</span>
                            <button className="vw-add-close" onClick={() => setActivePanel(null)}>✕</button>
                        </div>
                        {savedWorkflows.length === 0 ? (
                            <div className="vw-catalog-empty">Aucun workflow sauvegardé.<br />Utilisez 💾 Sauver pour enregistrer.</div>
                        ) : (
                            savedWorkflows.map((wf, idx) => (
                                <div
                                    key={wf.filename || `${wf.name || 'workflow'}-${idx}`}
                                    className={`vw-saved-item${String(wf.filename || '').toLowerCase() === highlightedWorkflowFilename ? ' is-ai-updated' : ''}`}
                                >
                                    <button
                                        className="vw-add-item"
                                        onClick={() => loadSavedWorkflow(wf.filename)}
                                    >
                                        <span className="vw-add-item-icon">⚡</span>
                                        <div className="vw-add-item-info">
                                            <span className="vw-add-item-name">{wf.name}</span>
                                            <span className="vw-add-item-desc">
                                                {wf.nodeCount} nœuds · {wf.edgeCount} liens
                                                {wf.updatedAt && ` · ${new Date(wf.updatedAt).toLocaleDateString('fr-FR')}`}
                                            </span>
                                        </div>
                                    </button>
                                    <button
                                        className="vw-saved-delete"
                                        onClick={(e) => { e.stopPropagation(); deleteSavedWorkflow(wf.filename); }}
                                        title="Supprimer"
                                    >
                                        🗑
                                    </button>
                                </div>
                            ))
                        )}
                    </div>
                )}

                {/* ── n8n Catalog Panel ── */}
                {activePanel === 'catalog' && (
                    <div className="vw-add-panel vw-catalog-panel">
                        <div className="vw-add-header">
                            <span className="vw-add-title">📦 Catalogue n8n</span>
                            <button className="vw-add-close" onClick={() => setActivePanel(null)}>✕</button>
                        </div>
                        <div className="vw-catalog-search">
                            <input
                                className="vw-node-input"
                                placeholder="🔍 Rechercher un workflow n8n..."
                                value={catalogSearch}
                                onChange={e => setCatalogSearch(e.target.value)}
                            />
                        </div>
                        {catalogLoading ? (
                            <div className="vw-catalog-loading">Chargement du catalogue...</div>
                        ) : filteredCatalog.length === 0 ? (
                            <div className="vw-catalog-empty">Aucun workflow trouvé</div>
                        ) : (
                            <>
                                <div className="vw-catalog-count">{filteredCatalog.length} workflows</div>
                                {filteredCatalog.map((item, idx) => (
                                    <button
                                        key={item.downloadUrl || `${item.name || 'workflow'}-${idx}`}
                                        className="vw-add-item"
                                        onClick={() => importN8nWorkflow(item)}
                                    >
                                        <span className="vw-add-item-icon">📋</span>
                                        <div className="vw-add-item-info">
                                            <span className="vw-add-item-name">{item.name}</span>
                                            <span className="vw-add-item-desc">{(item.size / 1024).toFixed(1)} KB</span>
                                        </div>
                                    </button>
                                ))}
                            </>
                        )}
                    </div>
                )}

                {/* ── AI Generation Panel ── */}
                {activePanel === 'ai' && (
                    <div className="vw-add-panel vw-ai-panel">
                        <div className="vw-add-header">
                            <span className="vw-add-title">🤖 Générer par IA</span>
                            <button className="vw-add-close" onClick={() => setActivePanel(null)}>✕</button>
                        </div>
                        <div className="vw-ai-body">
                            <textarea
                                className="vw-ai-prompt"
                                placeholder="Décrivez votre workflow en langage naturel...&#10;&#10;Ex: Un workflow de déploiement qui fait un npm test, puis si c'est OK un npm build, et termine par une notification"
                                value={aiPrompt}
                                onChange={e => setAiPrompt(e.target.value)}
                                rows={5}
                                onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) generateWithAI(); }}
                            />
                            <button
                                className="vw-ai-generate-btn"
                                onClick={generateWithAI}
                                disabled={!aiPrompt.trim() || aiGenerating}
                            >
                                {aiGenerating ? '⏳ Génération...' : '🤖 Générer le workflow'}
                            </button>
                            <div className="vw-ai-hints">
                                <span className="vw-ai-hint-title">💡 Exemples :</span>
                                <button className="vw-ai-hint" onClick={() => setAiPrompt('Un workflow CI/CD: npm install, npm test, si OK npm build, puis notification de succès')}>CI/CD Pipeline</button>
                                <button className="vw-ai-hint" onClick={() => setAiPrompt('Analyser le code du projet avec l\'IA, générer un rapport, et l\'enregistrer dans un fichier')}>Analyse IA du code</button>
                                <button className="vw-ai-hint" onClick={() => setAiPrompt('Surveiller un dossier, quand un fichier arrive, le lire, le traiter avec l\'IA, et notifier')}>Traitement de fichiers</button>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* ── Execution Log Panel ── */}
            {showLog && executionLog.length > 0 && (
                <div className="vw-log-panel">
                    <div className="vw-log-header">
                        <span className="vw-log-title">
                            📋 Journal d&apos;exécution
                            {isRunning && <span className="vw-log-running"> ● En cours</span>}
                        </span>
                        <div className="vw-log-actions">
                            <button className="vw-add-close" onClick={clearLog}>🗑</button>
                            <button className="vw-add-close" onClick={() => setShowLog(false)}>✕</button>
                        </div>
                    </div>
                    <div className="vw-log-body">
                        {executionLog.map((entry, idx) => (
                            <div key={`${entry.timestamp || 't'}-${entry.type || 'info'}-${idx}`} className={`vw-log-entry vw-log-${entry.type}`}>
                                <span className="vw-log-time">{entry.timestamp}</span>
                                <span className="vw-log-msg">{entry.message}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default VisualWorkflowEditor;
