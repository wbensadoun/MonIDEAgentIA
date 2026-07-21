import React from 'react';

// Presentational badge for the Intelligent Router — shows what the router
// decided for the last / current request (mode, agent, skills, model tier)
// right under the prompt composer. Renders nothing when there is no decision
// yet (manual mode, or auto mode before the first request).

const MODE_LABELS = {
  single_agent: 'Simple',
  orchestrator: 'Orchestrateur',
  multi_agent: 'Multi-agents'
};

const AIDecisionBadge = ({ decision }) => {
  if (!decision) return null;

  const modeLabel = MODE_LABELS[decision.mode] || 'Simple';
  const agentLabel = decision.agent ? String(decision.agent) : 'Aucun';
  const skillsLabel = Array.isArray(decision.skills) && decision.skills.length > 0
    ? decision.skills.join(', ')
    : 'Aucun';
  const complexityLabel = decision.complexity === 'premium' ? 'Premium' : 'Léger';
  const source = decision.source || 'inconnu';

  return (
    <div className="ai-decision-badge" role="status">
      <span className="ai-decision-part">🤖 Mode : <strong>{modeLabel}</strong></span>
      <span className="ai-decision-sep">|</span>
      <span className="ai-decision-part">👤 Agent : <strong>{agentLabel}</strong></span>
      <span className="ai-decision-sep">|</span>
      <span className="ai-decision-part">🛠️ Skills : <strong>{skillsLabel}</strong></span>
      <span className="ai-decision-sep">|</span>
      <span className="ai-decision-part">⚡ Modèle : <strong>{complexityLabel}</strong> ({source})</span>
    </div>
  );
};

export default AIDecisionBadge;
