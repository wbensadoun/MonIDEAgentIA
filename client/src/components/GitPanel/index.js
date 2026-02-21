import React, { useState, useEffect, useCallback } from 'react';
import './GitPanel.css';

const GitPanel = ({ currentProjectPath, isElectronApiAvailable, showMessage }) => {
    const [files, setFiles] = useState([]);
    const [commits, setCommits] = useState([]);
    const [branch, setBranch] = useState('');
    const [commitMessage, setCommitMessage] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [activeTab, setActiveTab] = useState('changes'); // 'changes' | 'log' | 'diff'
    const [isInitialized, setIsInitialized] = useState(true);
    const [diff, setDiff] = useState('');
    const [selectedFile, setSelectedFile] = useState(null);

    const api = isElectronApiAvailable && window.electronAPI;

    const refresh = useCallback(async () => {
        if (!api || !currentProjectPath) return;
        try {
            const [statusRes, branchRes] = await Promise.all([
                api.gitStatus(currentProjectPath),
                api.gitBranch(currentProjectPath)
            ]);
            if (statusRes.success) {
                setFiles(statusRes.files);
                setIsInitialized(true);
            } else if (statusRes.error && statusRes.error.includes('not a git')) {
                setIsInitialized(false);
            }
            if (branchRes.success) setBranch(branchRes.branch);
        } catch (e) {
            setIsInitialized(false);
        }
    }, [api, currentProjectPath]);

    const loadLog = useCallback(async () => {
        if (!api || !currentProjectPath) return;
        const res = await api.gitLog(currentProjectPath, 30);
        if (res.success) setCommits(res.commits);
    }, [api, currentProjectPath]);

    useEffect(() => { refresh(); }, [refresh]);
    useEffect(() => { if (activeTab === 'log') loadLog(); }, [activeTab, loadLog]);

    const handleInit = async () => {
        if (!api) return;
        const res = await api.gitInit(currentProjectPath);
        if (res.success) { showMessage('Git initialisé ✅', 2000); refresh(); }
        else showMessage(`Erreur git init: ${res.error}`, 4000);
    };

    const handleStageAll = async () => {
        if (!api) return;
        setIsLoading(true);
        const res = await api.gitAdd(currentProjectPath, []);
        setIsLoading(false);
        if (res.success) { showMessage('Tous les fichiers stagés ✅', 2000); refresh(); }
        else showMessage(`Erreur: ${res.error}`, 4000);
    };

    const handleStageFile = async (file) => {
        if (!api) return;
        const res = await api.gitAdd(currentProjectPath, [file.file]);
        if (res.success) { refresh(); }
        else showMessage(`Erreur: ${res.error}`, 4000);
    };

    const handleCommit = async () => {
        if (!commitMessage.trim()) { showMessage('Entrez un message de commit', 2000); return; }
        if (!api) return;
        setIsLoading(true);
        const res = await api.gitCommit(currentProjectPath, commitMessage);
        setIsLoading(false);
        if (res.success) {
            showMessage('Commit créé ✅', 2000);
            setCommitMessage('');
            refresh();
        } else showMessage(`Erreur commit: ${res.error}`, 4000);
    };

    const handlePush = async () => {
        if (!api) return;
        setIsLoading(true);
        showMessage('Push en cours...', 60000);
        const res = await api.gitPush(currentProjectPath);
        setIsLoading(false);
        if (res.success) showMessage('Push réussi ✅', 3000);
        else showMessage(`Erreur push: ${res.error}`, 5000);
    };

    const handlePull = async () => {
        if (!api) return;
        setIsLoading(true);
        const res = await api.gitPull(currentProjectPath);
        setIsLoading(false);
        if (res.success) { showMessage('Pull réussi ✅', 2000); refresh(); }
        else showMessage(`Erreur pull: ${res.error}`, 5000);
    };

    const handleViewDiff = async (file) => {
        if (!api) return;
        setSelectedFile(file.file);
        setActiveTab('diff');
        const res = await api.gitDiff(currentProjectPath, file.file);
        if (res.success) setDiff(res.diff || '(pas de diff)');
        else setDiff(`Erreur: ${res.error}`);
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
        return status.trim().charAt(0);
    };

    if (!currentProjectPath) {
        return (
            <div className="git-panel git-empty">
                <div className="git-empty-icon">⊞</div>
                <div>Ouvrez un projet pour utiliser Git</div>
            </div>
        );
    }

    if (!isInitialized) {
        return (
            <div className="git-panel git-empty">
                <div className="git-empty-icon">⊞</div>
                <div style={{ marginBottom: '12px' }}>Ce projet n&apos;est pas un dépôt Git</div>
                <button className="git-btn git-btn-primary" onClick={handleInit}>Git Init</button>
            </div>
        );
    }

    return (
        <div className="git-panel">
            {/* Header */}
            <div className="git-header">
                <div className="git-branch-badge">
                    <span style={{ color: '#00c49a' }}>⎇</span>
                    <span>{branch || 'main'}</span>
                </div>
                <div style={{ display: 'flex', gap: '6px' }}>
                    <button className="git-btn" onClick={handlePull} disabled={isLoading} title="Pull">↓ Pull</button>
                    <button className="git-btn git-btn-primary" onClick={handlePush} disabled={isLoading} title="Push">↑ Push</button>
                </div>
            </div>

            {/* Tabs */}
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

            {/* Changes tab */}
            {activeTab === 'changes' && (
                <div className="git-body">
                    {files.length === 0 ? (
                        <div className="git-empty-small">✓ Aucune modification</div>
                    ) : (
                        <div className="git-file-list">
                            {files.map((f, i) => (
                                <div key={i} className="git-file-item">
                                    <span className="git-file-status" style={{ color: getStatusColor(f.status) }} title={f.status}>
                                        {getStatusLabel(f.status)}
                                    </span>
                                    <span className="git-file-name" title={f.file}>{f.file}</span>
                                    <div className="git-file-actions">
                                        <button className="git-icon-btn" onClick={() => handleViewDiff(f)} title="Voir diff">±</button>
                                        <button className="git-icon-btn" onClick={() => handleStageFile(f)} title="Stager">+</button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                    <div className="git-commit-area">
                        <textarea
                            className="git-commit-input"
                            placeholder="Message de commit... (Ctrl+Enter pour valider)"
                            value={commitMessage}
                            onChange={e => setCommitMessage(e.target.value)}
                            rows={3}
                            onKeyDown={e => { if (e.ctrlKey && e.key === 'Enter') handleCommit(); }}
                        />
                        <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                            <button className="git-btn" onClick={handleStageAll} disabled={isLoading}>Stage All</button>
                            <button className="git-btn git-btn-primary" onClick={handleCommit} disabled={isLoading || !commitMessage.trim()} style={{ flex: 1 }}>
                                {isLoading ? '...' : '✓ Commit'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Log tab */}
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
                                    <div className="git-log-meta">{c.date} · {c.author}</div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Diff tab */}
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
