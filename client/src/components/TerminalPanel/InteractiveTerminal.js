import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import './InteractiveTerminal.css';

// Lit les tokens de couleur actuels (clair/sombre) pour que le thème xterm
// suive celui de l'app au lieu d'un jeu de couleurs fige — xterm.js veut des
// couleurs concretes en JS, pas des var(--x) CSS, donc on les resout ici.
const readTerminalTheme = () => {
  const styles = getComputedStyle(document.documentElement);
  const read = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
  return {
    background: read('--bg', '#101113'),
    foreground: read('--text-main', '#eceef1'),
    cursor: read('--accent', '#3b9eff'),
    selectionBackground: read('--accent-soft', 'rgba(59,158,255,0.25)'),
    black: '#1d1f23',
    brightBlack: '#5c6370',
  };
};

// Un id de session stable par montage de composant, pas par projet : deux
// onglets/panneaux de terminal ne doivent jamais partager une session pty.
let sessionCounter = 0;
const nextSessionId = () => `shell-${Date.now()}-${(sessionCounter += 1)}`;

const InteractiveTerminal = ({ currentProjectPath, isElectronApiAvailable, canUseTerminal }) => {
  const containerRef = useRef(null);
  const termRef = useRef(null);
  const fitAddonRef = useRef(null);
  const sessionIdRef = useRef(null);
  const [status, setStatus] = useState('idle'); // idle | starting | running | exited | unavailable | blocked

  useEffect(() => {
    if (!isElectronApiAvailable || !window.electronAPI?.createPty) {
      setStatus('unavailable');
      return undefined;
    }
    if (!canUseTerminal) {
      setStatus('blocked');
      return undefined;
    }
    if (!containerRef.current) return undefined;

    let disposed = false;
    const sessionId = nextSessionId();
    sessionIdRef.current = sessionId;

    const term = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'var(--font-mono, Consolas, monospace)',
      theme: readTerminalTheme(),
      scrollback: 5000,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();
    termRef.current = term;
    fitAddonRef.current = fitAddon;

    setStatus('starting');

    const start = async () => {
      const dims = fitAddon.proposeDimensions();
      const res = await window.electronAPI.createPty({
        id: sessionId,
        projectPath: currentProjectPath || null,
        cols: dims?.cols,
        rows: dims?.rows,
      });
      if (disposed) return;
      if (!res?.success) {
        term.writeln(`\r\n\x1b[31m${res?.error || 'Impossible de demarrer le terminal.'}\x1b[0m`);
        setStatus('unavailable');
        return;
      }
      setStatus('running');
    };
    start();

    const offData = window.electronAPI.onPtyData(({ id, chunk }) => {
      if (id === sessionId && termRef.current) termRef.current.write(chunk);
    });
    const offExit = window.electronAPI.onPtyExit(({ id }) => {
      if (id !== sessionId) return;
      setStatus('exited');
      if (termRef.current) termRef.current.writeln('\r\n\x1b[2m[session terminee]\x1b[0m');
    });

    const onInputDisposable = term.onData((data) => {
      window.electronAPI.writePty(sessionId, data);
    });

    const resizeObserver = new ResizeObserver(() => {
      if (!fitAddonRef.current) return;
      fitAddonRef.current.fit();
      const dims = fitAddonRef.current.proposeDimensions();
      if (dims?.cols && dims?.rows) {
        window.electronAPI.resizePty(sessionId, dims.cols, dims.rows);
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      disposed = true;
      resizeObserver.disconnect();
      onInputDisposable.dispose();
      if (typeof offData === 'function') offData();
      if (typeof offExit === 'function') offExit();
      window.electronAPI.killPty(sessionId);
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
    // currentProjectPath volontairement absent des deps : changer de projet ne
    // doit pas tuer une session shell en cours, seule une nouvelle ouverture
    // de panneau en tient compte (cf. commentaire sur sessionCounter).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isElectronApiAvailable, canUseTerminal]);

  return (
    <div className="pty-terminal">
      {status === 'unavailable' && (
        <div className="pty-terminal-banner">
          Terminal interactif indisponible sur cette installation (module natif
          non charge). Les commandes lancees par l&apos;IA restent visibles dans
          l&apos;onglet &quot;AI Terminal&quot;.
        </div>
      )}
      {status === 'blocked' && (
        <div className="pty-terminal-banner">
          Terminal desactive par le mode permissions actuel.
        </div>
      )}
      <div ref={containerRef} className="pty-terminal-surface" />
    </div>
  );
};

export default InteractiveTerminal;
