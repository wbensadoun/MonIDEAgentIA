import { useEffect, useMemo, useState } from 'react';

// Mirrors DEFAULT_APP_SETTINGS.routerComplexityThreshold in
// electron/services/settings.service.js (0-1 scale, clamped there via
// Math.min(1, Math.max(0, ...))). Keep these two defaults in sync.
const DEFAULT_ROUTER_COMPLEXITY_THRESHOLD = 0.5;

const readLocalStorageBoolean = (key, fallback) => {
  try {
    const stored = localStorage.getItem(key);
    if (stored === null) return fallback;
    return stored === '1';
  } catch {
    return fallback;
  }
};

const readLocalStorageString = (key) => {
  try {
    const stored = localStorage.getItem(key);
    return stored && stored.trim() ? stored : null;
  } catch {
    return null;
  }
};

const readLocalStorageNumber = (key, fallback) => {
  try {
    const stored = localStorage.getItem(key);
    const parsed = stored === null ? NaN : Number(stored);
    return Number.isFinite(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
};

const useRunConfiguration = () => {
  const [executionMode, setExecutionMode] = useState('agent');
  const [multiAgentFormationKey, setMultiAgentFormationKey] = useState('product-ui');
  const [disabledAgentKeys, setDisabledAgentKeys] = useState([]);
  const [collectiveDepth, setCollectiveDepth] = useState('deep');
  // Intelligent Router: on by default (product spec). `routerDecision` is the
  // last decision the router produced, rendered by AIDecisionBadge.
  const [autoRoute, setAutoRoute] = useState(() => readLocalStorageBoolean('router.autoRoute', true));
  const [routerDecision, setRouterDecision] = useState(null);
  // Provider/model override for the L2 classification call (electron/services/
  // router.service.js). null/unset means the backend falls back to its current
  // hardcoded default (the active chat provider).
  const [routerClassifierProvider, setRouterClassifierProvider] = useState(
    () => readLocalStorageString('router.classifierProvider')
  );
  const [routerClassifierModel, setRouterClassifierModel] = useState(
    () => readLocalStorageString('router.classifierModel')
  );
  // Numeric slider value for the L1 (trivial/local heuristic) -> L2 (LLM
  // classification) boundary, configured from the "Routeur Intelligent" tab.
  const [routerComplexityThreshold, setRouterComplexityThreshold] = useState(
    () => readLocalStorageNumber('router.complexityThreshold', DEFAULT_ROUTER_COMPLEXITY_THRESHOLD)
  );

  useEffect(() => {
    try {
      localStorage.setItem('router.autoRoute', autoRoute ? '1' : '0');
    } catch {
      // ignore
    }
  }, [autoRoute]);

  useEffect(() => {
    try {
      if (routerClassifierProvider) {
        localStorage.setItem('router.classifierProvider', routerClassifierProvider);
      } else {
        localStorage.removeItem('router.classifierProvider');
      }
    } catch {
      // ignore
    }
  }, [routerClassifierProvider]);

  useEffect(() => {
    try {
      if (routerClassifierModel) {
        localStorage.setItem('router.classifierModel', routerClassifierModel);
      } else {
        localStorage.removeItem('router.classifierModel');
      }
    } catch {
      // ignore
    }
  }, [routerClassifierModel]);

  useEffect(() => {
    try {
      localStorage.setItem('router.complexityThreshold', String(routerComplexityThreshold));
    } catch {
      // ignore
    }
  }, [routerComplexityThreshold]);

  const multiAgentRunOptions = useMemo(() => ({
    formationKey: multiAgentFormationKey,
    disabledAgentKeys,
    depth: collectiveDepth
  }), [disabledAgentKeys, multiAgentFormationKey, collectiveDepth]);

  return {
    executionMode,
    setExecutionMode,
    multiAgentFormationKey,
    setMultiAgentFormationKey,
    disabledAgentKeys,
    setDisabledAgentKeys,
    collectiveDepth,
    setCollectiveDepth,
    autoRoute,
    setAutoRoute,
    routerDecision,
    setRouterDecision,
    routerClassifierProvider,
    setRouterClassifierProvider,
    routerClassifierModel,
    setRouterClassifierModel,
    routerComplexityThreshold,
    setRouterComplexityThreshold,
    multiAgentRunOptions
  };
};

export default useRunConfiguration;
