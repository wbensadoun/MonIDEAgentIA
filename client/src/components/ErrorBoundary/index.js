import React from 'react';
import './ErrorBoundary.css';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(_error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ error, errorInfo });
    console.error('[ErrorBoundary] Error caught:', error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary-container">
          <div className="error-boundary-content">
            <div className="error-icon">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
              </svg>
            </div>
            <h1 className="error-title">Une erreur est survenue</h1>
            <p className="error-message">
              L&apos;application a rencontré une erreur inattendue.
            </p>
            {this.state.error && (
              <details className="error-details">
                <summary>Détails techniques</summary>
                <pre className="error-stack">
                  {this.state.error.toString()}\n\n
                  {this.state.errorInfo?.componentStack}
                </pre>
              </details>
            )}
            <div className="error-actions">
              <button type="button" onClick={this.handleReset} className="error-button primary">
                Ressayer
              </button>
              <button type="button" onClick={this.handleReload} className="error-button secondary">
                Recharger l&apos;application
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
