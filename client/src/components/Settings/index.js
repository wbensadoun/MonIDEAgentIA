import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import './Settings.css';
import ThemeSwitcher from '../AppShell/ThemeSwitcher';
import {
  IconSettings,
  IconMoon,
  IconPackage,
  IconAgents,
  IconLightning,
  IconShield,
  IconFolder,
  IconPlug,
  IconLayoutCustomize,
  IconCompass
} from '../ComponentLibrary/icons';
import {
  DEFAULT_OLLAMA_MODEL,
  normalizeOllamaModelLabel
} from '../../utils/ollamaModels';
import {
  AI_PROVIDER_OPTIONS,
  MULTI_AGENT_ROLE_DEFINITIONS,
  getDefaultModelForProvider,
  normalizeMultiAgentRoles
} from '../../utils/multiAgentConfig';
import {
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_KIMI_MODEL,
  DEFAULT_QWEN_MODEL,
  PROVIDER_CATALOG,
  normalizeRemoteModelName
} from '../../utils/remoteModels';
import {
  PROVIDER_MODELS_UPDATED_EVENT,
  getProviderModelsState,
  refreshProviderModel
} from '../../utils/providerModelsStore';

// Liste cible plan-ia-onglets.md §④. MCP debloque McpSettings.js (jusque-la
// orphelin) ; Extensions/Raccourcis sont nouveaux, coquilles annoncees pour
// la premiere, alimentee par les raccourcis clavier du §7 pour la seconde.
const SETTINGS_TABS = [
  { id: 'general', Icon: IconSettings, label: 'Général' },
  { id: 'appearance', Icon: IconMoon, label: 'Apparence' },
  { id: 'providers', Icon: IconPackage, label: 'Fournisseurs' },
  { id: 'agents', Icon: IconAgents, label: 'Agents' },
  { id: 'execution', Icon: IconLightning, label: 'Exécution' },
  { id: 'permissions', Icon: IconShield, label: 'Permissions' },
  { id: 'context', Icon: IconFolder, label: 'Contexte' },
  { id: 'mcp', Icon: IconPlug, label: 'MCP' },
  { id: 'extensions', Icon: IconLayoutCustomize, label: 'Extensions' },
  { id: 'shortcuts', Icon: IconCompass, label: 'Raccourcis' }
];

// plan-ia-onglets.md §7 — un seul endroit a tenir a jour : le gestionnaire de
// raccourcis (useCommandCenter.js) applique exactement cette liste.
const SHORTCUT_LIST = [
  { keys: 'Ctrl+K', action: 'Palette de commandes' },
  { keys: 'Ctrl+P', action: 'Ouvrir un fichier' },
  { keys: 'Ctrl+O', action: 'Ouvrir un dossier' },
  { keys: 'Ctrl+Shift+F', action: 'Recherche globale' },
  { keys: 'Ctrl+T', action: 'Recherche de symboles' },
  { keys: 'Ctrl+B', action: 'Basculer le panneau de gauche' },
  { keys: 'Ctrl+J', action: 'Basculer le terminal' },
  { keys: 'Ctrl+Shift+X', action: 'Ouvrir Extensions & Connecteurs' },
  { keys: 'Ctrl+W', action: "Fermer l'onglet actif" },
  { keys: 'Ctrl+Tab', action: 'Onglet suivant' },
  { keys: 'Ctrl+Shift+Tab', action: 'Onglet précédent' },
  { keys: 'Ctrl+1..9', action: "Aller au n-ième onglet" }
];

const Settings = ({
  isOpen,
  onClose,
  isElectronApiAvailable,
  showMessage,
  theme,
  onThemeChange,
  autoRoute = true,
  onAutoRouteChange,
  routerClassifierProvider = null,
  onRouterClassifierProviderChange,
  routerClassifierModel = null,
  onRouterClassifierModelChange,
  routerComplexityThreshold = 0.5,
  onRouterComplexityThresholdChange,
  onOpenExtensions = () => {}
}) => {
  const [settings, setSettings] = useState({
    defaultProvider: 'gemini',
    thinkingMode: false,
    geminiModel: DEFAULT_GEMINI_MODEL,
    claudeModel: DEFAULT_CLAUDE_MODEL,
    kimiModel: DEFAULT_KIMI_MODEL,
    qwenModel: DEFAULT_QWEN_MODEL,
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
  const [providerKeyStatus, setProviderKeyStatus] = useState({});
  // Le catalogue detecte vit dans un store partage (rafraichi silencieusement
  // au demarrage de l'app) : ce compteur force un re-render ET entre dans les
  // deps des valeurs memoizees ci-dessous, pour qu'elles se recalculent quand
  // le store change sans dupliquer son etat ici.
  const [providerModelsTick, setProviderModelsTick] = useState(0);
  const [systemAIProfile, setSystemAIProfile] = useState(null);
  const [isSystemProfileLoading, setIsSystemProfileLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('general');

  // Les secrets restent dans les champs non controles jusqu'au clic Sauvegarder.
  // Ils ne rentrent jamais dans l'etat React ni dans l'evenement settings-updated.
  const providerSecretRefs = useRef({});

  const loadSettings = useCallback(async () => {
    if (!isElectronApiAvailable || !window.electronAPI?.loadSettings) return;
    try {
      const response = await window.electronAPI.loadSettings();
      if (response.success && response.settings) {
        const safeSettings = { ...response.settings };
        PROVIDER_CATALOG.forEach((provider) => {
          if (provider.keyField) delete safeSettings[provider.keyField];
        });
        setProviderKeyStatus(safeSettings.providerKeyStatus || {});
        setSettings(prev => ({
          ...prev,
          ...safeSettings,
          defaultProvider: safeSettings.defaultProvider === 'dashscope'
            ? 'neven'
            : (safeSettings.defaultProvider || prev.defaultProvider),
          multiAgentRoles: normalizeMultiAgentRoles(safeSettings.multiAgentRoles)
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

  // Re-render quand le store partage change : rafraichissement silencieux au
  // demarrage de l'app, ou redetection declenchee ci-dessous par ce composant.
  useEffect(() => {
    const onUpdate = () => setProviderModelsTick((n) => n + 1);
    window.addEventListener(PROVIDER_MODELS_UPDATED_EVENT, onUpdate);
    return () => window.removeEventListener(PROVIDER_MODELS_UPDATED_EVENT, onUpdate);
  }, []);

  // Signature stable des disponibilites : les valeurs de clés ne sont jamais
  // conservées dans le renderer.
  const providerKeysSignature = PROVIDER_CATALOG
    .map((provider) => (provider.keyField ? (providerKeyStatus[provider.id] ? '1' : '0') : 'local'))
    .join('|');

  useEffect(() => {
    if (!isOpen) return undefined;
    const timers = PROVIDER_CATALOG.map((provider) => setTimeout(() => {
      if (provider.keyField && providerKeyStatus[provider.id] !== true) return;
      refreshProviderModel(provider);
    }, 600));
    return () => timers.forEach(clearTimeout);
  }, [isOpen, providerKeysSignature, providerKeyStatus]);

  const getDetection = (providerId) => getProviderModelsState(providerId);

  const getModelOptions = useCallback((provider) => {
    const detected = getDetection(provider.id).models;
    const current = String(settings[provider.modelField] || '').trim();
    return Array.from(new Set([
      ...(detected.length ? detected : provider.fallbackModels),
      current
    ].filter(Boolean)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, providerModelsTick]);

  // Le roster propose tout ce qui est reellement joignable, tous fournisseurs confondus.
  const availableMultiAgentModels = useMemo(() => Array.from(new Set(
    PROVIDER_CATALOG.flatMap((provider) => getModelOptions(provider))
  )), [getModelOptions]);

  const saveSettings = async () => {
    if (!isElectronApiAvailable) {
      showMessage('Erreur: Electron non disponible', 3000);
      return;
    }

    setLoading(true);
    try {
      const normalizedProviderModels = PROVIDER_CATALOG.reduce((acc, provider) => {
        const raw = settings[provider.modelField];
        acc[provider.modelField] = provider.id === 'ollama'
          ? normalizeOllamaModelLabel(raw)
          : normalizeRemoteModelName(raw, provider.defaultModel);
        return acc;
      }, {});

      const normalizedSettings = {
        ...settings,
        ...normalizedProviderModels,
        multiAgentRoles: normalizeMultiAgentRoles(settings.multiAgentRoles),
        localAIMaxConcurrentLocal: Math.max(1, Math.min(4, Number(settings.localAIMaxConcurrentLocal || 1))),
        localAIMaxConcurrentCloud: Math.max(1, Math.min(6, Number(settings.localAIMaxConcurrentCloud || 3))),
        localAIMaxTokens: Math.max(512, Math.min(8192, Number(settings.localAIMaxTokens || 4096)))
      };
      PROVIDER_CATALOG.forEach((provider) => {
        if (provider.keyField) delete normalizedSettings[provider.keyField];
      });

      const response = await window.electronAPI.saveSettings(normalizedSettings);
      if (response.success) {
        const nextProviderKeyStatus = { ...providerKeyStatus };
        for (const provider of PROVIDER_CATALOG) {
          if (!provider.keyField) continue;
          const secret = String(providerSecretRefs.current[provider.id]?.value || '').trim();
          if (!secret) continue;
          if (typeof window.electronAPI.saveProviderKey !== 'function') {
            throw new Error('Enregistrement sécurisé des clés indisponible');
          }
          const keyResponse = await window.electronAPI.saveProviderKey(provider.id, secret);
          if (!keyResponse?.success) {
            throw new Error(keyResponse?.error || `Clé ${provider.label} non enregistrée`);
          }
          nextProviderKeyStatus[provider.id] = true;
          providerSecretRefs.current[provider.id].value = '';
        }
        const safeSettings = { ...normalizedSettings, providerKeyStatus: nextProviderKeyStatus };
        setProviderKeyStatus(nextProviderKeyStatus);
        showMessage('Parametres sauvegardes', 3000);
        window.dispatchEvent(new CustomEvent('settings-updated', { detail: safeSettings }));
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
      // Les champs modele restent bruts pendant la saisie : normaliser a chaque
      // frappe empecherait de vider le champ pour taper un autre modele.
      // La normalisation se fait a la sauvegarde.
      if (field === 'localAIOptimizationMode' && value === 'safe') {
        return { ...prev, [field]: value, localAIHardwareConsent: false };
      }
      return { ...prev, [field]: value };
    });
  };

  const applyModelToProviderRoles = (provider, modelValue) => {
    const model = normalizeRemoteModelName(modelValue, provider.defaultModel);
    if (!model) return;

    setSettings((prev) => {
      const currentRoles = normalizeMultiAgentRoles(prev.multiAgentRoles);
      const nextRoles = Object.fromEntries(
        Object.entries(currentRoles).map(([roleKey, roleConfig]) => [
          roleKey,
          roleConfig.provider === provider.id
            ? { ...roleConfig, model }
            : roleConfig
        ])
      );

      return {
        ...prev,
        multiAgentRoles: normalizeMultiAgentRoles(nextRoles)
      };
    });

    showMessage && showMessage(`${provider.label}: modele applique aux roles`, 2500);
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

  const normalizedMultiAgentRoles = normalizeMultiAgentRoles(settings.multiAgentRoles);

  if (!isOpen) return null;

  const renderDetectionStatus = (provider) => {
    const detection = getDetection(provider.id);
    if (detection.status === 'loading') {
      return <span className="settings-provider-status is-loading">Détection…</span>;
    }
    if (detection.status === 'ok') {
      return (
        <span className="settings-provider-status is-ok">
          {detection.models.length} modèle{detection.models.length > 1 ? 's' : ''} détecté{detection.models.length > 1 ? 's' : ''}
        </span>
      );
    }
    if (detection.status === 'error') {
      return <span className="settings-provider-status is-error">{detection.error}</span>;
    }
    return (
      <span className="settings-provider-status">
        {provider.keyField ? 'Clé requise' : 'Non détecté'}
      </span>
    );
  };

  const renderProviderCard = (provider) => {
    const detection = getDetection(provider.id);
    const modelOptions = getModelOptions(provider);
    const listId = `provider-models-${provider.id}`;

    return (
      <div className="settings-provider" key={provider.id}>
        <div className="settings-provider-head">
          <span className="settings-provider-name">{provider.label}</span>
          <span className={`settings-provider-kind is-${provider.kind}`}>
            {provider.kind === 'local' ? 'Local' : 'Cloud'}
          </span>
          {renderDetectionStatus(provider)}
        </div>

        {provider.keyField && (
          <div className="settings-key">
            <label className="settings-key-label">Clé API</label>
            <input
              type={showApiKeys ? 'text' : 'password'}
              ref={(element) => {
                if (element) providerSecretRefs.current[provider.id] = element;
              }}
              defaultValue=""
              placeholder={providerKeyStatus[provider.id] ? 'Clé enregistrée — saisir pour remplacer' : provider.keyPlaceholder}
              className={`settings-input ${detection.status === 'error' ? 'is-invalid' : ''}`}
              aria-label={`Clé API ${provider.label}`}
            />
            <div className="settings-hint">Clé conservée dans le coffre local chiffré. Laisser vide pour conserver la clé actuelle.</div>
          </div>
        )}

        <div className="settings-key">
          <label className="settings-key-label">Modèle</label>
          <input
            type="text"
            list={listId}
            value={settings[provider.modelField] || provider.defaultModel}
            onChange={(e) => handleChange(provider.modelField, e.target.value)}
            placeholder={provider.defaultModel}
            className="settings-input"
            aria-label={`Modèle ${provider.label}`}
          />
          <datalist id={listId}>
            {modelOptions.map((modelName) => (
              <option key={`${provider.id}-${modelName}`} value={modelName} />
            ))}
          </datalist>
          <div className="settings-hint">
            {provider.keyHint}
            {detection.status !== 'ok' && ' — liste de repli affichée tant que la détection n’a pas abouti.'}
          </div>
        </div>

        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => applyModelToProviderRoles(provider, settings[provider.modelField] || provider.defaultModel)}
        >
          Appliquer ce modèle aux rôles {provider.label}
        </button>
      </div>
    );
  };

  return (
    // Hôte : contenu d'onglet (plan-ia-onglets.md §④), plus une modale — le
    // contenu interne (onglets, sections, formulaires) est inchangé.
    <div className="settings-pane">
      <div className="settings-header">
        <div>
          <div className="settings-title">Settings</div>
          <div className="settings-subtitle">Configuration IA et projet</div>
        </div>
        <button type="button" onClick={onClose} className="settings-close" title="Fermer l'onglet Paramètres">X</button>
      </div>

        <div className="settings-tabs">
          {SETTINGS_TABS.map(({ id, Icon, label }) => (
            <button
              key={id}
              type="button"
              className={`settings-tab ${activeTab === id ? 'is-active' : ''}`}
              onClick={() => setActiveTab(id)}
            >
              <Icon size={15} className="settings-tab-icon" />
              <span className="settings-tab-label">{label}</span>
            </button>
          ))}
        </div>

        <div className="settings-body custom-scrollbar">
          {activeTab === 'general' && (<>
          <div className="settings-section">
            <label className="settings-label">Fournisseur par défaut</label>
            <select
              value={settings.defaultProvider}
              onChange={(e) => handleChange('defaultProvider', e.target.value)}
              className="settings-input"
              aria-label="Fournisseur par défaut"
            >
              {PROVIDER_CATALOG.map((provider) => (
                <option key={`default-${provider.id}`} value={provider.id}>{provider.label}</option>
              ))}
              <option value="neven">Neven IA</option>
              <option value="multi">Équipe d&apos;agents</option>
            </select>
            <div className="settings-hint">
              « Équipe d&apos;agents » délègue la demande au roster configuré dans l&apos;onglet Agents,
              au lieu d&apos;interroger un seul fournisseur.
            </div>
          </div>

          <div className="settings-section">
            <label className="settings-label">Port serveur dev</label>
            <input
              type="text"
              value={settings.devPort}
              onChange={(e) => handleChange('devPort', e.target.value)}
              placeholder="3004"
              className="settings-input"
              aria-label="Port serveur dev"
            />
          </div>
          </>)}

          {activeTab === 'appearance' && (<>
          <div className="settings-section">
            <label className="settings-label">Thème</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="settings-hint" style={{ margin: 0 }}>Thème :</span>
              <ThemeSwitcher theme={theme} onThemeChange={onThemeChange} />
            </div>
          </div>
          </>)}

          {activeTab === 'providers' && (<>
          <div className="settings-section">
            <div className="settings-row">
              <label className="settings-label">Fournisseurs</label>
              <button
                type="button"
                onClick={() => setShowApiKeys(!showApiKeys)}
                className="settings-link"
              >
                {showApiKeys ? 'Masquer les clés' : 'Afficher les clés'}
              </button>
            </div>
            <div className="settings-hint">
              Les modèles sont lus directement chez le fournisseur dès qu&apos;une clé valide est saisie.
              Les champs restent libres : un modèle publié après cette version peut être saisi à la main.
            </div>

            <div className="settings-provider-grid">
              {PROVIDER_CATALOG.map(renderProviderCard)}
            </div>
          </div>

          <div className="settings-section">
            <label className="settings-label">Exécution locale (Ollama)</label>
            <select
              value={settings.localAIOptimizationMode || 'safe'}
              onChange={(e) => handleChange('localAIOptimizationMode', e.target.value)}
              className="settings-input"
              aria-label="Mode d'exécution locale (Ollama)"
            >
              <option value="safe">Privé / Safe</option>
              <option value="auto">Auto-adaptatif</option>
              <option value="manual">Manuel expert</option>
            </select>
            <div className="settings-hint">
              Safe ne lit pas la configuration PC et limite Ollama a un agent local. Auto lit CPU/RAM/GPU uniquement apres accord explicite.
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
                  aria-label="Agents Ollama locaux simultanes"
                />
                <input
                  type="number"
                  min="1"
                  max="6"
                  value={settings.localAIMaxConcurrentCloud || 3}
                  onChange={(e) => handleChange('localAIMaxConcurrentCloud', Number(e.target.value || 3))}
                  className="settings-input"
                  title="Agents API/cloud simultanes"
                  aria-label="Agents API/cloud simultanes"
                />
                <select
                  value={settings.localAIContextBudget || 'short'}
                  onChange={(e) => handleChange('localAIContextBudget', e.target.value)}
                  className="settings-input"
                  aria-label="Budget de contexte"
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
                  aria-label="Tokens max par agent"
                />
              </div>
            )}
          </div>
          </>)}

          {activeTab === 'agents' && (<>
          <datalist id="multi-agent-model-suggestions">
            {availableMultiAgentModels.map((modelName) => (
              <option key={`multi-agent-model-${modelName}`} value={modelName} />
            ))}
          </datalist>

          <div className="settings-section">
            <label className="settings-label">Roster d&apos;agents</label>
            <div className="settings-hint">
              Utilisé quand le fournisseur par défaut est « Équipe d&apos;agents », ou quand le mode
              d&apos;exécution automatique décide de constituer une équipe. L&apos;orchestrateur compose
              la formation selon la demande ; ces réglages fixent le fournisseur et le modèle de chaque rôle.
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
                        aria-label={`Fournisseur pour ${role.title}`}
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
                        aria-label={`Modèle pour ${role.title}`}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          </>)}

          {activeTab === 'execution' && (<>
          <datalist id="router-classifier-model-suggestions">
            {availableMultiAgentModels.map((modelName) => (
              <option key={`router-classifier-model-${modelName}`} value={modelName} />
            ))}
          </datalist>

          <div className="settings-section">
            <label className="settings-label">Choix du mode d&apos;exécution</label>
            <div className="settings-hint">
              Manuel : vous choisissez vous-meme le mode d&apos;execution (Ask / Plan / Agent) pour chaque demande.
              Automatique : l&apos;application décide à votre place.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.78rem', color: 'var(--text-1)' }}>
                <input
                  type="radio"
                  name="router-activation-mode"
                  checked={!autoRoute}
                  onChange={() => onAutoRouteChange && onAutoRouteChange(false)}
                />
                <span>Manuel</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.78rem', color: 'var(--text-1)' }}>
                <input
                  type="radio"
                  name="router-activation-mode"
                  checked={!!autoRoute}
                  onChange={() => onAutoRouteChange && onAutoRouteChange(true)}
                />
                <span>Automatique</span>
              </label>
            </div>
            <div className="settings-hint">
              Une heuristique locale (&lt;100ms, sans appel reseau) tranche les cas triviaux ; un modèle léger
              (temperature 0.1) tranche les cas ambigus entre agent simple et équipe.
            </div>
          </div>

          <div className="settings-section">
            <label className="settings-label">Modèle de classification</label>
            <div className="settings-hint">
              Modele leger utilise pour trancher les cas ambigus. Independant des modeles utilises pour repondre a la demande.
              Laissez sur « Fournisseur actif du chat » pour reutiliser automatiquement celui en cours.
              La clé employée est celle déjà saisie dans l&apos;onglet Fournisseurs.
            </div>
            <div className="settings-agent-controls">
              <select
                value={routerClassifierProvider || ''}
                onChange={(e) => onRouterClassifierProviderChange && onRouterClassifierProviderChange(e.target.value || null)}
                className="settings-input"
                aria-label="Fournisseur du modèle de classification"
              >
                <option value="">Fournisseur actif du chat (par defaut)</option>
                {AI_PROVIDER_OPTIONS.map((providerOption) => (
                  <option key={`router-classifier-${providerOption.value}`} value={providerOption.value}>
                    {providerOption.label}
                  </option>
                ))}
              </select>
              <input
                type="text"
                list="router-classifier-model-suggestions"
                value={routerClassifierModel || ''}
                onChange={(e) => onRouterClassifierModelChange && onRouterClassifierModelChange(e.target.value || null)}
                placeholder={routerClassifierProvider ? getDefaultModelForProvider(routerClassifierProvider) : 'Modele leger par defaut'}
                className="settings-input"
                aria-label="Modèle de classification"
              />
            </div>
          </div>

          <div className="settings-section">
            <label className="settings-label">Seuil de complexité</label>
            <div className="settings-hint">
              Plus le curseur est bas, plus l&apos;heuristique locale tranche seule sans appel reseau.
              Plus il est haut, plus les cas ambigus sont envoyes au modele de classification.
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="settings-hint" style={{ margin: 0 }}>Simple</span>
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={Math.round((routerComplexityThreshold ?? 0.5) * 100)}
                onChange={(e) => onRouterComplexityThresholdChange && onRouterComplexityThresholdChange(Number(e.target.value) / 100)}
                style={{ flex: 1 }}
                aria-label="Seuil de complexité"
                aria-valuetext={`${Math.round((routerComplexityThreshold ?? 0.5) * 100)}%`}
              />
              <span className="settings-hint" style={{ margin: 0 }}>Complexe</span>
              <span className="settings-hint" style={{ margin: 0, minWidth: 30, textAlign: 'right' }}>
                {Math.round((routerComplexityThreshold ?? 0.5) * 100)}
              </span>
            </div>
          </div>
          </>)}

          {activeTab === 'permissions' && (<>
          <div className="settings-section">
            <label className="settings-label">Niveau d&apos;accès</label>
            <select
              value={settings.permissionMode || 'edit_terminal'}
              onChange={(e) => handleChange('permissionMode', e.target.value)}
              className="settings-input"
              aria-label="Niveau d'accès"
            >
              <option value="read_only">Lecture seule</option>
              <option value="edit">Edition (sans terminal)</option>
              <option value="edit_terminal">Edition + terminal</option>
            </select>
            <div className="settings-hint">
              Lecture seule bloque les modifications. Edition bloque uniquement les commandes terminal.
            </div>
          </div>

          <div className="settings-section">
            <label className="settings-label">Confirmations</label>
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={settings.aiTerminalApprovalMode !== false}
                onChange={(e) => handleChange('aiTerminalApprovalMode', e.target.checked)}
              />
              <span>Demander confirmation avant chaque commande terminal IA</span>
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
                checked={settings.thinkingMode}
                onChange={(e) => handleChange('thinkingMode', e.target.checked)}
              />
              <span>Afficher le raisonnement du modele (plus lent)</span>
            </label>
            {/* Le cout est reel et paye en secondes d'attente : le raisonnement
                triple a decuple le nombre de tokens generes. Sur Ollama en
                local, c'est le CPU qui encaisse. */}
            <p className="settings-hint">
              Le modele redige un brouillon avant sa reponse, affiche dans un bloc
              repliable. Sans rapport avec la taille du modele (4b / 8b) : c&apos;est
              un comportement, pas un fichier different.
              {settings.defaultProvider === 'ollama'
                ? ' En local sur CPU, multiplie le temps de reponse par 3 a 10.'
                : ''}
            </p>
          </div>
          </>)}

          {activeTab === 'context' && (<>
          <div className="settings-section">
            <label className="settings-label">Contexte IA (scan projet)</label>
            <select
              value={settings.aiContextPreset || 'safe'}
              onChange={(e) => handleChange('aiContextPreset', e.target.value)}
              className="settings-input"
              aria-label="Contexte IA (scan projet)"
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
              aria-label="Stratégie pour les fichiers volumineux"
            >
              <option value="skip">Ignorer</option>
              <option value="truncate">Tronquer</option>
            </select>

            <label className="settings-label" style={{ marginTop: '10px' }}>Mode de contexte injecte</label>
            <select
              value={settings.contextMode || 'auto'}
              onChange={(e) => handleChange('contextMode', e.target.value)}
              className="settings-input"
              aria-label="Mode de contexte injecte"
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
              aria-label="Nombre maximum de fichiers dans le contexte"
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

          {activeTab === 'mcp' && (
            <div className="settings-section">
              <label className="settings-label">Connecteurs MCP</label>
              <p className="settings-hint">
                La gestion des connecteurs, du registre et des statuts live a été déplacée dans la vue
                Extensions &amp; Connecteurs.
              </p>
              <button type="button" className="btn btn-primary" onClick={onOpenExtensions}>
                Ouvrir Extensions &amp; Connecteurs
              </button>
            </div>
          )}

          {activeTab === 'extensions' && (
            <div className="settings-section settings-empty-section">
              <label className="settings-label">Extensions</label>
              <p className="settings-hint">
                Aucune extension pour le moment. Cette section est prête à accueillir un futur
                système d&apos;extensions — rien à configurer ici pour l&apos;instant.
              </p>
            </div>
          )}

          {activeTab === 'shortcuts' && (
            <div className="settings-section">
              <label className="settings-label">Raccourcis clavier</label>
              <div className="settings-hint">
                Ces raccourcis sont globaux et fonctionnent depuis n&apos;importe quel onglet.
              </div>
              <table className="settings-shortcuts-table">
                <tbody>
                  {SHORTCUT_LIST.map((shortcut) => (
                    <tr key={shortcut.keys}>
                      <td><kbd>{shortcut.keys}</kbd></td>
                      <td>{shortcut.action}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="settings-footer">
          <button type="button" onClick={onClose} className="btn btn-ghost">
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
  );
};

export default Settings;
