import { useMemo, useState } from 'react';

const useRunConfiguration = () => {
  const [executionMode, setExecutionMode] = useState('agent');
  const [runPreset, setRunPreset] = useState('default');
  const [multiAgentFormationKey, setMultiAgentFormationKey] = useState('product-ui');
  const [disabledAgentKeys, setDisabledAgentKeys] = useState([]);
  const [collectiveDepth, setCollectiveDepth] = useState('deep');
  const [localPrivate, setLocalPrivate] = useState(false);
  // Intelligent Router: on by default (product spec). `routerDecision` is the
  // last decision the router produced, rendered by AIDecisionBadge.
  const [autoRoute, setAutoRoute] = useState(true);
  const [routerDecision, setRouterDecision] = useState(null);

  const multiAgentRunOptions = useMemo(() => ({
    formationKey: multiAgentFormationKey,
    disabledAgentKeys,
    depth: collectiveDepth,
    localPrivate
  }), [disabledAgentKeys, multiAgentFormationKey, collectiveDepth, localPrivate]);

  return {
    executionMode,
    setExecutionMode,
    runPreset,
    setRunPreset,
    multiAgentFormationKey,
    setMultiAgentFormationKey,
    disabledAgentKeys,
    setDisabledAgentKeys,
    collectiveDepth,
    setCollectiveDepth,
    localPrivate,
    setLocalPrivate,
    autoRoute,
    setAutoRoute,
    routerDecision,
    setRouterDecision,
    multiAgentRunOptions
  };
};

export default useRunConfiguration;
