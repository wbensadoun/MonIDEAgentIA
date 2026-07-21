import React, { useState, useEffect, useCallback } from 'react';
import './Settings.css';
import ThemeSwitcher from '../AppShell/ThemeSwitcher';
import {
  DEFAULT_OLLAMA_MODEL,
  SUGGESTED_OLLAMA_MODELS,
  normalizeOllamaModelLabel
} from '../../utils/ollamaModels';
import {
  AI_PROVIDER_OPTIONS,
  MULTI_AGENT_ROLE_DEFINITIONS,
  REMOTE_MODEL_SUGGESTIONS,
  getDefaultModelForProvider,
  normalizeMultiAgentRoles
} from '../../utils/multiAgentConfig';
import {
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_KIMI_MODEL,
  getRemoteModelOptions,
  normalizeRemoteModelName
} from '../../utils/remoteModels';

const REMOTE_PROVIDER_MODEL_FIELDS = [
  { provider: 'gemini', field: 'geminiModel', label: 'Gemini', fallback: DEFAULT_GEMINI_MODEL },
  { provider: 'claude', field: 'claudeModel', label: 'Claude', fallback: DEFAULT_CLAUDE_MODEL },
  { provider: 'kimi', field: 'kimiModel', label: 'Kimi / Together', fallback: DEFAULT_KIMI_MODEL }
];

const Settings = ({ isOpen, onClose, isElectronApiAvailable, showMessage, theme, onThemeChange }) => {
  const [settings, setSettings] = useState({
    geminiApiKey: '',
    kimiApiKey: '',
    claudeApiKey: '',
    defaultProvider: 'gemini',
    thinkingMode: false,
    geminiModel: DEFAULT_GEMINI_MODEL,
    claudeModel: DEFAULT_CLAUDE_MODEL,
    kimiModel: DEFAULT_KIMI_MODEL,
    ollamaModel: DEFAULT_OLLAMA_MODEL,
    multiAgentRoles: normalizeMultiAgentRoles(),
    devPort: '3004',
    allowDangerousActions: false,
    aiContextPreset: 'safe',
    aiContextIncludeSecrets: false,
    aiContextLargeFileStrategy: 'skip',
    aiTerminalApprovalMode: true,
    permissionMode: 'edit_terminal',
    qualityGateOnApply: false,
    qualityGateLint: true,
    qualityGateTest: false,
    qualityGateBuild: false,
    qualityGateBlockOnFail: true,
    onboardingCompleted: false,
    contextMode: 'auto',
    contextMaxFiles: 120,
    localAIOptimizationMode: 'safe',
    localAIHardwareConsent: false,
    localAIMaxConcurrentLocal: 1,
    localAIMaxConcurrentCloud: 3,
    localAIContextBudget: 'short',
    localAIMaxTokens: 4096
  });

  const [loading, setLoading] = useState(false);
  const [showApiKeys, setShowApiKeys] = useState(false);
  const [validation, setValidation] = useState({ gemini: null, kimi: null, claude: null });
  const [ollamaModels, setOllamaModels] = useState([]);
  const [systemAIProfile, setSystemAIProfile] = useState(null);
  const [isSystemProfileLoading, setIsSystemProfileLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('general');

  const loadSettings = useCallback(async () => {
    if (!isElectronApiAvailable || !window.electronAPI?.loadSettings) return;
    try {
      const response = await window.electronAPI.loadSettings();
      if (response.success && response.settings) {
        setSettings(prev => ({
          ...prev,
          ...response.settings,
          multiAgentRoles: normalizeMultiAgentRoles(response.settings.multiAgentRoles)
        }));
      }
    } catch (error) {
      showMessage('Erreur chargement des parametres', 3000);
    }
  }, [isElectronApiAvailable, showMessage]);

  useEffect(() => {
    if (isOpen) {
      loadSettings();
    }
  }, [isOpen, loadSettings]);

  useEffect(() => {
    let mounted = true;
    const fetchOllamaModels = async () => {
      if (!isOpen || !isElectronApiAvailable || !window.electronAPI?.listOllamaModels) return;
      try {
        const response = await window.electronAPI.listOllamaModels();
        if (!mounted) return;
        if (response?.success && Array.isArray(response.models)) {
          const models = response.models
            .map((m) => String(m?.name || m || '').trim())
            .filter(Boolean);
          setOllamaModels(models);
        } else {
          setOllamaModels([]);
        }
      } catch {
        if (mounted) setOllamaModels([]);
      }
    };

    fetchOllamaModels();
    return () => { mounted = false; };
  }, [isOpen, isElectronApiAvailable]);

  useEffect(() => {
    if (!isElectronApiAvailable) return;
    const key = settings.geminiApiKey;
    let cancelled = false;
    const t = setTimeout(async () => {
      if (!key) {
        setValidation(prev => ({ ...prev, gemini: null }));
        return;
      }
      try {
        const res = await window.electronAPI.validateApiKey('gemini', key);
        if (!cancelled) setValidation(prev => ({ ...prev, gemini: res.valid ? 'valid' : 'invalid' }));
      } catch {
        if (!cancelled) setValidation(prev => ({ ...prev, gemini: 'invalid' }));
      }
    }, 600);
    return () => { cancelled = true; clearTimeout(t); };
  }, [settings.geminiApiKey, isElectronApiAvailable]);

  useEffect(() => {
    if (!isElectronApiAvailable) return;
    const key = settings.kimiApiKey;
    let cancelled = false;
    const t = setTimeout(async () => {
      if (!key) {
        setValidation(prev => ({ ...prev, kimi: null }));
        return;
      }
      try {
        const res = await window.electronAPI.validateApiKey('kimi', key);
        if (!cancelled) setValidation(prev => ({ ...prev, kimi: res.valid ? 'valid' : 'invalid' }));
      } catch {
        if (!cancelled) setValidation(prev => ({ ...prev, kimi: 'invalid' }));
      }
    }, 600);
    return () => { cancelled = true; clearTimeout(t); };
  }, [settings.kimiApiKey, isElectronApiAvailable]);

  const getValidationIcon = (status) => {
    if (status === 'valid') return <span className="settings-valid">OK</span>;
    if (status === 'invalid') return <span className="settings-invalid">X</span>;
    return null;
  };

  const getValidationMessage = (keyType) => {
    if (keyType === 'gemini' && validation.gemini === 'invalid') {
      return <span className="settings-warning">Cle Gemini invalide (ping echoue)</span>;
    }
    if (keyType === 'kimi' && validation.kimi === 'invalid') {
      return <span className="settings-warning">Cle Kimi invalide (ping echoue)</span>;
    }
    return null;
  };

  const saveSettings = async () => {
    if (!isElectronApiAvailable) {
      showMessage('Erreur: Electron non disponible', 3000);
      return;
    }

    setLoading(true);
    try {
      const normalizedSettings = {
        ...settings,
        geminiModel: normalizeRemoteModelName(settings.geminiModel, DEFAULT_GEMINI_MODEL),
        claudeModel: normalizeRemoteModelName(settings.claudeModel, DEFAULT_CLAUDE_MODEL),
        kimiModel: normalizeRemoteModelName(settings.kimiModel, DEFAULT_KIMI_MODEL),
        ollamaModel: normalizeOllamaModelLabel(settings.ollamaModel),
        multiAgentRoles: normalizeMultiAgentRoles(settings.multiAgentRoles),
        localAIMaxConcurrentLocal: Math.max(1, Math.min(4, Number(settings.localAIMaxConcurrentLocal || 1))),
        localAIMaxConcurrentCloud: Math.max(1, Math.min(6, Number(settings.localAIMaxConcurrentCloud || 3))),
        localAIMaxTokens: Math.max(512, Math.min(8192, Number(settings.localAIMaxTokens || 4096)))
      };
      const response = await window.electronAPI.saveSettings(normalizedSettings);
      if (response.success) {
        showMessage('Parametres sauvegardes', 3000);
        window.dispatchEvent(new CustomEvent('settings-updated', { detail: normalizedSettings }));
        onClose();
      } else {
        showMessage(`Erreur: ${response.error}`, 4000);
      }
    } catch (error) {
      showMessage('Erreur sauvegarde des parametres', 3000);
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (field, value) => {
    setSettings((prev) => {
      if (field === 'ollamaModel') {
        return { ...prev, [field]: normalizeOllamaModelLabel(value) };
      }
      if (field === 'geminiModel' || field === 'claudeModel' || field === 'kimiModel') {
        return { ...prev, [field]: value };
      }
      if (field === 'localAIOptimizationMode' && value === 'safe') {
        return { ...prev, [field]: value, localAIHardwareConsent: false };
      }
      return { ...prev, [field]: value };
    });
  };

  const applyModelToProviderRoles = (provider, modelValue) => {
    const model = normalizeRemoteModelName(modelValue, getDefaultModelForProvider(provider));
    if (!model) return;

    setSettings((prev) => {
      const currentRoles = normalizeMultiAgentRoles(prev.multiAgentRoles);
      const nextRoles = Object.fromEntries(
        Object.entries(currentRoles).map(([roleKey, roleConfig]) => [
          roleKey,
          roleConfig.provider === provider
            ? { ...roleConfig, model }
            : roleConfig
        ])
      );

      return {
        ...prev,
        multiAgentRoles: normalizeMultiAgentRoles(nextRoles)
      };
    });

    const providerLabel = REMOTE_PROVIDER_MODEL_FIELDS.find((item) => item.provider === provider)?.label || provider;
    showMessage && showMessage(`${providerLabel}: modele applique aux roles`, 2500);
  };

  const handleMultiAgentRoleChange = (roleKey, field, value) => {
    setSettings((prev) => {
      const currentRoles = normalizeMultiAgentRoles(prev.multiAgentRoles);
      const currentRole = currentRoles[roleKey] || {};
      const nextRole = { ...currentRole, [field]: value };

      if (field === 'provider') {
        nextRole.model = getDefaultModelForProvider(value, currentRole.model);
      }

      return {
        ...prev,
        multiAgentRoles: normalizeMultiAgentRoles({
          ...currentRoles,
          [roleKey]: nextRole
        })
      };
    });
  };

  const refreshSystemAIProfile = async () => {
    if (!isElectronApiAvailable || !window.electronAPI?.getSystemAIProfile) {
      showMessage && showMessage('Lecture hardware indisponible.', 3000);
      return;
    }

    setIsSystemProfileLoading(true);
    try {
      const response = await window.electronAPI.getSystemAIProfile({ consent: true });
      setSystemAIProfile(response);
      if (response?.success) {
        setSettings((prev) => ({
          ...prev,
          localAIHardwareConsent: true,
          localAIOptimizationMode: 'auto'
        }));
        showMessage && showMessage(`Profil IA locale: ${response.profile}`, 2500);
      } else {
        showMessage && showMessage(response?.error || 'Lecture hardware impossible.', 3500);
      }
    } catch (error) {
      showMessage && showMessage(`Lecture hardware: ${error.message}`, 3500);
    } finally {
      setIsSystemProfileLoading(false);
    }
  };

  const availableOllamaModels = Array.from(new Set([
    ...SUGGESTED_OLLAMA_MODELS,
    settings.ollamaModel,
    ...ollamaModels
  ].map((m) => String(m || '').trim()).filter((m) => m && !/:latest$/i.test(m))));

  const availableMultiAgentModels = Array.from(new Set([
    ...REMOTE_MODEL_SUGGESTIONS,
    settings.geminiModel,
    settings.claudeModel,
    settings.kimiModel,
    ...SUGGESTED_OLLAMA_MODELS,
    ...availableOllamaModels,
    ...Object.values(normalizeMultiAgentRoles(settings.multiAgentRoles))
      .map((role) => role.model)
  ].map((m) => String(m || '').trim()).filter(Boolean)));

  const normalizedMultiAgentRoles = normalizeMultiAgentRoles(settings.multiAgentRoles);
  const geminiModelOptions = getRemoteModelOptions('gemini', settings.geminiModel);
  const claudeModelOptions = getRemoteModelOptions('claude', settings.claudeModel);
  const kimiModelOptions = getRemoteModelOptions('kimi', settings.kimiModel);

  if (!isOpen) return null;

  const SETTINGS_TABS = [
    { id: 'general',  icon: '🎨', label: 'Général' },
    { id: 'models',   icon: '☁️', label: 'Modèles cloud' },
    { id: 'multi',    icon: '🤖', label: 'Multi-agents' },
    { id: 'ollama',   icon: '🦙', label: 'Ollama local' },
    { id: 'security', icon: '🔒', label: 'Sécurité' },
    { id: 'context',  icon: '📂', label: 'Contexte & Qualité' },
    { id: 'advanced', icon: '🔑', label: 'Clés API & Avancé' },
  ];

  return (
    <div className="settings-overlay">
      <div className="settings-modal">
        <div className="settings-header">
          <div>
            <div className="settings-title">Settings</div>
            <div className="settings-subtitle">Configuration IA et projet</div>
          </div>
          <button onClick={onClose} className="settings-close">X</button>
        </div>

        <div className="settings-tabs">
          {SETTINGS_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`settings-tab ${activeTab === t.id ? 'is-active' : ''}`}
              onClick={() => setActiveTab(t.id)}
            >
              <span className="settings-tab-icon">{t.icon}</span>
              <span className="settings-tab-label">{t.label}</span>
            </button>
          ))}
        </div>

        <div className="settings-body custom-scrollbar">
          {activeTab === 'general' && (<>
          <div className="settings-section">
            <label className="settings-label">Apparence</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="settings-hint" style={{ margin: 0 }}>Thème :</span>
              <ThemeSwitcher theme={theme} onThemeChange={onThemeChange} />
            </div>
          </div>

          <div className="settings-section">
            <label className="settings-label">Provider IA par defaut</label>
            <select
              value={settings.defaultProvider}
              onChange={(e) => handleChange('defaultProvider', e.target.value)}
              className="settings-input"
            >
              <option value="gemini">Gemini</option>
              <option value="claude">Claude</option>
              <option value="kimi">Kimi</option>
              <option value="multi">Multi-IA</option>
              <option value="ollama">Ollama</option>
            </select>
          </div>
          </>)}

          {activeTab === 'models' && (<>
          <div className="settings-section">
            <label className="settings-label">Modeles IA simples</label>
            <div className="settings-hint">
              Ces valeurs sont celles utilisees par le chat quand vous choisissez Gemini, Claude ou Kimi dans la barre du haut.
            </div>

            <label className="settings-label">Gemini</label>
            <input
              type="text"
              list="settings-gemini-models"
              value={settings.geminiModel || DEFAULT_GEMINI_MODEL}
              onChange={(e) => handleChange('geminiModel', e.target.value)}
              className="settings-input"
            />
            <datalist id="settings-gemini-models">
              {geminiModelOptions.map((modelName) => (
                <option key={`settings-gemini-${modelName}`} value={modelName} />
              ))}
            </datalist>

            <label className="settings-label">Claude</label>
            <input
              type="text"
              list="settings-claude-models"
              value={settings.claudeModel || DEFAULT_CLAUDE_MODEL}
              onChange={(e) => handleChange('claudeModel', e.target.value)}
              className="settings-input"
            />
            <datalist id="settings-claude-models">
              {claudeModelOptions.map((modelName) => (
                <option key={`settings-claude-${modelName}`} value={modelName} />
              ))}
            </datalist>

            <label className="settings-label">Kimi / Together</label>
            <input
              type="text"
              list="settings-kimi-models"
              value={settings.kimiModel || DEFAULT_KIMI_MODEL}
              onChange={(e) => handleChange('kimiModel', e.target.value)}
              className="settings-input"
            />
            <datalist id="settings-kimi-models">
              {kimiModelOptions.map((modelName) => (
                <option key={`settings-kimi-${modelName}`} value={modelName} />
              ))}
            </datalist>

            <div className="settings-hint" style={{ marginTop: '10px' }}>
              Les listes proposent des reperes, mais les champs acceptent aussi les nouvelles versions publiees par les providers.
            </div>
            <div className="settings-agent-controls">
              {REMOTE_PROVIDER_MODEL_FIELDS.map(({ provider, field, label, fallback }) => (
                <button
                  type="button"
                  key={`apply-${provider}-roles`}
                  className="btn btn-ghost"
                  onClick={() => applyModelToProviderRoles(provider, settings[field] || fallback)}
                >
                  Appliquer aux roles {label}
                </button>
              ))}
            </div>
          </div>
          </>)}

          {activeTab === 'multi' && (<>
          <datalist id="multi-agent-model-suggestions">
            {availableMultiAgentModels.map((modelName) => (
              <option key={`multi-agent-model-${modelName}`} value={modelName} />
            ))}
          </datalist>

          <div className="settings-section">
            <label className="settings-label">Multi-IA: roster du selectionneur</label>
            <div className="settings-hint">
              Le selectionneur compose une formation selon la demande. Ces reglages fixent le provider et le modele disponibles pour chaque specialiste.
            </div>

            <div className="settings-agent-grid">
              {MULTI_AGENT_ROLE_DEFINITIONS.map((role) => {
                const roleConfig = normalizedMultiAgentRoles[role.key];
                return (
                  <div className="settings-agent-role" key={role.key}>
                    <div className="settings-agent-role-head">
                      <span className="settings-agent-title">{role.title}</span>
                      <span className="settings-agent-focus">{role.focus}</span>
                    </div>
                    <div className="settings-agent-controls">
                      <select
                        value={roleConfig.provider}
                        onChange={(e) => handleMultiAgentRoleChange(role.key, 'provider', e.target.value)}
                        className="settings-input"
                      >
                        {AI_PROVIDER_OPTIONS.map((providerOption) => (
                          <option key={`${role.key}-${providerOption.value}`} value={providerOption.value}>
                            {providerOption.label}
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        list="multi-agent-model-suggestions"
                        value={roleConfig.model}
                        onChange={(e) => handleMultiAgentRoleChange(role.key, 'model', e.target.value)}
                        placeholder={getDefaultModelForProvider(roleConfig.provider)}
                        className="settings-input"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          </>)}

          {activeTab === 'ollama' && (<>
          <div className="settings-section">
            <label className="settings-label">Optimisation IA locale</label>
            <select
              value={settings.localAIOptimizationMode || 'safe'}
              onChange={(e) => handleChange('localAIOptimizationMode', e.target.value)}
              className="settings-input"
            >
              <option value="safe">Prive / Safe</option>
              <option value="auto">Auto-adaptatif</option>
              <option value="manual">Manuel expert</option>
            </select>
            <div className="settings-hint">
              Safe ne lit pas la configuration PC et limite Ollama a un agent local. Auto lit CPU/RAM/GPU uniquement apres accord explicite. Le mode multi-agent utilise le roster pour choisir le provider de chaque agent.
            </div>

            {settings.localAIOptimizationMode === 'auto' && (
              <>
                <label className="settings-toggle">
                  <input
                    type="checkbox"
                    checked={!!settings.localAIHardwareConsent}
                    onChange={(e) => handleChange('localAIHardwareConsent', e.target.checked)}
                  />
                  <span>Autoriser la lecture locale CPU/RAM/GPU pour adapter la puissance</span>
                </label>
                <button
                  type="button"
                  onClick={refreshSystemAIProfile}
                  disabled={isSystemProfileLoading}
                  className="btn btn-ghost"
                >
                  {isSystemProfileLoading ? 'Analyse...' : 'Analyser cette machine'}
                </button>
                {systemAIProfile?.success && (
                  <div className="settings-hardware-summary">
                    <span>Profil {systemAIProfile.profile}</span>
                    <span>{systemAIProfile.cpu?.cores || 0} coeurs CPU</span>
                    <span>{systemAIProfile.memory?.totalGb || '?'} Go RAM</span>
                    <span>
                      {systemAIProfile.ollama?.available
                        ? `${systemAIProfile.ollama.models?.length || 0} modeles Ollama`
                        : 'Ollama non detecte'}
                    </span>
                    {Array.isArray(systemAIProfile.gpu) && systemAIProfile.gpu.length > 0 && (
                      <span>{systemAIProfile.gpu[0].name}</span>
                    )}
                  </div>
                )}
              </>
            )}

            {settings.localAIOptimizationMode === 'manual' && (
              <div className="settings-agent-controls">
                <input
                  type="number"
                  min="1"
                  max="4"
                  value={settings.localAIMaxConcurrentLocal || 1}
                  onChange={(e) => handleChange('localAIMaxConcurrentLocal', Number(e.target.value || 1))}
                  className="settings-input"
                  title="Agents Ollama locaux simultanes"
                />
                <input
                  type="number"
                  min="1"
                  max="6"
                  value={settings.localAIMaxConcurrentCloud || 3}
                  onChange={(e) => handleChange('localAIMaxConcurrentCloud', Number(e.target.value || 3))}
                  className="settings-input"
                  title="Agents API/cloud simultanes"
                />
                <select
                  value={settings.localAIContextBudget || 'short'}
                  onChange={(e) => handleChange('localAIContextBudget', e.target.value)}
                  className="settings-input"
                >
                  <option value="short">Contexte court</option>
                  <option value="medium">Contexte moyen</option>
                  <option value="long">Contexte long</option>
                </select>
                <input
                  type="number"
                  min="512"
                  max="8192"
                  value={settings.localAIMaxTokens || 4096}
                  onChange={(e) => handleChange('localAIMaxTokens', Number(e.target.value || 4096))}
                  className="settings-input"
                  title="Tokens max par agent"
                />
              </div>
            )}
          </div>

          <div className="settings-section">
            <label className="settings-label">Modele Ollama</label>
            <div className="settings-hint">
              Utilise pour Ollama simple et les agents du roster qui choisissent Ollama.
            </div>
            <div className="settings-hint">
              Tailles proposees dynamiquement selon la famille Qwen la plus recente (8b, 14b, 30b, 32b...). La taille adaptee a votre machine est marquee (recommandee) dans la barre du haut. Aucun alias latest. Installer via `ollama pull` si absent localement.
            </div>

            <select
              value={settings.ollamaModel || DEFAULT_OLLAMA_MODEL}
              onChange={(e) => handleChange('ollamaModel', e.target.value)}
              className="settings-input"
            >
              {availableOllamaModels.length === 0 && (
                <option value={settings.ollamaModel || DEFAULT_OLLAMA_MODEL}>
                  {settings.ollamaModel || DEFAULT_OLLAMA_MODEL}
                </option>
              )}
              {availableOllamaModels.map((modelName) => (
                <option key={`ollama-${modelName}`} value={modelName}>{modelName}</option>
              ))}
            </select>
          </div>
          </>)}

          {activeTab === 'security' && (<>
          <div className="settings-section">
            <label className="settings-label">Options</label>
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={settings.thinkingMode}
                onChange={(e) => handleChange('thinkingMode', e.target.checked)}
              />
              <span>Activer le mode Thinking (raisonnement visible)</span>
            </label>
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={settings.allowDangerousActions}
                onChange={(e) => handleChange('allowDangerousActions', e.target.checked)}
              />
              <span>Autoriser les actions risquees sans confirmation</span>
            </label>
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={settings.aiTerminalApprovalMode !== false}
                onChange={(e) => handleChange('aiTerminalApprovalMode', e.target.checked)}
              />
              <span>Demander confirmation avant chaque commande terminal IA</span>
            </label>
          </div>

          <div className="settings-section">
            <label className="settings-label">Mode permissions</label>
            <select
              value={settings.permissionMode || 'edit_terminal'}
              onChange={(e) => handleChange('permissionMode', e.target.value)}
              className="settings-input"
            >
              <option value="read_only">Lecture seule</option>
              <option value="edit">Edition (sans terminal)</option>
              <option value="edit_terminal">Edition + terminal</option>
            </select>
            <div className="settings-hint">
              Lecture seule bloque les modifications. Edition bloque uniquement les commandes terminal.
            </div>
          </div>
          </>)}

          {activeTab === 'context' && (<>
          <div className="settings-section">
            <label className="settings-label">Contexte IA (scan projet)</label>
            <select
              value={settings.aiContextPreset || 'safe'}
              onChange={(e) => handleChange('aiContextPreset', e.target.value)}
              className="settings-input"
            >
              <option value="safe">Safe (rapide)</option>
              <option value="full">Full (configs + dotfiles)</option>
              <option value="god">God (build + node_modules + .git)</option>
            </select>
            <div className="settings-hint">
              Safe = le plus rapide. Full = meilleur contexte sans exploser. God = peut être long et gourmand.
            </div>

            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={!!settings.aiContextIncludeSecrets}
                onChange={(e) => handleChange('aiContextIncludeSecrets', e.target.checked)}
              />
              <span>Inclure fichiers sensibles (ex: .env, clés)</span>
            </label>
            <div className="settings-danger">
              Attention: si tu utilises un provider IA externe (Gemini/Together), ces données peuvent être envoyées hors machine.
            </div>

            <label className="settings-label">Fichiers volumineux</label>
            <select
              value={settings.aiContextLargeFileStrategy || 'skip'}
              onChange={(e) => handleChange('aiContextLargeFileStrategy', e.target.value)}
              className="settings-input"
            >
              <option value="skip">Ignorer</option>
              <option value="truncate">Tronquer</option>
            </select>

            <label className="settings-label" style={{ marginTop: '10px' }}>Mode de contexte injecte</label>
            <select
              value={settings.contextMode || 'auto'}
              onChange={(e) => handleChange('contextMode', e.target.value)}
              className="settings-input"
            >
              <option value="auto">Auto (intention detectee)</option>
              <option value="mentions">Mentions uniquement (@fichier)</option>
              <option value="none">Aucun contexte projet</option>
            </select>

            <label className="settings-label" style={{ marginTop: '10px' }}>Max fichiers contexte</label>
            <input
              type="number"
              min="10"
              max="50000"
              value={settings.contextMaxFiles ?? 120}
              onChange={(e) => handleChange('contextMaxFiles', Number(e.target.value || 120))}
              className="settings-input"
            />
          </div>

          <div className="settings-section">
            <label className="settings-label">Quality gates avant application IA</label>
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={!!settings.qualityGateOnApply}
                onChange={(e) => handleChange('qualityGateOnApply', e.target.checked)}
              />
              <span>Activer les quality gates</span>
            </label>
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={settings.qualityGateLint !== false}
                onChange={(e) => handleChange('qualityGateLint', e.target.checked)}
              />
              <span>Lancer lint</span>
            </label>
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={!!settings.qualityGateTest}
                onChange={(e) => handleChange('qualityGateTest', e.target.checked)}
              />
              <span>Lancer tests</span>
            </label>
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={!!settings.qualityGateBuild}
                onChange={(e) => handleChange('qualityGateBuild', e.target.checked)}
              />
              <span>Lancer build</span>
            </label>
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={settings.qualityGateBlockOnFail !== false}
                onChange={(e) => handleChange('qualityGateBlockOnFail', e.target.checked)}
              />
              <span>Bloquer l&apos;application si un gate echoue</span>
            </label>
          </div>
          </>)}

          {activeTab === 'advanced' && (<>
          <div className="settings-section">
            <label className="settings-label">Port serveur dev</label>
            <input
              type="text"
              value={settings.devPort}
              onChange={(e) => handleChange('devPort', e.target.value)}
              placeholder="3004"
              className="settings-input"
            />
          </div>

          <div className="settings-section">
            <div className="settings-row">
              <label className="settings-label">Cles API</label>
              <button
                type="button"
                onClick={() => setShowApiKeys(!showApiKeys)}
                className="settings-link"
              >
                {showApiKeys ? 'Masquer' : 'Afficher'}
              </button>
            </div>

            <div className="settings-key">
              <label className="settings-key-label">
                Gemini API Key {getValidationIcon(validation.gemini)}
              </label>
              <input
                type={showApiKeys ? 'text' : 'password'}
                value={settings.geminiApiKey}
                onChange={(e) => handleChange('geminiApiKey', e.target.value)}
                placeholder="AIza..."
                className={`settings-input ${validation.gemini === 'invalid' ? 'is-invalid' : ''}`}
              />
              {getValidationMessage('gemini')}
            </div>

            <div className="settings-key">
              <label className="settings-key-label">
                Kimi/Together API Key {getValidationIcon(validation.kimi)}
              </label>
              <input
                type={showApiKeys ? 'text' : 'password'}
                value={settings.kimiApiKey || ''}
                onChange={(e) => handleChange('kimiApiKey', e.target.value)}
                placeholder="tgp_v1_..."
                className={`settings-input ${validation.kimi === 'invalid' ? 'is-invalid' : ''}`}
              />
              {getValidationMessage('kimi')}
            </div>

            <div className="settings-key">
              <label className="settings-key-label">
                Claude API Key {getValidationIcon(validation.claude)}
              </label>
              <input
                type={showApiKeys ? 'text' : 'password'}
                value={settings.claudeApiKey || ''}
                onChange={(e) => handleChange('claudeApiKey', e.target.value)}
                placeholder="sk-ant-api..."
                className={`settings-input ${validation.claude === 'invalid' ? 'is-invalid' : ''}`}
              />
              {getValidationMessage('claude')}
            </div>
          </div>
          </>)}
        </div>

        <div className="settings-footer">
          <button onClick={onClose} className="btn btn-ghost">
            Annuler
          </button>
          <button
            onClick={saveSettings}
            disabled={loading}
            className="btn btn-primary"
          >
            {loading ? 'Sauvegarde...' : 'Sauvegarder'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Settings;
