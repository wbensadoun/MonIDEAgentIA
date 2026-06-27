import { useMemo, useState } from 'react';

const useRunConfiguration = () => {
  const [executionMode, setExecutionMode] = useState('agent');
  const [runPreset, setRunPreset] = useState('default');
  const [multiAgentFormationKey, setMultiAgentFormationKey] = useState('product-ui');
  const [disabledAgentKeys, setDisabledAgentKeys] = useState([]);

  const multiAgentRunOptions = useMemo(() => ({
    formationKey: multiAgentFormationKey,
    disabledAgentKeys
  }), [disabledAgentKeys, multiAgentFormationKey]);

  return {
    executionMode,
    setExecutionMode,
    runPreset,
    setRunPreset,
    multiAgentFormationKey,
    setMultiAgentFormationKey,
    disabledAgentKeys,
    setDisabledAgentKeys,
    multiAgentRunOptions
  };
};

export default useRunConfiguration;
