import React, { useEffect, useMemo, useState } from 'react';
import './AgentSwarmPanel.css';
import { IconAgents, IconX, IconCheck } from '../ComponentLibrary/icons';

/**
 * Formate une durée en ms façon "12s" / "1m 24s".
 * font-variant-numeric: tabular-nums côté CSS évite que les chiffres
 * ne "tremblent" en largeur à chaque tick du timer.
 */
const formatDuration = (ms) => {
  if (!ms || ms < 0) return '0s';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
};

const formatStartTime = (timestamp) => {
  if (!timestamp) return '';
  try {
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
};

/**
 * AgentSwarmPanel — Timeline verticale en direct des sous-agents IA
 * d'un run multi-agents (façon Claude Code / Codex "progress tracker").
 *
 * Ne fabrique jamais de fausse activité : si `multiAIState.steps` est vide
 * (mode mono-modèle), on affiche un état vide honnête plutôt qu'un faux run.
 */
const AgentSwarmPanel = ({ multiAIState, width, onClose }) => {
  const steps = Array.isArray(multiAIState?.steps) ? multiAIState.steps : [];
  const rawEvents = multiAIState?.events;
  const hasSteps = steps.length > 0;
  const isActive = Boolean(multiAIState?.isActive);
  const startedAt = multiAIState?.startedAt || null;
  const finishedAt = multiAIState?.finishedAt || null;

  // Timer réel : le setInterval ne tourne QUE pendant un run actif, il est
  // nettoyé dès que le run se termine (ou que le composant démonte) pour ne
  // jamais laisser un intervalle orphelin tourner en arrière-plan.
  const [now, setNow] = useState(() => Date.now());
  const [expandedDetailKey, setExpandedDetailKey] = useState(null);

  useEffect(() => {
    if (!isActive) return undefined;
    const intervalId = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(intervalId);
  }, [isActive]);

  const durationMs = useMemo(() => {
    if (!startedAt) return 0;
    const end = finishedAt || (isActive ? now : startedAt);
    return Math.max(0, end - startedAt);
  }, [startedAt, finishedAt, isActive, now]);

  const doneCount = steps.filter((s) => s.status === 'completed' || s.status === 'error').length;
  const hasError = Boolean(multiAIState?.error) || steps.some((s) => s.status === 'error');
  const progressPct = hasSteps ? Math.round((doneCount / steps.length) * 100) : 0;

  const badge = hasError
    ? { label: 'ERREUR', tone: 'danger' }
    : isActive
      ? { label: 'EN COURS', tone: 'accent' }
      : finishedAt
        ? { label: 'TERMINÉ', tone: 'success' }
        : null;

  // Le journal se lit du plus récent au plus ancien — on copie avant de
  // reverser pour ne jamais muter le tableau `events` reçu en prop. La
  // normalisation "tableau ou vide" vit ici pour que la dépendance du
  // useMemo (rawEvents) reste stable d'un render à l'autre.
  const events = useMemo(() => (Array.isArray(rawEvents) ? rawEvents : []), [rawEvents]);
  const reversedEvents = useMemo(() => [...events].reverse(), [events]);

  const eyebrow = multiAIState?.mode === 'ollama-multi' ? 'Swarm Ollama' : 'Équipe multi-agent';

  // Déterminer quel step doit montrer son détail
  const toggleDetail = (stepKey) => {
    setExpandedDetailKey(expandedDetailKey === stepKey ? null : stepKey);
  };

  return (
    <aside
      className="swarm-panel"
      style={{ width: `${width}px` }}
      role="complementary"
      aria-label="Suivi des agents IA"
    >
      <div className="swarm-header">
        <div className="swarm-header-text">
          <div className="swarm-eyebrow">{eyebrow}</div>
          <div className="swarm-run-label">{multiAIState?.runLabel || 'Run multi-agents'}</div>
        </div>
        <button
          type="button"
          className="swarm-close-btn focus-ring"
          onClick={onClose}
          title="Fermer le panneau"
          aria-label="Fermer le panneau des agents"
        >
          <IconX size={13} />
        </button>
      </div>

      {hasSteps && (
        <>
          <div className="swarm-status" aria-live="polite" aria-busy={isActive}>
            {badge && <span className={`swarm-badge swarm-badge-${badge.tone}`}>{badge.label}</span>}
            <div className="swarm-progress-track">
              <div
                className="swarm-progress-fill"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div className="swarm-meta">
              <span className="swarm-meta-item">{doneCount}/{steps.length} rôles</span>
              {multiAIState?.currentPhase && (
                <>
                  <span className="swarm-meta-sep" aria-hidden="true">·</span>
                  <span className="swarm-meta-item swarm-meta-phase">{multiAIState.currentPhase}</span>
                </>
              )}
              <span className="swarm-meta-sep" aria-hidden="true">·</span>
              <span className="swarm-meta-item swarm-meta-duration">{formatDuration(durationMs)}</span>
              {startedAt && (
                <>
                  <span className="swarm-meta-sep" aria-hidden="true">·</span>
                  <span className="swarm-meta-item swarm-meta-start">{formatStartTime(startedAt)}</span>
                </>
              )}
            </div>
          </div>

          <div className="swarm-body">
            <ol className="swarm-steps-list">
              {steps.map((step, index) => {
                const status = step.status || 'pending';
                const hasDetail = Boolean(step.detail);
                const canShowDetail = (status === 'active' || status === 'error') && hasDetail;
                const isDetailOpen = canShowDetail && expandedDetailKey === (step.key || index);
                const providerModel = [step.provider, step.model].filter(Boolean).join(' · ');
                const stepKey = step.key || index;

                return (
                  <li
                    key={stepKey}
                    className={`swarm-step swarm-step-${status}`}
                    style={{ '--i': index }}
                  >
                    {/* Row: pastille + label + meta */}
                    <div className="swarm-step-row">
                      {/* Pastille compacte 8px */}
                      <span className="swarm-step-marker" aria-hidden="true">
                        {status === 'active' && (
                          <svg className="swarm-spinner-small" viewBox="0 0 24 24" fill="none">
                            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="34 100" />
                          </svg>
                        )}
                        {status === 'completed' && <IconCheck size={5} />}
                        {status === 'error' && <IconX size={5} />}
                      </span>

                      {/* Label + chevron (si détail possible) */}
                      <div className="swarm-step-header">
                        {canShowDetail && (
                          <button
                            type="button"
                            className={`swarm-step-chevron ${isDetailOpen ? 'is-open' : ''}`}
                            onClick={() => toggleDetail(stepKey)}
                            aria-expanded={isDetailOpen}
                            title={isDetailOpen ? 'Masquer le détail' : 'Afficher le détail'}
                            aria-label={`Détails pour ${step.label}`}
                          >
                            ▸
                          </button>
                        )}
                        <div className={`swarm-step-label ${status === 'active' ? 'swarm-step-label-shimmer' : ''}`}>
                          {step.label}
                        </div>
                      </div>

                      {/* Meta (provider · model) très discret, aligné à droite */}
                      {providerModel && (
                        <div className="swarm-step-meta">{providerModel}</div>
                      )}
                    </div>

                    {/* Détail : se déplie seulement si ouvert */}
                    {canShowDetail && (
                      <div className={`swarm-step-detail-wrap ${isDetailOpen ? 'is-open' : ''}`}>
                        <div className="swarm-step-detail">{step.detail}</div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>

          {events.length > 0 && (
            <details className="swarm-journal">
              <summary className="swarm-journal-summary">Journal du run ({events.length})</summary>
              <div className="swarm-journal-content">
                <ul className="swarm-journal-list">
                  {reversedEvents.map((ev) => (
                    <li key={ev.id} className="swarm-journal-item">
                      <span className={`swarm-journal-dot swarm-journal-dot-${ev.status}`} aria-hidden="true" />
                      <div className="swarm-journal-text">
                        <span className="swarm-journal-label">{ev.label}</span>
                        {ev.detail && <span className="swarm-journal-detail">{ev.detail}</span>}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </details>
          )}
        </>
      )}

      {!hasSteps && (
        <div className="swarm-empty">
          <IconAgents size={44} className="swarm-empty-icon" />
          <div className="swarm-empty-title">Aucun run multi-agents en cours</div>
          <p className="swarm-empty-text">
            Basculez le provider sur « Multi-IA » pour voir apparaître ici, en direct, la progression de chaque sous-agent.
          </p>
        </div>
      )}
    </aside>
  );
};

export default AgentSwarmPanel;
