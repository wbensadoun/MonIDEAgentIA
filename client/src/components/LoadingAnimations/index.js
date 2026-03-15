import React, { useState, useEffect, useRef } from 'react';
import './LoadingAnimations.css';

// ─────────────────────────────────────────────────────────
// LoadingSteps (unchanged)
// ─────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────
// LoadingPulse (unchanged)
// ─────────────────────────────────────────────────────────
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

const PROVIDER_LABELS = {
  gemini: '🔷 Gemini',
  kimi: '🌙 Kimi K2.5',
  ollama: '🦙 Ollama',
  'ollama-multi': '🦙 Multi-Ollama',
  multi: '🤖 Multi-IA',
  claude: '🟠 Claude',
};

export const AIWorkingIndicator = ({ provider = 'gemini', statusText = 'L\'IA réfléchit...' }) => {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(Date.now());

  useEffect(() => {
    let timerInterval = null;
    const updateElapsed = () => {
      setElapsed((prev) => {
        const next = Math.floor((Date.now() - startRef.current) / 1000);
        return next === prev ? prev : next;
      });
    };
    const startTimer = () => {
      if (timerInterval) return;
      timerInterval = setInterval(updateElapsed, 1000);
    };
    const stopTimer = () => {
      if (!timerInterval) return;
      clearInterval(timerInterval);
      timerInterval = null;
    };
    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopTimer();
      } else {
        updateElapsed();
        startTimer();
      }
    };

    startTimer();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      stopTimer();
    };
  }, []);

  const providerLabel = PROVIDER_LABELS[provider] || `🤖 ${provider}`;

  return (
    <div className="ai-working">
      <div className="ai-working-top">
        <span className="ai-working-icon">🧠</span>
        <div className="ai-working-right">
          <span className="ai-working-phrase">
            {statusText}
          </span>
          <div className="ai-working-meta">
            <span className="ai-working-provider">{providerLabel}</span>
            {elapsed > 0 && (
              <span className="ai-working-timer">{elapsed}s</span>
            )}
          </div>
        </div>
        <div className="ai-dots">
          <div className="ai-dot" />
          <div className="ai-dot" />
          <div className="ai-dot" />
        </div>
      </div>
    </div>
  );
};



// ─────────────────────────────────────────────────────────
// SuccessAnimation
// ─────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────
// ErrorAnimation
// ─────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────
// VotingAnimation
// ─────────────────────────────────────────────────────────
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
  AIWorkingIndicator,
  SuccessAnimation,
  ErrorAnimation,
  VotingAnimation
};
