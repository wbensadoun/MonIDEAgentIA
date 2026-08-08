import React from 'react';

// The router is intentionally opaque in the normal Neven experience. This
// status confirms that automatic routing is active without exposing a model,
// provider, tier, source, or internal agent name.
const AIDecisionBadge = ({ decision }) => {
  if (!decision) return null;

  return (
    <div className="ai-decision-badge" role="status" aria-live="polite">
      <span className="ai-decision-part">Neven adapte automatiquement le traitement</span>
    </div>
  );
};

export default AIDecisionBadge;
