import React, { useState, useEffect, useCallback } from 'react';
import './Settings.css';

const Settings = ({ isOpen, onClose, isElectronApiAvailable, showMessage }) => {
  const [settings, setSettings] = useState({
    geminiApiKey: '',
    kimiApiKey: '',
    defaultProvider: 'gemini',
    thinkingMode: false,
    devPort: '3004',
    allowDangerousActions: false,
    aiContextPreset: 'safe',
    aiContextIncludeSecrets: false,
    aiContextLargeFileStrategy: 'skip'
  });

  const [loading, setLoading] = useState(false);
  const [showApiKeys, setShowApiKeys] = useState(false);
  const [validation, setValidation] = useState({ gemini: null, kimi: null });

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
              <option value="kimi">Kimi</option>
              <option value="multi">Multi-IA</option>
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
              <option value="god">God (build + node_modules)</option>
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
                value={settings.kimiApiKey}
                onChange={(e) => handleChange('kimiApiKey', e.target.value)}
                placeholder="tgp_v1_..."
                className={`settings-input ${validation.kimi === 'invalid' ? 'is-invalid' : ''}`}
              />
              {getValidationMessage('kimi')}
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
