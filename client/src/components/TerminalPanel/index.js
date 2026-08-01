import React, { useEffect, useState, useCallback } from 'react';
import InteractiveTerminal from './InteractiveTerminal';
import './TerminalPanel.css';

const TOP_TABS = [
  { id: 'problems', label: 'Problems' },
  { id: 'output', label: 'Output' },
  { id: 'debug', label: 'Debug Console' },
  { id: 'terminal', label: 'Terminal' },
  // Onglet distinct de "Terminal" (qui reste le lanceur de taches Dev/Test/
  // Build a boutons) : un vrai shell interactif backe par node-pty, ou
  // l'utilisateur tape librement. Volontairement separe pour ne rien changer
  // au comportement existant du lanceur de taches.
  { id: 'shell', label: 'Shell' },
  { id: 'ai', label: 'AI Terminal' },
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

const TerminalPanel = ({
  currentProjectPath,
  isElectronApiAvailable,
  showMessage,
  permissionMode = 'edit_terminal',
  preferredDevPort = '3004',
  onDevPortResolved,
  headerRightControls
}) => {
  const [logs, setLogs] = useState({});
  const [running, setRunning] = useState({});
  const [portsByProcess, setPortsByProcess] = useState({});
  const [activeProcessId, setActiveProcessId] = useState('dev');
  const [activeView, setActiveView] = useState('terminal');
  const canUseTerminal = permissionMode === 'edit_terminal';

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
      setPortsByProcess((prev) => {
        if (!Object.prototype.hasOwnProperty.call(prev, data.id)) return prev;
        const next = { ...prev };
        delete next[data.id];
        return next;
      });
      if (data.id === 'dev' && typeof onDevPortResolved === 'function') {
        onDevPortResolved(null);
      }
      appendLog(data.id, 'stdout', `\n[process exited with code ${data.code}]\n`);
    };

    const handleAiTerminalAction = (data) => {
      if (!data) return;
      const { command, iteration } = data;
      appendLog('ai', 'stdout', `\n[🤖 IA Iteration ${iteration}] Exécution de la commande :\n> ${command}\n\n`);
      // Scroll to bottom manually if needed or let React handle it
    };

    const handleAiTerminalResult = (data) => {
      if (!data) return;
      const { output, iteration } = data;
      appendLog('ai', 'stdout', `[🤖 IA Résultat de la commande Iteration ${iteration}]:\n${output}\n`);
    };

    const offOutput = window.electronAPI.onProcessOutput(handleOutput);
    const offExit = window.electronAPI.onProcessExit(handleExit);

    let offAiAction = null;
    let offAiResult = null;
    if (window.electronAPI.onAITerminalAction) {
      offAiAction = window.electronAPI.onAITerminalAction(handleAiTerminalAction);
    }
    if (window.electronAPI.onAITerminalResult) {
      offAiResult = window.electronAPI.onAITerminalResult(handleAiTerminalResult);
    }
    return () => {
      if (typeof offOutput === 'function') offOutput();
      if (typeof offExit === 'function') offExit();
      if (typeof offAiAction === 'function') offAiAction();
      if (typeof offAiResult === 'function') offAiResult();
    };
  }, [isElectronApiAvailable, appendLog, onDevPortResolved]);

  const start = async (proc) => {
    if (!canUseTerminal) {
      showMessage('Mode permissions: terminal desactive.', 3000);
      return;
    }

    if (!isElectronApiAvailable || !window.electronAPI) {
      showMessage('Electron non disponible', 3000);
      return;
    }
    if (!currentProjectPath) {
      showMessage('Ouvre un dossier de projet avant de lancer une commande.', 4000);
      return;
    }

    const isDevProcess = proc.id === 'dev';
    const parsedPreferredPort = Number.parseInt(String(preferredDevPort || ''), 10);
    const preferredPort = Number.isInteger(parsedPreferredPort) && parsedPreferredPort > 0
      ? parsedPreferredPort
      : 3004;

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
      if (isDevProcess) {
        payload.autoSelectPort = true;
        payload.preferredPort = preferredPort;
        payload.portEnvVars = ['PORT', 'VITE_PORT', 'NUXT_PORT', 'WEB_PORT'];
      }
      const res = await window.electronAPI.startProcess(payload);
      if (!res || !res.success) {
        setRunning(prev => ({ ...prev, [proc.id]: false }));
        showMessage(res && res.error ? res.error : 'Erreur lancement processus', 4000);
        return;
      }
      if (isDevProcess) {
        const runtimePort = Number.parseInt(String(res.allocatedPort || ''), 10);
        if (Number.isInteger(runtimePort) && runtimePort > 0) {
          setPortsByProcess((prev) => ({ ...prev, [proc.id]: runtimePort }));
          appendLog(proc.id, 'stdout', `[dev server port: ${runtimePort}]\n`);
          if (typeof onDevPortResolved === 'function') {
            onDevPortResolved(String(runtimePort));
          }
        }
      }
    } catch (error) {
      setRunning(prev => ({ ...prev, [proc.id]: false }));
      showMessage(error.message || 'Erreur lancement processus', 4000);
    }
  };

  const stop = async (id) => {
    if (!canUseTerminal) return;
    if (!isElectronApiAvailable || !window.electronAPI) return;
    try {
      await window.electronAPI.stopProcess(id);
      setRunning(prev => ({ ...prev, [id]: false }));
      setPortsByProcess((prev) => {
        if (!Object.prototype.hasOwnProperty.call(prev, id)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
      if (id === 'dev' && typeof onDevPortResolved === 'function') {
        onDevPortResolved(null);
      }
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
  const activeDevPort = portsByProcess.dev
    ? String(portsByProcess.dev)
    : String(preferredDevPort || '3004');

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
                  disabled={!canUseTerminal}
                >
                  {isRunning ? 'Stop' : 'Start'}
                </button>
              </div>
            );
          })}
        </div>
        {!canUseTerminal && (
          <div className="terminal-log" style={{ marginBottom: '8px' }}>
            Terminal bloque par le mode permissions actuel.
          </div>
        )}
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
  } else if (activeView === 'shell') {
    // Montee/demontee seulement quand l'onglet est actif : chaque montage
    // ouvre une nouvelle session pty (cf. InteractiveTerminal), donc on ne
    // veut pas la garder en vie hors ecran ni en recreer une a chaque re-rendu
    // du panneau.
    content = (
      <InteractiveTerminal
        currentProjectPath={currentProjectPath}
        isElectronApiAvailable={isElectronApiAvailable}
        canUseTerminal={canUseTerminal}
      />
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
  } else if (activeView === 'ai') {
    const aiLog = logs.ai || '';
    content = (
      <div className="terminal-log terminal-log__ai custom-scrollbar">
        {aiLog || "L'IA n'a pas encore exécuté de commande dans le terminal.\n(Note: La création de fichiers se fait silencieusement et directement via le système de fichiers pour plus de rapidité, pas avec des commandes du terminal !)"}
      </div>
    );
  } else if (activeView === 'ports') {
    content = (
      <div className="terminal-log custom-scrollbar">
        {`Dev server: ${activeDevPort}${running.dev ? ' (running)' : ' (stopped)'}`}
      </div>
    );
  }

  return (
    <div className="terminal-panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="bottom-terminal-header">
        <div className="bottom-terminal-header-left">
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px', marginRight: 12 }}>Terminal</span>
          {TOP_TABS.map((tab) => {
            const isActive = activeView === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveView(tab.id)}
                className={`bottom-terminal-title-btn ${isActive ? 'is-active' : ''}`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
        {headerRightControls}
      </div>
      <div className="bottom-terminal-content">
        {content}
      </div>
    </div>
  );
};

export default TerminalPanel;
