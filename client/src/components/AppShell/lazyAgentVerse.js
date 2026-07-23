import React from 'react';

/**
 * Shared lazy-load handle for AgentVerse module.
 * Centralizes the React.lazy() call to avoid Phaser eager loading
 * which breaks tests due to jsdom canvas limitations.
 */
const LazyAgentVerse = React.lazy(() => import('../../agentverse/index'));

export default LazyAgentVerse;
