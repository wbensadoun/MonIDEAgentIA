import React, { useState, useEffect, useRef, useCallback } from 'react';
import './LivePreview.css';

const LivePreview = ({ 
  projectId, 
  status = 'stopped',
  previewUrl = null,
  onRefresh,
  className = ''
}) => {
  const [iframeState, setIframeState] = useState({
    loading: true,
    error: null,
    key: 0 // Pour forcer le reload
  });
  
  const [isReloading, setIsReloading] = useState(false);
  const iframeRef = useRef(null);
  const reloadTimeoutRef = useRef(null);
  const previousStatusRef = useRef(status);

  const isRunning = status === 'running';
  const isStopped = status === 'stopped';
  const isError = status === 'error';

  // URL de la preview
  const getPreviewUrl = useCallback(() => {
    if (previewUrl) return previewUrl;
    return `/preview/${projectId}`;
  }, [previewUrl, projectId]);

  // Reload manuel
  const handleManualRefresh = useCallback(() => {
    setIsReloading(true);
    setIframeState(prev => ({ ...prev, loading: true, error: null }));
    
    // Incrémente la key pour forcer le re-render de l'iframe
    setTimeout(() => {
      setIframeState(prev => ({
        ...prev,
        key: prev.key + 1,
        loading: true
      }));
      setIsReloading(false);
    }, 300);

    if (onRefresh) {
      onRefresh();
    }
  }, [onRefresh]);

  // Auto-reload quand le status passe à running
  useEffect(() => {
    const previousStatus = previousStatusRef.current;
    const justStarted = previousStatus !== 'running' && status === 'running';
    previousStatusRef.current = status;

    if (justStarted || (isRunning && iframeState.error)) {
      // Le serveur vient de démarrer, reload automatique
      reloadTimeoutRef.current = setTimeout(() => {
        handleManualRefresh();
      }, 500);
    }

    return () => {
      if (reloadTimeoutRef.current) {
        clearTimeout(reloadTimeoutRef.current);
      }
    };
  }, [status, isRunning, iframeState.error, handleManualRefresh]);

  // Gestion du chargement de l'iframe
  const handleIframeLoad = useCallback(() => {
    setIframeState(prev => ({ ...prev, loading: false }));
  }, []);

  // Gestion des erreurs de l'iframe
  const handleIframeError = useCallback(() => {
    setIframeState(prev => ({
      ...prev,
      loading: false,
      error: 'Erreur de chargement de la preview'
    }));
  }, []);

  // Message d'état pour l'overlay
  const getStatusMessage = () => {
    if (isStopped) {
      return {
        title: 'Serveur arrêté',
        description: 'Démarrez le serveur de développement pour voir la preview',
        icon: 'stopped'
      };
    }
    if (isError) {
      return {
        title: 'Erreur serveur',
        description: 'Le serveur a rencontré une erreur. Vérifiez les logs.',
        icon: 'error'
      };
    }
    if (iframeState.loading) {
      return {
        title: 'Démarrage...',
        description: 'Connexion au serveur de preview en cours',
        icon: 'loading'
      };
    }
    return null;
  };

  const statusMessage = getStatusMessage();

  return (
    <div className={`live-preview ${className}`}>
      {/* Header avec titre et bouton refresh */}
      <div className="live-preview-header">
        <div className="live-preview-title">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
          <span>Live Preview</span>
          {/* Indicateur de statut */}
          <span className={`status-indicator status-${status}`}>
            {isRunning && <span className="status-pulse" />}
            {status}
          </span>
        </div>
        
        <button 
          onClick={handleManualRefresh}
          disabled={!isRunning || isReloading}
          className="live-preview-refresh-btn"
          title="Rafraîchir la preview"
        >
          <svg 
            className={`w-4 h-4 ${isReloading ? 'animate-spin' : ''}`} 
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>

      {/* Container de l'iframe */}
      <div className="live-preview-container">
        {/* Skeleton loader */}
        {(iframeState.loading || isReloading) && (
          <div className="live-preview-skeleton">
            <div className="skeleton-header">
              <div className="skeleton-circle" />
              <div className="skeleton-line short" />
            </div>
            <div className="skeleton-content">
              <div className="skeleton-line" />
              <div className="skeleton-line" />
              <div className="skeleton-line medium" />
            </div>
            <div className="skeleton-content">
              <div className="skeleton-box" />
              <div className="skeleton-box" />
            </div>
          </div>
        )}

        {/* Iframe - masquée si pas running ou en erreur */}
        {isRunning && (
          <iframe
            key={iframeState.key}
            ref={iframeRef}
            src={getPreviewUrl()}
            className={`live-preview-iframe ${iframeState.loading ? 'iframe-hidden' : ''}`}
            onLoad={handleIframeLoad}
            onError={handleIframeError}
            sandbox="allow-scripts allow-forms allow-same-origin"
            title="Live Preview"
          />
        )}

        {/* Overlay quand le serveur n'est pas prêt */}
        {statusMessage && (
          <div className="live-preview-overlay">
            <div className="overlay-content">
              {/* Icône */}
              <div className={`overlay-icon overlay-icon-${statusMessage.icon}`}>
                {statusMessage.icon === 'stopped' && (
                  <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                )}
                {statusMessage.icon === 'error' && (
                  <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                )}
                {statusMessage.icon === 'loading' && (
                  <div className="overlay-spinner" />
                )}
              </div>
              
              {/* Texte */}
              <h3 className="overlay-title">{statusMessage.title}</h3>
              <p className="overlay-description">{statusMessage.description}</p>
              
              {/* Bouton d'action si applicable */}
              {isError && (
                <button 
                  onClick={handleManualRefresh}
                  className="overlay-action-btn"
                >
                  Réessayer
                </button>
              )}
            </div>
          </div>
        )}

        {/* Message d'erreur iframe */}
        {iframeState.error && isRunning && (
          <div className="live-preview-error">
            <div className="error-icon">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <p className="error-text">{iframeState.error}</p>
            <button 
              onClick={handleManualRefresh}
              className="error-retry-btn"
            >
              Réessayer
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default LivePreview;
