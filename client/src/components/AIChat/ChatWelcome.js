import React from 'react';
import { IconSparkle, IconCode, IconSearch, IconWrench, IconShield, IconBrain } from '../ComponentLibrary/icons';

// ─── ChatWelcome ────────────────────────────────────────────────────────────
// Écran d'accueil du panneau de chat quand aucune conversation n'existe.
// Remplace l'ancien état vide minimaliste (icône + 2 lignes) par une surface
// d'onboarding riche, dans l'esprit de Cursor / Windsurf : un héros de marque,
// puis des suggestions de prompts cliquables qui pré-remplissent la saisie.
//
// Règles du plan polish respectées :
//  - N4 : toutes les couleurs passent par les tokens de styles/tokens.css.
//  - N6 : le focus reste visible (anneau via --focus-ring / accent).
//  - N7 : l'accent plein est réservé ; ici on n'utilise que --accent-soft et
//    des teintes de texte, jamais un fond accent saturé « pour faire joli ».
const SUGGESTIONS = [
  {
    icon: IconSparkle,
    title: 'Expliquer ce projet',
    prompt: 'Explique-moi la structure de ce projet et son objectif principal.'
  },
  {
    icon: IconCode,
    title: 'Écrire du code',
    prompt: 'Aide-moi à implémenter une nouvelle fonctionnalité. Commence par me poser les bonnes questions.'
  },
  {
    icon: IconSearch,
    title: 'Trouver un bug',
    prompt: 'Analyse ce code et aide-moi à identifier un bug ou un comportement inattendu.'
  },
  {
    icon: IconWrench,
    title: 'Refactoriser',
    prompt: 'Refactorise ce code pour améliorer sa lisibilité et sa maintenabilité, sans changer son comportement.'
  },
  {
    icon: IconShield,
    title: 'Revue de sécurité',
    prompt: 'Fais une revue de sécurité de ce code et signale les vulnérabilités potentielles.'
  },
  {
    icon: IconBrain,
    title: 'Ajouter des tests',
    prompt: 'Propose des tests unitaires pertinents pour couvrir ce code.'
  }
];

const ChatWelcome = ({ onPickSuggestion }) => (
  <div className="chat-welcome">
    <div className="chat-welcome-hero">
      <div className="chat-welcome-logo" aria-hidden="true">
        <IconSparkle size={22} />
      </div>
      <h2 className="chat-welcome-title">Code Companion</h2>
      <p className="chat-welcome-subtitle">
        Votre copilote IA. Posez une question ou choisissez un point de départ.
      </p>
    </div>

    <div className="chat-welcome-grid" role="list" aria-label="Suggestions de départ">
      {SUGGESTIONS.map(({ icon: Icon, title, prompt }) => (
        <button
          key={title}
          type="button"
          role="listitem"
          className="chat-welcome-card"
          onClick={() => onPickSuggestion && onPickSuggestion(prompt)}
        >
          <span className="chat-welcome-card-icon" aria-hidden="true">
            <Icon size={16} />
          </span>
          <span className="chat-welcome-card-copy">
            <span className="chat-welcome-card-title">{title}</span>
          </span>
        </button>
      ))}
    </div>

    <p className="chat-welcome-hint">
      Astuce : utilisez <kbd>@</kbd> pour mentionner un fichier, <kbd>/</kbd> pour un workflow.
    </p>
  </div>
);

export default ChatWelcome;
