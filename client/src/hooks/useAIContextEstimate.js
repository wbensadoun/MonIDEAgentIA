import { useCallback, useState } from 'react';

const createDefaultContextEstimate = (provider) => ({
  provider,
  promptChars: 0,
  contextChars: 0,
  estimatedTokens: 0,
  estimatedCostUsd: 0
});

const estimateRequestCost = (providerName, estimatedTokens) => {
  const provider = String(providerName || 'gemini');
  const inputRatePerMTokens = (() => {
    if (provider === 'claude') return 3.0;
    if (provider === 'kimi') return 0.6;
    if (provider === 'multi') return 1.6;
    if (provider === 'ollama') return 0;
    return 1.25;
  })();
  return (Math.max(0, Number(estimatedTokens) || 0) / 1000000) * inputRatePerMTokens;
};

const computeContextChars = (projectContextPayload) => {
  if (!projectContextPayload || typeof projectContextPayload !== 'object') return 0;
  const files = projectContextPayload.files;
  if (!files || typeof files !== 'object') return 0;

  let total = 0;
  for (const [filePath, entry] of Object.entries(files)) {
    total += String(filePath || '').length;
    if (entry && typeof entry.content === 'string') {
      total += entry.content.length;
    }
  }
  return total;
};

const useAIContextEstimate = (initialProvider = 'gemini') => {
  const [contextEstimate, setContextEstimate] = useState(() => (
    createDefaultContextEstimate(initialProvider)
  ));

  const updateContextEstimate = useCallback((providerName, promptText, projectContextPayload) => {
    const promptChars = String(promptText || '').length;
    const contextChars = computeContextChars(projectContextPayload);
    const estimatedTokens = Math.ceil((promptChars + contextChars) / 4);
    const estimatedCostUsd = estimateRequestCost(providerName, estimatedTokens);

    setContextEstimate({
      provider: providerName,
      promptChars,
      contextChars,
      estimatedTokens,
      estimatedCostUsd: Number(estimatedCostUsd.toFixed(4))
    });
  }, []);

  const resetContextEstimate = useCallback((providerName = initialProvider) => {
    setContextEstimate(createDefaultContextEstimate(providerName));
  }, [initialProvider]);

  return {
    contextEstimate,
    updateContextEstimate,
    resetContextEstimate
  };
};

export default useAIContextEstimate;
