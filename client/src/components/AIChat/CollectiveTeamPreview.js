import React from 'react';

const STAGE_ORDER = ['selection', 'analysis', 'planning', 'implementation', 'validation'];

const STAGE_ICON = {
  selection: '🎯',
  analysis: '🔍',
  planning: '📋',
  implementation: '💻',
  validation: '✅'
};

const PROVIDER_COLOR = {
  gemini: '#4285f4',
  claude: '#fb923c',
  kimi: '#a78bfa',
  ollama: '#f59e0b'
};

const AgentChip = ({ agent }) => (
  <div className="ctp-agent-chip">
    <span
      className="ctp-agent-dot"
      style={{ background: PROVIDER_COLOR[agent.provider] || '#00f5d4' }}
    />
    <span className="ctp-agent-name">{agent.title}</span>
    <span className="ctp-agent-provider">{agent.provider}</span>
  </div>
);

const ExcludedChip = ({ agent }) => (
  <div className="ctp-excluded-chip" title={agent.reason}>
    <span className="ctp-excluded-name">{agent.title || agent.key}</span>
  </div>
);

/**
 * CollectiveTeamPreview
 * Affiche le plan d'équipe calculé par buildTeamPlan + applyCollectiveDepth.
 *
 * Props:
 *   teamPlan  : objet retourné par applyCollectiveDepth(buildTeamPlan(...))
 */
const CollectiveTeamPreview = ({ teamPlan }) => {
  if (!teamPlan) return null;

  const { selectedAgents = [], excludedAgents = [], budget, formationLabel, formationFocus } = teamPlan;

  // Grouper les agents sélectionnés par stage
  const byStage = STAGE_ORDER.reduce((acc, stage) => {
    const agents = selectedAgents.filter((a) => a.stage === stage);
    if (agents.length > 0) acc.push({ stage, agents });
    return acc;
  }, []);

  const localCount = selectedAgents.filter((a) => a.provider === 'ollama').length;
  const cloudCount = selectedAgents.length - localCount;

  return (
    <div className="ctp-panel">
      {/* Header */}
      <div className="ctp-header">
        <span className="ctp-formation">{formationLabel}</span>
        <span className="ctp-focus">{formationFocus}</span>
      </div>

      {/* Agents par phase */}
      <div className="ctp-stages">
        {byStage.map(({ stage, agents }) => (
          <div key={stage} className="ctp-stage">
            <span className="ctp-stage-label">
              {STAGE_ICON[stage] || '•'} {stage}
            </span>
            <div className="ctp-stage-agents">
              {agents.map((a) => <AgentChip key={a.key} agent={a} />)}
            </div>
          </div>
        ))}
      </div>

      {/* Budget */}
      <div className="ctp-budget">
        <span className="ctp-budget-item">
          <span className="ctp-budget-val">{selectedAgents.length}</span> agents
        </span>
        <span className="ctp-budget-sep">·</span>
        <span className="ctp-budget-item">
          {cloudCount > 0 && <span className="ctp-cloud">{cloudCount} cloud</span>}
          {cloudCount > 0 && localCount > 0 && ' + '}
          {localCount > 0 && <span className="ctp-local">{localCount} local</span>}
        </span>
        {budget?.maxTokens && (
          <>
            <span className="ctp-budget-sep">·</span>
            <span className="ctp-budget-item">
              max <span className="ctp-budget-val">{budget.maxTokens.toLocaleString('fr-FR')}</span> tokens
            </span>
          </>
        )}
      </div>

      {/* Agents exclus */}
      {excludedAgents.length > 0 && (
        <div className="ctp-excluded">
          <span className="ctp-excluded-label">Écarté :</span>
          {excludedAgents.map((a) => <ExcludedChip key={a.key} agent={a} />)}
        </div>
      )}
    </div>
  );
};

export default CollectiveTeamPreview;
