const VISUAL_WORKFLOW_SCHEMA_VERSION = 2;
const VISUAL_WORKFLOW_MAX_NODES = 250;
const VISUAL_WORKFLOW_MAX_EDGES = 800;
const VISUAL_WORKFLOW_ALLOWED_NODE_TYPES = new Set(['trigger', 'ai', 'action', 'logic', 'output']);

const toFiniteNumberOr = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const sanitizeVisualWorkflowPayload = (rawWorkflow, options = {}) => {
  const strict = options.strict !== false;
  if (!rawWorkflow || typeof rawWorkflow !== 'object' || Array.isArray(rawWorkflow)) {
    throw new Error('Workflow visuel invalide: objet attendu');
  }

  const sourceVersion = Number.parseInt(String(rawWorkflow.schemaVersion ?? ''), 10);
  const schemaVersion = Number.isFinite(sourceVersion) ? sourceVersion : 1;
  let migrated = schemaVersion !== VISUAL_WORKFLOW_SCHEMA_VERSION;

  const workflowName = String(rawWorkflow.name || '').trim();
  if (!workflowName) {
    throw new Error('Workflow visuel invalide: champ "name" requis');
  }

  const nodesInput = Array.isArray(rawWorkflow.nodes) ? rawWorkflow.nodes : [];
  const edgesInput = Array.isArray(rawWorkflow.edges) ? rawWorkflow.edges : [];

  if (nodesInput.length > VISUAL_WORKFLOW_MAX_NODES) {
    throw new Error(`Workflow trop volumineux: max ${VISUAL_WORKFLOW_MAX_NODES} noeuds`);
  }
  if (edgesInput.length > VISUAL_WORKFLOW_MAX_EDGES) {
    throw new Error(`Workflow trop volumineux: max ${VISUAL_WORKFLOW_MAX_EDGES} liens`);
  }

  const usedNodeIds = new Set();
  const nodes = [];
  nodesInput.forEach((node, index) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      if (strict) {
        throw new Error(`Noeud invalide a l'index ${index}`);
      }
      migrated = true;
      return;
    }

    let id = String(node.id ?? '').trim();
    if (!id) {
      id = `node_${index + 1}`;
      migrated = true;
    }
    if (usedNodeIds.has(id)) {
      throw new Error(`ID de noeud duplique: ${id}`);
    }
    usedNodeIds.add(id);

    const rawType = String(node.type || 'action').trim();
    const type = VISUAL_WORKFLOW_ALLOWED_NODE_TYPES.has(rawType) ? rawType : 'action';
    if (type !== rawType) migrated = true;

    const label = String(node.label || `Node ${index + 1}`).trim() || `Node ${index + 1}`;
    const icon = String(node.icon || '').trim() || '⚡';

    const rawPosition = node.position && typeof node.position === 'object' ? node.position : {};
    const position = {
      x: toFiniteNumberOr(rawPosition.x, 120 + (index % 4) * 240),
      y: toFiniteNumberOr(rawPosition.y, 120 + Math.floor(index / 4) * 170)
    };

    const config = node.config && typeof node.config === 'object' && !Array.isArray(node.config)
      ? node.config
      : {};
    if (config !== node.config) migrated = true;

    nodes.push({
      id,
      type,
      label,
      icon,
      position,
      config
    });
  });

  const edges = [];
  const edgePairs = new Set();
  edgesInput.forEach((edge, index) => {
    if (!edge || typeof edge !== 'object' || Array.isArray(edge)) {
      if (strict) {
        throw new Error(`Lien invalide a l'index ${index}`);
      }
      migrated = true;
      return;
    }

    const source = String(edge.source ?? '').trim();
    const target = String(edge.target ?? '').trim();
    if (!source || !target) {
      if (strict) {
        throw new Error(`Lien incomplet a l'index ${index}`);
      }
      migrated = true;
      return;
    }
    if (!usedNodeIds.has(source) || !usedNodeIds.has(target)) {
      if (strict) {
        throw new Error(`Lien invalide (${source} -> ${target})`);
      }
      migrated = true;
      return;
    }

    const pairKey = `${source}->${target}`;
    if (edgePairs.has(pairKey)) {
      migrated = true;
      return;
    }
    edgePairs.add(pairKey);
    edges.push({ source, target });
  });

  const normalized = {
    schemaVersion: VISUAL_WORKFLOW_SCHEMA_VERSION,
    name: workflowName,
    nodes,
    edges
  };

  if (typeof rawWorkflow.description === 'string' && rawWorkflow.description.trim()) {
    normalized.description = rawWorkflow.description.trim().slice(0, 300);
  }
  if (typeof rawWorkflow.updatedAt === 'string' && rawWorkflow.updatedAt.trim()) {
    normalized.updatedAt = rawWorkflow.updatedAt.trim();
  }

  return {
    workflow: normalized,
    migrated,
    sourceVersion: schemaVersion
  };
};

module.exports = {
  VISUAL_WORKFLOW_SCHEMA_VERSION,
  sanitizeVisualWorkflowPayload
};
