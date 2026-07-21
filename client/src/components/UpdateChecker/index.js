import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './UpdateChecker.css';
import { DEFAULT_OLLAMA_MODEL, normalizeOllamaModelLabel } from '../../utils/ollamaModels';

const CHECK_INTERVAL_MS = 5 * 60 * 1000;

const MODEL_FIELDS = [
  { key: 'ollamaModel', label: 'Ollama' }
];

const normalizeModelName = (value) => String(value || '').trim();

const buildConfiguredModels = (settings = {}) => {
  const primaryModel = normalizeOllamaModelLabel(settings.ollamaModel, DEFAULT_OLLAMA_MODEL);
  if (!primaryModel) return [];
  return [{ model: primaryModel, roles: ['Ollama'] }];
};

const getPullStateKind = (status) => {
  const normalized = normalizeModelName(status).toLowerCase();
  if (!normalized) return '';
  if (normalized === 'success') return 'success';
  if (normalized === 'error') return 'error';
  return 'downloading';
};

const getProgressPercent = (completed, total) => {
  const done = Number(completed);
  const full = Number(total);
  if (!Number.isFinite(done) || !Number.isFinite(full) || full <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((done / full) * 100)));
};

const UpdateChecker = ({ isElectronApiAvailable, showMessage }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [configuredModels, setConfiguredModels] = useState([]);
  const [statusByModel, setStatusByModel] = useState({});
  const [pullStates, setPullStates] = useState({});
  const [checkError, setCheckError] = useState('');
  const [isInstallingOllama, setIsInstallingOllama] = useState(false);
  const [isStartingOllama, setIsStartingOllama] = useState(false);
  const containerRef = useRef(null);
  const configuredModelsRef = useRef([]);

  const loadConfiguredModels = useCallback(async () => {
    if (!isElectronApiAvailable || !window.electronAPI?.loadSettings) {
      configuredModelsRef.current = [];
      setConfiguredModels([]);
      return [];
    }

    try {
      const response = await window.electronAPI.loadSettings();
      const nextModels = buildConfiguredModels(response?.success ? response.settings : {});
      configuredModelsRef.current = nextModels;
      setConfiguredModels(nextModels);
      return nextModels;
    } catch {
      const fallbackModels = buildConfiguredModels({});
      configuredModelsRef.current = fallbackModels;
      setConfiguredModels(fallbackModels);
      return fallbackModels;
    }
  }, [isElectronApiAvailable]);

  const checkUpdates = useCallback(async (modelsInput) => {
    if (!isElectronApiAvailable || !window.electronAPI?.checkOllamaUpdates) {
      setStatusByModel({});
      setCheckError('');
      return;
    }

    const models = Array.isArray(modelsInput) ? modelsInput : configuredModelsRef.current;
    const modelNames = models.map((entry) => normalizeModelName(entry?.model)).filter(Boolean);
    if (modelNames.length === 0) {
      setStatusByModel({});
      setCheckError('');
      return;
    }

    setIsChecking(true);
    try {
      const response = await window.electronAPI.checkOllamaUpdates(modelNames);
      if (!response?.success || !Array.isArray(response.models)) {
        throw new Error(response?.error || 'Verification Ollama impossible.');
      }

      const nextStatusByModel = {};
      let nextError = '';

      response.models.forEach((entry) => {
        const model = normalizeModelName(entry?.model);
        if (!model) return;
        nextStatusByModel[model] = {
          status: normalizeModelName(entry?.status) || 'error',
          error: normalizeModelName(entry?.error)
        };
        if (!nextError && entry?.status === 'error' && entry?.error) {
          nextError = String(entry.error);
        }
      });

      setStatusByModel(nextStatusByModel);
      setCheckError(nextError);
    } catch (error) {
      const message = error?.message || 'Verification Ollama impossible.';
      const nextStatusByModel = {};
      modelNames.forEach((model) => {
        nextStatusByModel[model] = { status: 'error', error: message };
      });
      setStatusByModel(nextStatusByModel);
      setCheckError(message);
    } finally {
      setIsChecking(false);
    }
  }, [isElectronApiAvailable]);

  const refreshModels = useCallback(async () => {
    const models = await loadConfiguredModels();
    await checkUpdates(models);
    // Rafraichit le catalogue dynamique (famille la plus recente + tailles) cote App.
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('ollama-models-refreshed'));
    }
  }, [checkUpdates, loadConfiguredModels]);

  useEffect(() => {
    if (!isElectronApiAvailable) return undefined;

    refreshModels();
    const intervalId = window.setInterval(() => {
      refreshModels();
    }, CHECK_INTERVAL_MS);

    const handleSettingsUpdated = () => {
      refreshModels();
    };

    window.addEventListener('settings-updated', handleSettingsUpdated);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('settings-updated', handleSettingsUpdated);
    };
  }, [isElectronApiAvailable, refreshModels]);

  useEffect(() => {
    if (!isElectronApiAvailable || !window.electronAPI?.onOllamaPullProgress) {
      return undefined;
    }

    return window.electronAPI.onOllamaPullProgress((payload) => {
      const model = normalizeModelName(payload?.model);
      if (!model) return;

      const statusKind = getPullStateKind(payload?.status);

      if (statusKind === 'success') {
        setPullStates((prev) => {
          const next = { ...prev };
          delete next[model];
          return next;
        });
        setStatusByModel((prev) => ({
          ...prev,
          [model]: { status: 'installed', error: '' }
        }));
        setCheckError('');
        return;
      }

      setPullStates((prev) => ({
        ...prev,
        [model]: {
          status: statusKind || 'downloading',
          label: normalizeModelName(payload?.status) || 'pulling',
          completed: Number.isFinite(Number(payload?.completed)) ? Number(payload.completed) : null,
          total: Number.isFinite(Number(payload?.total)) ? Number(payload.total) : null,
          error: normalizeModelName(payload?.error)
        }
      }));

      if (statusKind === 'error') {
        setStatusByModel((prev) => ({
          ...prev,
          [model]: {
            status: 'error',
            error: normalizeModelName(payload?.error) || prev?.[model]?.error || 'Telechargement Ollama impossible.'
          }
        }));
      }
    });
  }, [isElectronApiAvailable]);

  useEffect(() => {
    if (!isOpen) return undefined;

    const handlePointerDown = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handleInstall = useCallback(async (model) => {
    if (!window.electronAPI?.pullOllamaModel) return;

    setPullStates((prev) => ({
      ...prev,
      [model]: {
        status: 'downloading',
        label: 'starting',
        completed: 0,
        total: 0,
        error: ''
      }
    }));

    if (showMessage) {
      showMessage('Telechargement Ollama lance. Les gros modeles peuvent prendre plusieurs minutes.', 4500);
    }

    try {
      const response = await window.electronAPI.pullOllamaModel(model);
      if (!response?.success) {
        throw new Error(response?.error || `Téléchargement impossible pour ${model}.`);
      }
      await checkUpdates(configuredModelsRef.current);
      if (showMessage) {
        showMessage(`Modèle Ollama disponible: ${model}`, 3000);
      }
    } catch (error) {
      const message = error?.message || `Téléchargement impossible pour ${model}.`;
      setPullStates((prev) => ({
        ...prev,
        [model]: {
          status: 'error',
          label: 'error',
          completed: null,
          total: null,
          error: message
        }
      }));
      setStatusByModel((prev) => ({
        ...prev,
        [model]: { status: 'error', error: message }
      }));
      if (showMessage) {
        showMessage(message, 5000);
      }
    }
  }, [checkUpdates, showMessage]);

  const handleStartOllama = useCallback(async () => {
    if (!window.electronAPI?.startOllama) return;
    setIsStartingOllama(true);
    try {
      const response = await window.electronAPI.startOllama();
      if (!response?.success) {
        throw new Error(response?.error || 'Demarrage Ollama impossible.');
      }
      showMessage && showMessage('Ollama demarre.', 2500);
      await refreshModels();
    } catch (error) {
      showMessage && showMessage(error?.message || 'Demarrage Ollama impossible.', 4500);
    } finally {
      setIsStartingOllama(false);
    }
  }, [refreshModels, showMessage]);

  const handleInstallOllama = useCallback(async () => {
    if (!window.electronAPI?.installOllama) return;
    setIsInstallingOllama(true);
    try {
      const response = await window.electronAPI.installOllama();
      if (!response?.success) {
        throw new Error(response?.error || 'Installation Ollama impossible.');
      }
      showMessage && showMessage(
        response.openedDownload
          ? 'Page officielle Ollama ouverte.'
          : 'Ollama installe ou deja disponible.',
        3500
      );
      await refreshModels();
    } catch (error) {
      showMessage && showMessage(error?.message || 'Installation Ollama impossible.', 5000);
    } finally {
      setIsInstallingOllama(false);
    }
  }, [refreshModels, showMessage]);

  const effectiveModels = useMemo(() => {
    const statusOrder = { error: 0, downloading: 1, missing: 2, installed: 3 };

    return configuredModels
      .map((entry) => {
        const model = entry.model;
        const baseState = statusByModel[model] || {};
        const pullState = pullStates[model] || null;
        const pullKind = pullState ? getPullStateKind(pullState.status) : '';

        let status = baseState.status || 'missing';
        let error = baseState.error || '';

        if (pullKind === 'downloading') {
          status = 'downloading';
        } else if (pullKind === 'error') {
          status = 'error';
          error = pullState.error || error;
        }

        const progressPercent = getProgressPercent(pullState?.completed, pullState?.total);
        return {
          ...entry,
          status,
          error,
          progressPercent,
          pullLabel: pullState?.label || '',
          pullState
        };
      })
      .sort((a, b) => {
        const statusDiff = (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99);
        if (statusDiff !== 0) return statusDiff;
        return a.model.localeCompare(b.model);
      });
  }, [configuredModels, pullStates, statusByModel]);

  const missingCount = effectiveModels.filter((entry) => entry.status === 'missing').length;
  const activePullCount = effectiveModels.filter((entry) => entry.status === 'downloading').length;
  const hasError = effectiveModels.some((entry) => entry.status === 'error') || !!checkError;
  const totalVisibleModels = effectiveModels.length;
  const actionableModels = effectiveModels.filter((entry) => entry.status !== 'installed');
  const installedCount = effectiveModels.length - actionableModels.length;

  if (!isElectronApiAvailable || totalVisibleModels === 0) {
    return null;
  }

  let badgeLabel = `🔄 ${missingCount} update${missingCount > 1 ? 's' : ''}`;
  let badgeClassName = 'update-checker-trigger';

  if (activePullCount > 0) {
    badgeLabel = `⏳ ${activePullCount} telechargement${activePullCount > 1 ? 's' : ''}`;
    badgeClassName += ' is-active';
  } else if (hasError) {
    badgeLabel = '⚠ Ollama';
    badgeClassName += ' is-error';
  } else if (missingCount === 0) {
    badgeLabel = 'Ollama OK';
  } else {
    badgeClassName += ' is-pulsing';
  }

  return (
    <div className="update-checker" ref={containerRef}>
      <button
        type="button"
        className={badgeClassName}
        onClick={() => {
          const nextOpen = !isOpen;
          setIsOpen(nextOpen);
          if (nextOpen) {
            refreshModels();
          }
        }}
        title="Verifier Ollama et installer les modeles locaux manquants"
      >
        <span>{badgeLabel}</span>
        {isChecking && <span className="update-checker-spinner" aria-hidden="true"></span>}
      </button>

      {isOpen && (
        <div className="update-checker-panel">
          <div className="update-checker-panel-header">
            <div>
              <div className="update-checker-title">Ollama local</div>
              <div className="update-checker-subtitle">
                Vérification des modèles locaux sélectionnés. Le choix du modèle actif se fait dans la barre du haut.
              </div>
            </div>
            <button type="button" className="update-checker-refresh" onClick={refreshModels}>
              Vérifier
            </button>
          </div>

          {checkError && (
            <div className="update-checker-error-box">
              <div className="update-checker-error-title">Ollama indisponible</div>
              <div className="update-checker-error-text">{checkError}</div>
              <div className="update-checker-error-actions">
                <button
                  type="button"
                  className="update-checker-secondary"
                  onClick={handleStartOllama}
                  disabled={isStartingOllama || isInstallingOllama}
                >
                  {isStartingOllama ? 'Demarrage...' : 'Demarrer Ollama'}
                </button>
                <button
                  type="button"
                  className="update-checker-install"
                  onClick={handleInstallOllama}
                  disabled={isStartingOllama || isInstallingOllama}
                >
                  {isInstallingOllama ? 'Installation...' : 'Installer Ollama'}
                </button>
              </div>
            </div>
          )}

          <div className="update-checker-list">
            {actionableModels.length === 0 && !checkError && (
              <div className="update-checker-ready">
                <div className="update-checker-ready-icon" aria-hidden="true">✓</div>
                <div>
                  <div className="update-checker-ready-title">Tout est prêt</div>
                  <div className="update-checker-ready-text">
                    {installedCount} modèle{installedCount > 1 ? 's' : ''} Ollama disponible{installedCount > 1 ? 's' : ''}. Aucun bouton inutile ici.
                  </div>
                </div>
              </div>
            )}

            {actionableModels.length > 0 && (
              <div className="update-checker-group">
                <div className="update-checker-group-title">Modèles Ollama locaux</div>
                <div className="update-checker-group-subtitle">
                  Action requise uniquement pour les modèles manquants ou en erreur.
                </div>
                {actionableModels.map((entry) => {
                  const isBusy = entry.status === 'downloading';
                  const canPull = !isBusy && entry.status !== 'installed';
                  const actionLabel = entry.pullState?.status === 'error'
                    ? 'Reessayer'
                    : 'Installer';

                  return (
                    <div key={entry.model} className={`update-checker-item is-${entry.status}`}>
                      <div className="update-checker-item-main">
                        <div className="update-checker-status-icon" aria-hidden="true">
                          {entry.status === 'installed' && '✅'}
                          {entry.status === 'missing' && '⚠️'}
                          {entry.status === 'downloading' && '⏳'}
                          {entry.status === 'error' && '❌'}
                        </div>

                        <div className="update-checker-item-copy">
                          <div className="update-checker-model-name">{entry.model}</div>
                          <div className="update-checker-model-roles">{entry.roles.join(' · ')}</div>
                          {entry.status === 'downloading' && (
                            <div className="update-checker-model-status">
                              {entry.pullLabel || 'Téléchargement en cours'}
                            </div>
                          )}
                          {entry.status === 'error' && entry.error && (
                            <div className="update-checker-model-error">{entry.error}</div>
                          )}
                        </div>
                      </div>

                      <div className="update-checker-item-action">
                        {canPull && (
                          <button
                            type="button"
                            className="update-checker-install"
                            onClick={() => handleInstall(entry.model)}
                            disabled={isBusy}
                          >
                            {actionLabel}
                          </button>
                        )}
                        {entry.status === 'downloading' && (
                          <span className="update-checker-pill is-downloading">En cours</span>
                        )}
                      </div>

                      {entry.status === 'downloading' && (
                        <div className="update-checker-progress">
                          <div
                            className={`update-checker-progress-bar ${entry.progressPercent === null ? 'is-indeterminate' : ''}`}
                            style={entry.progressPercent === null ? undefined : { width: `${entry.progressPercent}%` }}
                          />
                          <span className="update-checker-progress-text">
                            {entry.progressPercent === null ? 'Calcul de la progression...' : `${entry.progressPercent}%`}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default UpdateChecker;
