import React, { useState, useEffect, useRef } from 'react';
import './LoadingAnimations.css';
import './AgentProcess.css';
import {
  IconBot, IconBrain, IconCheck, IconFile, IconLightning
} from '../ComponentLibrary/icons';
import { OPAQUE_AI_LABEL, OPAQUE_WORKING_LABEL, opaqueStepLabel } from '../../utils/rendererOpacity';

// ─────────────────────────────────────────────────────────
// LoadingSteps
// ─────────────────────────────────────────────────────────
export const LoadingSteps = ({ steps, currentStep }) => {
  const normalizeStatus = (stepStatus) => {
    if (stepStatus === 'done' || stepStatus === 'completed') return 'completed';
    if (stepStatus === 'active' || stepStatus === 'error') return stepStatus;
    return null;
  };

  const getStepStatus = (stepIndex) => {
    if (stepIndex < currentStep) return 'completed';
    if (stepIndex === currentStep) return 'active';
    return 'pending';
  };

  return (
    <div className="loading-steps">
      {steps.map((step, index) => {
        const status = normalizeStatus(step?.status) || getStepStatus(index);
        return (
          <div key={index} className={`step step-${status}`}>
            <div className="step-indicator">
              {status === 'completed' ? (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              ) : status === 'error' ? (
                <span className="step-error-mark">!</span>
              ) : status === 'active' ? (
                <div className="step-spinner" />
              ) : (
                <span className="step-number">{index + 1}</span>
              )}
            </div>
            <div className="step-content">
              <span className="step-label">{opaqueStepLabel(index)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ─────────────────────────────────────────────────────────
// LoadingPulse (unchanged)
// ─────────────────────────────────────────────────────────
export const LoadingPulse = ({ text, variant = 'default' }) => {
  const variants = {
    default: 'from-cyan-500 to-blue-600',
    success: 'from-green-500 to-emerald-600',
    error: 'from-red-500 to-pink-600',
    warning: 'from-yellow-500 to-orange-600'
  };

  return (
    <div className={`loading-pulse ${variants[variant]}`}>
      <div className="pulse-ring" />
      <div className="pulse-ring pulse-ring-delayed" />
      <div className="pulse-center" />
      <span className="pulse-text">{text}</span>
    </div>
  );
};

// ─────────────────────────────────────────────────────────
// Renderer metadata : l'icone et la couleur restent animées, le routage reste
// volontairement opaque côté utilisateur.
// ─────────────────────────────────────────────────────────
const OPAQUE_META = { Icon: IconBot, label: OPAQUE_AI_LABEL, color: '#00f5d4' };

// Rolling phrases that rotate while the AI thinks
const THINKING_PHRASES = [
  'Analyse du contexte projet...',
  'Lecture des fichiers sources...',
  'Planification de la réponse...',
  'Génération du code...',
  'Vérification de la cohérence...',
  'Optimisation de la solution...',
  'Rédaction en cours...',
  'Traitement des données...',
];

// ─────────────────────────────────────────────────────────
// AgentProcessPanel — Antigravity-style working indicator
// ─────────────────────────────────────────────────────────
export const AIWorkingIndicator = ({
  statusText = "L'IA réfléchit...",
  steps = [],
  currentStepIndex = 0,
  streamingAgent = '',
  tokenCount = 0,
}) => {
  const [elapsed, setElapsed] = useState(0);
  const [phraseIdx, setPhraseIdx] = useState(0);
  const [logs, setLogs] = useState([]);
  const startRef = useRef(Date.now());
  const logsEndRef = useRef(null);

  // Elapsed timer
  useEffect(() => {
    startRef.current = Date.now();
    setElapsed(0);
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // Rolling phrase
  useEffect(() => {
    const id = setInterval(() => {
      setPhraseIdx(i => (i + 1) % THINKING_PHRASES.length);
    }, 2800);
    return () => clearInterval(id);
  }, []);

  // Build a live log entry whenever statusText changes
  useEffect(() => {
    if (!statusText) return;
    const ts = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setLogs(prev => {
      const last = prev[prev.length - 1];
      if (last && last.text === OPAQUE_WORKING_LABEL) return prev; // deduplicate
      return [...prev.slice(-14), { ts, text: OPAQUE_WORKING_LABEL, id: Date.now() }];
    });
  }, [statusText]);

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const meta = OPAQUE_META;

  const formatTime = (s) => {
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m${s % 60}s`;
  };

  // Derive active steps
  const hasSteps = Array.isArray(steps) && steps.length > 0;

  return (
    <div className="ap-panel">
      {/* ── Top bar ── */}
      <div className="ap-topbar">
        <div className="ap-topbar-left">
          <div className="ap-brain-wrap">
            <span className="ap-brain"><IconBrain size={16} /></span>
            <span className="ap-brain-ring" />
          </div>
          <div className="ap-info">
            <div className="ap-status-line">
              <span className="ap-status-dot" />
              <span className="ap-status-text">
                {streamingAgent ? OPAQUE_WORKING_LABEL : THINKING_PHRASES[phraseIdx]}
              </span>
            </div>
            <div className="ap-meta-row">
              <span className="ap-provider-chip" style={{ '--provider-color': meta.color }}>
                <meta.Icon size={11} /> {meta.label}
              </span>
              <span className="ap-timer">{formatTime(elapsed)}</span>
              {tokenCount > 0 && (
                <span className="ap-tokens">~{tokenCount.toLocaleString('fr-FR')} tokens</span>
              )}
            </div>
          </div>
        </div>

        {/* Animated dots */}
        <div className="ap-dots">
          <span className="ap-dot" />
          <span className="ap-dot" />
          <span className="ap-dot" />
        </div>
      </div>

      {/* ── Step pipeline (when multi-agent) ── */}
      {hasSteps && (
        <div className="ap-pipeline">
          {steps.map((step, i) => {
            const isDone = step.status === 'completed' || i < currentStepIndex;
            const isActive = step.status === 'active' || i === currentStepIndex;
            return (
              <React.Fragment key={i}>
                <div className={`ap-step ${isDone ? 'is-done' : isActive ? 'is-active' : 'is-pending'}`}>
                  <div className="ap-step-icon">
                    {isDone ? (
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    ) : isActive ? (
                      <span className="ap-step-spinner" />
                    ) : (
                      <span className="ap-step-num">{i + 1}</span>
                    )}
                  </div>
                  <span className="ap-step-label">{opaqueStepLabel(i)}</span>
                </div>
                {i < steps.length - 1 && (
                  <div className={`ap-connector ${isDone ? 'is-done' : ''}`} />
                )}
              </React.Fragment>
            );
          })}
        </div>
      )}

      {/* ── Live log ── */}
      <div className="ap-log">
        {logs.map((entry) => (
          <div key={entry.id} className="ap-log-line">
            <span className="ap-log-ts">{entry.ts}</span>
            <span className="ap-log-text">{entry.text}</span>
          </div>
        ))}
        <div ref={logsEndRef} />
      </div>

      {/* ── Progress bar ── */}
      <div className="ap-progress">
        <div className="ap-progress-fill" />
      </div>
    </div>
  );
};


// ─────────────────────────────────────────────────────────
// SuccessAnimation
// ─────────────────────────────────────────────────────────
export const SuccessAnimation = ({ message, onComplete }) => {
  React.useEffect(() => {
    const timer = setTimeout(onComplete, 2000);
    return () => clearTimeout(timer);
  }, [onComplete]);

  return (
    <div className="success-animation">
      <div className="success-checkmark">
        <svg className="checkmark" viewBox="0 0 52 52">
          <circle className="checkmark-circle" cx="26" cy="26" r="25" fill="none" />
          <path className="checkmark-check" fill="none" d="M14.1 27.2l7.1 7.2 16.7-16.8" />
        </svg>
      </div>
      <p className="success-message">{message}</p>
    </div>
  );
};

// ─────────────────────────────────────────────────────────
// ErrorAnimation
// ─────────────────────────────────────────────────────────
export const ErrorAnimation = ({ message, onRetry, onDismiss }) => {
  return (
    <div className="error-animation">
      <div className="error-icon">
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>
      <p className="error-message">{message}</p>
      <div className="error-actions">
        {onRetry && (
          <button type="button" onClick={onRetry} className="error-btn retry">
            Réessayer
          </button>
        )}
        {onDismiss && (
          <button type="button" onClick={onDismiss} className="error-btn dismiss">
            Fermer
          </button>
        )}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────
// VotingAnimation
// ─────────────────────────────────────────────────────────
export const VotingAnimation = ({ votes, total }) => {
  return (
    <div className="voting-animation">
      <div className="voting-header">
        <span className="voting-title">Vote en cours...</span>
        <span className="voting-progress">{votes}/{total}</span>
      </div>
      <div className="voting-bars">
        {Array.from({ length: total }).map((_, i) => (
          <div
            key={i}
            className={`voting-bar ${i < votes ? 'voted' : ''}`}
            style={{ animationDelay: `${i * 0.1}s` }}
          />
        ))}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────
// LiveFilesPanel — montre les fichiers édités + commandes en direct (style Claude Code)
// ─────────────────────────────────────────────────────────
export const LiveFilesPanel = ({ files = [], commands = [] }) => {
  const hasFiles = Array.isArray(files) && files.length > 0;
  const hasCommands = Array.isArray(commands) && commands.length > 0;
  if (!hasFiles && !hasCommands) return null;

  return (
    <div className="apf-panel">
      {hasFiles && (
        <div className="apf-group">
          <div className="apf-group-title"><IconFile size={11} /> Fichiers</div>
          {files.map((f, i) => (
            <div key={`${f.path}-${i}`} className={`apf-row ${f.status === 'writing' ? 'is-writing' : 'is-done'}`}>
              <span className="apf-icon">
                {f.status === 'writing' ? <span className="apf-spinner" /> : <IconCheck size={10} />}
              </span>
              <span className="apf-path" title={f.path}>{f.path}</span>
              <span className="apf-status">{f.status === 'writing' ? 'écriture…' : 'écrit'}</span>
            </div>
          ))}
        </div>
      )}
      {hasCommands && (
        <div className="apf-group">
          <div className="apf-group-title"><IconLightning size={11} /> Commandes</div>
          {commands.map((c, i) => (
            <div key={`cmd-${i}`} className={`apf-row ${c.type === 'done' ? 'is-done' : 'is-writing'}`}>
              <span className="apf-icon">
                {c.type === 'done' ? <IconCheck size={10} /> : <span className="apf-spinner" />}
              </span>
              <span className="apf-path apf-cmd" title={c.command}>{c.command}</span>
              {c.iteration ? <span className="apf-status">#{c.iteration}</span> : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default {
  LoadingSteps,
  LoadingPulse,
  AIWorkingIndicator,
  LiveFilesPanel,
  SuccessAnimation,
  ErrorAnimation,
  VotingAnimation
};
