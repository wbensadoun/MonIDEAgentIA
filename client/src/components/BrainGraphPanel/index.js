import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ReactFlow, { Background, Controls, MiniMap } from 'reactflow';
import 'reactflow/dist/style.css';
import './BrainGraphPanel.css';

const KIND_COLUMNS = {
  manifest: 0,
  config: 0,
  workflow: 1,
  source: 2,
  utility: 2,
  hook: 3,
  component: 4,
  style: 5,
  test: 6,
  docs: 6
};

const KIND_LABELS = {
  manifest: 'Manifest',
  config: 'Config',
  workflow: 'Workflow',
  source: 'Source',
  utility: 'Utility',
  hook: 'Hook',
  component: 'Component',
  style: 'Style',
  test: 'Test',
  docs: 'Docs'
};

const BADGE_LABELS = {
  'core-file': 'Core',
  isolated: 'Isolated',
  'high-coupling': 'Coupled',
  'workflow-related': 'Workflow',
  config: 'Config',
  'test-missing': 'No test'
};

const shortPath = (filePath = '') => {
  const parts = String(filePath || '').split(/[\\/]/).filter(Boolean);
  if (parts.length <= 2) return String(filePath || '');
  return `${parts[0]}/.../${parts[parts.length - 1]}`;
};

const getNodeClass = (node, selectedIds, activeFile) => {
  const classes = ['brain-node'];
  if (selectedIds.has(node.id)) classes.push('is-selected');
  if (node.path === activeFile) classes.push('is-active-file');
  if ((node.badges || []).includes('core-file')) classes.push('is-core');
  if ((node.badges || []).includes('test-missing')) classes.push('is-risk');
  return classes.join(' ');
};

const buildFlowNodes = (graph, selectedIds, activeFile) => {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const sorted = nodes
    .slice()
    .sort((a, b) => (b.metrics?.centrality || 0) - (a.metrics?.centrality || 0) || a.path.localeCompare(b.path))
    .slice(0, 120);

  const columnCounts = {};
  return sorted.map((node) => {
    const column = KIND_COLUMNS[node.kind] ?? 2;
    const row = columnCounts[column] || 0;
    columnCounts[column] = row + 1;
    return {
      id: node.id,
      position: {
        x: 40 + column * 230,
        y: 40 + row * 92
      },
      data: {
        label: (
          <div className={getNodeClass(node, selectedIds, activeFile)}>
            <div className="brain-node-kind">{KIND_LABELS[node.kind] || node.kind}</div>
            <div className="brain-node-title">{node.label || node.path}</div>
            <div className="brain-node-path">{shortPath(node.path)}</div>
            <div className="brain-node-meta">
              <span>{node.metrics?.centrality || 0}</span>
              <span>{node.symbols?.length || 0} symbols</span>
            </div>
          </div>
        )
      },
      style: {
        width: 190,
        minHeight: 70,
        padding: 0,
        border: 'none',
        background: 'transparent'
      }
    };
  });
};

const buildFlowEdges = (graph, visibleNodeIds, selectedIds) => (
  (Array.isArray(graph?.edges) ? graph.edges : [])
    .filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target))
    .slice(0, 320)
    .map((edge, index) => ({
      id: `${edge.source}->${edge.target}:${edge.type}:${index}`,
      source: edge.source,
      target: edge.target,
      type: 'smoothstep',
      animated: selectedIds.has(edge.source) || selectedIds.has(edge.target),
      style: {
        stroke: edge.type === 'tests' ? '#22c55e' : edge.type === 'workflow' ? '#f59e0b' : '#38bdf8',
        strokeOpacity: selectedIds.size > 0 && !selectedIds.has(edge.source) && !selectedIds.has(edge.target) ? 0.18 : 0.55,
        strokeWidth: selectedIds.has(edge.source) || selectedIds.has(edge.target) ? 2 : 1
      }
    }))
);

const BrainGraphPanel = ({
  currentProjectPath,
  isElectronApiAvailable,
  showMessage,
  activeFile = '',
  onOpenFile
}) => {
  const [graph, setGraph] = useState(null);
  const [selection, setSelection] = useState(null);
  const [selectedNodeId, setSelectedNodeId] = useState('');
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [source, setSource] = useState('');

  const loadGraph = useCallback(async ({ force = false } = {}) => {
    if (!currentProjectPath || !isElectronApiAvailable || !window.electronAPI?.brainGraphGet) {
      setGraph(null);
      setSelection(null);
      return;
    }
    setIsLoading(true);
    try {
      const res = await window.electronAPI.brainGraphGet(currentProjectPath, { force, maxFiles: 8000 });
      if (!res?.success) {
        showMessage?.(`Brain Graph: ${res?.error || 'index indisponible'}`, 4500);
        return;
      }
      setGraph(res.graph || null);
      setSource(res.source || '');
      if (!selectedNodeId && res.graph?.hotspots?.[0]?.path) {
        setSelectedNodeId(res.graph.hotspots[0].path);
      }
      showMessage?.(force ? 'Brain Graph reconstruit.' : 'Brain Graph charge.', 2200);
    } catch (error) {
      showMessage?.(`Brain Graph: ${error.message}`, 5000);
    } finally {
      setIsLoading(false);
    }
  }, [currentProjectPath, isElectronApiAvailable, selectedNodeId, showMessage]);

  useEffect(() => {
    loadGraph({ force: false });
  }, [loadGraph]);

  const runSelection = useCallback(async (nextQuery = query) => {
    if (!currentProjectPath || !window.electronAPI?.brainGraphSelect) return;
    const text = String(nextQuery || activeFile || '').trim();
    if (!text) return;
    setIsLoading(true);
    try {
      const res = await window.electronAPI.brainGraphSelect(currentProjectPath, text, {
        activeFile,
        maxFiles: 12
      });
      if (!res?.success) {
        showMessage?.(`Impact map: ${res?.error || 'selection impossible'}`, 4500);
        return;
      }
      setSelection(res.selection || null);
      const first = res.selection?.selected?.[0]?.path;
      if (first) setSelectedNodeId(first);
      showMessage?.(`${res.selection?.selected?.length || 0} fichier(s) retenus par le Brain Graph.`, 2500);
    } catch (error) {
      showMessage?.(`Impact map: ${error.message}`, 5000);
    } finally {
      setIsLoading(false);
    }
  }, [activeFile, currentProjectPath, query, showMessage]);

  const nodesById = useMemo(() => {
    const map = new Map();
    (graph?.nodes || []).forEach((node) => map.set(node.id, node));
    return map;
  }, [graph?.nodes]);
  const selectedNode = selectedNodeId ? nodesById.get(selectedNodeId) : null;
  const selectedIds = useMemo(() => new Set((selection?.selected || []).map((node) => node.path)), [selection]);
  const flowNodes = useMemo(() => buildFlowNodes(graph, selectedIds, activeFile), [activeFile, graph, selectedIds]);
  const visibleNodeIds = useMemo(() => new Set(flowNodes.map((node) => node.id)), [flowNodes]);
  const flowEdges = useMemo(() => buildFlowEdges(graph, visibleNodeIds, selectedIds), [graph, selectedIds, visibleNodeIds]);

  const explainSelected = useMemo(() => {
    if (!selectedNode) return 'Selectionnez un fichier dans le graphe.';
    const lines = [];
    lines.push(`${selectedNode.path} est un noeud ${KIND_LABELS[selectedNode.kind] || selectedNode.kind}.`);
    lines.push(`Score impact: ${selectedNode.metrics?.centrality || 0}.`);
    if (selectedNode.importedBy?.length) lines.push(`Utilise par ${selectedNode.importedBy.length} fichier(s).`);
    if (selectedNode.resolvedImports?.length) lines.push(`Depend de ${selectedNode.resolvedImports.length} fichier(s).`);
    if (selectedNode.testedBy?.length) lines.push(`Couvert par ${selectedNode.testedBy.length} test(s).`);
    if ((selectedNode.badges || []).includes('test-missing')) lines.push('Risque: fichier central sans test detecte.');
    return lines.join(' ');
  }, [selectedNode]);

  if (!currentProjectPath) {
    return (
      <div className="brain-panel">
        <div className="brain-empty">Ouvrez un projet pour construire le Brain Graph.</div>
      </div>
    );
  }

  return (
    <div className="brain-panel">
      <aside className="brain-sidebar">
        <div className="brain-header">
          <div>
            <div className="brain-eyebrow">Brain Graph</div>
            <h2>Cerveau projet</h2>
          </div>
          <button type="button" className="brain-btn" onClick={() => loadGraph({ force: true })} disabled={isLoading}>
            Indexer
          </button>
        </div>

        <div className="brain-stats">
          <div><strong>{graph?.stats?.nodeCount || 0}</strong><span>fichiers</span></div>
          <div><strong>{graph?.stats?.edgeCount || 0}</strong><span>liens</span></div>
          <div><strong>{graph?.stats?.symbolCount || 0}</strong><span>symboles</span></div>
          <div><strong>{graph?.stats?.workflowCount || 0}</strong><span>flux</span></div>
        </div>

        <div className="brain-search">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') runSelection();
            }}
            placeholder="Impact map: auth, settings, App.js..."
          />
          <button type="button" className="brain-btn is-primary" onClick={() => runSelection()} disabled={isLoading}>
            Impact map
          </button>
        </div>

        <div className="brain-summary custom-scrollbar">
          <div className="brain-section-title">Architecture locale</div>
          <p>{graph?.summary || 'Index en attente.'}</p>
          <div className="brain-section-title">Hotspots</div>
          {(graph?.hotspots || []).slice(0, 10).map((hotspot) => (
            <button
              type="button"
              key={hotspot.path}
              className={`brain-hotspot ${selectedNodeId === hotspot.path ? 'is-active' : ''}`}
              onClick={() => setSelectedNodeId(hotspot.path)}
            >
              <span>{shortPath(hotspot.path)}</span>
              <small>{hotspot.score}</small>
            </button>
          ))}
        </div>
      </aside>

      <section className="brain-main">
        <div className="brain-toolbar">
          <div>
            <div className="brain-eyebrow">{source === 'scan' ? 'Scan frais' : 'Cache local'}</div>
            <h3>{graph?.projectName || 'Projet'}</h3>
          </div>
          <div className="brain-toolbar-actions">
            <button type="button" className="brain-btn" onClick={() => runSelection(activeFile)} disabled={!activeFile || isLoading}>
              Impact fichier actif
            </button>
            <button type="button" className="brain-btn" onClick={() => selectedNode?.path && onOpenFile?.(selectedNode.path)} disabled={!selectedNode}>
              Ouvrir
            </button>
          </div>
        </div>

        <div className="brain-body">
          <div className="brain-flow">
            <ReactFlow
              nodes={flowNodes}
              edges={flowEdges}
              fitView
              minZoom={0.2}
              maxZoom={1.6}
              nodesDraggable={false}
              nodesConnectable={false}
              onNodeClick={(_, node) => setSelectedNodeId(node.id)}
            >
              <Background color="var(--border)" gap={18} />
              <Controls />
              <MiniMap nodeStrokeWidth={2} pannable zoomable />
            </ReactFlow>
          </div>

          <aside className="brain-details custom-scrollbar">
            <div className="brain-section-title">Pourquoi ce fichier compte ?</div>
            <p>{explainSelected}</p>

            {selectedNode && (
              <>
                <div className="brain-file-title">{selectedNode.path}</div>
                <div className="brain-badges">
                  {(selectedNode.badges || []).map((badge) => (
                    <span key={badge} className={`brain-badge is-${badge}`}>{BADGE_LABELS[badge] || badge}</span>
                  ))}
                  {(selectedNode.badges || []).length === 0 && <span className="brain-badge">Normal</span>}
                </div>

                <div className="brain-section-title">Symboles</div>
                {(selectedNode.symbols || []).slice(0, 16).map((symbol) => (
                  <div key={`${symbol.kind}-${symbol.name}-${symbol.line}`} className="brain-list-row">
                    <span>{symbol.kind}</span>
                    <strong>{symbol.name}</strong>
                    <small>L{symbol.line}</small>
                  </div>
                ))}

                <div className="brain-section-title">Relations</div>
                {[
                  ['Imports', selectedNode.resolvedImports],
                  ['Utilise par', selectedNode.importedBy],
                  ['Tests', [...(selectedNode.tests || []), ...(selectedNode.testedBy || [])]]
                ].map(([label, values]) => (
                  <div key={label} className="brain-rel-block">
                    <strong>{label}</strong>
                    {(values || []).slice(0, 10).map((value) => (
                      <button type="button" key={value} onClick={() => setSelectedNodeId(value)}>{shortPath(value)}</button>
                    ))}
                    {(!values || values.length === 0) && <span>Aucun lien</span>}
                  </div>
                ))}
              </>
            )}

            {selection?.selected?.length > 0 && (
              <>
                <div className="brain-section-title">Contexte IA retenu</div>
                {selection.selected.map((item) => (
                  <button type="button" key={item.path} className="brain-selected-row" onClick={() => setSelectedNodeId(item.path)}>
                    <span>{shortPath(item.path)}</span>
                    <small>{item.score}</small>
                  </button>
                ))}
              </>
            )}
          </aside>
        </div>
      </section>
    </div>
  );
};

export default BrainGraphPanel;
