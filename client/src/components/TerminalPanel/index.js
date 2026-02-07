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

    return () => {
      // Pas de removeAllListeners ici pour éviter d'impacter d'autres listeners
    };
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
      showMessage(error.message || 'Erreur arrêt processus', 4000);
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
        <div className="flex items-center gap-2 border-b border-gray-700 px-3 py-2">
          {DEFAULT_PROCESSES.map((proc) => {
            const isActive = activeProcessId === proc.id;
            const isRunning = !!running[proc.id];
            return (
              <div key={proc.id} className="flex items-center gap-1">
                <button
                  onClick={() => setActiveProcessId(proc.id)}
                  className={`px-2 py-1 rounded text-xs font-mono ${
                    isActive ? 'bg-cyan-600 text-white' : 'text-gray-300 hover:bg-gray-700'
                  }`}
                >
                  {proc.label}
                </button>
                <button
                  onClick={() => (isRunning ? stop(proc.id) : start(proc))}
                  className={`px-2 py-1 rounded text-xs border ${
                    isRunning
                      ? 'border-red-500 text-red-400 hover:bg-red-500/20'
                      : 'border-green-500 text-green-400 hover:bg-green-500/20'
                  }`}
                >
                  {isRunning ? 'Stop' : 'Start'}
                </button>
              </div>
            );
          })}
        </div>
        <div className="flex-1 overflow-auto custom-scrollbar p-3 font-mono text-xs text-gray-200 whitespace-pre-wrap">
          {activeLog || 'Aucun log pour le moment. Lance une commande pour voir la sortie ici.'}
        </div>
      </>
    );
  } else if (activeView === 'problems') {
    content = (
      <div className="flex-1 overflow-auto custom-scrollbar p-3 font-mono text-xs text-gray-200 whitespace-pre-wrap">
        {!buildLog &&
          "Aucun log de build pour le moment. Lance la commande 'Build' dans l'onglet Terminal pour voir les erreurs de compilation ici."}
        {buildLog && buildProblemLines.length === 0 &&
          'Aucun problème détecté dans les logs de build.'}
        {buildProblemLines.length > 0 && (
          <ul className="space-y-1">
            {buildProblemLines.map((line, index) => (
              <li
                key={index}
                className={line.toLowerCase().includes('error') ? 'text-red-300' : 'text-yellow-300'}
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
      <div className="flex-1 overflow-auto custom-scrollbar p-3 font-mono text-xs text-gray-200 whitespace-pre-wrap">
        {activeLog || 'Aucun output pour le moment. Lance une commande dans le Terminal pour voir la sortie ici.'}
      </div>
    );
  } else if (activeView === 'debug') {
    content = (
      <div className="flex-1 overflow-auto custom-scrollbar p-3 font-mono text-xs text-gray-200 whitespace-pre-wrap">
        {'Debug Console non implémentée pour le moment. Utilise les logs du Terminal pour diagnostiquer les problèmes.'}
      </div>
    );
  } else if (activeView === 'ports') {
    content = (
      <div className="flex-1 overflow-auto custom-scrollbar p-3 font-mono text-xs text-gray-200 whitespace-pre-wrap">
        {'Ports non gérés directement ici pour l’instant. Le serveur de dev utilise le port configuré dans les paramètres.'}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-black bg-opacity-30">
      <div className="flex items-center gap-4 border-b border-gray-800 px-3">
        {TOP_TABS.map((tab) => {
          const isActive = activeView === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveView(tab.id)}
              className={`px-2 py-1 text-xs font-mono border-b-2 ${
                isActive
                  ? 'border-yellow-400 text-yellow-300'
                  : 'border-transparent text-gray-300 hover:text-white hover:border-gray-500'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <div className="flex-1 flex flex-col">
        {content}
      </div>
    </div>
  );
};

export default TerminalPanel;
