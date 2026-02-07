import React, { useState, useEffect } from 'react';

const Settings = ({ isOpen, onClose, isElectronApiAvailable, showMessage }) => {
  const [settings, setSettings] = useState({
    geminiApiKey: '',
    kimiApiKey: '',
    defaultProvider: 'gemini',
    thinkingMode: false,
    devPort: '3004',
    allowDangerousActions: false
  });

  const [loading, setLoading] = useState(false);
  const [showApiKeys, setShowApiKeys] = useState(false);
  const [validation, setValidation] = useState({ gemini: null, kimi: null });

  // Charger les settings au montage
  useEffect(() => {
    if (isOpen && isElectronApiAvailable) {
      loadSettings();
    }
  }, [isOpen, isElectronApiAvailable]);

  // Ping de validation Gemini (débounce)
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

  // Ping de validation Kimi (débounce)
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
    if (status === 'valid') return <span className="text-green-400 ml-2">✓</span>;
    if (status === 'invalid') return <span className="text-red-400 ml-2">✗</span>;
    return null;
  };

  const getValidationMessage = (keyType) => {
    if (keyType === 'gemini' && validation.gemini === 'invalid') {
      return <span className="text-xs text-red-400 mt-1">Clé Gemini invalide (ping échoué)</span>;
    }
    if (keyType === 'kimi' && validation.kimi === 'invalid') {
      return <span className="text-xs text-red-400 mt-1">Clé Kimi invalide (ping échoué)</span>;
    }
    return null;
  };

  const loadSettings = async () => {
    try {
      const response = await window.electronAPI.loadSettings();
      if (response.success && response.settings) {
        setSettings(prev => ({ ...prev, ...response.settings }));
      }
    } catch (error) {
      console.error('Erreur chargement settings:', error);
      showMessage('Erreur chargement des paramètres', 3000);
    }
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
        showMessage('Paramètres sauvegardés', 3000);
        window.dispatchEvent(new CustomEvent('settings-updated', { detail: settings }));
        onClose();
      } else {
        showMessage(`Erreur: ${response.error}`, 4000);
      }
    } catch (error) {
      console.error('Erreur sauvegarde settings:', error);
      showMessage('Erreur sauvegarde des paramètres', 3000);
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (field, value) => {
    setSettings(prev => ({ ...prev, [field]: value }));
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-gray-900 text-white rounded-lg p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">Paramètres</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-xl leading-none"
          >
            ×
          </button>
        </div>

        <div className="space-y-4">
          {/* Provider par défaut */}
          <div>
            <label className="block text-sm font-medium mb-1">Provider IA par défaut</label>
            <select
              value={settings.defaultProvider}
              onChange={(e) => handleChange('defaultProvider', e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white"
            >
              <option value="gemini">Gemini (Google)</option>
              <option value="kimi">Kimi (Together)</option>
              <option value="multi">Multi-IA (Gemini+Kimi)</option>
            </select>
          </div>

          {/* Mode Thinking */}
          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="thinkingMode"
              checked={settings.thinkingMode}
              onChange={(e) => handleChange('thinkingMode', e.target.checked)}
              className="rounded"
            />
            <label htmlFor="thinkingMode" className="text-sm">
              Activer le mode &quot;Thinking&quot; (réflexion visible)
            </label>
          </div>

          {/* Actions risquées / Always proceed */}
          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="allowDangerousActions"
              checked={settings.allowDangerousActions}
              onChange={(e) => handleChange('allowDangerousActions', e.target.checked)}
              className="rounded"
            />
            <label htmlFor="allowDangerousActions" className="text-sm">
              Autoriser les actions risquées sans confirmation (mode &quot;always proceed&quot;)
            </label>
          </div>

          {/* Port de développement */}
          <div>
            <label className="block text-sm font-medium mb-1">Port serveur dev (pour développement)</label>
            <input
              type="text"
              value={settings.devPort}
              onChange={(e) => handleChange('devPort', e.target.value)}
              placeholder="3004"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white"
            />
          </div>

          {/* Clés API */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium">Clés API</label>
              <button
                type="button"
                onClick={() => setShowApiKeys(!showApiKeys)}
                className="text-xs text-blue-400 hover:text-blue-300"
              >
                {showApiKeys ? 'Masquer' : 'Afficher'}
              </button>
            </div>

            {/* Gemini API Key */}
            <div className="mb-3">
              <label className="block text-xs text-gray-400 mb-1 flex items-center">
                Gemini API Key
                {getValidationIcon(validation.gemini)}
              </label>
              <input
                type={showApiKeys ? 'text' : 'password'}
                value={settings.geminiApiKey}
                onChange={(e) => handleChange('geminiApiKey', e.target.value)}
                placeholder="AIza..."
                className={`w-full px-3 py-2 bg-gray-800 border rounded text-white text-sm ${
                  validation.gemini === 'invalid' ? 'border-red-500' : 'border-gray-700'
                }`}
              />
              {getValidationMessage('gemini')}
            </div>

            {/* Kimi/Together API Key */}
            <div>
              <label className="block text-xs text-gray-400 mb-1 flex items-center">
                Kimi/Together API Key
                {getValidationIcon(validation.kimi)}
              </label>
              <input
                type={showApiKeys ? 'text' : 'password'}
                value={settings.kimiApiKey}
                onChange={(e) => handleChange('kimiApiKey', e.target.value)}
                placeholder="tgp_v1_..."
                className={`w-full px-3 py-2 bg-gray-800 border rounded text-white text-sm ${
                  validation.kimi === 'invalid' ? 'border-red-500' : 'border-gray-700'
                }`}
              />
              {getValidationMessage('kimi')}
            </div>
          </div>
        </div>

        <div className="flex justify-end space-x-2 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-400 hover:text-white"
          >
            Annuler
          </button>
          <button
            onClick={saveSettings}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded"
          >
            {loading ? 'Sauvegarde...' : 'Sauvegarder'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Settings;
