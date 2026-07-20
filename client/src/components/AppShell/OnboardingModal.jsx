import React from 'react';

const OnboardingModal = ({ onOpenSettings, onComplete }) => (
  <div className="command-overlay" onClick={onComplete}>
    <div className="command-modal is-wide" onClick={(event) => event.stopPropagation()}>
      <div className="command-input-row" style={{ justifyContent: 'space-between' }}>
        <strong>Bienvenue dans Vibe IDE</strong>
        <span className="command-hint">Onboarding</span>
      </div>
      <div className="command-list custom-scrollbar is-tall" style={{ padding: '14px' }}>
        <p style={{ marginTop: 0 }}>Checklist recommandee avant de commencer:</p>
        <p>1. Configurer vos cles API (Gemini/Kimi/Claude).</p>
        <p>2. Choisir un mode permissions adapte (lecture seule / edition / edition+terminal).</p>
        <p>3. Activer les quality gates si vous voulez valider lint/test/build avant application IA.</p>
        <div style={{ display: 'flex', gap: '8px', marginTop: '14px' }}>
          <button className="btn btn-primary" onClick={onOpenSettings}>Ouvrir settings</button>
          <button className="btn btn-ghost" onClick={onComplete}>Terminer</button>
        </div>
      </div>
    </div>
  </div>
);

export default OnboardingModal;
