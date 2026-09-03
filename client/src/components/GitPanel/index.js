import React, { useState, useEffect, useCallback, useMemo } from 'react';
import './GitPanel.css';
import {
  getGitDisplayPath,
  getGitSectionActionLabel,
  getGitSectionMeta,
  groupGitStatusEntries
} from '../../utils/gitChanges';

const buildComparisonKey = (entry, sectionId) => `${sectionId}:${entry?.file || ''}:${entry?.previousFile || ''}`;

const getSectionBadge = (sectionId, entry) => {
  if (sectionId === 'conflicted') return '!';
  if (sectionId === 'untracked') return 'U';
  if (sectionId === 'staged') return String(entry?.indexStatus || entry?.status || 'M').trim() || 'M';
  return String(entry?.workingTreeStatus || entry?.status || 'M').trim() || 'M';
};

const GitPanel = ({
  currentProjectPath,
  isElectronApiAvailable,
  showMessage,
  permissionMode = 'edit_terminal',
  onOpenFile,
  onOpenGitDiff,
  activeComparisonKey = ''
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
  const [activeTab, setActiveTab] = useState('changes');
  const [isInitialized, setIsInitialized] = useState(true);

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
      // keep previous optional metadata
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

  const groupedFiles = useMemo(() => groupGitStatusEntries(files), [files]);
  const totalChangedFiles = files.length;

  const changeSections = useMemo(() => ([
    {
      id: 'conflicted',
      title: 'Conflits',
      count: groupedFiles.conflicted.length,
      items: groupedFiles.conflicted,
      tone: 'danger'
    },
    {
      id: 'working',
      title: 'Modifications',
      count: groupedFiles.working.length,
      items: groupedFiles.working,
      tone: 'warning'
    },
    {
      id: 'staged',
      title: 'Staged',
      count: groupedFiles.staged.length,
      items: groupedFiles.staged,
      tone: 'success'
    },
    {
      id: 'untracked',
      title: 'Nouveaux fichiers',
      count: groupedFiles.untracked.length,
      items: groupedFiles.untracked,
      tone: 'muted'
    }
  ]), [groupedFiles]);

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

  const handleToggleStage = async (entry, sectionId) => {
    if (!api || !entry?.file) return;
    if (!canEditGit) return;

    const action = sectionId === 'staged' ? api.gitUnstage : api.gitAdd;
    if (typeof action !== 'function') {
      showMessage('Action Git indisponible.', 3000);
      return;
    }

    const res = await action(currentProjectPath, [entry.file]);
    if (res?.success) {
      showMessage(sectionId === 'staged' ? `Fichier retire de l'index: ${entry.file}` : `Fichier stage: ${entry.file}`, 2000);
      refresh();
    } else {
      showMessage(`Erreur: ${res?.error || 'inconnue'}`, 4000);
    }
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
      loadLog();
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

  const handleOpenEntry = useCallback((entry, sectionId) => {
    if (typeof onOpenFile === 'function') {
      onOpenFile(entry, sectionId);
    }
  }, [onOpenFile]);

  const handleOpenDiff = useCallback((entry, sectionId) => {
    if (typeof onOpenGitDiff === 'function') {
      onOpenGitDiff(entry, sectionId);
    }
  }, [onOpenGitDiff]);

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
        <button type="button" className="git-btn git-btn-primary" onClick={handleInit} disabled={!canEditGit}>Git Init</button>
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
        <div className="git-header-actions">
          <button type="button" className="git-btn" onClick={handlePull} disabled={isLoading || !canEditGit} title="Pull">Pull</button>
          <button type="button" className="git-btn git-btn-primary" onClick={handlePush} disabled={isLoading || !canEditGit} title="Push">Push</button>
        </div>
      </div>

      <div className="git-toolbar">
        <div className="git-toolbar-row">
          <select
            className="git-select"
            value={selectedBranch}
            onChange={(e) => setSelectedBranch(e.target.value)}
            aria-label="Branche à activer"
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
            aria-label="Nom de la nouvelle branche"
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
            aria-label="Message du stash"
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
            aria-label="Stash à appliquer"
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
        <button type="button" className={`git-tab${activeTab === 'changes' ? ' is-active' : ''}`} onClick={() => setActiveTab('changes')}>
          Modifications {totalChangedFiles > 0 && <span className="git-badge">{totalChangedFiles}</span>}
        </button>
        <button type="button" className={`git-tab${activeTab === 'log' ? ' is-active' : ''}`} onClick={() => setActiveTab('log')}>
          Historique
        </button>
      </div>

      {activeTab === 'changes' && (
        <div className="git-body">
          <div className="git-summary-row">
            {changeSections.filter((section) => section.count > 0).map((section) => (
              <span key={section.id} className={`git-summary-pill is-${section.tone}`}>
                {section.title} {section.count}
              </span>
            ))}
            {totalChangedFiles === 0 && (
              <span className="git-summary-pill is-muted">Working tree clean</span>
            )}
          </div>

          <div className="git-file-list">
            {totalChangedFiles === 0 ? (
              <div className="git-empty-small">Aucune modification</div>
            ) : (
              changeSections.map((section) => (
                section.count > 0 ? (
                  <section key={section.id} className="git-section">
                    <div className="git-section-header">
                      <span className="git-section-title">{section.title}</span>
                      <span className={`git-section-count is-${section.tone}`}>{section.count}</span>
                    </div>
                    {section.items.map((entry) => {
                      const comparisonKey = buildComparisonKey(entry, section.id);
                      return (
                        <div
                          key={comparisonKey}
                          className={`git-file-item ${activeComparisonKey === comparisonKey ? 'is-selected' : ''}`}
                          role="button"
                          tabIndex={0}
                          onClick={() => handleOpenDiff(entry, section.id)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              handleOpenDiff(entry, section.id);
                            }
                          }}
                        >
                          <span className={`git-file-status is-${section.tone}`} title={String(entry.rawStatus || entry.status || '')}>
                            {getSectionBadge(section.id, entry)}
                          </span>
                          <span className="git-file-copy">
                            <span className="git-file-name" title={getGitDisplayPath(entry)}>{getGitDisplayPath(entry)}</span>
                            <span className="git-file-meta">{getGitSectionMeta(entry, section.id)}</span>
                          </span>
                          <div className="git-file-actions">
                            <button
                              className="git-icon-btn"
                              onClick={(event) => {
                                event.stopPropagation();
                                handleOpenEntry(entry, section.id);
                              }}
                              title="Ouvrir le fichier"
                            >
                              Open
                            </button>
                            <button
                              className="git-icon-btn"
                              onClick={(event) => {
                                event.stopPropagation();
                                handleOpenDiff(entry, section.id);
                              }}
                              title="Ouvrir le diff"
                            >
                              Diff
                            </button>
                            {canEditGit && !entry.conflicted && (
                              <button
                                className="git-icon-btn"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleToggleStage(entry, section.id);
                                }}
                                title={getGitSectionActionLabel(section.id)}
                              >
                                {section.id === 'staged' ? '-' : '+'}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </section>
                ) : null
              ))
            )}
          </div>

          <div className="git-commit-area">
            <textarea
              className="git-commit-input"
              placeholder="Message de commit... (Ctrl+Enter)"
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              rows={3}
              onKeyDown={(e) => { if (e.ctrlKey && e.key === 'Enter') handleCommit(); }}
              aria-label="Message de commit"
            />
            <div className="git-commit-actions">
              <button type="button" className="git-btn" onClick={handleStageAll} disabled={isLoading || !canEditGit}>Stage All</button>
              <button
                className="git-btn git-btn-primary"
                onClick={handleCommit}
                disabled={isLoading || !commitMessage.trim() || !canEditGit}
              >
                {isLoading ? '...' : 'Commit'}
              </button>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'log' && (
        <div className="git-body git-body-scroll">
          {commits.length === 0 ? (
            <div className="git-empty-small">Aucun commit</div>
          ) : (
            <div className="git-log-list">
              {commits.map((commit, index) => (
                <div key={`${commit.hash || 'commit'}-${index}`} className="git-log-item">
                  <div className="git-log-hash">{commit.hash ? commit.hash.substring(0, 7) : ''}</div>
                  <div className="git-log-message" title={commit.message}>{commit.message}</div>
                  <div className="git-log-meta">{commit.date} | {commit.author}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default GitPanel;
