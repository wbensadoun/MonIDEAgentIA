import React from 'react';
import './LoadingAnimations.css';

export const LoadingSteps = ({ steps, currentStep }) => {
  const getStepStatus = (stepIndex) => {
    if (stepIndex < currentStep) return 'completed';
    if (stepIndex === currentStep) return 'active';
    return 'pending';
  };

  return (
    <div className="loading-steps">
      {steps.map((step, index) => {
        const status = getStepStatus(index);
        return (
          <div key={index} className={`step step-${status}`}>
            <div className="step-indicator">
              {status === 'completed' ? (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              ) : status === 'active' ? (
                <div className="step-spinner" />
              ) : (
                <span className="step-number">{index + 1}</span>
              )}
            </div>
            <div className="step-content">
              <span className="step-label">{step.label}</span>
              {step.provider && <span className="step-provider">{step.provider}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export const LoadingPulse = ({ text, variant = 'default' }) => {
  const variants = {
    default: 'from-cyan-500 to-blue-600',
    success: 'from-green-500 to-emerald-600',
    error: 'from-red-500 to-pink-600',
    warning: 'from-yellow-500 to-orange-600'
  };

  return (
    <div className={`loading-pulse ${variants[variant]}`}>
      <div className="pulse-ring" />
      <div className="pulse-ring pulse-ring-delayed" />
      <div className="pulse-center" />
      <span className="pulse-text">{text}</span>
    </div>
  );
};

export const SuccessAnimation = ({ message, onComplete }) => {
  React.useEffect(() => {
    const timer = setTimeout(onComplete, 2000);
    return () => clearTimeout(timer);
  }, [onComplete]);

  return (
    <div className="success-animation">
      <div className="success-checkmark">
        <svg className="checkmark" viewBox="0 0 52 52">
          <circle className="checkmark-circle" cx="26" cy="26" r="25" fill="none" />
          <path className="checkmark-check" fill="none" d="M14.1 27.2l7.1 7.2 16.7-16.8" />
        </svg>
      </div>
      <p className="success-message">{message}</p>
    </div>
  );
};

export const ErrorAnimation = ({ message, onRetry, onDismiss }) => {
  return (
    <div className="error-animation">
      <div className="error-icon">
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>
      <p className="error-message">{message}</p>
      <div className="error-actions">
        {onRetry && (
          <button onClick={onRetry} className="error-btn retry">
            Réessayer
          </button>
        )}
        {onDismiss && (
          <button onClick={onDismiss} className="error-btn dismiss">
            Fermer
          </button>
        )}
      </div>
    </div>
  );
};

export const VotingAnimation = ({ votes, total }) => {
  return (
    <div className="voting-animation">
      <div className="voting-header">
        <span className="voting-title">Vote en cours...</span>
        <span className="voting-progress">{votes}/{total}</span>
      </div>
      <div className="voting-bars">
        {Array.from({ length: total }).map((_, i) => (
          <div 
            key={i} 
            className={`voting-bar ${i < votes ? 'voted' : ''}`}
            style={{ animationDelay: `${i * 0.1}s` }}
          />
        ))}
      </div>
    </div>
  );
};

export default {
  LoadingSteps,
  LoadingPulse,
  SuccessAnimation,
  ErrorAnimation,
  VotingAnimation
};
