import { useMemo, useState } from 'react';

const useRunConfiguration = () => {
  const [executionMode, setExecutionMode] = useState('agent');
  const [runPreset, setRunPreset] = useState('default');
  const [multiAgentFormationKey, setMultiAgentFormationKey] = useState('product-ui');
  const [disabledAgentKeys, setDisabledAgentKeys] = useState([]);
  const [collectiveDepth, setCollectiveDepth] = useState('deep');
  const [localPrivate, setLocalPrivate] = useState(false);

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
    multiAgentRunOptions
  };
};

export default useRunConfiguration;
