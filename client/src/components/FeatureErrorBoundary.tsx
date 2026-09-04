import React, { ErrorInfo, ReactNode } from 'react';
import log from '../services/logger';

interface Props {
  feature?: string;
  fallback?: ReactNode;
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class FeatureErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const feature = this.props.feature ?? 'unknown';
    log.error(`[FeatureErrorBoundary:${feature}] ${error.message}`, {
      feature,
      stack: error.stack,
      componentStack: info.componentStack,
    });
  }

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      const feature = this.props.feature ?? 'ce panneau';
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          padding: '2rem',
          color: 'var(--text-muted, #888)',
          gap: '0.75rem',
          textAlign: 'center',
        }}>
          <span style={{ fontSize: '1.5rem' }}>&#9888;&#65039;</span>
          <strong style={{ color: 'var(--text-primary, #ccc)' }}>
            Erreur dans {feature}
          </strong>
          <p style={{ fontSize: '0.8rem', maxWidth: '280px' }}>
            {this.state.error?.message ?? 'Une erreur inattendue est survenue.'}
          </p>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              padding: '0.4rem 1rem',
              borderRadius: '6px',
              border: '1px solid var(--border, #444)',
              background: 'transparent',
              color: 'var(--text-primary, #ccc)',
              cursor: 'pointer',
              fontSize: '0.8rem',
            }}
          >
            R&#233;essayer
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default FeatureErrorBoundary;
