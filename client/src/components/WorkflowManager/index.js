import React, { useMemo, useState, useCallback } from 'react';
import './WorkflowManager.css';
import Dialog from '../ComponentLibrary/Dialog';

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
  const [packScope, setPackScope] = useState('workspace');
  const [packImportOverwrite, setPackImportOverwrite] = useState(false);
  const [isPackTransferRunning, setIsPackTransferRunning] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [isConfirming, setIsConfirming] = useState(false);

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

  const exportPack = async () => {
    if (!isElectronApiAvailable || !window.electronAPI?.exportLibraryPack) {
      showMessage && showMessage('Erreur: API Electron indisponible', 3000);
      return;
    }

    if (packScope === 'workspace' && !currentProjectPath) {
      showMessage && showMessage("Ouvrez d'abord un projet pour exporter le scope workspace.", 3500);
      return;
    }

    setIsPackTransferRunning(true);
    try {
      const res = await window.electronAPI.exportLibraryPack(currentProjectPath, { scope: packScope });
      if (res?.success) {
        const msg = `Pack exporte: ${res.entries} fichier(s)`;
        setPacksStatus(msg);
        showMessage && showMessage(msg, 3500);
      } else if (!res?.canceled) {
        const msg = res?.error ? String(res.error) : 'Export pack: erreur';
        setPacksStatus(msg);
        showMessage && showMessage(msg, 4000);
      }
    } catch (e) {
      const msg = `Export pack: ${e.message}`;
      setPacksStatus(msg);
      showMessage && showMessage(msg, 4000);
    } finally {
      setIsPackTransferRunning(false);
    }
  };

  const importPack = async () => {
    if (!isElectronApiAvailable || !window.electronAPI?.importLibraryPack) {
      showMessage && showMessage('Erreur: API Electron indisponible', 3000);
      return;
    }

    setIsPackTransferRunning(true);
    try {
      if (!currentProjectPath) {
        showMessage && showMessage('Aucun projet ouvert: seules les sections globales seront importees.', 3500);
      }

      const res = await window.electronAPI.importLibraryPack(currentProjectPath || '', {
        overwrite: !!packImportOverwrite
      });
      if (res?.success) {
        const msg = `Pack importe: ${res.imported} fichier(s), ${res.skipped} ignore(s)`;
        setPacksStatus(msg);
        showMessage && showMessage(msg, 4000);
        onLibraryUpdated && onLibraryUpdated();
        loadInstalledSkills();
      } else if (!res?.canceled) {
        const msg = res?.error ? String(res.error) : 'Import pack: erreur';
        setPacksStatus(msg);
        showMessage && showMessage(msg, 4500);
      }
    } catch (e) {
      const msg = `Import pack: ${e.message}`;
      setPacksStatus(msg);
      showMessage && showMessage(msg, 4500);
    } finally {
      setIsPackTransferRunning(false);
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

  const [installedSkills, setInstalledSkills] = useState({ global: [], workspace: [] });
  const [isInstalledSkillsLoading, setIsInstalledSkillsLoading] = useState(false);

  const loadInstalledSkills = useCallback(async () => {
    if (!isElectronApiAvailable || !window.electronAPI?.listSkills) return;
    setIsInstalledSkillsLoading(true);
    try {
      const res = await window.electronAPI.listSkills(currentProjectPath);
      if (res?.success && Array.isArray(res.skills)) {
        const global = res.skills.filter(s => s.scope === 'global');
        const workspace = res.skills.filter(s => s.scope === 'workspace');
        setInstalledSkills({ global, workspace });
      }
    } catch (e) {
      console.error('Erreur chargement skills installes:', e);
    } finally {
      setIsInstalledSkillsLoading(false);
    }
  }, [currentProjectPath, isElectronApiAvailable]);

  React.useEffect(() => {
    loadInstalledSkills();
  }, [loadInstalledSkills]);

  const getDerivedSkillName = (entry) => {
    let nameBase = entry.label || entry.url || '';
    if (!entry.label && entry.url) {
      const match = entry.url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)/i);
      if (match) {
        let repo = match[2].replace(/\.git$/i, '');
        nameBase = `${match[1]}-${repo}`;
      }
    }
    return String(nameBase).replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '-').trim();
  };

  const checkIsSkillInstalled = (entry, scope) => {
    const safeName = getDerivedSkillName(entry);
    if (scope === 'global') {
      return installedSkills.global.some(s => s.name === safeName);
    }
    return installedSkills.workspace.some(s => s.name === safeName);
  };

  const runInstallAllAgentSkills = async () => {
    setIsInstalling(true);
    setPacksStatus(`Installation de ${agentSkills.length} skills en cours... (Ne fermez pas cette fenetre)`);

    try {
      const res = await window.electronAPI.installAllSkills(agentSkills);
      if (res?.success) {
        const msg = `Installation terminee. Succes: ${res.results?.successful?.length || 0}, Echecs: ${res.results?.failed?.length || 0}`;
        setPacksStatus(msg);
        showMessage && showMessage(msg, 5000);
        onLibraryUpdated && onLibraryUpdated();
        if (activeTab === 'installed_skills') loadInstalledSkills();
      } else {
        const msg = res?.error ? String(res.error) : 'Erreur lors de l\'installation massive';
        setPacksStatus(msg);
        showMessage && showMessage(msg, 4500);
      }
    } catch (e) {
      const msg = `Erreur critique installation: ${e.message}`;
      setPacksStatus(msg);
      showMessage && showMessage(msg, 4500);
    } finally {
      setIsInstalling(false);
    }
  };

  const installAllAgentSkills = async () => {
    if (!isElectronApiAvailable || !window.electronAPI?.installAllSkills) return;
    if (!Array.isArray(agentSkills) || agentSkills.length === 0) {
      showMessage && showMessage("Veuillez d'abord charger le catalogue Agent Skills", 3000);
      return;
    }

    setConfirmDialog({
      title: 'Installer tous les skills',
      message: `Voulez-vous vraiment installer les ${agentSkills.length} skills du catalogue globalement ? Cela peut prendre plusieurs minutes.`,
      confirmLabel: 'Tout installer',
      onConfirm: runInstallAllAgentSkills,
    });
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
    setConfirmDialog({
      title: 'Supprimer le workflow',
      message: `Supprimer le workflow "${workflow.name}" ?`,
      confirmLabel: 'Supprimer',
      onConfirm: () => onDelete(workflow.name, workflow.scope),
    });
  };

  const confirmPendingAction = async () => {
    if (!confirmDialog || isConfirming) return;
    setIsConfirming(true);
    try {
      await confirmDialog.onConfirm();
      setConfirmDialog(null);
    } finally {
      setIsConfirming(false);
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
            <button type="button" onClick={() => setIsEditing(false)} className="workflow-close">X</button>
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
            <button type="button" onClick={() => setIsEditing(false)} className="btn btn-ghost">
              Annuler
            </button>
            <button
              type="button"
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
      {confirmDialog && (
        <Dialog
          ariaLabel={confirmDialog.title}
          onClose={() => !isConfirming && setConfirmDialog(null)}
          overlayClassName="workflow-confirm-overlay"
          className="workflow-confirm-dialog"
        >
          <h2 className="workflow-confirm-title">{confirmDialog.title}</h2>
          <p className="workflow-confirm-message">{confirmDialog.message}</p>
          <div className="workflow-confirm-actions">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setConfirmDialog(null)}
              disabled={isConfirming}
            >
              Annuler
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={confirmPendingAction}
              disabled={isConfirming}
            >
              {isConfirming ? 'En cours…' : confirmDialog.confirmLabel}
            </button>
          </div>
        </Dialog>
      )}
      <div className="workflow-modal">
        <div className="workflow-header">
          <div className="workflow-title">Workflows</div>
          <button type="button" onClick={onClose} className="workflow-close">X</button>
        </div>

        <div className="workflow-tabs">
          <button
            type="button"
            onClick={() => setActiveTab('global')}
            className={`workflow-tab ${activeTab === 'global' ? 'is-active' : ''}`}
          >
            Global
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('workspace')}
            className={`workflow-tab ${activeTab === 'workspace' ? 'is-active' : ''}`}
          >
            Workspace
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('installed_skills');
              loadInstalledSkills();
            }}
            className={`workflow-tab ${activeTab === 'installed_skills' ? 'is-active' : ''}`}
          >
            Installed Skills
          </button>
          <button
            type="button"
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
                    <div className="pack-card-title">Pack local (export/import)</div>
                    <div className="pack-card-desc">Sauvegarde ou restaure workflows, agents et skills sous forme d&apos;un fichier JSON.</div>
                  </div>
                  <div className="pack-transfer-actions">
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={exportPack}
                      disabled={!isElectronApiAvailable || isPackTransferRunning}
                    >
                      {isPackTransferRunning ? '...' : 'Exporter'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={importPack}
                      disabled={!isElectronApiAvailable || isPackTransferRunning}
                    >
                      {isPackTransferRunning ? '...' : 'Importer'}
                    </button>
                  </div>
                </div>
                <div className="packs-controls pack-transfer-controls">
                  <label className="pack-inline-label">
                    Scope export
                    <select
                      className="packs-input pack-select"
                      value={packScope}
                      onChange={(e) => setPackScope(e.target.value)}
                    >
                      <option value="workspace">workspace</option>
                      <option value="global">global</option>
                      <option value="both">both</option>
                    </select>
                  </label>
                  <label className="pack-inline-check" style={{ marginLeft: '10px' }}>
                    <input
                      type="checkbox"
                      checked={!!packImportOverwrite}
                      onChange={(e) => setPackImportOverwrite(e.target.checked)}
                    />
                    <span>Import: ecraser les fichiers existants</span>
                  </label>
                </div>
              </div>

              <div className="pack-card">
                <div className="pack-card-head">
                  <div>
                    <div className="pack-card-title">Subagents (awesome-claude-code-subagents)</div>
                    <div className="pack-card-desc">Installe ~129 personas specialistes (ex: electron-pro, frontend-dev...).</div>
                  </div>
                  <button
                    type="button"
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
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => loadCatalog('agent-skills')}
                      disabled={!isElectronApiAvailable || isAgentSkillsLoading}
                    >
                      {isAgentSkillsLoading ? 'Chargement...' : 'Charger'}
                    </button>
                    {Array.isArray(agentSkills) && agentSkills.length > 0 && (
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={installAllAgentSkills}
                        disabled={isInstalling || !isElectronApiAvailable}
                        title="Installer TOUS les skills globalement"
                      >
                        {isInstalling ? 'Installation...' : 'Tout installer'}
                      </button>
                    )}
                  </div>
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
                            type="button"
                            className="workflow-action run"
                            onClick={() => installSkill(entry, 'workspace')}
                            disabled={!currentProjectPath || isInstalling || checkIsSkillInstalled(entry, 'workspace')}
                            title={currentProjectPath ? 'Installer dans le projet' : 'Ouvrez un projet'}
                          >
                            {checkIsSkillInstalled(entry, 'workspace') ? 'Installé (WS)' : 'Install (WS)'}
                          </button>
                          <button
                            type="button"
                            className="workflow-action edit"
                            onClick={() => installSkill(entry, 'global')}
                            disabled={isInstalling || checkIsSkillInstalled(entry, 'global')}
                            title="Installer global"
                          >
                            {checkIsSkillInstalled(entry, 'global') ? 'Installé (G)' : 'Install (G)'}
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
                    type="button"
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
                            type="button"
                            className="workflow-action run"
                            onClick={() => installSkill(entry, 'workspace')}
                            disabled={!currentProjectPath || isInstalling || checkIsSkillInstalled(entry, 'workspace')}
                            title={currentProjectPath ? 'Installer dans le projet' : 'Ouvrez un projet'}
                          >
                            {checkIsSkillInstalled(entry, 'workspace') ? 'Installé (WS)' : 'Install (WS)'}
                          </button>
                          <button
                            type="button"
                            className="workflow-action edit"
                            onClick={() => installSkill(entry, 'global')}
                            disabled={isInstalling || checkIsSkillInstalled(entry, 'global')}
                            title="Installer global"
                          >
                            {checkIsSkillInstalled(entry, 'global') ? 'Installé (G)' : 'Install (G)'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'installed_skills' && (
            <div className="packs-root">
              <div className="packs-intro">
                <div className="packs-title">Skills Installés</div>
                <div className="packs-subtitle">
                  Gérez vos skills ici. Les skills globaux sont <strong>toujours actifs</strong> automatiquement.
                </div>
              </div>

              {isInstalledSkillsLoading ? (
                <div className="workflow-empty">Chargement des skills...</div>
              ) : (
                <>
                  {/* GLOBAL SKILLS — AUTOMATIC */}
                  <div className="pack-card" style={{ marginBottom: '16px' }}>
                    <div className="pack-card-head">
                      <div>
                        <div className="pack-card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span>🌐 Skills Globaux</span>
                          <span style={{
                            background: installedSkills.global.length > 0 ? '#00c49a22' : '#ff444422',
                            color: installedSkills.global.length > 0 ? '#00c49a' : '#ff6b6b',
                            border: `1px solid ${installedSkills.global.length > 0 ? '#00c49a55' : '#ff444455'}`,
                            borderRadius: '20px',
                            padding: '2px 10px',
                            fontSize: '12px',
                            fontWeight: 600
                          }}>
                            {installedSkills.global.length > 0 ? `✓ ${installedSkills.global.length} actifs` : '0 installés'}
                          </span>
                        </div>
                        <div className="pack-card-desc" style={{ marginTop: '6px' }}>
                          <span style={{ display: 'inline-block', background: '#00c49a18', border: '1px solid #00c49a44', borderRadius: '6px', padding: '4px 10px', color: '#00c49a', fontSize: '12px', marginBottom: '4px' }}>
                            ⚡ Injection automatique — aucune action requise
                          </span>
                          <br />
                          Ces skills sont injectés dans <strong>chaque requête IA</strong>, quel que soit le provider, sans que vous ayez à les sélectionner. Installez-en via l&apos;onglet <strong>Packs</strong>.
                        </div>
                      </div>
                    </div>
                    {installedSkills.global.length > 0 ? (
                      <div className="packs-list">
                        {installedSkills.global.map(s => (
                          <div key={s.name} className="packs-item" style={{ borderBottom: '1px solid #333' }}>
                            <div className="packs-item-info">
                              <div className="packs-item-title" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ color: '#00c49a', fontSize: '10px' }}>●</span>
                                {s.name}
                                {!s.hasSkillMd && <span style={{ color: '#888', fontSize: '10px', fontStyle: 'italic' }}>(pas de SKILL.md)</span>}
                              </div>
                              <div className="packs-item-desc" style={{ fontSize: '11px', opacity: 0.5 }}>{s.path}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="workflow-empty" style={{ paddingTop: '10px', paddingBottom: '10px' }}>
                        Aucun skill global. Allez dans <strong>Packs</strong> pour en installer.
                      </div>
                    )}
                  </div>

                  {/* WORKSPACE SKILLS — MANUAL */}
                  <div className="pack-card">
                    <div className="pack-card-head">
                      <div>
                        <div className="pack-card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span>📁 Skills Workspace</span>
                          <span style={{
                            background: '#ffffff11',
                            color: '#aaa',
                            border: '1px solid #444',
                            borderRadius: '20px',
                            padding: '2px 10px',
                            fontSize: '12px',
                            fontWeight: 600
                          }}>
                            {installedSkills.workspace.length} installés
                          </span>
                        </div>
                        <div className="pack-card-desc" style={{ marginTop: '6px' }}>
                          <span style={{ display: 'inline-block', background: '#ffffff0a', border: '1px solid #444', borderRadius: '6px', padding: '4px 10px', color: '#aaa', fontSize: '12px', marginBottom: '4px' }}>
                            🖐 Sélection manuelle dans le chat IA
                          </span>
                          <br />
                          Ces skills sont spécifiques au projet <code style={{ fontSize: '11px', opacity: 0.7 }}>{currentProjectPath || 'aucun projet ouvert'}</code>.
                          Choisissez-en un via le menu déroulant <strong>Skill</strong> dans la barre du chat.
                        </div>
                      </div>
                    </div>
                    {installedSkills.workspace.length > 0 ? (
                      <div className="packs-list">
                        {installedSkills.workspace.map(s => (
                          <div key={s.name} className="packs-item" style={{ borderBottom: '1px solid #333' }}>
                            <div className="packs-item-info">
                              <div className="packs-item-title" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ color: '#888', fontSize: '10px' }}>◎</span>
                                {s.name}
                              </div>
                              <div className="packs-item-desc" style={{ fontSize: '11px', opacity: 0.5 }}>{s.path}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="workflow-empty" style={{ paddingTop: '10px', paddingBottom: '10px' }}>
                        Aucun skill workspace. Installez via <strong>Packs</strong> avec le bouton &quot;Install (WS)&quot;.
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {activeTab !== 'packs' && activeTab !== 'installed_skills' && (
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
                        type="button"
                        onClick={() => onTrigger(workflow)}
                        className="workflow-action run"
                        title="Executer"
                      >
                        Run
                      </button>
                      <button
                        type="button"
                        onClick={() => handleEdit(workflow)}
                        className="workflow-action edit"
                        title="Modifier"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
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
            type="button"
            onClick={() => handleCreate(activeTab)}
            disabled={activeTab === 'packs' || activeTab === 'installed_skills' || (activeTab === 'workspace' && !currentProjectPath)}
            className="btn btn-primary workflow-create"
          >
            Nouveau Workflow {activeTab === 'global' ? 'Global' : activeTab === 'workspace' ? 'Workspace' : ''}
          </button>
        </div>
      </div>
    </div>
  );
};

export default WorkflowManager;
