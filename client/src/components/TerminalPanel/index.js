import React, { useEffect, useState, useCallback } from 'react';

const TOP_TABS = [
  { id: 'problems', label: 'Problems' },
  { id: 'output', label: 'Output' },
  { id: 'debug', label: 'Debug Console' },
  { id: 'terminal', label: 'Terminal' },
  { id: 'ports', label: 'Ports' },
];

const DEFAULT_PROCESSES = [
  {
    id: 'dev',
    label: 'Dev Server',
    command: 'npm',
    args: ['run', 'dev'],
  },
  {
    id: 'test',
    label: 'Tests',
    command: 'npm',
    args: ['test'],
  },
  {
    id: 'build',
    label: 'Build',
    command: 'npm',
    args: ['run', 'build'],
  },
];

const TerminalPanel = ({ currentProjectPath, isElectronApiAvailable, showMessage }) => {
  const [logs, setLogs] = useState({});
  const [running, setRunning] = useState({});
  const [activeProcessId, setActiveProcessId] = useState('dev');
  const [activeView, setActiveView] = useState('terminal');

  const appendLog = useCallback((id, type, text) => {
    setLogs(prev => {
      const existing = prev[id] || '';
      const prefix = type === 'stderr' ? '[err] ' : '';
      return {
        ...prev,
        [id]: existing + prefix + text,
      };
    });
  }, []);

  useEffect(() => {
    if (!isElectronApiAvailable || !window.electronAPI) return;

    const handleOutput = (data) => {
      if (!data || !data.id) return;
      appendLog(data.id, data.type, data.data || '');
    };

    const handleExit = (data) => {
      if (!data || !data.id) return;
      setRunning(prev => ({ ...prev, [data.id]: false }));
      appendLog(data.id, 'stdout', `\n[process exited with code ${data.code}]\n`);
    };

    window.electronAPI.onProcessOutput(handleOutput);
    window.electronAPI.onProcessExit(handleExit);
  }, [isElectronApiAvailable, appendLog]);

  const start = async (proc) => {
    if (!isElectronApiAvailable || !window.electronAPI) {
      showMessage('Electron non disponible', 3000);
      return;
    }
    if (!currentProjectPath) {
      showMessage('Ouvre un dossier de projet avant de lancer une commande.', 4000);
      return;
    }

    setActiveProcessId(proc.id);
    setRunning(prev => ({ ...prev, [proc.id]: true }));
    appendLog(proc.id, 'stdout', `\n[launching ${proc.command} ${proc.args.join(' ')}]\n`);

    try {
      const payload = {
        id: proc.id,
        command: proc.command,
        args: proc.args,
        cwd: currentProjectPath,
      };
      const res = await window.electronAPI.startProcess(payload);
      if (!res || !res.success) {
        setRunning(prev => ({ ...prev, [proc.id]: false }));
        showMessage(res && res.error ? res.error : 'Erreur lancement processus', 4000);
      }
    } catch (error) {
      setRunning(prev => ({ ...prev, [proc.id]: false }));
      showMessage(error.message || 'Erreur lancement processus', 4000);
    }
  };

  const stop = async (id) => {
    if (!isElectronApiAvailable || !window.electronAPI) return;
    try {
      await window.electronAPI.stopProcess(id);
      setRunning(prev => ({ ...prev, [id]: false }));
      appendLog(id, 'stdout', '\n[process stopped]\n');
    } catch (error) {
      showMessage(error.message || 'Erreur arret processus', 4000);
    }
  };

  const activeLog = logs[activeProcessId] || '';
  const buildLog = logs.build || '';

  const buildProblemLines = buildLog
    ? buildLog
        .split('\n')
        .filter((line) => /ERROR|Failed to compile|Type error/i.test(line))
    : [];

  let content = null;

  if (activeView === 'terminal') {
    content = (
      <>
        <div className="terminal-actions">
          {DEFAULT_PROCESSES.map((proc) => {
            const isActive = activeProcessId === proc.id;
            const isRunning = !!running[proc.id];
            return (
              <div key={proc.id} className="terminal-action">
                <button
                  onClick={() => setActiveProcessId(proc.id)}
                  className={`terminal-pill ${isActive ? 'is-active' : ''}`}
                >
                  {proc.label}
                </button>
                <button
                  onClick={() => (isRunning ? stop(proc.id) : start(proc))}
                  className={`terminal-toggle ${isRunning ? 'is-running' : ''}`}
                >
                  {isRunning ? 'Stop' : 'Start'}
                </button>
              </div>
            );
          })}
        </div>
        <div className="terminal-log custom-scrollbar">
          {activeLog || 'Aucun log pour le moment. Lance une commande pour voir la sortie ici.'}
        </div>
      </>
    );
  } else if (activeView === 'problems') {
    content = (
      <div className="terminal-log custom-scrollbar">
        {!buildLog &&
          "Aucun log de build pour le moment. Lance la commande 'Build' dans l'onglet Terminal pour voir les erreurs de compilation ici."}
        {buildLog && buildProblemLines.length === 0 &&
          'Aucun probleme detecte dans les logs de build.'}
        {buildProblemLines.length > 0 && (
          <ul className="terminal-problem-list">
            {buildProblemLines.map((line, index) => (
              <li
                key={index}
                className={line.toLowerCase().includes('error') ? 'problem-error' : 'problem-warn'}
              >
                {line}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  } else if (activeView === 'output') {
    content = (
      <div className="terminal-log custom-scrollbar">
        {activeLog || 'Aucun output pour le moment. Lance une commande dans le Terminal pour voir la sortie ici.'}
      </div>
    );
  } else if (activeView === 'debug') {
    content = (
      <div className="terminal-log custom-scrollbar">
        {'Debug Console non implementee pour le moment. Utilise les logs du Terminal pour diagnostiquer les problemes.'}
      </div>
    );
  } else if (activeView === 'ports') {
    content = (
      <div className="terminal-log custom-scrollbar">
        {'Ports non geres ici pour l instant. Le serveur de dev utilise le port configure dans les parametres.'}
      </div>
    );
  }

  return (
    <div className="terminal-panel">
      <div className="terminal-tabs">
        {TOP_TABS.map((tab) => {
          const isActive = activeView === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveView(tab.id)}
              className={`terminal-tab ${isActive ? 'is-active' : ''}`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <div className="terminal-body">
        {content}
      </div>
    </div>
  );
};

export default TerminalPanel;
