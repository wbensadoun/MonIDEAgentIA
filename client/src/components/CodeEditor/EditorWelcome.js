import React from 'react';
import { IconCode, IconSearch, IconTerminal, IconSparkle, IconGit, IconWorkflow } from '../ComponentLibrary/icons';

// ─── EditorWelcome ──────────────────────────────────────────────────────────
// Écran d'accueil affiché au centre de l'éditeur quand aucun fichier n'est
// ouvert (mode code). Remplace la surface Monaco vide par un panneau riche,
// dans l'esprit de la page d'accueil de VS Code / Cursor : raccourcis clavier
// actionnables et actions rapides.
//
// Règles du plan polish respectées :
//  - N4 : toutes les couleurs passent par les tokens de styles/tokens.css.
//  - N6 : le focus reste visible (anneau via --accent).
//  - N7 : pas de fond accent saturé ; --accent-soft et teintes de texte.
//
// Les actions sont des raccourcis clavier réels de l'IDE, déclenchés en
// simulant l'événement clavier global (les gestionnaires existent dans
// useCommandCenter / App.js). Aucune logique nouvelle n'est inventée.
const dispatchKey = (key, ctrl = true, shift = false) => {
  window.dispatchEvent(new KeyboardEvent('keydown', {
    key,
    ctrlKey: ctrl,
    metaKey: ctrl,
    shiftKey: shift,
    bubbles: true
  }));
};

const SHORTCUTS = [
  { icon: IconSearch, label: 'Ouvrir un fichier', keys: 'Ctrl+P', run: () => dispatchKey('p') },
  { icon: IconCode, label: 'Palette de commandes', keys: 'Ctrl+K', run: () => dispatchKey('k') },
  { icon: IconTerminal, label: 'Basculer le terminal', keys: 'Ctrl+J', run: () => dispatchKey('j') },
  { icon: IconSparkle, label: 'Recherche globale', keys: 'Ctrl+Shift+F', run: () => dispatchKey('f', true, true) }
];

const EditorWelcome = ({ projectName }) => (
  <div className="editor-welcome">
    <div className="editor-welcome-hero">
      <div className="editor-welcome-logo" aria-hidden="true">
        <IconCode size={22} />
      </div>
      <h2 className="editor-welcome-title">{projectName || 'Code Companion'}</h2>
      <p className="editor-welcome-subtitle">
        Ouvrez un fichier pour commencer, ou utilisez un raccourci.
      </p>
    </div>

    <div className="editor-welcome-grid" role="list" aria-label="Raccourcis rapides">
      {SHORTCUTS.map(({ icon: Icon, label, keys, run }) => (
        <button
          key={keys}
          type="button"
          role="listitem"
          className="editor-welcome-card"
          onClick={run}
        >
          <span className="editor-welcome-card-icon" aria-hidden="true">
            <Icon size={16} />
          </span>
          <span className="editor-welcome-card-copy">
            <span className="editor-welcome-card-title">{label}</span>
            <span className="editor-welcome-card-keys">{keys}</span>
          </span>
        </button>
      ))}
    </div>

    <div className="editor-welcome-foot">
      <span className="editor-welcome-foot-item"><IconGit size={13} /> Source Control</span>
      <span className="editor-welcome-foot-item"><IconWorkflow size={13} /> Workflows</span>
      <span className="editor-welcome-foot-item"><IconSparkle size={13} /> IA intégrée</span>
    </div>
  </div>
);

export default EditorWelcome;
