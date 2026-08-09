import React, { useMemo } from 'react';
import MessageViewer from '../AIChat/MessageViewer';
import { conversationToChatMessages } from '../../utils/chatMessages';
import { IconChat, IconExpand } from '../ComponentLibrary/icons';

/**
 * Contenu d'un onglet de chat (plan-ia-onglets.md §⑤ 5.5.3).
 *
 * Vue de LECTURE d'une session : le pipeline de generation IA (isLoading,
 * abortController, multiAIState...) est un singleton partage par toute
 * l'appli (useAI.js) qui n'opere que sur la session ACTIVE DU PANNEAU — il
 * ne peut donc pas exister deux compositeurs independants generant en
 * parallele pour deux sessions differentes sans reecrire ce pipeline en
 * profondeur, hors perimetre de ce chantier. Composer depuis l'onglet
 * basculerait forcement la session active du panneau, ce que 5.5.3 interdit
 * explicitement ("le panneau ne suit pas l'ouverture d'un onglet... ne
 * jamais perdre la place de l'utilisateur"). L'onglet reste donc une vue
 * epinglee du transcript, avec un bouton explicite pour reprendre la
 * conversation depuis le panneau quand on veut vraiment y repondre.
 *
 * "Une seule source de verite" (5.5.3) est neanmoins garanti : ce composant
 * lit `session.messages` directement depuis le tableau `sessions` partage
 * (App.js -> useAI -> useAIConversationSession), jamais une copie. Un
 * message envoye depuis le panneau apparait donc ici immediatement.
 */
const ChatSessionPane = ({ session, isActiveInPanel, onSwitchPanelToSession }) => {
  const messages = useMemo(
    () => conversationToChatMessages(session?.messages || []),
    [session]
  );

  if (!session) {
    return (
      <div className="chat-tab-pane chat-tab-pane--empty">
        <IconChat size={28} />
        <p>Cette session a ete supprimee.</p>
      </div>
    );
  }

  return (
    <div className="chat-tab-pane">
      <div className="chat-tab-pane-header">
        <IconChat size={14} />
        <span className="chat-tab-pane-title">{session.title}</span>
        {isActiveInPanel ? (
          <span className="chat-tab-pane-badge">Session active du panneau IA</span>
        ) : (
          typeof onSwitchPanelToSession === 'function' && (
            <button
              type="button"
              className="chat-tab-pane-switch"
              onClick={() => onSwitchPanelToSession(session.id)}
              title="Afficher cette session dans le panneau IA pour continuer la conversation"
            >
              <IconExpand size={12} />
              Reprendre dans le panneau IA
            </button>
          )
        )}
      </div>
      <div className="chat-tab-pane-body custom-scrollbar">
        <MessageViewer
          messages={messages}
          emptyState={<p>Aucun message dans cette conversation pour le moment.</p>}
        />
      </div>
    </div>
  );
};

export default ChatSessionPane;
