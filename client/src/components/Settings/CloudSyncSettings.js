import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { IconCloud, IconDownload, IconRepeat as IconRefresh, IconUpload } from '../ComponentLibrary/icons';

const RESOURCE_TYPES = [
  { id: 'agents', label: 'Agents', singular: 'agent' },
  { id: 'skills', label: 'Skills', singular: 'skill' },
  { id: 'workflows', label: 'Workflows', singular: 'workflow' }
];

const getItems = (response, type) => (response?.success && Array.isArray(response[type]) ? response[type] : []);

const formatSize = (size) => {
  if (!Number.isFinite(Number(size))) return null;
  const value = Number(size);
  if (value < 1024) return `${value} o`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} Ko`;
  return `${(value / (1024 * 1024)).toFixed(1)} Mo`;
};

const formatDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString('fr-FR');
};

export default function CloudSyncSettings({ isElectronApiAvailable, showMessage }) {
  const [status, setStatus] = useState(null);
  const [resources, setResources] = useState({ agents: [], skills: [], workflows: [] });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState(null);

  const api = useMemo(() => window.electronAPI || {}, []);

  const refresh = useCallback(async ({ announce = false } = {}) => {
    if (!isElectronApiAvailable || typeof api.cloudflareAgentsStatus !== 'function') {
      setStatus({ configured: false, enabled: false, unavailable: true });
      setResources({ agents: [], skills: [], workflows: [] });
      setLoading(false);
      return;
    }

    setLoading(true);
    setErrors({});
    try {
      const nextStatus = await api.cloudflareAgentsStatus();
      if (!nextStatus?.success) throw new Error(nextStatus?.error || 'Statut Cloud Sync indisponible');
      setStatus(nextStatus);
      if (nextStatus.configured && nextStatus.enabled) {
        // Le statut est local : on charge explicitement après l’avoir reçu.
        const responses = await Promise.all(RESOURCE_TYPES.map(async ({ id }) => {
          try {
            const response = await api.cloudflareAgentsList(id);
            return [id, response?.success ? null : (response?.error || 'Listage impossible'), getItems(response, id)];
          } catch (error) {
            return [id, error.message || 'Listage impossible', []];
          }
        }));
        const nextResources = { agents: [], skills: [], workflows: [] };
        const nextErrors = {};
        responses.forEach(([type, error, items]) => {
          nextResources[type] = items;
          if (error) nextErrors[type] = error;
        });
        setResources(nextResources);
        setErrors(nextErrors);
      } else {
        setResources({ agents: [], skills: [], workflows: [] });
      }
      if (announce) showMessage?.('Liste Cloud Sync actualisée.', 2500);
    } catch (error) {
      setStatus({ configured: false, enabled: false, error: error.message });
      setErrors({ global: error.message });
      showMessage?.(`Cloud Sync : ${error.message}`, 3500);
    } finally {
      setLoading(false);
    }
  }, [api, isElectronApiAvailable, showMessage]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const runPushAll = async (type = null) => {
    if (typeof api.cloudflareAgentsPushAll !== 'function') return;
    const types = type ? [type] : RESOURCE_TYPES.map(({ id }) => id);
    setBusyAction(type ? `push:${type}` : 'push:all');
    try {
      const results = [];
      for (const resourceType of types) {
        results.push(await api.cloudflareAgentsPushAll(resourceType));
      }
      const failed = results.filter((result) => !result?.success);
      if (failed.length) throw new Error(failed[0]?.error || 'Publication Cloud Sync impossible');
      const pushed = results.reduce((total, result) => total + Number(result?.pushed || 0), 0);
      showMessage?.(`${pushed} ressource${pushed > 1 ? 's' : ''} publiée${pushed > 1 ? 's' : ''}.`, 3000);
      await refresh();
    } catch (error) {
      showMessage?.(`Publication Cloud Sync : ${error.message}`, 4000);
    } finally {
      setBusyAction(null);
    }
  };

  const pullResource = async (name, type) => {
    if (typeof api.cloudflareAgentsPull !== 'function') return;
    setBusyAction(`pull:${type}:${name}`);
    try {
      const result = await api.cloudflareAgentsPull(name, type);
      if (!result?.success) throw new Error(result?.error || 'Récupération impossible');
      showMessage?.(`${name} récupéré dans la bibliothèque locale.`, 3000);
      await refresh();
    } catch (error) {
      showMessage?.(`Récupération Cloud Sync : ${error.message}`, 4000);
    } finally {
      setBusyAction(null);
    }
  };

  const statusView = !isElectronApiAvailable || status?.unavailable
    ? { label: 'Indisponible hors application', className: 'is-neutral' }
    : loading && !status
      ? { label: 'Lecture du statut…', className: 'is-loading' }
      : !status?.configured
        ? { label: 'Non configuré', className: 'is-error' }
        : !status.enabled
          ? { label: 'Configuré mais désactivé', className: 'is-warning' }
          : { label: 'Synchronisation active', className: 'is-ok' };

  return (
    <div className="settings-cloud-sync" aria-busy={loading || Boolean(busyAction)}>
      <div className="settings-section settings-cloud-sync-intro">
        <div className="settings-cloud-sync-heading">
          <div>
            <label className="settings-label">Sync Cloud</label>
            <p className="settings-hint">
              Publiez et récupérez les ressources globales via l’API Cloudflare configurée dans le processus principal.
            </p>
          </div>
          <span className={`settings-cloud-sync-badge ${statusView.className}`} role="status">
            <IconCloud size={14} />
            {statusView.label}
          </span>
        </div>
        {status?.error && <p className="settings-warning">{status.error}</p>}
        {status && !status.configured && !status.unavailable && (
          <p className="settings-hint">Renseignez CF_AGENTS_API_URL et une couche d’authentification dans le .env Electron.</p>
        )}
        {status?.configured && !status.enabled && (
          <p className="settings-warning">Le serveur est configuré, mais CF_AGENTS_SYNC_ENABLED n’est pas activé.</p>
        )}
        {errors.global && <p className="settings-warning">{errors.global}</p>}
        <div className="settings-cloud-sync-actions">
          <button type="button" className="btn btn-primary" onClick={() => runPushAll()} disabled={!status?.configured || !status?.enabled || Boolean(busyAction)}>
            <IconUpload size={14} />
            Publier tout
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => refresh({ announce: true })} disabled={loading || Boolean(busyAction)}>
            <IconRefresh size={14} />
            Actualiser
          </button>
        </div>
      </div>

      {RESOURCE_TYPES.map(({ id, label }) => (
        <section className="settings-section settings-cloud-sync-type" key={id} aria-labelledby={`cloud-sync-${id}`}>
          <div className="settings-cloud-sync-type-head">
            <div>
              <h3 id={`cloud-sync-${id}`} className="settings-cloud-sync-type-title">{label}</h3>
              <span className="settings-hint">{resources[id].length} ressource{resources[id].length > 1 ? 's' : ''} distante{resources[id].length > 1 ? 's' : ''}</span>
            </div>
            <button type="button" className="btn btn-ghost" onClick={() => runPushAll(id)} disabled={!status?.configured || !status?.enabled || Boolean(busyAction)}>
              <IconUpload size={13} />
              Publier {label.toLowerCase()}
            </button>
          </div>
          {errors[id] && <p className="settings-warning">{errors[id]}</p>}
          {!loading && !errors[id] && resources[id].length === 0 && (
            <p className="settings-hint settings-cloud-sync-empty">Aucune ressource distante.</p>
          )}
          {resources[id].length > 0 && (
            <ul className="settings-cloud-sync-list">
              {resources[id].map((item) => (
                <li className="settings-cloud-sync-item" key={`${id}:${item.name}`}>
                  <div className="settings-cloud-sync-item-meta">
                    <strong>{item.name}</strong>
                    <span>
                      {[formatSize(item.size), formatDate(item.updatedAt)].filter(Boolean).join(' · ') || 'Détails indisponibles'}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => pullResource(item.name, id)}
                    disabled={!status?.configured || !status?.enabled || Boolean(busyAction)}
                    aria-label={`Récupérer ${item.name}`}
                  >
                    <IconDownload size={13} />
                    Récupérer
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
