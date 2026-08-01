import type { ThemeId, ThemeMeta, WorldKpis } from '../types';
import { THEMES, THEME_ORDER } from '../data/themes';

interface TopbarProps {
  theme: ThemeMeta;
  kpis: WorldKpis;
  /** True when wired to the real IDE AI bridge; false = local mock. */
  live: boolean;
  onThemeChange: (id: ThemeId) => void;
}

/** Header: product title, scene switcher and live project KPIs. */
export function Topbar({ theme, kpis, live, onThemeChange }: TopbarProps) {
  return (
    <header className="av-topbar">
      <div className="av-topbar__brand">
        <span className="av-topbar__logo" aria-hidden>AV</span>
        <span className="av-topbar__title">
          AgentVerse
          <small>{theme.name} - {theme.tagline}</small>
        </span>
        <span
          className={`av-mode${live ? ' av-mode--live' : ''}`}
          title={live ? "Agents connectes au moteur IA de l'IDE" : 'Donnees simulees (aucun moteur IA detecte)'}
        >
          <i className="av-mode__dot" />
          {live ? 'Live IA' : 'Demo'}
        </span>
      </div>

      <nav className="av-switcher" aria-label="Scène visuelle AgentVerse">
        {THEME_ORDER.map((id) => (
          <button
            key={id}
            type="button"
            className={`av-switcher__btn${theme.id === id ? ' is-active' : ''}`}
            onClick={() => onThemeChange(id)}
            aria-pressed={theme.id === id}
            aria-label={`Choisir la scène ${THEMES[id].name}`}
          >
            {THEMES[id].badge}
          </button>
        ))}
      </nav>

      <div className="av-kpis">
        <div className="av-kpi">
          <span className="av-kpi__value">{kpis.shipped}/{kpis.goal}</span>
          <span className="av-kpi__label">Features livrees</span>
        </div>
        <div className="av-kpi">
          <span className="av-kpi__value">{kpis.bugs}</span>
          <span className="av-kpi__label">Bugs ouverts</span>
        </div>
        <div className="av-kpi av-kpi--bar">
          <span className="av-kpi__value">{kpis.completion}%</span>
          <span className="av-kpi__track"><i style={{ width: `${kpis.completion}%` }} /></span>
        </div>
      </div>
    </header>
  );
}
