import React, { useState, useEffect, useCallback } from 'react';
import './GitPanel.css';

const GitPanel = ({
  currentProjectPath,
  isElectronApiAvailable,
  showMessage,
  permissionMode = 'edit_terminal'
}) => {
  const [files, setFiles] = useState([]);
  const [commits, setCommits] = useState([]);
  const [branch, setBranch] = useState('');
  const [branches, setBranches] = useState([]);
  const [selectedBranch, setSelectedBranch] = useState('');
  const [newBranchName, setNewBranchName] = useState('');
  const [stashEntries, setStashEntries] = useState([]);
  const [selectedStashRef, setSelectedStashRef] = useState('');
  const [stashMessage, setStashMessage] = useState('');
  const [commitMessage, setCommitMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('changes'); // changes | log | diff
  const [isInitialized, setIsInitialized] = useState(true);
  const [diff, setDiff] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);

  const canEditGit = permissionMode !== 'read_only';
  const api = isElectronApiAvailable && window.electronAPI;

  const refreshBranchesAndStashes = useCallback(async (currentBranchHint = '') => {
    if (!api || !currentProjectPath) return;

    try {
      if (api.gitListBranches) {
        const listRes = await api.gitListBranches(currentProjectPath);
        if (listRes?.success && Array.isArray(listRes.branches)) {
          const normalized = listRes.branches
            .filter((item) => item && item.name)
            .filter((item) => !String(item.name).startsWith('HEAD ->'));

          setBranches(normalized);

          const detectedCurrent = normalized.find((item) => item.current)?.name || currentBranchHint || '';
          setSelectedBranch((prev) => {
            if (prev && normalized.some((item) => item.name === prev)) return prev;
            return detectedCurrent;
          });
        } else {
          setBranches([]);
        }
      }

      if (api.gitStashList) {
        const stashRes = await api.gitStashList(currentProjectPath);
        if (stashRes?.success && Array.isArray(stashRes.stashes)) {
          setStashEntries(stashRes.stashes);
          setSelectedStashRef((prev) => {
            if (prev && stashRes.stashes.some((item) => item.ref === prev)) return prev;
            return stashRes.stashes[0]?.ref || '';
          });
        } else {
          setStashEntries([]);
          setSelectedStashRef('');
        }
      }
    } catch {
      // Keep existing UI state if optional metadata calls fail
    }
  }, [api, currentProjectPath]);

  const refresh = useCallback(async () => {
    if (!api || !currentProjectPath) return;

    try {
      const [statusRes, branchRes] = await Promise.all([
        api.gitStatus(currentProjectPath),
        api.gitBranch(currentProjectPath)
      ]);

      if (statusRes?.success) {
        setFiles(Array.isArray(statusRes.files) ? statusRes.files : []);
        setIsInitialized(true);
      } else if (statusRes?.error && String(statusRes.error).includes('not a git')) {
        setIsInitialized(false);
      }

      const currentBranch = branchRes?.success ? String(branchRes.branch || '') : '';
      if (currentBranch) {
        setBranch(currentBranch);
        setSelectedBranch((prev) => prev || currentBranch);
      }

      await refreshBranchesAndStashes(currentBranch);
    } catch {
      setIsInitialized(false);
    }
  }, [api, currentProjectPath, refreshBranchesAndStashes]);

  const loadLog = useCallback(async () => {
    if (!api || !currentProjectPath) return;
    const res = await api.gitLog(currentProjectPath, 30);
    if (res?.success) {
      setCommits(Array.isArray(res.commits) ? res.commits : []);
    }
  }, [api, currentProjectPath]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (activeTab === 'log') loadLog();
  }, [activeTab, loadLog]);

  const handleInit = async () => {
    if (!api) return;
    if (!canEditGit) {
      showMessage('Mode lecture seule: action git bloquee.', 3000);
      return;
    }

    const res = await api.gitInit(currentProjectPath);
    if (res?.success) {
      showMessage('Git initialise.', 2000);
      refresh();
    } else {
      showMessage(`Erreur git init: ${res?.error || 'inconnue'}`, 4000);
    }
  };

  const handleStageAll = async () => {
    if (!api) return;
    if (!canEditGit) {
      showMessage('Mode lecture seule: action git bloquee.', 3000);
      return;
    }

    setIsLoading(true);
    const res = await api.gitAdd(currentProjectPath, []);
    setIsLoading(false);

    if (res?.success) {
      showMessage('Tous les fichiers stages.', 2000);
      refresh();
    } else {
      showMessage(`Erreur: ${res?.error || 'inconnue'}`, 4000);
    }
  };

  const handleStageFile = async (file) => {
    if (!api || !file?.file) return;
    if (!canEditGit) return;

    const res = await api.gitAdd(currentProjectPath, [file.file]);
    if (res?.success) refresh();
    else showMessage(`Erreur: ${res?.error || 'inconnue'}`, 4000);
  };

  const handleCommit = async () => {
    if (!commitMessage.trim()) {
      showMessage('Entrez un message de commit.', 2000);
      return;
    }
    if (!api) return;
    if (!canEditGit) {
      showMessage('Mode lecture seule: commit bloque.', 3000);
      return;
    }

    setIsLoading(true);
    const res = await api.gitCommit(currentProjectPath, commitMessage);
    setIsLoading(false);

    if (res?.success) {
      showMessage('Commit cree.', 2000);
      setCommitMessage('');
      refresh();
    } else {
      showMessage(`Erreur commit: ${res?.error || 'inconnue'}`, 4000);
    }
  };

  const handlePush = async () => {
    if (!api) return;
    if (!canEditGit) {
      showMessage('Mode lecture seule: push bloque.', 3000);
      return;
    }

    setIsLoading(true);
    const res = await api.gitPush(currentProjectPath);
    setIsLoading(false);

    if (res?.success) showMessage('Push reussi.', 3000);
    else showMessage(`Erreur push: ${res?.error || 'inconnue'}`, 5000);
  };

  const handlePull = async () => {
    if (!api) return;
    if (!canEditGit) {
      showMessage('Mode lecture seule: pull bloque.', 3000);
      return;
    }

    setIsLoading(true);
    const res = await api.gitPull(currentProjectPath);
    setIsLoading(false);

    if (res?.success) {
      showMessage('Pull reussi.', 2000);
      refresh();
    } else {
      showMessage(`Erreur pull: ${res?.error || 'inconnue'}`, 5000);
    }
  };

  const handleViewDiff = async (file) => {
    if (!api || !file?.file) return;

    setSelectedFile(file.file);
    setActiveTab('diff');

    const res = await api.gitDiff(currentProjectPath, file.file);
    if (res?.success) setDiff(res.diff || '(pas de diff)');
    else setDiff(`Erreur: ${res?.error || 'inconnue'}`);
  };

  const handleCheckoutBranch = async (targetBranch = selectedBranch) => {
    if (!api || !targetBranch) return;
    if (!canEditGit) {
      showMessage('Mode lecture seule: checkout bloque.', 3000);
      return;
    }
    if (!api.gitCheckoutBranch) {
      showMessage('Checkout de branche non disponible.', 3000);
      return;
    }

    setIsLoading(true);
    const res = await api.gitCheckoutBranch(currentProjectPath, targetBranch);
    setIsLoading(false);

    if (res?.success) {
      showMessage(`Branche active: ${targetBranch}`, 2500);
      setBranch(targetBranch);
      refresh();
    } else {
      showMessage(`Erreur checkout: ${res?.error || 'inconnue'}`, 4500);
    }
  };

  const handleCreateBranch = async () => {
    if (!api) return;
    if (!canEditGit) {
      showMessage('Mode lecture seule: creation branche bloquee.', 3000);
      return;
    }
    if (!api.gitCreateBranch) {
      showMessage('Creation de branche non disponible.', 3000);
      return;
    }

    const nextBranch = String(newBranchName || '').trim();
    if (!nextBranch) {
      showMessage('Nom de branche manquant.', 2500);
      return;
    }

    setIsLoading(true);
    const res = await api.gitCreateBranch(currentProjectPath, nextBranch);
    setIsLoading(false);

    if (res?.success) {
      setNewBranchName('');
      setBranch(nextBranch);
      setSelectedBranch(nextBranch);
      showMessage(`Branche creee: ${nextBranch}`, 2500);
      refresh();
    } else {
      showMessage(`Erreur creation branche: ${res?.error || 'inconnue'}`, 4500);
    }
  };

  const handleStashSave = async () => {
    if (!api) return;
    if (!canEditGit) {
      showMessage('Mode lecture seule: stash bloque.', 3000);
      return;
    }
    if (!api.gitStashSave) {
      showMessage('Stash non disponible.', 3000);
      return;
    }

    setIsLoading(true);
    const res = await api.gitStashSave(currentProjectPath, stashMessage);
    setIsLoading(false);

    if (res?.success) {
      setStashMessage('');
      showMessage('Stash cree.', 2500);
      refresh();
    } else {
      showMessage(`Erreur stash: ${res?.error || 'inconnue'}`, 4500);
    }
  };

  const handleStashPop = async (stashRef = selectedStashRef) => {
    if (!api) return;
    if (!canEditGit) {
      showMessage('Mode lecture seule: stash pop bloque.', 3000);
      return;
    }
    if (!api.gitStashPop) {
      showMessage('Stash pop non disponible.', 3000);
      return;
    }

    if (!stashRef) {
      showMessage('Aucun stash selectionne.', 2500);
      return;
    }

    setIsLoading(true);
    const res = await api.gitStashPop(currentProjectPath, stashRef);
    setIsLoading(false);

    if (res?.success) {
      showMessage(`Stash applique: ${stashRef}`, 2500);
      refresh();
    } else {
      showMessage(`Erreur stash pop: ${res?.error || 'inconnue'}`, 4500);
    }
  };

  const getStatusColor = (status) => {
    if (!status) return '#888';
    if (status.includes('M')) return '#f5a623';
    if (status.includes('A')) return '#00c49a';
    if (status.includes('D')) return '#ff6b6b';
    if (status.includes('?')) return '#888';
    return '#ccc';
  };

  const getStatusLabel = (status) => {
    if (!status) return '?';
    if (status.includes('M')) return 'M';
    if (status.includes('A')) return 'A';
    if (status.includes('D')) return 'D';
    if (status.includes('?')) return 'U';
    return String(status).trim().charAt(0);
  };

  if (!currentProjectPath) {
    return (
      <div className="git-panel git-empty">
        <div className="git-empty-icon">git</div>
        <div>Ouvrez un projet pour utiliser Git</div>
      </div>
    );
  }

  if (!isInitialized) {
    return (
      <div className="git-panel git-empty">
        <div className="git-empty-icon">git</div>
        <div style={{ marginBottom: '12px' }}>Ce projet n&apos;est pas un depot Git</div>
        <button className="git-btn git-btn-primary" onClick={handleInit} disabled={!canEditGit}>Git Init</button>
      </div>
    );
  }

  return (
    <div className="git-panel">
      <div className="git-header">
        <div className="git-branch-badge">
          <span>branch</span>
          <span>{branch || 'main'}</span>
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button className="git-btn" onClick={handlePull} disabled={isLoading || !canEditGit} title="Pull">Pull</button>
          <button className="git-btn git-btn-primary" onClick={handlePush} disabled={isLoading || !canEditGit} title="Push">Push</button>
        </div>
      </div>

      <div className="git-toolbar">
        <div className="git-toolbar-row">
          <select
            className="git-select"
            value={selectedBranch}
            onChange={(e) => setSelectedBranch(e.target.value)}
          >
            {branches.length === 0 && <option value="">(branche courante)</option>}
            {branches.map((item) => (
              <option key={item.name} value={item.name}>{item.current ? `* ${item.name}` : item.name}</option>
            ))}
          </select>
          <button
            className="git-btn"
            onClick={() => handleCheckoutBranch()}
            disabled={isLoading || !selectedBranch || !canEditGit}
          >
            Checkout
          </button>
          <button
            className="git-btn"
            onClick={() => refresh()}
            disabled={isLoading}
            title="Actualiser"
          >
            Refresh
          </button>
        </div>

        <div className="git-toolbar-row">
          <input
            className="git-input"
            value={newBranchName}
            onChange={(e) => setNewBranchName(e.target.value)}
            placeholder="nouvelle-branche"
          />
          <button
            className="git-btn"
            onClick={handleCreateBranch}
            disabled={isLoading || !newBranchName.trim() || !canEditGit}
          >
            Create Branch
          </button>
        </div>

        <div className="git-toolbar-row">
          <input
            className="git-input"
            value={stashMessage}
            onChange={(e) => setStashMessage(e.target.value)}
            placeholder="message stash (optionnel)"
          />
          <button
            className="git-btn"
            onClick={handleStashSave}
            disabled={isLoading || !canEditGit}
          >
            Stash Save
          </button>
        </div>

        <div className="git-toolbar-row">
          <select
            className="git-select"
            value={selectedStashRef}
            onChange={(e) => setSelectedStashRef(e.target.value)}
          >
            {stashEntries.length === 0 && <option value="">Aucun stash</option>}
            {stashEntries.map((entry) => (
              <option key={entry.ref} value={entry.ref}>
                {entry.ref} {entry.when ? `(${entry.when})` : ''} {entry.message ? `- ${entry.message}` : ''}
              </option>
            ))}
          </select>
          <button
            className="git-btn"
            onClick={() => handleStashPop()}
            disabled={isLoading || !selectedStashRef || !canEditGit}
          >
            Stash Pop
          </button>
        </div>
      </div>

      <div className="git-tabs">
        <button className={`git-tab${activeTab === 'changes' ? ' is-active' : ''}`} onClick={() => setActiveTab('changes')}>
          Modifications {files.length > 0 && <span className="git-badge">{files.length}</span>}
        </button>
        <button className={`git-tab${activeTab === 'log' ? ' is-active' : ''}`} onClick={() => setActiveTab('log')}>
          Historique
        </button>
        {selectedFile && (
          <button className={`git-tab${activeTab === 'diff' ? ' is-active' : ''}`} onClick={() => setActiveTab('diff')}>
            Diff
          </button>
        )}
      </div>

      {activeTab === 'changes' && (
        <div className="git-body">
          {files.length === 0 ? (
            <div className="git-empty-small">Aucune modification</div>
          ) : (
            <div className="git-file-list">
              {files.map((f, i) => (
                <div key={i} className="git-file-item">
                  <span className="git-file-status" style={{ color: getStatusColor(f.status) }} title={f.status}>
                    {getStatusLabel(f.status)}
                  </span>
                  <span className="git-file-name" title={f.file}>{f.file}</span>
                  <div className="git-file-actions">
                    <button className="git-icon-btn" onClick={() => handleViewDiff(f)} title="Voir diff">Diff</button>
                    <button className="git-icon-btn" onClick={() => handleStageFile(f)} title="Stager" disabled={!canEditGit}>+</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="git-commit-area">
            <textarea
              className="git-commit-input"
              placeholder="Message de commit... (Ctrl+Enter)"
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              rows={3}
              onKeyDown={(e) => { if (e.ctrlKey && e.key === 'Enter') handleCommit(); }}
            />
            <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
              <button className="git-btn" onClick={handleStageAll} disabled={isLoading || !canEditGit}>Stage All</button>
              <button
                className="git-btn git-btn-primary"
                onClick={handleCommit}
                disabled={isLoading || !commitMessage.trim() || !canEditGit}
                style={{ flex: 1 }}
              >
                {isLoading ? '...' : 'Commit'}
              </button>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'log' && (
        <div className="git-body" style={{ overflowY: 'auto' }}>
          {commits.length === 0 ? (
            <div className="git-empty-small">Aucun commit</div>
          ) : (
            <div className="git-log-list">
              {commits.map((c, i) => (
                <div key={i} className="git-log-item">
                  <div className="git-log-hash">{c.hash ? c.hash.substring(0, 7) : ''}</div>
                  <div className="git-log-message" title={c.message}>{c.message}</div>
                  <div className="git-log-meta">{c.date} | {c.author}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'diff' && (
        <div className="git-body" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '8px 12px', borderBottom: '1px solid #333', fontSize: '12px', color: '#aaa' }}>
            {selectedFile}
          </div>
          <pre className="git-diff-view">{diff}</pre>
        </div>
      )}
    </div>
  );
};

export default GitPanel;
