import { useEffect, useState } from 'react';
import { normalizeMultiAgentRoles } from '../utils/multiAgentConfig';

const buildApiKeysFromSettings = (settings = {}) => ({
  gemini: settings.geminiApiKey || '',
  kimi: settings.kimiApiKey || '',
  claude: settings.claudeApiKey || '',
  geminiModel: settings.geminiModel || '',
  claudeModel: settings.claudeModel || '',
  kimiModel: settings.kimiModel || '',
  ollamaModel: settings.ollamaModel || '',
  multiAgentRoles: normalizeMultiAgentRoles(settings.multiAgentRoles),
  localAI: {
    optimizationMode: settings.localAIOptimizationMode || 'safe',
    hardwareConsent: !!settings.localAIHardwareConsent,
    maxConcurrentLocal: Number(settings.localAIMaxConcurrentLocal || 1),
    maxConcurrentCloud: Number(settings.localAIMaxConcurrentCloud || 3),
    contextBudget: settings.localAIContextBudget || 'short',
    maxTokens: Number(settings.localAIMaxTokens || 4096)
  }
});

export const useAISettingsSync = (isElectronApiAvailable) => {
  const [apiKeys, setApiKeys] = useState({
    gemini: '',
    kimi: '',
    claude: '',
    geminiModel: '',
    claudeModel: '',
    kimiModel: '',
    ollamaModel: '',
    multiAgentRoles: normalizeMultiAgentRoles(),
    localAI: {
      optimizationMode: 'safe',
      hardwareConsent: false,
      maxConcurrentLocal: 1,
      maxConcurrentCloud: 3,
      contextBudget: 'short',
      maxTokens: 4096
    }
  });
  const [projectScanPreset, setProjectScanPreset] = useState('safe');
  const [projectScanIncludeSecrets, setProjectScanIncludeSecrets] = useState(false);
  const [projectScanLargeFileStrategy, setProjectScanLargeFileStrategy] = useState('skip');

  useEffect(() => {
    const loadSettings = async () => {
      if (!isElectronApiAvailable) return;
      try {
        const response = await window.electronAPI.loadSettings();
        if (response?.success && response.settings) {
          const settings = response.settings;
          setApiKeys(buildApiKeysFromSettings(settings));

          if (settings.aiContextPreset === 'safe' || settings.aiContextPreset === 'full' || settings.aiContextPreset === 'god') {
            setProjectScanPreset(settings.aiContextPreset);
          }

          setProjectScanIncludeSecrets(!!settings.aiContextIncludeSecrets);
          setProjectScanLargeFileStrategy(settings.aiContextLargeFileStrategy === 'truncate' ? 'truncate' : 'skip');
        }
      } catch {
        // ignore
      }
    };

    loadSettings();
  }, [isElectronApiAvailable]);

  useEffect(() => {
    const onSettingsUpdated = (event) => {
      const next = event?.detail;
      if (!next || typeof next !== 'object') return;

      setApiKeys(buildApiKeysFromSettings(next));

      if (next.aiContextPreset === 'safe' || next.aiContextPreset === 'full' || next.aiContextPreset === 'god') {
        setProjectScanPreset(next.aiContextPreset);
      }

      setProjectScanIncludeSecrets(!!next.aiContextIncludeSecrets);
      setProjectScanLargeFileStrategy(next.aiContextLargeFileStrategy === 'truncate' ? 'truncate' : 'skip');
    };

    window.addEventListener('settings-updated', onSettingsUpdated);
    return () => window.removeEventListener('settings-updated', onSettingsUpdated);
  }, []);

  return {
    apiKeys,
    projectScanPreset,
    projectScanIncludeSecrets,
    projectScanLargeFileStrategy
  };
};

export default useAISettingsSync;
