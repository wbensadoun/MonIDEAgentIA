import React, { useMemo, useState } from 'react';
import './WorkflowManager.css';

const WorkflowManager = ({
  workflows,
  isLoading,
  onSave,
  onDelete,
  onTrigger,
  onClose,
  currentProjectPath,
  showMessage,
  isElectronApiAvailable,
  onLibraryUpdated
}) => {
  const [activeTab, setActiveTab] = useState('global');
  const [isEditing, setIsEditing] = useState(false);
  const [editingWorkflow, setEditingWorkflow] = useState(null);
  const [formData, setFormData] = useState({ name: '', description: '', body: '' });

  const [packsStatus, setPacksStatus] = useState('');
  const [agentSkills, setAgentSkills] = useState([]);
  const [openclawSkills, setOpenclawSkills] = useState([]);
  const [agentSkillsQuery, setAgentSkillsQuery] = useState('');
  const [openclawQuery, setOpenclawQuery] = useState('');
  const [isAgentSkillsLoading, setIsAgentSkillsLoading] = useState(false);
  const [isOpenclawLoading, setIsOpenclawLoading] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);

  const filteredWorkflows = workflows.filter(w => w.scope === activeTab);

  const filteredAgentSkills = useMemo(() => {
    const q = agentSkillsQuery.trim().toLowerCase();
    const base = Array.isArray(agentSkills) ? agentSkills : [];
    const list = q ? base.filter(s => String(s.label || '').toLowerCase().includes(q)) : base;
    return list.slice(0, 60);
  }, [agentSkills, agentSkillsQuery]);

  const filteredOpenclawSkills = useMemo(() => {
    const q = openclawQuery.trim().toLowerCase();
    const base = Array.isArray(openclawSkills) ? openclawSkills : [];
    if (!q) return [];
    const list = base.filter(s => {
      const label = String(s.label || '').toLowerCase();
      const desc = String(s.description || '').toLowerCase();
      return label.includes(q) || desc.includes(q);
    });
    return list.slice(0, 60);
  }, [openclawSkills, openclawQuery]);

  const syncSubagents = async () => {
    if (!isElectronApiAvailable || !window.electronAPI?.syncVoltAgentSubagents) {
      showMessage && showMessage('Erreur: API Electron indisponible', 3000);
      return;
    }

    setPacksStatus('Import des subagents en cours...');
    try {
      const res = await window.electronAPI.syncVoltAgentSubagents({ overwrite: false });
      if (res?.success) {
        const msg = `Subagents importes: ${res.imported} (skips: ${res.skipped}, erreurs: ${res.errors})`;
        setPacksStatus(msg);
        showMessage && showMessage(msg, 3500);
        onLibraryUpdated && onLibraryUpdated();
      } else {
        const msg = res?.error ? String(res.error) : 'Import subagents: erreur';
        setPacksStatus(msg);
        showMessage && showMessage(msg, 4000);
      }
    } catch (e) {
      const msg = `Import subagents: ${e.message}`;
      setPacksStatus(msg);
      showMessage && showMessage(msg, 4000);
    }
  };

  const loadCatalog = async (catalogId) => {
    if (!isElectronApiAvailable || !window.electronAPI?.getVoltAgentCatalog) {
      showMessage && showMessage('Erreur: API Electron indisponible', 3000);
      return;
    }

    if (catalogId === 'agent-skills') {
      setIsAgentSkillsLoading(true);
    } else {
      setIsOpenclawLoading(true);
    }

    try {
      const res = await window.electronAPI.getVoltAgentCatalog(catalogId);
      if (res?.success && Array.isArray(res.entries)) {
        if (catalogId === 'agent-skills') {
          setAgentSkills(res.entries);
        } else {
          setOpenclawSkills(res.entries);
        }
        const msg = `Catalogue "${catalogId}" charge: ${res.entries.length} items`;
        setPacksStatus(msg);
        showMessage && showMessage(msg, 2500);
      } else {
        const msg = res?.error ? String(res.error) : `Catalogue "${catalogId}": erreur`;
        setPacksStatus(msg);
        showMessage && showMessage(msg, 4000);
      }
    } catch (e) {
      const msg = `Catalogue "${catalogId}": ${e.message}`;
      setPacksStatus(msg);
      showMessage && showMessage(msg, 4000);
    } finally {
      if (catalogId === 'agent-skills') {
        setIsAgentSkillsLoading(false);
      } else {
        setIsOpenclawLoading(false);
      }
    }
  };

  const installSkill = async (entry, scope) => {
    if (!entry || !entry.url) return;
    if (!isElectronApiAvailable || !window.electronAPI?.installSkillFromUrl) {
      showMessage && showMessage('Erreur: API Electron indisponible', 3000);
      return;
    }

    if (scope === 'workspace' && !currentProjectPath) {
      showMessage && showMessage("Ouvrez d'abord un projet pour installer en workspace.", 4000);
      return;
    }

    setIsInstalling(true);
    try {
      const res = await window.electronAPI.installSkillFromUrl(entry.url, scope, currentProjectPath, { overwrite: false });
      if (res?.success) {
        const msg = `Skill installe: ${res.name} (${scope})`;
        setPacksStatus(msg);
        showMessage && showMessage(msg, 3000);
        onLibraryUpdated && onLibraryUpdated();
      } else {
        const msg = res?.error ? String(res.error) : 'Installation: erreur';
        setPacksStatus(msg);
        showMessage && showMessage(msg, 4500);
      }
    } catch (e) {
      const msg = `Installation: ${e.message}`;
      setPacksStatus(msg);
      showMessage && showMessage(msg, 4500);
    } finally {
      setIsInstalling(false);
    }
  };

  const handleCreate = (scope) => {
    setFormData({ name: '', description: '', body: '' });
    setEditingWorkflow({ scope, isNew: true });
    setIsEditing(true);
  };

  const handleEdit = (workflow) => {
    setFormData({
      name: workflow.name,
      description: workflow.description || '',
      body: workflow.body || ''
    });
    setEditingWorkflow({ ...workflow, isNew: false });
    setIsEditing(true);
  };

  const handleSave = async () => {
    if (!formData.name.trim()) return;

    const content = `---
description: ${formData.description}
---

${formData.body}`;

    const result = await onSave(formData.name, content, editingWorkflow.scope);
    if (result.success) {
      setIsEditing(false);
      setEditingWorkflow(null);
    }
  };

  const handleDelete = async (workflow) => {
    if (window.confirm(`Supprimer le workflow "${workflow.name}" ?`)) {
      await onDelete(workflow.name, workflow.scope);
    }
  };

  if (isEditing) {
    return (
      <div className="workflow-overlay">
        <div className="workflow-modal workflow-editor">
          <div className="workflow-header">
            <div>
              <div className="workflow-title">
                {editingWorkflow?.isNew ? 'Nouveau Workflow' : 'Modifier Workflow'}
              </div>
              <div className="workflow-scope-chip">
                {editingWorkflow?.scope === 'global' ? 'Global' : 'Workspace'}
              </div>
            </div>
            <button onClick={() => setIsEditing(false)} className="workflow-close">X</button>
          </div>

          <div className="workflow-body custom-scrollbar">
            <div className="workflow-field">
              <label>Nom (utilise pour /nom)</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                placeholder="deploy, test, etc."
                disabled={!editingWorkflow?.isNew}
              />
            </div>

            <div className="workflow-field">
              <label>Description</label>
              <input
                type="text"
                value={formData.description}
                onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Courte description du workflow"
              />
            </div>

            <div className="workflow-field">
              <label>Instructions (Markdown)</label>
              <textarea
                value={formData.body}
                onChange={(e) => setFormData(prev => ({ ...prev, body: e.target.value }))}
                placeholder="Etapes detaillees que l'IA doit suivre..."
                rows={12}
              />
            </div>
          </div>

          <div className="workflow-footer">
            <button onClick={() => setIsEditing(false)} className="btn btn-ghost">
              Annuler
            </button>
            <button
              onClick={handleSave}
              disabled={!formData.name.trim()}
              className="btn btn-primary"
            >
              Sauvegarder
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="workflow-overlay">
      <div className="workflow-modal">
        <div className="workflow-header">
          <div className="workflow-title">Workflows</div>
          <button onClick={onClose} className="workflow-close">X</button>
        </div>

        <div className="workflow-tabs">
          <button
            onClick={() => setActiveTab('global')}
            className={`workflow-tab ${activeTab === 'global' ? 'is-active' : ''}`}
          >
            Global
          </button>
          <button
            onClick={() => setActiveTab('workspace')}
            className={`workflow-tab ${activeTab === 'workspace' ? 'is-active' : ''}`}
          >
            Workspace
          </button>
          <button
            onClick={() => setActiveTab('packs')}
            className={`workflow-tab ${activeTab === 'packs' ? 'is-active' : ''}`}
          >
            Packs
          </button>
        </div>

        <div className="workflow-body custom-scrollbar">
          {activeTab === 'packs' && (
            <div className="packs-root">
              <div className="packs-intro">
                <div className="packs-title">VoltAgent Packs</div>
                <div className="packs-subtitle">
                  Importer des subagents et installer des skills depuis des catalogues open-source.
                </div>
                {packsStatus && <div className="packs-status">{packsStatus}</div>}
              </div>

              <div className="pack-card">
                <div className="pack-card-head">
                  <div>
                    <div className="pack-card-title">Subagents (awesome-claude-code-subagents)</div>
                    <div className="pack-card-desc">Installe ~129 personas specialistes (ex: electron-pro, frontend-dev...).</div>
                  </div>
                  <button
                    className="btn btn-primary"
                    onClick={syncSubagents}
                    disabled={!isElectronApiAvailable || isInstalling}
                  >
                    Importer
                  </button>
                </div>
              </div>

              <div className="pack-card">
                <div className="pack-card-head">
                  <div>
                    <div className="pack-card-title">Agent Skills (awesome-agent-skills)</div>
                    <div className="pack-card-desc">Catalogue (200+). Installe une skill en 1 clic.</div>
                  </div>
                  <button
                    className="btn btn-ghost"
                    onClick={() => loadCatalog('agent-skills')}
                    disabled={!isElectronApiAvailable || isAgentSkillsLoading}
                  >
                    {isAgentSkillsLoading ? 'Chargement...' : 'Charger'}
                  </button>
                </div>

                <div className="packs-controls">
                  <input
                    className="packs-input"
                    value={agentSkillsQuery}
                    onChange={(e) => setAgentSkillsQuery(e.target.value)}
                    placeholder="Rechercher (ex: react, mcp, pdf...)"
                  />
                </div>

                {Array.isArray(agentSkills) && agentSkills.length > 0 && (
                  <div className="packs-list">
                    {filteredAgentSkills.map((entry) => (
                      <div key={entry.url} className="packs-item">
                        <div className="packs-item-info">
                          <div className="packs-item-title">{entry.label}</div>
                          <div className="packs-item-desc">{entry.description}</div>
                        </div>
                        <div className="packs-item-actions">
                          <button
                            className="workflow-action run"
                            onClick={() => installSkill(entry, 'workspace')}
                            disabled={!currentProjectPath || isInstalling}
                            title={currentProjectPath ? 'Installer dans le projet' : 'Ouvrez un projet'}
                          >
                            Install (WS)
                          </button>
                          <button
                            className="workflow-action edit"
                            onClick={() => installSkill(entry, 'global')}
                            disabled={isInstalling}
                            title="Installer global"
                          >
                            Install (G)
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="pack-card">
                <div className="pack-card-head">
                  <div>
                    <div className="pack-card-title">OpenClaw Skills (awesome-openclaw-skills)</div>
                    <div className="pack-card-desc">Catalogue (3000+). Tape un terme pour filtrer avant d&apos;installer.</div>
                  </div>
                  <button
                    className="btn btn-ghost"
                    onClick={() => loadCatalog('openclaw-skills')}
                    disabled={!isElectronApiAvailable || isOpenclawLoading}
                  >
                    {isOpenclawLoading ? 'Chargement...' : 'Charger'}
                  </button>
                </div>

                <div className="packs-controls">
                  <input
                    className="packs-input"
                    value={openclawQuery}
                    onChange={(e) => setOpenclawQuery(e.target.value)}
                    placeholder="Rechercher (ex: slack, notion, email...)"
                  />
                </div>

                {Array.isArray(openclawSkills) && openclawSkills.length > 0 && !openclawQuery.trim() && (
                  <div className="workflow-empty">Entrez une recherche pour afficher des resultats.</div>
                )}

                {Array.isArray(openclawSkills) && openclawSkills.length > 0 && openclawQuery.trim() && (
                  <div className="packs-list">
                    {filteredOpenclawSkills.map((entry) => (
                      <div key={entry.url} className="packs-item">
                        <div className="packs-item-info">
                          <div className="packs-item-title">{entry.label}</div>
                          <div className="packs-item-desc">{entry.description}</div>
                        </div>
                        <div className="packs-item-actions">
                          <button
                            className="workflow-action run"
                            onClick={() => installSkill(entry, 'workspace')}
                            disabled={!currentProjectPath || isInstalling}
                            title={currentProjectPath ? 'Installer dans le projet' : 'Ouvrez un projet'}
                          >
                            Install (WS)
                          </button>
                          <button
                            className="workflow-action edit"
                            onClick={() => installSkill(entry, 'global')}
                            disabled={isInstalling}
                            title="Installer global"
                          >
                            Install (G)
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab !== 'packs' && (
            isLoading ? (
              <div className="workflow-empty">Chargement...</div>
            ) : filteredWorkflows.length === 0 ? (
              <div className="workflow-empty">
                Aucun workflow {activeTab === 'global' ? 'global' : 'dans ce projet'}
              </div>
            ) : (
              <div className="workflow-list">
                {filteredWorkflows.map((workflow) => (
                  <div
                    key={`${workflow.scope}-${workflow.name}`}
                    className="workflow-card"
                  >
                    <div className="workflow-card-info">
                      <div className="workflow-name">/{workflow.name}</div>
                      {workflow.description && (
                        <div className="workflow-desc">{workflow.description}</div>
                      )}
                    </div>
                    <div className="workflow-actions">
                      <button
                        onClick={() => onTrigger(workflow)}
                        className="workflow-action run"
                        title="Executer"
                      >
                        Run
                      </button>
                      <button
                        onClick={() => handleEdit(workflow)}
                        className="workflow-action edit"
                        title="Modifier"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(workflow)}
                        className="workflow-action delete"
                        title="Supprimer"
                      >
                        Del
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )
          )}
        </div>

        <div className="workflow-footer">
          <button
            onClick={() => handleCreate(activeTab)}
            disabled={activeTab === 'packs' || (activeTab === 'workspace' && !currentProjectPath)}
            className="btn btn-primary workflow-create"
          >
            Nouveau Workflow {activeTab === 'global' ? 'Global' : 'Workspace'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default WorkflowManager;
