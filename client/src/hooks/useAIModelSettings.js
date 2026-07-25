import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_OLLAMA_MODEL,
  SUGGESTED_OLLAMA_MODELS,
  normalizeOllamaModelLabel
} from '../utils/ollamaModels';
import {
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_KIMI_MODEL,
  getRemoteModelOptions,
  normalizeRemoteModelName
} from '../utils/remoteModels';

const DEFAULT_QUALITY_GATE_CONFIG = {
  onApply: false,
  lint: true,
  test: false,
  build: false,
  blockOnFail: true
};

const useAIModelSettings = ({ isElectronApiAvailable, showMessage }) => {
  const [aiProvider, setAiProvider] = useState('gemini');
  const [thinkingMode, setThinkingMode] = useState(false);
  const [deepContextEnabled, setDeepContextEnabled] = useState(() => {
    try {
      return localStorage.getItem('aiDeepContext') === '1';
    } catch {
      return false;
    }
  });
  const [devPort, setDevPort] = useState('3004');
  const [permissionMode, setPermissionMode] = useState('edit_terminal');
  const [contextMode, setContextMode] = useState('auto');
  const [contextMaxFiles, setContextMaxFiles] = useState(120);
  const [geminiModel, setGeminiModel] = useState(DEFAULT_GEMINI_MODEL);
  const [claudeModel, setClaudeModel] = useState(DEFAULT_CLAUDE_MODEL);
  const [kimiModel, setKimiModel] = useState(DEFAULT_KIMI_MODEL);
  const [providerApiKeys, setProviderApiKeys] = useState({
    geminiApiKey: '',
    claudeApiKey: '',
    kimiApiKey: ''
  });
  const [ollamaModel, setOllamaModel] = useState(DEFAULT_OLLAMA_MODEL);
  const [ollamaModels, setOllamaModels] = useState([]);
  const [ollamaFamily, setOllamaFamily] = useState('');
  const [ollamaSizes, setOllamaSizes] = useState([]);
  const [recommendedOllamaSize, setRecommendedOllamaSize] = useState('');
  const [qualityGateConfig, setQualityGateConfig] = useState(DEFAULT_QUALITY_GATE_CONFIG);
  const [showOnboarding, setShowOnboarding] = useState(false);

  const resolvedOllamaModel = normalizeOllamaModelLabel(ollamaModel);

  const applySettings = useCallback((settings) => {
    if (!settings || typeof settings !== 'object') return;

    if (settings.devPort) {
      setDevPort(String(settings.devPort));
    }

    if (settings.defaultProvider) {
      setAiProvider(String(settings.defaultProvider));
    }

    setGeminiModel(normalizeRemoteModelName(settings.geminiModel, DEFAULT_GEMINI_MODEL));
    setClaudeModel(normalizeRemoteModelName(settings.claudeModel, DEFAULT_CLAUDE_MODEL));
    setKimiModel(normalizeRemoteModelName(settings.kimiModel, DEFAULT_KIMI_MODEL));
    setProviderApiKeys({
      geminiApiKey: String(settings.geminiApiKey || '').trim(),
      claudeApiKey: String(settings.claudeApiKey || '').trim(),
      kimiApiKey: String(settings.kimiApiKey || '').trim()
    });
    setOllamaModel(normalizeOllamaModelLabel(settings.ollamaModel));

    if (typeof settings.thinkingMode === 'boolean') {
      setThinkingMode(settings.thinkingMode);
    }

    setPermissionMode(settings.permissionMode || 'edit_terminal');

    if (settings.contextMode) {
      setContextMode(String(settings.contextMode));
    }

    if (Number.isFinite(Number(settings.contextMaxFiles))) {
      setContextMaxFiles(Number(settings.contextMaxFiles));
    }

    setQualityGateConfig({
      onApply: !!settings.qualityGateOnApply,
      lint: settings.qualityGateLint !== false,
      test: !!settings.qualityGateTest,
      build: !!settings.qualityGateBuild,
      blockOnFail: settings.qualityGateBlockOnFail !== false
    });

    if (typeof settings.onboardingCompleted === 'boolean') {
      setShowOnboarding(!settings.onboardingCompleted);
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('aiDeepContext', deepContextEnabled ? '1' : '0');
    } catch {
      // ignore
    }
  }, [deepContextEnabled]);

  useEffect(() => {
    if (!isElectronApiAvailable) return undefined;

    const loadSettings = async () => {
      if (!window.electronAPI?.loadSettings) return;
      try {
        const res = await window.electronAPI.loadSettings();
        if (res?.success && res.settings) {
          applySettings(res.settings);
        }
      } catch {
        // silent
      }
    };

    const onSettingsUpdated = (event) => {
      applySettings(event?.detail);
    };

    loadSettings();
    window.addEventListener('settings-updated', onSettingsUpdated);
    return () => window.removeEventListener('settings-updated', onSettingsUpdated);
  }, [applySettings, isElectronApiAvailable]);

  useEffect(() => {
    if (!isElectronApiAvailable || !window.electronAPI?.listOllamaModels) return undefined;
    if (aiProvider !== 'ollama') return undefined;

    let mounted = true;
    const loadOllamaModels = async () => {
      try {
        const response = await window.electronAPI.listOllamaModels();
        if (!mounted) return;
        if (response?.success && Array.isArray(response.models)) {
          setOllamaModels(
            response.models
              .map((model) => String(model?.name || model || '').trim())
              .filter(Boolean)
          );
        } else {
          setOllamaModels([]);
        }
      } catch {
        if (mounted) setOllamaModels([]);
      }
    };

    loadOllamaModels();
    return () => {
      mounted = false;
    };
  }, [aiProvider, isElectronApiAvailable]);

  useEffect(() => {
    if (!isElectronApiAvailable || !window.electronAPI?.resolveOllamaFamily) return undefined;
    if (aiProvider !== 'ollama') return undefined;

    let mounted = true;
    const loadCatalog = async (force = false) => {
      try {
        const famResp = await window.electronAPI.resolveOllamaFamily('qwen', force);
        if (!mounted || !famResp?.success || !famResp.family) return;
        setOllamaFamily(famResp.family);

        const sizesResp = await window.electronAPI.fetchOllamaLibrarySizes(famResp.family, force);
        if (!mounted || !sizesResp?.success || !Array.isArray(sizesResp.sizes)) return;
        setOllamaSizes(sizesResp.sizes);

        if (sizesResp.sizes.length > 0 && window.electronAPI?.recommendOllamaSize) {
          const recoResp = await window.electronAPI.recommendOllamaSize(sizesResp.sizes);
          if (mounted && recoResp?.success && recoResp.recommended) {
            setRecommendedOllamaSize(recoResp.recommended);
          }
        }
      } catch {
        // Offline: keep local and fallback model options.
      }
    };

    loadCatalog(false);
    const onRefresh = () => loadCatalog(true);
    window.addEventListener('ollama-models-refreshed', onRefresh);
    return () => {
      mounted = false;
      window.removeEventListener('ollama-models-refreshed', onRefresh);
    };
  }, [aiProvider, isElectronApiAvailable]);

  const saveSettingsPatch = useCallback(async (patch, successMessage = '') => {
    if (!isElectronApiAvailable || !window.electronAPI?.loadSettings || !window.electronAPI?.saveSettings) {
      return false;
    }

    try {
      const current = await window.electronAPI.loadSettings();
      const nextSettings = {
        ...(current?.settings || {}),
        ...patch
      };
      const result = await window.electronAPI.saveSettings(nextSettings);
      if (!result?.success) {
        throw new Error(result?.error || 'Sauvegarde impossible');
      }
      window.dispatchEvent(new CustomEvent('settings-updated', { detail: nextSettings }));
      if (successMessage) {
        showMessage(successMessage, 1800);
      }
      return true;
    } catch (error) {
      showMessage(`Erreur settings: ${error.message}`, 3500);
      return false;
    }
  }, [isElectronApiAvailable, showMessage]);

  const handleAiProviderChange = useCallback(async (provider) => {
    const nextProvider = String(provider || 'gemini');
    setAiProvider(nextProvider);
    await saveSettingsPatch({ defaultProvider: nextProvider }, `Assistant: ${nextProvider}`);
  }, [saveSettingsPatch]);

  const handleOllamaSettingChange = useCallback(async (field, value) => {
    const normalizedValue = normalizeOllamaModelLabel(value);
    if (field === 'ollamaModel') {
      setOllamaModel(normalizedValue);
    }

    await saveSettingsPatch({ [field]: normalizedValue }, `Modele Ollama: ${normalizedValue}`);
  }, [saveSettingsPatch]);

  // Allows UI surfaces other than the Settings modal (e.g. AutonomyControls
  // in AIChat) to change permissionMode without duplicating the persistence
  // flow. Mirrors the Settings modal's own save path: optimistic local
  // update + saveSettingsPatch + 'settings-updated' broadcast.
  const handlePermissionModeChange = useCallback(async (mode) => {
    const nextMode = String(mode || 'edit_terminal');
    setPermissionMode(nextMode);
    await saveSettingsPatch({ permissionMode: nextMode }, `Autonomie: ${nextMode}`);
  }, [saveSettingsPatch]);

  const ollamaTopbarLabel = useMemo(() => {
    if (aiProvider === 'ollama') {
      return `🦙 ${resolvedOllamaModel}`;
    }

    return '';
  }, [aiProvider, resolvedOllamaModel]);

  const ollamaStatusLabel = useMemo(() => {
    if (aiProvider === 'ollama') {
      return resolvedOllamaModel;
    }

    return '';
  }, [aiProvider, resolvedOllamaModel]);

  const recommendedOllamaModel = useMemo(() => (
    ollamaFamily && recommendedOllamaSize ? `${ollamaFamily}:${recommendedOllamaSize}` : ''
  ), [ollamaFamily, recommendedOllamaSize]);

  const availableOllamaModels = useMemo(() => {
    const dynamicModels = ollamaFamily
      ? ollamaSizes.map((size) => `${ollamaFamily}:${size}`)
      : [];
    const installedModels = ollamaModels
      .map((model) => String(model || '').trim())
      .filter((model) => model && !/:latest$/i.test(model));
    const fallback = dynamicModels.length === 0 && installedModels.length === 0
      ? SUGGESTED_OLLAMA_MODELS
      : [];

    return Array.from(new Set([
      ...dynamicModels,
      ...installedModels,
      ...fallback,
      normalizeOllamaModelLabel(ollamaModel)
    ].filter(Boolean)));
  }, [
    ollamaModel,
    ollamaModels,
    ollamaFamily,
    ollamaSizes
  ]);

  const activeModelField = useMemo(() => {
    if (aiProvider === 'claude') return 'claudeModel';
    if (aiProvider === 'kimi') return 'kimiModel';
    if (aiProvider === 'ollama') return 'ollamaModel';
    if (aiProvider === 'gemini') return 'geminiModel';
    return '';
  }, [aiProvider]);

  const activeModelValue = useMemo(() => {
    if (aiProvider === 'claude') return claudeModel || DEFAULT_CLAUDE_MODEL;
    if (aiProvider === 'kimi') return kimiModel || DEFAULT_KIMI_MODEL;
    if (aiProvider === 'ollama') return resolvedOllamaModel;
    if (aiProvider === 'gemini') return geminiModel || DEFAULT_GEMINI_MODEL;
    return '';
  }, [aiProvider, claudeModel, geminiModel, kimiModel, resolvedOllamaModel]);

  const availableActiveModels = useMemo(() => {
    if (aiProvider === 'ollama') return availableOllamaModels;
    if (aiProvider === 'gemini') return getRemoteModelOptions('gemini', geminiModel);
    if (aiProvider === 'claude') return getRemoteModelOptions('claude', claudeModel);
    if (aiProvider === 'kimi') return getRemoteModelOptions('kimi', kimiModel);
    return [];
  }, [aiProvider, availableOllamaModels, claudeModel, geminiModel, kimiModel]);

  const handleActiveModelChange = useCallback(async (value) => {
    if (!activeModelField) return;

    if (activeModelField === 'ollamaModel') {
      await handleOllamaSettingChange(activeModelField, value);
      return;
    }

    const normalizedValue = normalizeRemoteModelName(value);
    if (!normalizedValue) return;

    if (activeModelField === 'geminiModel') {
      setGeminiModel(normalizedValue);
    } else if (activeModelField === 'claudeModel') {
      setClaudeModel(normalizedValue);
    } else if (activeModelField === 'kimiModel') {
      setKimiModel(normalizedValue);
    }

    await saveSettingsPatch({ [activeModelField]: normalizedValue }, `Modele IA: ${normalizedValue}`);
  }, [activeModelField, handleOllamaSettingChange, saveSettingsPatch]);

  const completeOnboarding = useCallback(async () => {
    setShowOnboarding(false);
    const saved = await saveSettingsPatch({ onboardingCompleted: true }, 'Onboarding termine.');
    if (!saved) {
      // Keep the local dismissal even when settings persistence is unavailable.
      setShowOnboarding(false);
    }
  }, [saveSettingsPatch]);

  const aiModelSelection = useMemo(() => ({
    geminiModel,
    claudeModel,
    kimiModel,
    ollamaModel: resolvedOllamaModel,
    resolvedOllamaModel,
    ...providerApiKeys
  }), [
    claudeModel,
    geminiModel,
    kimiModel,
    providerApiKeys,
    resolvedOllamaModel
  ]);

  return {
    aiProvider,
    thinkingMode,
    setThinkingMode,
    deepContextEnabled,
    setDeepContextEnabled,
    devPort,
    permissionMode,
    contextMode,
    contextMaxFiles,
    qualityGateConfig,
    showOnboarding,
    completeOnboarding,
    isReadOnlyMode: permissionMode === 'read_only',
    geminiModel,
    claudeModel,
    kimiModel,
    resolvedOllamaModel,
    recommendedOllamaModel,
    availableOllamaModels,
    activeModelValue,
    availableActiveModels,
    ollamaTopbarLabel,
    ollamaStatusLabel,
    aiModelSelection,
    handleAiProviderChange,
    handleOllamaSettingChange,
    handleActiveModelChange,
    handlePermissionModeChange
  };
};

export default useAIModelSettings;
