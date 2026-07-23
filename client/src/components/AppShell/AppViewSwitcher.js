import React from 'react';

/* ---- Icônes SVG inline ---- */
const IconCode = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="16 18 22 12 16 6" />
    <polyline points="8 6 2 12 8 18" />
  </svg>
);

const IconChat = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

const IconAgents = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2a2 2 0 0 1 2 2v2h-4V4a2 2 0 0 1 2-2z" />
    <rect x="4" y="6" width="16" height="12" rx="2" />
    <circle cx="9" cy="12" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="15" cy="12" r="1.5" fill="currentColor" stroke="none" />
    <path d="M9 16h6" />
    <path d="M2 10v4M22 10v4" />
  </svg>
);

const AppViewSwitcher = ({ viewMode = 'ide', onViewModeChange = () => {} }) => {
  const views = [
    { id: 'ide', label: 'IDE', icon: IconCode },
    { id: 'chat', label: 'Chat', icon: IconChat },
    { id: 'agents', label: 'Agents', icon: IconAgents },
  ];

  return (
    <div className="app-view-switcher">
      {views.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          className={`app-view-switcher__btn ${viewMode === id ? 'is-active' : ''}`}
          onClick={() => onViewModeChange(id)}
          title={`Basculer vers ${label}`}
          aria-pressed={viewMode === id}
          aria-label={`Basculer vers ${label}`}
        >
          <Icon />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
};

export default AppViewSwitcher;
