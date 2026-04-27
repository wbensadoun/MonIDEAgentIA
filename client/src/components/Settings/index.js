import React, { useState, useEffect, useCallback } from 'react';
import './Settings.css';
import McpSettings from './McpSettings';

const Settings = ({ isOpen, onClose, isElectronApiAvailable, showMessage }) => {
  const suggestedOllamaModels = [
    'qwen3.6:latest',
    'qwen3.6-27b',
    'qwen3:8b',
    'qwen3:14b',
    'qwen3:32b'
  ];

  const [settings, setSettings] = useState({
    geminiApiKey: '',
    kimiApiKey: '',
    claudeApiKey: '',
    defaultProvider: 'gemini',
    thinkingMode: false,
    ollamaModel: 'qwen3:8b',
    ollamaModelArchitect: 'qwen3:8b',
    ollamaModelCoder: 'qwen3:8b',
    ollamaModelTester: 'qwen3:8b',
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
    contextMaxFiles: 120
  });

  const [loading, setLoading] = useState(false);
  const [showApiKeys, setShowApiKeys] = useState(false);
  const [validation, setValidation] = useState({ gemini: null, kimi: null, claude: null });
  const [ollamaModels, setOllamaModels] = useState([]);

  const loadSettings = useCallback(async () => {
    if (!isElectronApiAvailable || !window.electronAPI?.loadSettings) return;
    try {
      const response = await window.electronAPI.loadSettings();
      if (response.success && response.settings) {
        setSettings(prev => ({ ...prev, ...response.settings }));
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
      const response = await window.electronAPI.saveSettings(settings);
      if (response.success) {
        showMessage('Parametres sauvegardes', 3000);
        window.dispatchEvent(new CustomEvent('settings-updated', { detail: settings }));
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
    setSettings(prev => ({ ...prev, [field]: value }));
  };

  const availableOllamaModels = Array.from(new Set([
    ...suggestedOllamaModels,
    settings.ollamaModel,
    settings.ollamaModelArchitect,
    settings.ollamaModelCoder,
    settings.ollamaModelTester,
    ...ollamaModels
  ].map((m) => String(m || '').trim()).filter(Boolean)));

  if (!isOpen) return null;

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

        <div className="settings-body custom-scrollbar">
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
              <option value="ollama-multi">Multi-Ollama</option>
            </select>
          </div>

          <div className="settings-section">
            <label className="settings-label">Modeles Ollama</label>
            <div className="settings-hint">
              Utilises pour Ollama simple et Multi-Ollama (Architecte / Codeur / Relecteur).
            </div>
            <div className="settings-hint">
              Presets proposes: qwen3.6:latest, qwen3:8b, qwen3:14b (installer via `ollama pull` si absent localement).
            </div>

            <label className="settings-label">Modele Ollama simple</label>
            <select
              value={settings.ollamaModel || 'qwen3:8b'}
              onChange={(e) => handleChange('ollamaModel', e.target.value)}
              className="settings-input"
            >
              {availableOllamaModels.length === 0 && (
                <option value={settings.ollamaModel || 'qwen3:8b'}>
                  {settings.ollamaModel || 'qwen3:8b'}
                </option>
              )}
              {availableOllamaModels.map((modelName) => (
                <option key={`ollama-${modelName}`} value={modelName}>{modelName}</option>
              ))}
            </select>

            <label className="settings-label">Architecte (Multi-Ollama)</label>
            <select
              value={settings.ollamaModelArchitect || settings.ollamaModel || 'qwen3:8b'}
              onChange={(e) => handleChange('ollamaModelArchitect', e.target.value)}
              className="settings-input"
            >
              {availableOllamaModels.map((modelName) => (
                <option key={`arch-${modelName}`} value={modelName}>{modelName}</option>
              ))}
            </select>

            <label className="settings-label">Codeur (Multi-Ollama)</label>
            <select
              value={settings.ollamaModelCoder || settings.ollamaModel || 'qwen3:8b'}
              onChange={(e) => handleChange('ollamaModelCoder', e.target.value)}
              className="settings-input"
            >
              {availableOllamaModels.map((modelName) => (
                <option key={`coder-${modelName}`} value={modelName}>{modelName}</option>
              ))}
            </select>

            <label className="settings-label">Relecteur (Multi-Ollama)</label>
            <select
              value={settings.ollamaModelTester || settings.ollamaModel || 'qwen3:8b'}
              onChange={(e) => handleChange('ollamaModelTester', e.target.value)}
              className="settings-input"
            >
              {availableOllamaModels.map((modelName) => (
                <option key={`tester-${modelName}`} value={modelName}>{modelName}</option>
              ))}
            </select>
          </div>

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

          <div className="settings-section">
            <McpSettings
              isElectronApiAvailable={isElectronApiAvailable}
              showMessage={showMessage}
            />
          </div>

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
